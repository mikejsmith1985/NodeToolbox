import { describe, expect, it, vi } from 'vitest';
import type { JiraIssue } from '../../types/jira.ts';
import { buildBurnDownData } from './buildBurnDownData.ts';

/** The two things the burndown actually reads about an issue, plus its optional status history. */
interface BurnDownIssueFixture {
  id: string;
  key: string;
  status: { name: string; statusCategory: { key: string } };
  created: string;
  updated: string;
  changelog?: JiraIssue['changelog'];
}

/**
 * Builds a JiraIssue for these tests.
 *
 * JiraIssue.fields requires several fields the burndown never looks at — priority, assignee,
 * reporter, issuetype, description. Spelling them out in every fixture would bury the two that
 * matter (the status and the timestamps), which is why each fixture used to be cast instead. Filling
 * the irrelevant ones here once means a fixture states only what its test is really about.
 */
function buildBurnDownIssue(fixture: BurnDownIssueFixture): JiraIssue {
  return {
    id: fixture.id,
    key: fixture.key,
    ...(fixture.changelog ? { changelog: fixture.changelog } : {}),
    fields: {
      summary: `Issue ${fixture.id}`,
      status: fixture.status,
      created: fixture.created,
      updated: fixture.updated,
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      description: null,
    },
  };
}

const TO_DO_STATUS = { name: 'To Do', statusCategory: { key: 'new' } };
const DONE_STATUS = { name: 'Done', statusCategory: { key: 'done' } };

describe('buildBurnDownData', () => {
  const startDate = '2025-01-01T09:00:00.000Z';
  const endDate = '2025-01-11T09:00:00.000Z'; // 10 days

  it('calculates the ideal burndown correctly', () => {
    const issues: JiraIssue[] = [
      buildBurnDownIssue({
        id: '1',
        key: 'TBX-1',
        status: TO_DO_STATUS,
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      }),
    ];
    // isClosed = true
    const result = buildBurnDownData(startDate, endDate, issues, true);

    expect(result).toHaveLength(11); // Day 0 to 10
    // Ideal should start at 1 and drop to 0
    expect(result[0].ideal).toBe(1);
    expect(result[10].ideal).toBe(0);
    // Projected should start at 0 and rise to 1
    expect(result[0].projected).toBe(0);
    expect(result[10].projected).toBe(1);
  });

  it('calculates the projected burnup correctly over multiple days', () => {
    const issues: JiraIssue[] = [
      buildBurnDownIssue({
        id: '1',
        key: 'TBX-1',
        status: TO_DO_STATUS,
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      }),
      buildBurnDownIssue({
        id: '2',
        key: 'TBX-2',
        status: TO_DO_STATUS,
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      }),
    ];
    const result = buildBurnDownData(startDate, endDate, issues, true);

    expect(result[0].projected).toBe(0);
    expect(result[5].projected).toBe(1); // Day 5 is middle of 10 days (2 * 5 / 10 = 1)
    expect(result[10].projected).toBe(2); // Day 10 is end of 10 days (2 * 10 / 10 = 2)
  });

  it('calculates completed and remaining over time with changelog', () => {
    // Issue 1 is completed on Day 5
    const issue1 = buildBurnDownIssue({
      id: '1',
      key: 'TBX-1',
      status: DONE_STATUS,
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-06T08:00:00.000Z',
      changelog: {
        histories: [
          {
            id: 'h1',
            created: '2025-01-06T08:00:00.000Z', // Day 5
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                from: 'To Do',
                fromString: 'To Do',
                to: 'Done',
                toString: 'Done',
              },
            ],
          },
        ],
      },
    });

    const result = buildBurnDownData(startDate, endDate, [issue1], true);

    // Before Day 5 (Day 0 to 4), it is remaining
    expect(result[0].remaining).toBe(1);
    expect(result[0].completed).toBe(0);
    expect(result[4].remaining).toBe(1);
    expect(result[4].completed).toBe(0);

    // On and after Day 5 (Day 5 to 10), it is completed
    expect(result[5].remaining).toBe(0);
    expect(result[5].completed).toBe(1);
    expect(result[10].remaining).toBe(0);
    expect(result[10].completed).toBe(1);
  });

  it('handles fallbacks when no changelog is available using updated timestamp', () => {
    const issue1 = buildBurnDownIssue({
      id: '1',
      key: 'TBX-1',
      status: DONE_STATUS,
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-06T08:00:00.000Z', // Day 5
    });

    const result = buildBurnDownData(startDate, endDate, [issue1], true);

    // Before Day 5 (Day 0 to 4), remaining is 1, completed is 0
    expect(result[0].remaining).toBe(1);
    expect(result[0].completed).toBe(0);

    // On/after Day 5, remaining is 0, completed is 1
    expect(result[5].remaining).toBe(0);
    expect(result[5].completed).toBe(1);
  });

  it('respects the active sprint todayDayIndex limit', () => {
    // Suppose today is Day 3
    const today = new Date('2025-01-04T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(today);

    const issue1 = buildBurnDownIssue({
      id: '1',
      key: 'TBX-1',
      status: TO_DO_STATUS,
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
    });

    const result = buildBurnDownData(startDate, endDate, [issue1], false); // active sprint

    // Day 0 to 3 should have remaining/completed plotted
    expect(result[0].remaining).toBe(1);
    expect(result[3].remaining).toBe(1);

    // Day 4 onwards should be undefined (not plotted)
    expect(result[4].remaining).toBeUndefined();
    expect(result[10].remaining).toBeUndefined();

    vi.useRealTimers();
  });
});
