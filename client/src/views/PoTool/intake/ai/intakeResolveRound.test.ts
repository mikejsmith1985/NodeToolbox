// intakeResolveRound.test.ts — Contract tests for the single "resolve" exchange of an Epic Intake: one request
// answers every item's duplicate verdict, label and new-Epic draft at once; the PO then reviews the table and
// clicking Create is the only confirmation (spec 037, contracts/ai-rounds.md, AI-first redesign).

import { describe, expect, it } from 'vitest';

import { SECTION_LABELS } from '../../ai/featureDocSections.ts';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type DuplicateCandidate,
  type EpicIntake,
  type IntakeItem,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { isItemCreatableAfterReview, listOpenDecisions, MAX_AI_ATTEMPTS_PER_DECISION } from '../intakeChecklist.ts';
import { MAX_EPIC_SUMMARY_CHARS, SHARED_SCOPE_SUFFIX } from './intakeDraftRound.ts';
import {
  applyResolveOutcome,
  buildResolveRequests,
  MAX_CANDIDATES_IN_PROMPT,
  parseResolveReply,
  RESOLVE_REPLY_KIND,
} from './intakeResolveRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const SINGLE_PART = { partIndex: 0, partCount: 1 };
const LONG_LINE_CHARS = 2500;

function settled<TValue>(value: TValue, settledBy: 'rule' | 'ai' | 'po' = 'rule'): Decision<TValue> {
  return { state: 'settled', value, settledBy, reason: 'test', aiAttempts: 0 };
}

function buildCandidate(key: string, excerpt = 'excerpt'): DuplicateCandidate {
  return { key, summary: `Epic ${key}`, statusName: 'In Progress', statusCategory: 'indeterminate', descriptionExcerpt: excerpt, foundBy: 'search' };
}

/** An Enrollment work item that has been searched and has the given candidates, match still open. */
function buildSearchedItem(itemNumber: number, candidateKeys: string[]): IntakeItem {
  const item = createIntakeItem(itemNumber, `Item ${itemNumber}`, [itemNumber]);
  item.decisions.kind = settled('work');
  item.decisions.owner = settled('enrollment');
  item.decisions.searchTerms = settled(['term']);
  item.searchStatus = 'ok';
  item.candidates = candidateKeys.map((key) => buildCandidate(key));
  return item;
}

/** A searched item Toolbox already decided needs a new Epic (no candidates). */
function buildNewEpicItem(itemNumber: number): IntakeItem {
  const item = buildSearchedItem(itemNumber, []);
  item.decisions.duplicate = settled({ verdict: 'createNew' as const });
  return item;
}

function buildLines(items: IntakeItem[], lineText: (item: IntakeItem) => string = (item) => item.title): SourceLine[] {
  return items.map((item) => ({ lineNumber: item.lineNumbers[0], text: lineText(item), rawText: `• ${lineText(item)}`, outlineLevel: 1 as const }));
}

function buildIntake(items: IntakeItem[], lines: SourceLine[] = buildLines(items)): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION, id: 'i', teamProfileId: 't', name: 'n', targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO, updatedAtIso: NOW_ISO, sourceTitles: [], lines, items, setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' }, batchRequiredFieldValues: {}, roundHistory: [],
  };
}

function reply(items: unknown[]): string {
  return JSON.stringify({ kind: RESOLVE_REPLY_KIND, items });
}

function resolveOnce(intake: EpicIntake, replyItems: unknown[], askedItemIds: string[]): EpicIntake {
  return applyResolveOutcome(intake, parseResolveReply(reply(replyItems), intake, askedItemIds), askedItemIds, SINGLE_PART, NOW_ISO);
}

const FULL_NEW_ANSWER = { verdict: 'createNew', confidence: 'high', reason: 'nothing covers it', label: 'Roadmap', summary: 'New thing', description: 'Description:\nDo it.' };

// ── Building the request ──

describe('buildResolveRequests', () => {
  it('asks open matches and new Epics in one request, listing each item\'s own Epics and all nine sections', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700']), buildNewEpicItem(3)]);
    intake.items[1].decisions.duplicate = settled({ verdict: 'existing' as const, key: 'DENP-700' });
    const [request, ...otherRequests] = buildResolveRequests(intake);
    expect(otherRequests).toEqual([]);
    expect(request).toMatchObject({ itemIds: ['item-1', 'item-3'], partIndex: 0, partCount: 1 });
    expect(request.text).toContain('DENP-632 [In Progress] Epic DENP-632 — excerpt');
    expect(request.text).not.toContain('DENP-700');
    expect(request.text).toContain(`"kind":"${RESOLVE_REPLY_KIND}"`);
    expect(request.text).not.toMatch(/part \d of/);
    for (const label of SECTION_LABELS) {
      expect(request.text).toContain(`- ${label}`);
    }
  });

  it('caps the Epics shown per item and shortens long excerpts', () => {
    const item = buildSearchedItem(1, Array.from({ length: MAX_CANDIDATES_IN_PROMPT + 2 }, (_, index) => `DENP-${100 + index}`));
    item.candidates[0] = buildCandidate('DENP-100', 'x'.repeat(300));
    const [request] = buildResolveRequests(buildIntake([item]));
    expect(request.text).toContain(`DENP-${100 + MAX_CANDIDATES_IN_PROMPT - 1}`);
    expect(request.text).not.toContain(`DENP-${100 + MAX_CANDIDATES_IN_PROMPT}`);
    expect(request.text).not.toContain('x'.repeat(121));
    expect(request.text).toContain('x'.repeat(120));
  });

  it('tells the assistant to write only Enrollment\'s part of a Shared item', () => {
    const item = buildNewEpicItem(1);
    item.decisions.owner = settled('shared', 'po');
    const [request] = buildResolveRequests(buildIntake([item]));
    expect(request.text).toMatch(/item-1[^\n]*shared with Fulfillment[^\n]*Enrollment's part only/i);
  });

  it('asks nothing once every item is decided, drafted, or handed to the PO', () => {
    const drafted = buildNewEpicItem(1);
    drafted.decisions.label = settled('Roadmap', 'ai');
    drafted.draft = { summary: 's', description: 'd', source: 'ai', editedByPo: false };
    const handedOver = buildSearchedItem(2, ['DENP-1']);
    handedOver.decisions.duplicate = { ...handedOver.decisions.duplicate, isAwaitingPo: true } as Decision<never>;
    handedOver.decisions.label = { ...handedOver.decisions.label, isAwaitingPo: true } as Decision<never>;
    handedOver.decisions.draftAccepted = { ...handedOver.decisions.draftAccepted, isAwaitingPo: true } as Decision<never>;
    expect(buildResolveRequests(buildIntake([drafted, handedOver]))).toEqual([]);
  });

  it('splits a long request into labelled parts without ever splitting an item', () => {
    const items = [1, 2, 3, 4, 5].map((itemNumber) => buildNewEpicItem(itemNumber));
    const requests = buildResolveRequests(buildIntake(items, buildLines(items, (item) => `${item.title} ${'y'.repeat(LONG_LINE_CHARS)}`)));
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.flatMap((request) => request.itemIds)).toEqual(['item-1', 'item-2', 'item-3', 'item-4', 'item-5']);
    requests.forEach((request, index) => {
      expect(request).toMatchObject({ partIndex: index, partCount: requests.length });
      expect(request.text).toContain(`This is part ${index + 1} of ${requests.length}.`);
    });
  });
});

// ── Reading the answer ──

describe('parseResolveReply', () => {
  const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700'])]);
  const asked = ['item-1', 'item-2'];

  it('accepts a key from the item\'s own list, in the list\'s spelling', () => {
    const outcome = parseResolveReply(reply([{ id: 'ITEM-1', verdict: 'existing', key: 'denp-632', confidence: 'high', reason: 'same scope' }]), intake, asked);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted[0]).toMatchObject({ itemId: 'item-1', verdict: { verdict: 'existing', key: 'DENP-632' }, isConfident: true, reason: 'same scope', label: null, draft: null });
  });

  it('refuses a key found for a different item or invented (FR-018)', () => {
    const outcome = parseResolveReply(reply([
      { id: 'item-1', verdict: 'existing', key: 'DENP-700', confidence: 'high' },
      { id: 'item-2', verdict: 'existing', key: 'DENP-9', confidence: 'high' },
    ]), intake, asked);
    expect(outcome.accepted.map((answer) => answer.verdict)).toEqual([null, null]);
    expect(outcome.accepted[0].fieldErrors.verdict).toBe('DENP-700 was not among the Epics found for item-1.');
    expect(outcome.accepted[1].fieldErrors.verdict).toMatch(/DENP-9/);
  });

  it('rejects an item that was not asked about, by name', () => {
    const outcome = parseResolveReply(reply([{ id: 'item-9', verdict: 'createNew' }]), intake, asked);
    expect(outcome.accepted).toEqual([]);
    expect(outcome.rejected).toEqual([{ itemId: 'item-9', reason: expect.stringContaining('item-9') }]);
  });

  it('treats a missing confidence as low', () => {
    expect(parseResolveReply(reply([{ id: 'item-2', verdict: 'createNew' }]), intake, asked).accepted[0].isConfident).toBe(false);
  });

  it('normalises a draft to nine sections and strips authorship claims', () => {
    const outcome = parseResolveReply(reply([{ ...FULL_NEW_ANSWER, id: 'item-1', description: 'Description:\nRedo invoices. This was generated by AI.' }]), intake, asked);
    const draft = outcome.accepted[0].draft!;
    expect(draft.description).toContain('Redo invoices.');
    expect(draft.description).not.toMatch(/generated by AI/i);
    expect(SECTION_LABELS.every((label) => draft.description.includes(`${label}:`))).toBe(true);
    expect(outcome.accepted[0].label).toBe('Roadmap');
  });

  it('refuses an over-long summary as a draft error', () => {
    const outcome = parseResolveReply(reply([{ ...FULL_NEW_ANSWER, id: 'item-1', summary: 'x'.repeat(MAX_EPIC_SUMMARY_CHARS + 1) }]), intake, asked);
    expect(outcome.accepted[0].draft).toBeNull();
    expect(outcome.accepted[0].fieldErrors.draft).toMatch(/summary/);
  });

  it('reports a whole-reply failure once, without an item', () => {
    expect(parseResolveReply('nope', intake, asked)).toEqual({ accepted: [], rejected: [{ itemId: null, reason: expect.any(String) }] });
  });
});

// ── Applying the answer ──

describe('applyResolveOutcome', () => {
  it('settles a confident existing match and closes the label and draft', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const applied = resolveOnce(intake, [{ id: 'item-1', verdict: 'existing', key: 'DENP-632', confidence: 'high', reason: 'same' }], ['item-1']);
    const [item] = applied.items;
    expect(item.decisions.duplicate).toMatchObject({ state: 'settled', settledBy: 'ai', value: { verdict: 'existing', key: 'DENP-632' } });
    expect(item.decisions.label.state).toBe('notApplicable');
    expect(item.decisions.draftAccepted.state).toBe('notApplicable');
    expect(item.draft).toBeNull();
    expect(item.reviewFlag).toBeNull();
    expect(applied.roundHistory).toEqual([expect.objectContaining({ kind: RESOLVE_REPLY_KIND, partIndex: 0, partCount: 1, acceptedCount: 1 })]);
  });

  it('still settles an unsure match, but flags the row for review', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const applied = resolveOnce(intake, [{ id: 'item-1', verdict: 'existing', key: 'DENP-632', confidence: 'low', reason: 'maybe' }], ['item-1']);
    expect(applied.items[0].decisions.duplicate).toMatchObject({ state: 'settled', settledBy: 'ai' });
    expect(applied.items[0].reviewFlag).toBe('Unsure match: maybe');
  });

  it('settles verdict and label and stores the draft in one pass, leaving Create as the only confirmation', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const [item] = resolveOnce(intake, [{ ...FULL_NEW_ANSWER, id: 'item-1' }], ['item-1']).items;
    expect(item.decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'createNew' } });
    expect(item.decisions.label).toMatchObject({ state: 'settled', value: 'Roadmap', settledBy: 'ai' });
    expect(item.draft).toMatchObject({ summary: 'New thing', source: 'ai', editedByPo: false });
    expect(item.decisions.draftAccepted.state).toBe('open');
    expect(isItemCreatableAfterReview(item, true)).toBe(true);
  });

  it('counts a refused key against the match, handing it to the PO after the limit', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700'])]);
    let applied = intake;
    for (let attempt = 0; attempt < MAX_AI_ATTEMPTS_PER_DECISION; attempt += 1) {
      applied = resolveOnce(applied, [{ id: 'item-1', verdict: 'existing', key: 'DENP-700', confidence: 'high' }, { id: 'item-2', verdict: 'existing', key: 'DENP-700', confidence: 'high' }], ['item-1', 'item-2']);
    }
    expect(applied.items[0].decisions.duplicate).toMatchObject({ state: 'open', lastRejection: 'DENP-700 was not among the Epics found for item-1.' });
    expect(listOpenDecisions(applied, true).find((openDecision) => openDecision.itemId === 'item-1' && openDecision.slot === 'duplicate')?.turn).toBe('po');
    expect(applied.items[1].decisions.duplicate).toMatchObject({ state: 'settled', value: { verdict: 'existing', key: 'DENP-700' } });
    expect(applied.roundHistory[0].rejected).toEqual([{ itemId: 'item-1', reason: 'DENP-700 was not among the Epics found for item-1.' }]);
  });

  it('counts a missing or invalid draft for a new Epic as an attempt', () => {
    const intake = buildIntake([buildNewEpicItem(1)]);
    const applied = resolveOnce(intake, [{ id: 'item-1', label: 'Stability' }], ['item-1']);
    expect(applied.items[0].draft).toBeNull();
    expect(applied.items[0].decisions.draftAccepted).toMatchObject({ state: 'open', aiAttempts: 1 });
    expect(applied.items[0].decisions.label).toMatchObject({ state: 'settled', value: 'Stability' });
  });

  it('counts one attempt on every asked slot of an item the answer skipped', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildNewEpicItem(2)]);
    const applied = resolveOnce(intake, [{ ...FULL_NEW_ANSWER, id: 'item-2' }], ['item-1', 'item-2']);
    const { decisions } = applied.items[0];
    expect([decisions.duplicate, decisions.label, decisions.draftAccepted].map((decision) => decision.state === 'open' && decision.aiAttempts)).toEqual([1, 1, 1]);
  });

  it('costs nothing when the whole reply is unusable', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const applied = applyResolveOutcome(intake, parseResolveReply('garbage', intake, ['item-1']), ['item-1'], SINGLE_PART, NOW_ISO);
    expect(applied.items[0]).toEqual(intake.items[0]);
    expect(applied.roundHistory).toHaveLength(1);
  });

  it('never changes an answer the PO already gave', () => {
    const item = buildNewEpicItem(1);
    item.decisions.label = settled('Stability', 'po');
    const applied = resolveOnce(buildIntake([item]), [{ ...FULL_NEW_ANSWER, id: 'item-1' }], ['item-1']);
    expect(applied.items[0].decisions.label).toMatchObject({ value: 'Stability', settledBy: 'po' });
  });

  it('never replaces a draft the PO has edited', () => {
    const item = buildNewEpicItem(1);
    item.draft = { summary: 'Mine', description: 'Mine', source: 'ai', editedByPo: true };
    const applied = resolveOnce(buildIntake([item]), [{ ...FULL_NEW_ANSWER, id: 'item-1' }], ['item-1']);
    expect(applied.items[0].draft?.summary).toBe('Mine');
  });

  it('adds the Enrollment-scope suffix to a Shared item\'s summary exactly once', () => {
    const item = buildNewEpicItem(1);
    item.decisions.owner = settled('shared', 'po');
    const intake = buildIntake([item]);
    const applied = resolveOnce(intake, [{ ...FULL_NEW_ANSWER, id: 'item-1', summary: 'AEP readiness' }], ['item-1']);
    expect(applied.items[0].draft?.summary).toBe(`AEP readiness${SHARED_SCOPE_SUFFIX}`);
    const again = resolveOnce(intake, [{ ...FULL_NEW_ANSWER, id: 'item-1', summary: `AEP readiness${SHARED_SCOPE_SUFFIX}` }], ['item-1']);
    expect(again.items[0].draft?.summary).toBe(`AEP readiness${SHARED_SCOPE_SUFFIX}`);
  });

  it('records the part position it was given', () => {
    const intake = buildIntake([buildNewEpicItem(1)]);
    const outcome = parseResolveReply(reply([{ ...FULL_NEW_ANSWER, id: 'item-1' }]), intake, ['item-1']);
    const applied = applyResolveOutcome(intake, outcome, ['item-1'], { partIndex: 1, partCount: 3 }, NOW_ISO);
    expect(applied.roundHistory[0]).toMatchObject({ partIndex: 1, partCount: 3, ingestedAtIso: NOW_ISO });
    expect(applied.updatedAtIso).toBe(NOW_ISO);
  });
});
