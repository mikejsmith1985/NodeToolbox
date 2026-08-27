// rewriteJourney.test.ts — Where a run has got to, and the one thing to do next.

import { describe, expect, it } from 'vitest';

import { readRewriteJourney } from './rewriteJourney.ts';
import type { ItemState, RewriteBatch, RewriteItem } from './rewriteBatchModel.ts';

/** One issue in the batch, in whatever state the test is about. */
function item(jiraKey: string, state: ItemState, hasProposal = true): RewriteItem {
  return {
    jiraKey,
    original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
    proposed: hasProposal ? { description: 'Description:\nx', acceptanceCriteria: 'ac', isEdited: false } : null,
    state,
    captureError: null,
    submitResult: null,
  };
}

/** A batch carrying whatever the test needs. */
function batch(overrides: Partial<RewriteBatch> = {}): RewriteBatch {
  return {
    id: 'b-1',
    name: 'A batch',
    teamProfileId: 'team-1',
    createdAtIso: '2026-08-21T00:00:00.000Z',
    updatedAtIso: '2026-08-21T00:00:00.000Z',
    items: [item('ABC-1', 'captured', false)],
    ...overrides,
  };
}

/** One pasted note. */
function note(id: string) {
  return { kind: 'paste' as const, id, label: `Note ${id}`, text: 'some text' };
}

/** One document's extract. */
function extract(sourceId: string) {
  return {
    sourceId, sourceTitle: `Note ${sourceId}`, sourceOrigin: 'Pasted',
    summary: 's', decisions: ['d'], requirements: [], openQuestions: [], facts: [],
    extractedAtIso: '2026-08-27T00:00:00.000Z',
  };
}

/** The state of the numbered step. */
function stateOf(journey: ReturnType<typeof readRewriteJourney>, stepNumber: number): string {
  return journey.steps.find((step) => step.number === stepNumber)?.state ?? 'missing';
}

describe('readRewriteJourney', () => {
  it('tells somebody with no batch to capture some issues', () => {
    const journey = readRewriteJourney(null);

    expect(journey.nextAction).toContain('Capture originals');
    expect(journey.isComplete).toBe(false);
  });

  it('starts at the notes once issues are captured', () => {
    const journey = readRewriteJourney(batch());

    expect(stateOf(journey, 1)).toBe('current');
    expect(journey.nextAction).toContain('Add the notes');
  });

  it('moves to condensing once notes are added', () => {
    const journey = readRewriteJourney(batch({ sharedSources: [note('p-1')] }));

    expect(stateOf(journey, 1)).toBe('done');
    expect(stateOf(journey, 2)).toBe('current');
  });

  it('marks condensing SKIPPED when there are no documents, not done', () => {
    // Saying "done" would claim work that never happened.
    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'proposed')] }));

    expect(stateOf(journey, 2)).toBe('skipped');
  });

  it('keeps condensing live while a document is un-condensed', () => {
    const journey = readRewriteJourney(batch({
      sharedSources: [note('p-1'), note('p-2')],
      sourceExtracts: { 'p-1': extract('p-1') },
    }));

    expect(stateOf(journey, 2)).toBe('current');
  });

  it('keeps condensing live while two extracts have no brief', () => {
    // Consolidating is the only step that catches two documents contradicting each other.
    const journey = readRewriteJourney(batch({
      sharedSources: [note('p-1'), note('p-2')],
      sourceExtracts: { 'p-1': extract('p-1'), 'p-2': extract('p-2') },
    }));

    expect(stateOf(journey, 2)).toBe('current');
  });

  it('finishes condensing when a lone document is condensed, since there is nothing to consolidate', () => {
    const journey = readRewriteJourney(batch({
      sharedSources: [note('p-1')],
      sourceExtracts: { 'p-1': extract('p-1') },
    }));

    expect(stateOf(journey, 2)).toBe('done');
    expect(stateOf(journey, 3)).toBe('current');
  });

  it('moves to drafting once the material is settled', () => {
    const journey = readRewriteJourney(batch({
      sharedSources: [note('p-1')],
      sourceExtracts: { 'p-1': extract('p-1') },
    }));

    expect(journey.nextAction).toContain('paste the whole reply back');
  });

  it('stays on drafting until EVERY issue has one', () => {
    const journey = readRewriteJourney(batch({
      items: [item('ABC-1', 'proposed'), item('ABC-2', 'captured', false)],
    }));

    expect(stateOf(journey, 3)).toBe('current');
  });

  it('moves to review once everything is drafted', () => {
    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'proposed')] }));

    expect(stateOf(journey, 3)).toBe('done');
    expect(stateOf(journey, 4)).toBe('current');
    expect(journey.nextAction).toContain('Approve or');
  });

  it('stays on review while any drafted issue is undecided', () => {
    const journey = readRewriteJourney(batch({
      items: [item('ABC-1', 'approved'), item('ABC-2', 'reviewing')],
    }));

    expect(stateOf(journey, 4)).toBe('current');
  });

  it('counts a rejected issue as decided, because it is', () => {
    const journey = readRewriteJourney(batch({
      items: [item('ABC-1', 'approved'), item('ABC-2', 'rejected')],
    }));

    expect(stateOf(journey, 4)).toBe('done');
    expect(stateOf(journey, 5)).toBe('current');
  });

  it('moves to sending once everything is decided and something is approved', () => {
    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'approved')] }));

    expect(stateOf(journey, 5)).toBe('current');
    expect(journey.nextAction).toContain('Write N approved to Jira');
    expect(journey.isComplete).toBe(false);
  });

  it('is complete once every approved item has been written', () => {
    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'submitted')] }));

    expect(journey.isComplete).toBe(true);
    expect(stateOf(journey, 5)).toBe('done');
    expect(journey.nextAction).toContain('Add more notes');
  });

  it('is complete when everything was rejected, since nothing was ever going to be written', () => {
    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'rejected')] }));

    expect(journey.isComplete).toBe(true);
  });

  it('ignores an issue that could not be captured, which has nothing to re-write', () => {
    const uncapturable: RewriteItem = { ...item('ABC-2', 'captured', false), captureError: 'Not found' };

    const journey = readRewriteJourney(batch({ items: [item('ABC-1', 'proposed'), uncapturable] }));

    expect(stateOf(journey, 3)).toBe('done');
  });

  it('always returns all five steps, so the strip never changes shape', () => {
    [readRewriteJourney(null), readRewriteJourney(batch()), readRewriteJourney(batch({ items: [item('A-1', 'submitted')] }))]
      .forEach((journey) => expect(journey.steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]));
  });

  it('gives exactly one live step at a time — that is the whole point', () => {
    const journey = readRewriteJourney(batch({ sharedSources: [note('p-1')] }));

    expect(journey.steps.filter((step) => step.state === 'current')).toHaveLength(1);
  });
});
