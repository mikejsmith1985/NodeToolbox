// intakeClassifyApply.test.ts — Applying a sorting answer: regrouping without stealing lines, rules first, PO answers
// untouched, and missing answers counted (spec 037, contracts/ai-rounds.md §1, US1-2…4, US2-1/4).

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import type { EpicIntake, IntakeItem } from '../epicIntakeModel.ts';
import { listOpenDecisions, settleDecision } from '../intakeChecklist.ts';
import { proveLineCoverage } from '../notesOutline.ts';
import { startEpicIntake } from '../startIntake.ts';
import { applyClassifyOutcome } from './intakeClassifyApply.ts';
import { buildClassifyRequests, CLASSIFY_REPLY_KIND, parseClassifyReply } from './intakeClassifyRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const POSITION = { partIndex: 0, partCount: 1 };

const NOTES = [
  '•\tAlpha work',
  'o\tAlpha detail',
  '•\tBeta work',
  '•\tCore Integration (denp-632)',
  'o\tXL Enrollment',
  'o\tFulfillment M',
  '•\tGamma',
].join('\n');

function startIntake(): EpicIntake {
  const source: ReferencedSource = { kind: 'paste', id: 'paste-1', label: 'Notes', text: NOTES };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: NOW_ISO, mintId: () => 'intake-1' });
}

function findItem(intake: EpicIntake, titlePrefix: string): IntakeItem {
  const item = intake.items.find((candidate) => candidate.title.startsWith(titlePrefix));
  if (item === undefined) throw new Error(titlePrefix);
  return item;
}

function applyReply(intake: EpicIntake, items: unknown[], setAside: unknown[] = []): EpicIntake {
  const [request] = buildClassifyRequests(intake);
  const outcome = parseClassifyReply(JSON.stringify({ kind: CLASSIFY_REPLY_KIND, items, setAside }), intake, request.itemIds);
  return applyClassifyOutcome(intake, outcome, request.itemIds, POSITION, NOW_ISO);
}

describe('applyClassifyOutcome', () => {
  it('settles kind, owner from a clear share, terms, and keeps the label as a proposal only', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const applied = applyReply(intake, [{ id: alpha.id, kind: 'work', enrollmentShare: 75, searchTerms: ['alpha work'], labelProposal: 'Stability', reason: 'mostly enrollment' }]);
    const appliedAlpha = findItem(applied, 'Alpha');
    expect(appliedAlpha.decisions.kind).toMatchObject({ state: 'settled', value: 'work', settledBy: 'ai' });
    expect(appliedAlpha.decisions.owner).toMatchObject({ state: 'settled', value: 'enrollment', settledBy: 'ai' });
    expect(appliedAlpha.decisions.searchTerms).toMatchObject({ state: 'settled', value: ['alpha work'] });
    expect(appliedAlpha.decisions.label).toMatchObject({ state: 'open', aiProposal: 'Stability' });
    expect(appliedAlpha.aiEnrollmentShare).toBe(75);
    expect(applied.roundHistory).toHaveLength(1);
  });

  it('hands a close-call share to the PO (US2-4)', () => {
    const intake = startIntake();
    const beta = findItem(intake, 'Beta');
    const applied = applyReply(intake, [{ id: beta.id, kind: 'work', enrollmentShare: 50, searchTerms: ['beta'] }]);
    expect(findItem(applied, 'Beta').decisions.owner).toMatchObject({ state: 'open', isAwaitingPo: true });
  });

  it('keeps the size-rule owner and its reason even when the share disagrees (US2-1)', () => {
    const intake = startIntake();
    const core = findItem(intake, 'Core');
    const applied = applyReply(intake, [{ id: core.id, kind: 'work', enrollmentShare: 10, searchTerms: ['core integration'] }]);
    expect(findItem(applied, 'Core').decisions.owner).toMatchObject({ value: 'enrollment', settledBy: 'rule', reason: 'Stated sizes: Enrollment XL vs Fulfillment M' });
    expect(findItem(applied, 'Core').aiEnrollmentShare).toBe(10);
  });

  it('moves a line between items and re-reads the facts of both', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const beta = findItem(intake, 'Beta');
    const detailLine = alpha.lineNumbers[1];
    const applied = applyReply(intake, [
      { id: alpha.id, kind: 'work', lines: [alpha.lineNumbers[0]] },
      { id: beta.id, kind: 'work', lines: [...beta.lineNumbers, detailLine] },
    ]);
    expect(findItem(applied, 'Beta').lineNumbers).toContain(detailLine);
    expect(proveLineCoverage(applied).isComplete).toBe(true);
  });

  it('refuses both claims when two items claim one line, keeping it where it was (US1-4)', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const beta = findItem(intake, 'Beta');
    const gamma = findItem(intake, 'Gamma');
    const contested = alpha.lineNumbers[1];
    const applied = applyReply(intake, [
      { id: beta.id, kind: 'work', lines: [...beta.lineNumbers, contested] },
      { id: gamma.id, kind: 'work', lines: [...gamma.lineNumbers, contested] },
    ]);
    expect(findItem(applied, 'Alpha').lineNumbers).toContain(contested);
    expect(proveLineCoverage(applied).isComplete).toBe(true);
    expect(applied.roundHistory[0].rejected.filter((rejection) => rejection.reason.includes(`Line ${contested}`))).toHaveLength(2);
  });

  it('reports a line the answer dropped as a gap for the PO to place (US1-3)', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const applied = applyReply(intake, [{ id: alpha.id, kind: 'work', lines: [alpha.lineNumbers[0]] }]);
    expect(proveLineCoverage(applied).missing).toEqual([alpha.lineNumbers[1]]);
    expect(listOpenDecisions(applied, true)).toContainEqual(expect.objectContaining({ slot: 'lineCoverage', turn: 'po' }));
  });

  it('sets a line aside, but never an item\'s only line', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const gamma = findItem(intake, 'Gamma');
    const applied = applyReply(intake, [], [{ line: alpha.lineNumbers[1], reason: 'contextOnly' }, { line: gamma.lineNumbers[0], reason: 'notWork' }]);
    expect(applied.setAsideLines).toContainEqual({ lineNumber: alpha.lineNumbers[1], reason: 'contextOnly', settledBy: 'ai', note: null });
    expect(findItem(applied, 'Gamma').lineNumbers).toEqual(gamma.lineNumbers);
  });

  it('never changes a decision the PO already made (FR-008)', () => {
    const intake = startIntake();
    const alpha = findItem(intake, 'Alpha');
    const poKind = settleDecision(alpha.decisions.kind, 'risk', 'po', 'PO says risk');
    const withPoAnswer = { ...intake, items: intake.items.map((item) => (item.id === alpha.id ? { ...item, decisions: { ...item.decisions, kind: poKind } } : item)) };
    const applied = applyReply(withPoAnswer, [{ id: alpha.id, kind: 'work' }]);
    expect(findItem(applied, 'Alpha').decisions.kind).toBe(poKind);
  });

  it('counts a skipped item as one attempt against its open questions', () => {
    const intake = startIntake();
    const applied = applyReply(intake, []);
    const gamma = findItem(applied, 'Gamma');
    expect(gamma.decisions.kind).toMatchObject({ state: 'open', aiAttempts: 1 });
    expect(gamma.decisions.searchTerms).toMatchObject({ state: 'open', aiAttempts: 1 });
  });

  it('changes nothing, and costs nothing, when the reply cannot be read', () => {
    const intake = startIntake();
    const [request] = buildClassifyRequests(intake);
    const outcome = parseClassifyReply('not json', intake, request.itemIds);
    const applied = applyClassifyOutcome(intake, outcome, request.itemIds, POSITION, NOW_ISO);
    expect(applied.items).toEqual(intake.items);
    expect(applied.roundHistory).toHaveLength(1);
  });
});
