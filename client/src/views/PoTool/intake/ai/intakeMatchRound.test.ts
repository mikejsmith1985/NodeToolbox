// intakeMatchRound.test.ts — Contract tests for the matching exchange (spec 037, contracts/ai-rounds.md §2):
// only an item's own candidates can be chosen, and an unsure pick goes to the PO pre-selected.

import { describe, expect, it } from 'vitest';

import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type Decision,
  type DuplicateCandidate,
  type EpicIntake,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import { listOpenDecisions, MAX_AI_ATTEMPTS_PER_DECISION } from '../intakeChecklist.ts';
import { applyMatchOutcome, buildMatchRequest, MATCH_REPLY_KIND, parseMatchReply } from './intakeMatchRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'rule', reason: 'test', aiAttempts: 0 };
}

function buildCandidate(key: string): DuplicateCandidate {
  return { key, summary: `Epic ${key}`, statusName: 'In Progress', statusCategory: 'indeterminate', descriptionExcerpt: 'excerpt', foundBy: 'search' };
}

function buildSearchedItem(itemNumber: number, candidateKeys: string[]): IntakeItem {
  const item = createIntakeItem(itemNumber, `Item ${itemNumber}`, [itemNumber]);
  item.decisions.kind = settled('work');
  item.decisions.owner = settled('enrollment');
  item.decisions.searchTerms = settled(['term']);
  item.searchStatus = 'ok';
  item.candidates = candidateKeys.map(buildCandidate);
  return item;
}

function buildIntake(items: IntakeItem[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION, id: 'i', teamProfileId: 't', name: 'n', targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO, updatedAtIso: NOW_ISO, sourceTitles: [],
    lines: items.map((item) => ({ lineNumber: item.lineNumbers[0], text: item.title, rawText: `• ${item.title}`, outlineLevel: 1 as const })),
    items, setAsideLines: [], epicType: { state: 'resolved', id: '10000', name: 'Epic' }, batchRequiredFieldValues: {}, roundHistory: [],
  };
}

function reply(items: unknown[]): string {
  return JSON.stringify({ kind: MATCH_REPLY_KIND, items });
}

describe('buildMatchRequest', () => {
  it('asks only about items with an open match and candidates, listing each item\'s own Epics', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700', 'DENP-701'])]);
    intake.items[1].decisions.duplicate = settled({ verdict: 'createNew' });
    const request = buildMatchRequest(intake);
    expect(request.itemIds).toEqual(['item-1']);
    expect(request.text).toContain('DENP-632 [In Progress] Epic DENP-632');
    expect(request.text).not.toContain('DENP-700');
    expect(request.text).toContain(`"kind":"${MATCH_REPLY_KIND}"`);
  });
});

describe('parseMatchReply', () => {
  const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700'])]);
  const asked = ['item-1', 'item-2'];

  it('accepts a key from the item\'s own list, in the list\'s spelling', () => {
    const outcome = parseMatchReply(reply([{ id: 'item-1', verdict: 'existing', key: 'denp-632', confidence: 'high', reason: 'same scope' }]), intake, asked);
    expect(outcome.accepted).toEqual([{ itemId: 'item-1', verdict: { verdict: 'existing', key: 'DENP-632' }, isConfident: true, reason: 'same scope' }]);
  });

  it('rejects a key found for a different item (FR-018)', () => {
    const outcome = parseMatchReply(reply([{ id: 'item-1', verdict: 'existing', key: 'DENP-700', confidence: 'high' }]), intake, asked);
    expect(outcome.accepted).toEqual([]);
    expect(outcome.rejected).toEqual([{ itemId: 'item-1', reason: 'DENP-700 was not among the Epics found for item-1.' }]);
  });

  it('rejects an invented key and an item that was not asked about', () => {
    const outcome = parseMatchReply(reply([
      { id: 'item-1', verdict: 'existing', key: 'DENP-9', confidence: 'high' },
      { id: 'item-9', verdict: 'createNew', confidence: 'high' },
    ]), intake, asked);
    expect(outcome.rejected.map((rejection) => rejection.itemId)).toEqual(['item-1', 'item-9']);
  });

  it('treats a missing confidence as low', () => {
    const outcome = parseMatchReply(reply([{ id: 'item-2', verdict: 'createNew' }]), intake, asked);
    expect(outcome.accepted[0].isConfident).toBe(false);
  });

  it('reports a whole-reply failure once, without an item', () => {
    expect(parseMatchReply('nope', intake, asked)).toEqual({ accepted: [], rejected: [{ itemId: null, reason: expect.any(String) }] });
  });
});

describe('applyMatchOutcome', () => {
  it('settles a confident verdict as the assistant\'s and closes the label for an existing Epic', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const outcome = parseMatchReply(reply([{ id: 'item-1', verdict: 'existing', key: 'DENP-632', confidence: 'high', reason: 'same' }]), intake, ['item-1']);
    const applied = applyMatchOutcome(intake, outcome, ['item-1'], NOW_ISO);
    expect(applied.items[0].decisions.duplicate).toMatchObject({ state: 'settled', settledBy: 'ai', value: { verdict: 'existing', key: 'DENP-632' } });
    expect(applied.items[0].decisions.label.state).toBe('notApplicable');
    expect(applied.roundHistory).toHaveLength(1);
  });

  it('hands an unsure verdict to the PO with the pick pre-selected', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632'])]);
    const outcome = parseMatchReply(reply([{ id: 'item-1', verdict: 'existing', key: 'DENP-632', confidence: 'low', reason: 'maybe' }]), intake, ['item-1']);
    const applied = applyMatchOutcome(intake, outcome, ['item-1'], NOW_ISO);
    expect(applied.items[0].decisions.duplicate).toMatchObject({ state: 'open', isAwaitingPo: true, aiProposal: { verdict: 'existing', key: 'DENP-632' } });
    expect(listOpenDecisions(applied, true).find((openDecision) => openDecision.slot === 'duplicate')?.turn).toBe('po');
  });

  it('counts rejected and missing answers as attempts, and a whole-reply failure as none', () => {
    const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, ['DENP-700'])]);
    const asked = ['item-1', 'item-2'];
    let applied = intake;
    for (let attempt = 0; attempt < MAX_AI_ATTEMPTS_PER_DECISION; attempt += 1) {
      const outcome = parseMatchReply(reply([{ id: 'item-1', verdict: 'existing', key: 'DENP-9', confidence: 'high' }]), applied, asked);
      applied = applyMatchOutcome(applied, outcome, asked, NOW_ISO);
    }
    expect(listOpenDecisions(applied, true).filter((openDecision) => openDecision.slot === 'duplicate').map((openDecision) => openDecision.turn)).toEqual(['po', 'po']);
    const untouched = applyMatchOutcome(intake, parseMatchReply('garbage', intake, asked), asked, NOW_ISO);
    expect(untouched.items[0].decisions.duplicate).toMatchObject({ state: 'open', aiAttempts: 0 });
  });
});
