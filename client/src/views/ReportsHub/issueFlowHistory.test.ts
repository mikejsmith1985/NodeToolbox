// issueFlowHistory.test.ts — Unit tests for the identity-retaining changelog reader.
//
// The person-centric report's reader collapses every assignee change to a boolean ("was it hers?").
// That collapse is exactly why it can say how long someone held an issue but never who else held it.
// This reader keeps the identity, which is what lets the flow analysis answer "and with whom?".
//
// The Unassigned case is the one to watch: an issue sitting in nobody's queue is a real, and often
// large, stage. Modelling it as an absence would silently charge that queue time to whoever picked
// the issue up next — flattering them and hiding the delay.

import { describe, expect, it } from 'vitest';

import { UNASSIGNED_HOLDER, readIssueHolderHistory } from './issueFlowHistory.ts';

/** Builds a minimal raw issue with the changelog shape Jira returns. */
function buildIssue(options: {
  assignee?: { displayName?: string; name?: string; accountId?: string } | null;
  histories?: Array<{ created: string; items: Array<Record<string, unknown>> }>;
}) {
  return {
    key: 'FLOW-1',
    fields: { assignee: options.assignee ?? null },
    changelog: { histories: options.histories ?? [] },
  };
}

describe('readIssueHolderHistory — identity is retained, not collapsed', () => {
  it('keeps the machine id and the display name of each new holder', () => {
    const issue = buildIssue({
      histories: [
        {
          created: '2026-07-02T09:00:00.000Z',
          items: [{ field: 'assignee', from: 'jdev', fromString: 'Dev, Jane (CTR)', to: 'mpo', toString: 'Owner, Mark (CTR)' }],
        },
      ],
    });

    const history = readIssueHolderHistory(issue);

    expect(history.holderTransitions).toEqual([
      { atIso: '2026-07-02T09:00:00.000Z', holder: { holderId: 'mpo', holderName: 'Owner, Mark (CTR)' } },
    ]);
  });

  it('reads the initial holder from the first assignee change\'s from side', () => {
    const issue = buildIssue({
      assignee: { name: 'mpo', displayName: 'Owner, Mark (CTR)' },
      histories: [
        {
          created: '2026-07-02T09:00:00.000Z',
          items: [{ field: 'assignee', from: 'jdev', fromString: 'Dev, Jane (CTR)', to: 'mpo', toString: 'Owner, Mark (CTR)' }],
        },
      ],
    });

    // The CURRENT assignee is Mark, but at creation the issue was Jane's. Using the current field
    // here would credit Mark with time he never held.
    expect(readIssueHolderHistory(issue).initialHolder).toEqual({ holderId: 'jdev', holderName: 'Dev, Jane (CTR)' });
  });

  it('falls back to the current assignee when the issue was never reassigned', () => {
    const issue = buildIssue({ assignee: { name: 'jdev', displayName: 'Dev, Jane (CTR)' } });

    expect(readIssueHolderHistory(issue).initialHolder).toEqual({ holderId: 'jdev', holderName: 'Dev, Jane (CTR)' });
    expect(readIssueHolderHistory(issue).holderTransitions).toEqual([]);
  });

  it('records three successive holders in changelog order', () => {
    const issue = buildIssue({
      histories: [
        { created: '2026-07-02T09:00:00.000Z', items: [{ field: 'assignee', from: 'a', to: 'b', toString: 'Bee' }] },
        { created: '2026-07-03T09:00:00.000Z', items: [{ field: 'assignee', from: 'b', to: 'c', toString: 'Cee' }] },
      ],
    });

    expect(readIssueHolderHistory(issue).holderTransitions.map((change) => change.holder.holderName))
      .toEqual(['Bee', 'Cee']);
  });
});

describe('readIssueHolderHistory — the Unassigned holder is a value, not an absence', () => {
  it('yields the explicit Unassigned holder when an issue is de-assigned', () => {
    const issue = buildIssue({
      histories: [
        { created: '2026-07-02T09:00:00.000Z', items: [{ field: 'assignee', from: 'jdev', to: null, toString: null }] },
      ],
    });

    // If this returned null/undefined instead, the span would later be dropped or merged into the
    // next holder's — turning invisible queue time into someone's apparent slowness.
    expect(readIssueHolderHistory(issue).holderTransitions[0].holder).toEqual(UNASSIGNED_HOLDER);
  });

  it('treats an issue with no assignee and no history as Unassigned from the start', () => {
    expect(readIssueHolderHistory(buildIssue({})).initialHolder).toEqual(UNASSIGNED_HOLDER);
  });

  it('names the Unassigned holder in words so a reader never sees a blank cell', () => {
    expect(UNASSIGNED_HOLDER.holderId).toBeNull();
    expect(UNASSIGNED_HOLDER.holderName).toBe('Unassigned');
  });
});

describe('readIssueHolderHistory — defensive reading', () => {
  it('ignores changelog entries for other fields', () => {
    const issue = buildIssue({
      histories: [
        { created: '2026-07-02T09:00:00.000Z', items: [{ field: 'status', from: '1', to: '3' }] },
        { created: '2026-07-03T09:00:00.000Z', items: [{ field: 'assignee', from: null, to: 'b', toString: 'Bee' }] },
      ],
    });

    expect(readIssueHolderHistory(issue).holderTransitions).toHaveLength(1);
  });

  it('sorts histories oldest first even when Jira returns them out of order', () => {
    const issue = buildIssue({
      histories: [
        { created: '2026-07-05T09:00:00.000Z', items: [{ field: 'assignee', from: 'b', to: 'c', toString: 'Cee' }] },
        { created: '2026-07-02T09:00:00.000Z', items: [{ field: 'assignee', from: 'a', to: 'b', toString: 'Bee' }] },
      ],
    });

    expect(readIssueHolderHistory(issue).holderTransitions.map((change) => change.holder.holderName))
      .toEqual(['Bee', 'Cee']);
    // And the initial holder must come from the genuinely earliest change, not the first in the array.
    expect(readIssueHolderHistory(issue).initialHolder.holderId).toBe('a');
  });

  it('falls back to the machine id when Jira supplies no display name', () => {
    const issue = buildIssue({
      histories: [
        { created: '2026-07-02T09:00:00.000Z', items: [{ field: 'assignee', from: null, to: 'ghost' }] },
      ],
    });

    expect(readIssueHolderHistory(issue).holderTransitions[0].holder).toEqual({
      holderId: 'ghost',
      holderName: 'ghost',
    });
  });

  it('drops histories with no usable timestamp rather than dating them to the epoch', () => {
    const issue = buildIssue({
      histories: [
        { created: '', items: [{ field: 'assignee', from: null, to: 'b', toString: 'Bee' }] },
      ],
    });

    expect(readIssueHolderHistory(issue).holderTransitions).toEqual([]);
  });
});
