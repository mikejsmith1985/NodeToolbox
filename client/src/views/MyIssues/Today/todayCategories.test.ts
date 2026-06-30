// todayCategories.test.ts — Unit tests for the Scrum Master "Today" dashboard selectors.
//
// These prove that the Today tab buckets issues purely through the existing Hygiene
// rules. Fixtures carry only the fields each rule actually reads, so a passing test
// documents exactly which Jira data drives each category.

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../Hygiene/checks/hygieneChecks.ts';
import {
  CATEGORY_CATALOG,
  bucketTeamHygiene,
  isBlockedIssue,
  isDoneForToday,
  selectBlockers,
  selectDueOverdue,
  selectMyStale,
  selectUntriaged,
  type CategoryId,
} from './todayCategories.ts';

// A date far enough in the past to clear any stale / overdue threshold.
const LONG_PAST_ISO = '2020-01-01T00:00:00.000Z';
// A date far enough in the past as a plain Jira date-only string (overdue dates).
const LONG_PAST_DATE = '2020-01-01';

/** Builds a minimal hygiene JiraIssue, letting each test override only the fields it cares about. */
function createIssue(key: string, fields: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      ...fields,
    },
  };
}

// ── isBlockedIssue ──

describe('isBlockedIssue', () => {
  it('is true when the status name is Blocked', () => {
    expect(isBlockedIssue(createIssue('A-1', { status: { name: 'Blocked' } }))).toBe(true);
  });

  it('is true when the status name is Impeded', () => {
    expect(isBlockedIssue(createIssue('A-2', { status: { name: 'Impeded' } }))).toBe(true);
  });

  it('is true when the status name is On Hold', () => {
    expect(isBlockedIssue(createIssue('A-3', { status: { name: 'On Hold' } }))).toBe(true);
  });

  it('is false for an ordinary in-progress status', () => {
    expect(isBlockedIssue(createIssue('A-4', { status: { name: 'In Progress' } }))).toBe(false);
  });
});

// ── selectBlockers ──

describe('selectBlockers', () => {
  it('unions my + team blocked issues and dedupes a key present in both', () => {
    const sharedBlocked = createIssue('SHARED-1', { status: { name: 'Blocked' } });
    const myBlocked = createIssue('MY-1', { status: { name: 'Impeded' } });
    const teamBlocked = createIssue('TEAM-1', { status: { name: 'On Hold' } });
    const teamActive = createIssue('TEAM-2', { status: { name: 'In Progress' } });

    const blockers = selectBlockers([sharedBlocked, myBlocked], [sharedBlocked, teamBlocked, teamActive]);

    expect(blockers.map((issue) => issue.key)).toEqual(['SHARED-1', 'MY-1', 'TEAM-1']);
  });
});

// ── selectMyStale ──

describe('selectMyStale', () => {
  it('flags an in-progress issue not updated within the threshold', () => {
    const staleIssue = createIssue('MINE-1', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: LONG_PAST_ISO,
    });
    expect(selectMyStale([staleIssue]).map((issue) => issue.key)).toEqual(['MINE-1']);
  });

  it('does not flag a freshly updated in-progress issue', () => {
    const freshIssue = createIssue('MINE-2', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: new Date().toISOString(),
    });
    expect(selectMyStale([freshIssue])).toEqual([]);
  });
});

// ── bucketTeamHygiene ──

describe('bucketTeamHygiene', () => {
  it('routes an unassigned non-done issue into the unassigned bucket', () => {
    const unassignedIssue = createIssue('TEAM-U', {
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      issuetype: { name: 'Bug' },
      assignee: null,
    });
    expect(bucketTeamHygiene([unassignedIssue]).unassigned.map((issue) => issue.key)).toEqual(['TEAM-U']);
  });

  it('routes a story missing story points or AC into the commitment-gaps bucket', () => {
    const gapStory = createIssue('TEAM-G', {
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      issuetype: { name: 'Story' },
      assignee: { displayName: 'Pat Owner' },
      // No story points fields and no acceptance criteria → missing-sp + no-ac.
    });
    expect(bucketTeamHygiene([gapStory]).commitmentGaps.map((issue) => issue.key)).toEqual(['TEAM-G']);
  });

  it('routes a stale in-progress issue into the stale bucket', () => {
    const staleIssue = createIssue('TEAM-S', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Task' },
      assignee: { displayName: 'Pat Owner' },
      updated: LONG_PAST_ISO,
      customfield_10028: 5, // pointed, so it is not also a commitment gap
    });
    expect(bucketTeamHygiene([staleIssue]).stale.map((issue) => issue.key)).toEqual(['TEAM-S']);
  });
});

// ── selectDueOverdue ──

describe('selectDueOverdue', () => {
  it('includes a feature-type issue past its due date and dedupes the my + team union', () => {
    const overdueEpic = createIssue('DUE-1', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Epic' },
      duedate: LONG_PAST_DATE,
    });
    const healthyStory = createIssue('DUE-2', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
    });

    const overdue = selectDueOverdue([overdueEpic, healthyStory], [overdueEpic]);

    expect(overdue.map((issue) => issue.key)).toEqual(['DUE-1']);
  });
});

// ── selectUntriaged ──

describe('selectUntriaged', () => {
  it('returns the curated new set unchanged', () => {
    const untriaged = [createIssue('NEW-1'), createIssue('NEW-2')];
    expect(selectUntriaged(untriaged)).toHaveLength(2);
  });
});

// ── isDoneForToday ──

describe('isDoneForToday', () => {
  it('is true only when every catalog category is complete', () => {
    const allComplete = Object.fromEntries(
      CATEGORY_CATALOG.map((entry) => [entry.id, true]),
    ) as Record<CategoryId, boolean>;
    expect(isDoneForToday(allComplete)).toBe(true);

    const oneOutstanding = { ...allComplete, mentions: false };
    expect(isDoneForToday(oneOutstanding)).toBe(false);
  });
});
