// workflowDelivery.test.ts — Unit tests for the ART-wide status taxonomy and delivered-credit rules.

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../types/jira.ts';
import {
  classifyInProgressSubGroup,
  classifyStatusBucket,
  groupInProgressIssuesBySubGroup,
  groupIssuesByStatusBucket,
  isDeliveredForCredit,
  isDeliveredIssue,
  isDeliveredWithinWindow,
  isDeliveredWorkflowStatusName,
  resolveDeliveryDateIso,
} from './workflowDelivery.ts';

/** One status move for the changelog builder: the status the issue moved to and when. */
interface StatusMove {
  toStatusName: string;
  atIso: string;
}

/** Builds a minimal JiraIssue with the given current status and optional status-transition history. */
function createIssue(
  statusName: string,
  statusCategoryKey: string,
  statusMoves?: StatusMove[],
): JiraIssue {
  return {
    id: 'TBX-1',
    key: 'TBX-1',
    ...(statusMoves === undefined
      ? {}
      : {
          changelog: {
            histories: statusMoves.map((statusMove, moveIndex) => ({
              id: String(moveIndex + 1),
              created: statusMove.atIso,
              items: [
                {
                  field: 'status',
                  fieldtype: 'jira',
                  from: null,
                  fromString: null,
                  to: null,
                  toString: statusMove.toStatusName,
                },
              ],
            })),
          },
        }),
    fields: {
      summary: 'Test issue',
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2026-05-01T00:00:00.000Z',
      updated: '2026-06-01T00:00:00.000Z',
      description: null,
    },
  };
}

describe('classifyStatusBucket', () => {
  it('buckets purely by statusCategory, never by status name', () => {
    // "Working" is the exact status from the bug report: statusCategory In Progress but the
    // old token matching dropped it into To Do because the name contains no known token.
    expect(classifyStatusBucket(createIssue('Working', 'indeterminate'))).toBe('In Progress');
    expect(classifyStatusBucket(createIssue('Open', 'new'))).toBe('To Do');
    expect(classifyStatusBucket(createIssue('Accepted', 'done'))).toBe('Done');
    // An unapproved status still lands where its category says, not where its name hints.
    expect(classifyStatusBucket(createIssue('Done-ish Review', 'new'))).toBe('To Do');
  });

  it('treats unknown categories as To Do so nothing silently disappears', () => {
    expect(classifyStatusBucket(createIssue('Mystery', 'undefined'))).toBe('To Do');
  });
});

describe('classifyInProgressSubGroup', () => {
  it('maps the approved testing statuses onto their ART display sub-groups', () => {
    expect(classifyInProgressSubGroup('Ready for Testing')).toBe('Internal Testing');
    expect(classifyInProgressSubGroup('Ready for QA')).toBe('External Testing');
    expect(classifyInProgressSubGroup('Ready to Accept')).toBe('Ready to Accept');
  });

  it('is case-insensitive and defaults every other status to Active', () => {
    expect(classifyInProgressSubGroup('READY FOR QA')).toBe('External Testing');
    expect(classifyInProgressSubGroup('Working')).toBe('Active');
    expect(classifyInProgressSubGroup('Code Review')).toBe('Active');
  });
});

describe('isDeliveredWorkflowStatusName', () => {
  it('recognizes delivered statuses by name alone (for changelogs and JQL, which lack categories)', () => {
    expect(isDeliveredWorkflowStatusName('Ready for QA')).toBe(true);
    expect(isDeliveredWorkflowStatusName('ready to accept')).toBe(true);
    expect(isDeliveredWorkflowStatusName('Accepted')).toBe(true);
    expect(isDeliveredWorkflowStatusName('Closed')).toBe(true);
    expect(isDeliveredWorkflowStatusName('Ready for Testing')).toBe(false);
    expect(isDeliveredWorkflowStatusName('Working')).toBe(false);
  });
});

describe('isDeliveredIssue', () => {
  it('counts Ready for QA and beyond as delivered even while statusCategory is still In Progress', () => {
    expect(isDeliveredIssue(createIssue('Ready for QA', 'indeterminate'))).toBe(true);
    expect(isDeliveredIssue(createIssue('Ready to Accept', 'indeterminate'))).toBe(true);
    expect(isDeliveredIssue(createIssue('Accepted', 'done'))).toBe(true);
  });

  it('does not count anything before External Testing as delivered', () => {
    expect(isDeliveredIssue(createIssue('Working', 'indeterminate'))).toBe(false);
    expect(isDeliveredIssue(createIssue('Ready for Testing', 'indeterminate'))).toBe(false);
    expect(isDeliveredIssue(createIssue('Open', 'new'))).toBe(false);
  });
});

describe('resolveDeliveryDateIso', () => {
  it('returns the date the issue entered its current delivered run, not the latest hop within it', () => {
    // RfQA (delivery) → Ready to Accept → Accepted: credit anchors at the first External Testing entry.
    const issue = createIssue('Accepted', 'done', [
      { toStatusName: 'Working', atIso: '2026-05-25T10:00:00.000Z' },
      { toStatusName: 'Ready for QA', atIso: '2026-06-01T10:00:00.000Z' },
      { toStatusName: 'Ready to Accept', atIso: '2026-06-15T10:00:00.000Z' },
      { toStatusName: 'Accepted', atIso: '2026-07-02T10:00:00.000Z' },
    ]);
    expect(resolveDeliveryDateIso(issue)).toBe('2026-06-01T10:00:00.000Z');
  });

  it('returns null after a regression so the credit is lost until re-delivered', () => {
    const regressedIssue = createIssue('Working', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-06-01T10:00:00.000Z' },
      { toStatusName: 'Working', atIso: '2026-06-10T10:00:00.000Z' },
    ]);
    expect(resolveDeliveryDateIso(regressedIssue)).toBeNull();
  });

  it('re-anchors on the re-delivery date after a regress-and-fix cycle', () => {
    const redeliveredIssue = createIssue('Ready for QA', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-06-01T10:00:00.000Z' },
      { toStatusName: 'Working', atIso: '2026-06-10T10:00:00.000Z' },
      { toStatusName: 'Ready for QA', atIso: '2026-07-05T10:00:00.000Z' },
    ]);
    expect(resolveDeliveryDateIso(redeliveredIssue)).toBe('2026-07-05T10:00:00.000Z');
  });

  it('returns null when the changelog was never fetched (attribution unknown)', () => {
    expect(resolveDeliveryDateIso(createIssue('Ready for QA', 'indeterminate'))).toBeNull();
  });

  it('falls back to the created date when a delivered issue has no status transitions at all', () => {
    expect(resolveDeliveryDateIso(createIssue('Ready for QA', 'indeterminate', []))).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('returns null for issues that are simply not delivered', () => {
    expect(resolveDeliveryDateIso(createIssue('Working', 'indeterminate', []))).toBeNull();
  });
});

describe('isDeliveredWithinWindow', () => {
  const PI_START = '2026-05-21';
  const PI_END = '2026-07-29';

  it('credits a delivery that lands inside the PI window', () => {
    const issue = createIssue('Ready for QA', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-06-01T10:00:00.000Z' },
    ]);
    expect(isDeliveredWithinWindow(issue, PI_START, PI_END)).toBe(true);
  });

  it('treats the last day of the PI as inclusive ("on or before the last day")', () => {
    const lastDayIssue = createIssue('Ready for QA', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-07-29T23:00:00.000Z' },
    ]);
    expect(isDeliveredWithinWindow(lastDayIssue, PI_START, PI_END)).toBe(true);
  });

  it('classifies a delivery after the PI end as carry-over (no credit this PI)', () => {
    const carryOverIssue = createIssue('Ready for QA', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-07-30T01:00:00.000Z' },
    ]);
    expect(isDeliveredWithinWindow(carryOverIssue, PI_START, PI_END)).toBe(false);
  });

  it('gives a delivered issue the benefit of the doubt when no changelog was fetched', () => {
    // Live current-PI views may not fetch changelogs; a currently-delivered issue still counts.
    expect(isDeliveredWithinWindow(createIssue('Ready to Accept', 'indeterminate'), PI_START, PI_END)).toBe(true);
  });

  it('never credits an issue that is not currently delivered', () => {
    const regressedIssue = createIssue('Working', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-06-01T10:00:00.000Z' },
      { toStatusName: 'Working', atIso: '2026-06-10T10:00:00.000Z' },
    ]);
    expect(isDeliveredWithinWindow(regressedIssue, PI_START, PI_END)).toBe(false);
  });
});

describe('isDeliveredForCredit', () => {
  const deliveredIssue = createIssue('Ready for QA', 'indeterminate', [
    { toStatusName: 'Ready for QA', atIso: '2026-08-01T10:00:00.000Z' },
  ]);

  it('applies the PI window when one is known', () => {
    // Delivered in August, but the window ends 07/29 → carry-over, no credit.
    expect(isDeliveredForCredit(deliveredIssue, { startIso: '2026-05-21', endIso: '2026-07-29' })).toBe(false);
    expect(isDeliveredForCredit(deliveredIssue, { startIso: '2026-07-30', endIso: '2026-10-07' })).toBe(true);
  });

  it('falls back to the plain delivered rule when no window is known', () => {
    expect(isDeliveredForCredit(deliveredIssue, null)).toBe(true);
    expect(isDeliveredForCredit(createIssue('Working', 'indeterminate'), null)).toBe(false);
  });
});

describe('groupIssuesByStatusBucket', () => {
  it('groups every issue by statusCategory so "Working" lands in In Progress', () => {
    const workingIssue = createIssue('Working', 'indeterminate');
    const openIssue = createIssue('Open', 'new');
    const acceptedIssue = createIssue('Accepted', 'done');

    const groupedIssues = groupIssuesByStatusBucket([workingIssue, openIssue, acceptedIssue]);
    expect(groupedIssues['In Progress']).toEqual([workingIssue]);
    expect(groupedIssues['To Do']).toEqual([openIssue]);
    expect(groupedIssues.Done).toEqual([acceptedIssue]);
  });
});

describe('groupInProgressIssuesBySubGroup', () => {
  it('returns ordered non-empty sub-groups: Active → Internal Testing → External Testing → Ready to Accept', () => {
    const workingIssue = createIssue('Working', 'indeterminate');
    const internalTestingIssue = createIssue('Ready for Testing', 'indeterminate');
    const externalTestingIssue = createIssue('Ready for QA', 'indeterminate');

    const subGroups = groupInProgressIssuesBySubGroup([externalTestingIssue, workingIssue, internalTestingIssue]);
    expect(subGroups.map((subGroup) => subGroup.subGroup)).toEqual(['Active', 'Internal Testing', 'External Testing']);
    expect(subGroups[0].issues).toEqual([workingIssue]);
    expect(subGroups[1].issues).toEqual([internalTestingIssue]);
    expect(subGroups[2].issues).toEqual([externalTestingIssue]);
  });

  it('omits empty sub-groups entirely', () => {
    const subGroups = groupInProgressIssuesBySubGroup([createIssue('Ready to Accept', 'indeterminate')]);
    expect(subGroups).toEqual([{ subGroup: 'Ready to Accept', issues: [expect.objectContaining({ key: 'TBX-1' })] }]);
  });
});
