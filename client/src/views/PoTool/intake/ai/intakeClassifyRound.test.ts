// intakeClassifyRound.test.ts — Contract tests for the sorting exchange (spec 037, contracts/ai-rounds.md §0–§1):
// only open questions are asked, answers are validated field by field, and nothing is invented.

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import { readItemDisplayTitle } from '../epicIntakeModel.ts';
import { GH387_NOTES_TEXT } from '../gh387Notes.fixture.ts';
import { startEpicIntake } from '../startIntake.ts';
import { buildClassifyRequests, CLASSIFY_REPLY_KIND, MAX_SEARCH_TERMS_PER_ITEM, parseClassifyReply } from './intakeClassifyRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function startIntake(text = GH387_NOTES_TEXT) {
  const source: ReferencedSource = { kind: 'paste', id: 'paste-1', label: 'Notes', text };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: NOW_ISO, mintId: () => 'intake-1' });
}

function reply(items: unknown[], setAside: unknown[] = []): string {
  return JSON.stringify({ kind: CLASSIFY_REPLY_KIND, items, setAside });
}

describe('buildClassifyRequests', () => {
  it('fits GH #387 in one part and quotes numbered lines verbatim', () => {
    const requests = buildClassifyRequests(startIntake());
    expect(requests).toHaveLength(1);
    expect(requests[0].text).toContain('o\t(1.2M) XL Enrollment');
    expect(requests[0].text).toMatch(/\[\d+\] •\tCore Integration \(denp-632\)/);
    expect(requests[0].text).toContain(`"kind":"${CLASSIFY_REPLY_KIND}"`);
  });

  it('does not ask for a share where the stated sizes already decided the owner', () => {
    const intake = startIntake();
    const coreIntegration = intake.items.find((item) => item.title.startsWith('Core Integration'));
    const itemLine = buildClassifyRequests(intake)[0].text.split('\n').find((line) => line.startsWith(`${coreIntegration?.id} —`));
    expect(itemLine).not.toContain('enrollmentShare');
    expect(itemLine).toContain('owner already decided');
  });

  it('does not ask about an item whose kind a rule settled and that needs nothing else', () => {
    const intake = startIntake();
    const massReissue = intake.items.find((item) => item.title.startsWith('Mass ID Card Reissue'));
    expect(buildClassifyRequests(intake)[0].itemIds).not.toContain(massReissue?.id);
  });

  it('splits long notes at item boundaries into several parts', () => {
    const longNotes = Array.from({ length: 120 }, (_, index) => `• Item ${index} ${'detail '.repeat(15)}`).join('\n');
    const requests = buildClassifyRequests(startIntake(longNotes));
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.map((request) => request.partCount)).toEqual(requests.map(() => requests.length));
    expect(new Set(requests.flatMap((request) => request.itemIds)).size).toBe(120);
    expect(requests[0].text).toContain(`part 1 of ${requests.length}`);
  });

  it('asks for nothing once every sorting question is answered', () => {
    const intake = startIntake('• Only item');
    const [request] = buildClassifyRequests(intake);
    const answered = parseClassifyReply(reply([{ id: request.itemIds[0], kind: 'noise' }]), intake, request.itemIds);
    expect(answered.accepted).toHaveLength(1);
  });
});

describe('parseClassifyReply', () => {
  const intake = startIntake();
  const [request] = buildClassifyRequests(intake);
  const firstAskedId = request.itemIds[0];

  it('reads every field, in the vocabulary\'s own spelling, and sanitises search terms', () => {
    const outcome = parseClassifyReply(reply([{
      id: firstAskedId.toUpperCase(), kind: 'WORK', enrollmentShare: 70, searchTerms: ['offshore: enrollment', ''], labelProposal: 'roadmap', title: 'Offshore enrollment support', reason: 'r',
    }]), intake, request.itemIds);
    expect(outcome.accepted[0]).toMatchObject({
      itemId: firstAskedId, kind: 'work', enrollmentShare: 70, hasEnrollmentShare: true,
      searchTerms: ['offshore enrollment'], labelProposal: 'Roadmap', title: 'Offshore enrollment support', fieldErrors: {},
    });
  });

  it('keeps at most five search terms', () => {
    const outcome = parseClassifyReply(reply([{ id: firstAskedId, kind: 'work', searchTerms: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'] }]), intake, request.itemIds);
    expect(outcome.accepted[0].searchTerms).toHaveLength(MAX_SEARCH_TERMS_PER_ITEM);
  });

  it('rejects an invented item by name', () => {
    const outcome = parseClassifyReply(reply([{ id: 'item-999', kind: 'work' }]), intake, request.itemIds);
    expect(outcome.rejected).toEqual([{ itemId: 'item-999', reason: '"item-999" is not an item in this request.' }]);
  });

  it('records field errors instead of dropping the whole answer', () => {
    const outcome = parseClassifyReply(reply([{ id: firstAskedId, kind: 'task', lines: [99999], searchTerms: 'core' }]), intake, request.itemIds);
    expect(outcome.accepted[0].fieldErrors).toEqual({
      kind: '"task" is not a kind.',
      lines: 'The lines must be numbers of lines in this part.',
      searchTerms: 'No search terms given.',
    });
  });

  it('reads set-aside lines and refuses unknown lines or reasons', () => {
    const firstItem = intake.items.find((item) => item.id === firstAskedId);
    const lineNumber = firstItem?.lineNumbers[0] ?? 0;
    const outcome = parseClassifyReply(reply([], [{ line: lineNumber, reason: 'notWork' }, { line: 99999, reason: 'notWork' }, { line: lineNumber, reason: 'boring' }]), intake, request.itemIds);
    expect(outcome.setAside).toEqual([{ lineNumber, reason: 'notWork' }]);
    expect(outcome.rejected).toHaveLength(2);
  });

  it('reports a whole-reply failure once', () => {
    expect(parseClassifyReply('I could not do that.', intake, request.itemIds)).toMatchObject({ accepted: [], setAside: [], rejected: [{ itemId: null }] });
  });

  it('uses display titles for items (sanity: the intake has readable titles)', () => {
    expect(intake.items.every((item) => readItemDisplayTitle(item).length > 0)).toBe(true);
  });
});
