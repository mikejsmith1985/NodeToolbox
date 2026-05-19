// sprintDashboardIssueUtils.test.ts — Unit tests for shared Sprint Dashboard issue parity helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import {
  calculateIssueAgeDays,
  hasBlockingLink,
  isBlockedIssue,
  isDoneIssue,
  isStaleIssue,
  isStatusBlockedIssue,
  readStoryPoints,
  readStoryPointsValue,
} from './sprintDashboardIssueUtils.ts';

function createIssue(statusName = 'In Progress', statusCategoryKey = 'indeterminate'): JiraIssue {
  return {
    id: 'TBX-1',
    key: 'TBX-1',
    fields: {
      summary: 'Test issue',
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: { name: 'High', iconUrl: '' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-03T00:00:00.000Z',
      description: null,
      customfield_10016: 5,
      fixVersions: [],
    },
  };
}

describe('sprintDashboardIssueUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-06T00:00:00.000Z'));
  });

  it('reads the configured story points field and falls back to the legacy field', () => {
    const configuredFieldIssue = {
      ...createIssue(),
      fields: {
        ...createIssue().fields,
        customfield_10016: 3,
        story_points: 8,
      },
    } as JiraIssue;

    expect(readStoryPointsValue(configuredFieldIssue, 'story_points')).toBe(8);
    expect(readStoryPointsValue(createIssue(), 'story_points')).toBe(5);
    expect(readStoryPoints(createIssue(), 'story_points')).toBe(5);
  });

  it('detects blocked issues from both status names and inward blocking links', () => {
    const blockedByStatusIssue = createIssue('Blocked');
    const blockedByLinkIssue = {
      ...createIssue(),
      fields: {
        ...createIssue().fields,
        issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'TBX-2' } }],
      },
    } as JiraIssue;

    expect(isStatusBlockedIssue(blockedByStatusIssue)).toBe(true);
    expect(hasBlockingLink(blockedByLinkIssue)).toBe(true);
    expect(isBlockedIssue(blockedByLinkIssue)).toBe(true);
  });

  it('calculates issue age, done-state, and stale-state with legacy rules', () => {
    expect(calculateIssueAgeDays('2025-01-03T00:00:00.000Z')).toBe(3);
    expect(isDoneIssue(createIssue('Resolved', 'done'))).toBe(true);
    expect(isStaleIssue(createIssue('In Progress', 'indeterminate'), 3)).toBe(true);
    expect(isStaleIssue(createIssue('To Do', 'new'), 3)).toBe(false);
  });
});
