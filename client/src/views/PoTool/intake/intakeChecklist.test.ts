// intakeChecklist.test.ts — Contract tests for the decision engine (spec 037, contracts/decision-engine.md):
// which decisions are open, whose turn each is, which step is current, and the invariants that keep a PO's
// answer safe from later replies.

import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  createOpenDecision,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type EpicIntake,
  type IntakeItem,
  type SourceLine,
} from './epicIntakeModel.ts';
import {
  handStepToPo,
  isItemReadyToCreate,
  listOpenDecisions,
  MAX_AI_ATTEMPTS_PER_DECISION,
  readIntakeNextStep,
  recordAiProposal,
  recordAiRejection,
  refreshApplicability,
  replaceIntakeItem,
  routeDecisionToPo,
  settleDecision,
} from './intakeChecklist.ts';

// ── Builders ──

function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 1 };
}

function buildIntake(items: IntakeItem[], lineCount = items.length): EpicIntake {
  const lines = Array.from({ length: lineCount }, (_, index) => buildLine(index + 1, `line ${index + 1}`));
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: '2026-09-18T00:00:00.000Z',
    updatedAtIso: '2026-09-18T00:00:00.000Z',
    sourceTitles: ['Pasted notes'],
    lines,
    items,
    setAsideLines: [],
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

function settled<TValue>(value: TValue, settledBy: 'rule' | 'ai' | 'po' = 'rule'): Decision<TValue> {
  return { state: 'settled', value, settledBy, reason: 'test', aiAttempts: 0 };
}

/** An item one line long whose decisions are settled up to (and including) the named stage. */
function buildItem(itemNumber: number, stage: 'none' | 'kind' | 'owner' | 'terms' | 'searched' | 'createNew' | 'labelled' | 'drafted' | 'accepted' | 'created'): IntakeItem {
  const item = createIntakeItem(itemNumber, `Item ${itemNumber}`, [itemNumber]);
  const order = ['none', 'kind', 'owner', 'terms', 'searched', 'createNew', 'labelled', 'drafted', 'accepted', 'created'];
  const reached = (name: string): boolean => order.indexOf(stage) >= order.indexOf(name);
  if (reached('kind')) item.decisions.kind = settled('work');
  if (reached('owner')) item.decisions.owner = settled('enrollment');
  if (reached('terms')) item.decisions.searchTerms = settled(['core integration'], 'ai');
  if (reached('searched')) item.searchStatus = 'ok';
  if (reached('createNew')) item.decisions.duplicate = settled({ verdict: 'createNew' });
  if (reached('labelled')) item.decisions.label = settled('Roadmap', 'po');
  if (reached('drafted')) item.draft = { summary: `Item ${itemNumber}`, description: 'Description:\nx', source: 'ai', editedByPo: false };
  if (reached('accepted')) item.decisions.draftAccepted = settled('accepted', 'po');
  if (reached('created')) item.creation = { state: 'created', key: `DENP-${itemNumber}`, createdAtIso: '2026-09-18T00:00:00.000Z' };
  return item;
}

// ── §3 / §5 Step derivation ──

describe('readIntakeNextStep — step derivation', () => {
  it('starts at sorting the notes, on the assistant, when unlocked', () => {
    const next = readIntakeNextStep(buildIntake([buildItem(1, 'none')]), true);
    expect(next.step).toBe('sortNotes');
    expect(next.turn).toBe('ai');
  });

  it('gives every assistant turn to the PO when locked (INV-5)', () => {
    const intake = buildIntake([buildItem(1, 'none'), buildItem(2, 'kind')]);
    const openDecisions = listOpenDecisions(intake, false);
    expect(openDecisions.length).toBeGreaterThan(0);
    expect(openDecisions.every((openDecision) => openDecision.turn !== 'ai')).toBe(true);
    expect(readIntakeNextStep(intake, false).turn).toBe('po');
  });

  it('moves to deciding owners once every kind is settled', () => {
    const item = buildItem(1, 'kind');
    item.decisions.searchTerms = settled(['x'], 'ai');
    expect(readIntakeNextStep(buildIntake([item]), true).step).toBe('decideOwners');
  });

  it('asks Toolbox to check DENP once an Enrollment item has terms and no search', () => {
    const next = readIntakeNextStep(buildIntake([buildItem(1, 'terms')]), true);
    expect(next).toMatchObject({ step: 'checkDenp', turn: 'toolbox' });
  });

  it('uses Toolbox fallback terms at Check DENP when locked, instead of a PO question', () => {
    const openDecisions = listOpenDecisions(buildIntake([buildItem(1, 'owner')]), false);
    expect(openDecisions).toContainEqual(expect.objectContaining({ slot: 'searchTerms', step: 'checkDenp', turn: 'toolbox' }));
  });

  it('asks for a match once the search ran', () => {
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'searched')]), true)).toMatchObject({ step: 'match', turn: 'ai' });
  });

  it('keeps a failed search on Toolbox and never reaches create (INV-4)', () => {
    const item = buildItem(1, 'terms');
    item.searchStatus = 'failed';
    item.searchFailureReason = 'Jira unreachable';
    const next = readIntakeNextStep(buildIntake([item]), true);
    expect(next).toMatchObject({ step: 'checkDenp', turn: 'toolbox' });
    expect(isItemReadyToCreate(item)).toBe(false);
  });

  it('asks the PO for a label on create-new items, never the assistant', () => {
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'createNew')]), true)).toMatchObject({ step: 'confirmLabels', turn: 'po' });
  });

  it('asks the assistant for a draft when none exists, the PO to accept once one does', () => {
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'labelled')]), true)).toMatchObject({ step: 'draft', turn: 'ai' });
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'drafted')]), true)).toMatchObject({ step: 'draft', turn: 'po' });
  });

  it('hands creation to Toolbox after acceptance, and is done once created', () => {
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'accepted')]), true)).toMatchObject({ step: 'create', turn: 'toolbox' });
    expect(readIntakeNextStep(buildIntake([buildItem(1, 'created')]), true)).toMatchObject({ step: 'summary', turn: 'done', openCount: 0 });
  });

  it('points at the EARLIEST step with a gap across items', () => {
    const ownerStillOpen = buildItem(2, 'kind');
    ownerStillOpen.decisions.searchTerms = settled(['x'], 'ai');
    const next = readIntakeNextStep(buildIntake([buildItem(1, 'accepted'), ownerStillOpen]), true);
    expect(next.step).toBe('decideOwners');
  });

  it('prefers the assistant, then Toolbox, then the PO within one step', () => {
    const awaitingPo = buildItem(1, 'none');
    awaitingPo.decisions.kind = routeDecisionToPo(awaitingPo.decisions.kind);
    awaitingPo.decisions.searchTerms = settled(['x'], 'ai');
    const aiItem = buildItem(2, 'none');
    expect(readIntakeNextStep(buildIntake([awaitingPo, aiItem]), true).turn).toBe('ai');
    expect(readIntakeNextStep(buildIntake([awaitingPo]), true).turn).toBe('po');
  });

  it('describes the next action without naming the assistant, prompts or replies when locked', () => {
    const stages = ['none', 'kind', 'terms', 'searched', 'createNew', 'labelled', 'drafted', 'accepted', 'created'] as const;
    for (const stage of stages) {
      const { nextAction } = readIntakeNextStep(buildIntake([buildItem(1, stage)]), false);
      expect(nextAction).not.toMatch(/\bAI\b|assistant|unlock|prompt|reply/i);
      expect(nextAction.length).toBeGreaterThan(0);
    }
  });
});

// ── §4 Turn rules ──

describe('turn rules', () => {
  it('hands a slot to the PO after the maximum failed attempts (FR-007)', () => {
    const item = buildItem(1, 'none');
    let kind = item.decisions.kind;
    for (let attempt = 0; attempt < MAX_AI_ATTEMPTS_PER_DECISION; attempt += 1) {
      expect(listOpenDecisions(buildIntake([{ ...item, decisions: { ...item.decisions, kind } }]), true)
        .find((openDecision) => openDecision.slot === 'kind')?.turn).toBe('ai');
      kind = recordAiRejection(kind, 'unknown kind "task"');
    }
    const openKind = listOpenDecisions(buildIntake([{ ...item, decisions: { ...item.decisions, kind } }]), true)
      .find((openDecision) => openDecision.slot === 'kind');
    expect(openKind?.turn).toBe('po');
  });

  it('reports a coverage gap as a PO decision in the sorting step', () => {
    const intake = buildIntake([buildItem(1, 'kind')], 2);
    const gaps = listOpenDecisions(intake, true).filter((openDecision) => openDecision.slot === 'lineCoverage');
    expect(gaps).toEqual([expect.objectContaining({ itemId: null, step: 'sortNotes', turn: 'po', lineNumber: 2 })]);
  });

  it('counts exactly the open decisions it lists (INV-6)', () => {
    const intake = buildIntake([buildItem(1, 'none'), buildItem(2, 'searched'), buildItem(3, 'created')]);
    expect(readIntakeNextStep(intake, true).openCount).toBe(listOpenDecisions(intake, true).length);
  });

  it('is a pure function of the intake and the lock (INV-2)', () => {
    const intake = buildIntake([buildItem(1, 'terms'), buildItem(2, 'none')]);
    expect(readIntakeNextStep(intake, true)).toEqual(readIntakeNextStep(structuredClone(intake), true));
  });

  it('is done exactly when nothing is open (INV-3)', () => {
    const doneIntake = buildIntake([buildItem(1, 'created')]);
    expect(listOpenDecisions(doneIntake, true)).toEqual([]);
    expect(readIntakeNextStep(doneIntake, true).turn).toBe('done');
  });
});

// ── Settling (INV-1) ──

describe('settleDecision / recordAiRejection / routeDecisionToPo', () => {
  it('settles an open slot and carries the attempt count', () => {
    const rejected = recordAiRejection(createOpenDecision<string>(), 'bad');
    expect(settleDecision(rejected, 'work', 'ai', 'reply')).toEqual({
      state: 'settled', value: 'work', settledBy: 'ai', reason: 'reply', aiAttempts: 1,
    });
  });

  it('never lets a rule or a reply change a slot the PO settled (INV-1)', () => {
    const poSettled = settled('fulfillment', 'po');
    expect(settleDecision(poSettled, 'enrollment', 'ai', 'reply')).toBe(poSettled);
    expect(settleDecision(poSettled, 'enrollment', 'rule', 'sizes')).toBe(poSettled);
    expect(recordAiRejection(poSettled, 'x')).toBe(poSettled);
    expect(routeDecisionToPo(poSettled)).toBe(poSettled);
  });

  it('ignores a reply that answers an already settled slot', () => {
    const ruleSettled = settled('enrollment', 'rule');
    expect(settleDecision(ruleSettled, 'fulfillment', 'ai', 'reply')).toBe(ruleSettled);
  });

  it('lets the PO override a rule or reply', () => {
    expect(settleDecision(settled('enrollment', 'rule'), 'fulfillment', 'po', 'PO choice'))
      .toMatchObject({ value: 'fulfillment', settledBy: 'po' });
  });

  it('never settles a slot that does not apply', () => {
    const notApplicable: Decision<string> = { state: 'notApplicable', reason: 'not work' };
    expect(settleDecision(notApplicable, 'x', 'po', 'x')).toBe(notApplicable);
  });

  it('keeps a proposal and its reason when routing to the PO', () => {
    expect(routeDecisionToPo(createOpenDecision<string>(), 'enrollment', 'share 50%')).toMatchObject({
      state: 'open', isAwaitingPo: true, aiProposal: 'enrollment', aiReason: 'share 50%',
    });
  });
});

// ── §6 Applicability ──

describe('refreshApplicability', () => {
  it('closes every downstream slot for non-work items', () => {
    const item = buildItem(1, 'none');
    item.decisions.kind = settled('risk');
    const refreshed = refreshApplicability(item);
    for (const slot of ['owner', 'searchTerms', 'duplicate', 'label', 'draftAccepted'] as const) {
      expect(refreshed.decisions[slot].state).toBe('notApplicable');
    }
  });

  it('closes search, match, label and draft for Fulfillment-owned work', () => {
    const item = buildItem(1, 'kind');
    item.decisions.owner = settled('fulfillment');
    const refreshed = refreshApplicability(item);
    expect(refreshed.decisions.owner.state).toBe('settled');
    expect(refreshed.decisions.duplicate.state).toBe('notApplicable');
    expect(refreshed.decisions.label.state).toBe('notApplicable');
  });

  it('closes label and draft when an existing Epic covers the item', () => {
    const item = buildItem(1, 'searched');
    item.decisions.duplicate = settled({ verdict: 'existing', key: 'DENP-632' });
    const refreshed = refreshApplicability(item);
    expect(refreshed.decisions.label.state).toBe('notApplicable');
    expect(refreshed.decisions.draftAccepted.state).toBe('notApplicable');
  });

  it('re-opens downstream slots when the PO reverses a kind, keeping PO-settled slots', () => {
    const item = buildItem(1, 'none');
    item.decisions.kind = settled('risk');
    const closed = refreshApplicability(item);
    closed.decisions.kind = settled('work', 'po');
    const reopened = refreshApplicability(closed);
    expect(reopened.decisions.owner).toEqual(createOpenDecision());
    expect(reopened.decisions.duplicate).toEqual(createOpenDecision());
  });

  it('leaves settled slots settled even when they stop applying (INV-1)', () => {
    const item = buildItem(1, 'labelled');
    item.decisions.owner = settled('fulfillment', 'po');
    const refreshed = refreshApplicability(item);
    expect(refreshed.decisions.label).toEqual(item.decisions.label);
  });

  it('does not list an item for creation once its owner changes away from Enrollment', () => {
    const item = buildItem(1, 'accepted');
    item.decisions.owner = settled('fulfillment', 'po');
    expect(isItemReadyToCreate(refreshApplicability(item))).toBe(false);
  });
});

describe('recordAiProposal', () => {
  it('keeps a suggestion on an open slot without settling it', () => {
    expect(recordAiProposal(createOpenDecision<string>(), 'Roadmap', 'new capability')).toMatchObject({
      state: 'open', isAwaitingPo: false, aiProposal: 'Roadmap', aiReason: 'new capability',
    });
  });

  it('leaves a settled slot alone', () => {
    const poSettled = settled('Stability', 'po');
    expect(recordAiProposal(poSettled, 'Roadmap', null)).toBe(poSettled);
  });
});

describe('handStepToPo', () => {
  it('moves every assistant question in the step to the PO and nothing else', () => {
    const intake = buildIntake([buildItem(1, 'none'), buildItem(2, 'searched')]);
    const handed = handStepToPo(intake, 'sortNotes');
    const sortingTurns = listOpenDecisions(handed, true).filter((openDecision) => openDecision.step === 'sortNotes');
    expect(sortingTurns.every((openDecision) => openDecision.turn === 'po')).toBe(true);
    expect(listOpenDecisions(handed, true).find((openDecision) => openDecision.slot === 'duplicate')?.turn).toBe('ai');
  });
});

describe('replaceIntakeItem', () => {
  it('swaps one item by id and leaves the rest untouched', () => {
    const intake = buildIntake([buildItem(1, 'none'), buildItem(2, 'none')]);
    const replacement = { ...intake.items[1], title: 'Replaced' };
    const updated = replaceIntakeItem(intake, replacement);
    expect(updated.items[1].title).toBe('Replaced');
    expect(updated.items[0]).toBe(intake.items[0]);
    expect(intake.items[1].title).toBe('Item 2');
  });
});
