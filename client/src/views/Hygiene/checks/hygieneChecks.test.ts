// hygieneChecks.test.ts — Unit tests for the Hygiene issue-health predicates.

import { describe, expect, it } from 'vitest';

import {
  checkMissingStoryPoints,
  checkNoAcceptanceCriteria,
  checkNoAssignee,
  checkOldInSprint,
  checkStaleIssue,
  evaluateHygieneIssue,
  summarizeHygieneFindings,
  type JiraIssue,
} from './hygieneChecks.ts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_STATUS = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const TODO_STATUS = { name: 'To Do', statusCategory: { key: 'new' } };
const DONE_STATUS = { name: 'Done', statusCategory: { key: 'done' } };

function buildDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildIssue(overrides: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    key: 'TBX-101',
    fields: {
      summary: 'Sample issue',
      status: TODO_STATUS,
      assignee: { displayName: 'Alex' },
      issuetype: { name: 'Story' },
      created: buildDateDaysAgo(5),
      updated: buildDateDaysAgo(1),
      description: 'Given a user opens the tool, when they run hygiene, then issues are reviewed.',
      customfield_10028: 3,
      customfield_10016: null,
      customfield_10020: [],
      ...overrides,
    },
  };
}

describe('hygiene check predicates', () => {
  it('flags Story issues when both story-point fields are empty', () => {
    const hygieneFlag = checkMissingStoryPoints(buildIssue({ customfield_10028: null, customfield_10016: null }));

    expect(hygieneFlag?.checkId).toBe('missing-sp');
  });

  it('does not flag Bugs for missing story points', () => {
    const hygieneFlag = checkMissingStoryPoints(
      buildIssue({ issuetype: { name: 'Bug' }, customfield_10028: null, customfield_10016: null }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('flags in-progress issues that have not been updated for more than fourteen days', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: buildDateDaysAgo(15) }));

    expect(hygieneFlag?.checkId).toBe('stale');
  });

  it('does not flag recently updated in-progress issues as stale', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: buildDateDaysAgo(3) }));

    expect(hygieneFlag).toBeNull();
  });

  it('flags in-progress issues with no assignee', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: ACTIVE_STATUS, assignee: null }));

    expect(hygieneFlag?.checkId).toBe('no-assignee');
  });

  it('does not flag unassigned issues that are not active work', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: TODO_STATUS, assignee: null }));

    expect(hygieneFlag).toBeNull();
  });

  it('flags stories whose description does not resemble acceptance criteria', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(buildIssue({ description: 'Needs work.' }));

    expect(hygieneFlag?.checkId).toBe('no-ac');
  });

  it('does not flag stories with a Given When Then description', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(
      buildIssue({ description: 'Given a release manager opens the report, when data loads, then risks are visible.' }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('flags active-sprint issues created more than thirty days ago', () => {
    const hygieneFlag = checkOldInSprint(
      buildIssue({ created: buildDateDaysAgo(31), customfield_10020: [{ id: 10, state: 'active' }] }),
    );

    expect(hygieneFlag?.checkId).toBe('old-in-sprint');
  });

  it('does not flag completed issues even when they remain in an active sprint', () => {
    const hygieneFlag = checkOldInSprint(
      buildIssue({ status: DONE_STATUS, created: buildDateDaysAgo(60), customfield_10020: [{ state: 'active' }] }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('evaluates multiple flags for the same unhealthy active issue', () => {
    const flags = evaluateHygieneIssue(
      buildIssue({
        status: ACTIVE_STATUS,
        assignee: null,
        updated: buildDateDaysAgo(20),
        customfield_10028: null,
        customfield_10016: null,
      }),
    );

    expect(flags.map((flag) => flag.checkId)).toEqual(expect.arrayContaining(['missing-sp', 'stale', 'no-assignee']));
  });

  it('aggregates summary counts across a mixed finding set', () => {
    const missingStoryPointsIssue = buildIssue({ customfield_10028: null, customfield_10016: null });
    const staleIssue = { ...buildIssue(), key: 'TBX-102' };
    const findings = [
      { issue: missingStoryPointsIssue, flags: evaluateHygieneIssue(missingStoryPointsIssue) },
      { issue: staleIssue, flags: [{ checkId: 'stale' as const, label: 'Stale', severity: 'warn' as const }] },
    ];

    const summary = summarizeHygieneFindings(findings);

    expect(summary.totalIssues).toBe(2);
    expect(summary.totalFlags).toBe(2);
    expect(summary.countByCheck['missing-sp']).toBe(1);
    expect(summary.countByCheck.stale).toBe(1);
  });
});
