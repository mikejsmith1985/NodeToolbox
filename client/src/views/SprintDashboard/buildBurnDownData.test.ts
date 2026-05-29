import { describe, expect, it, vi } from 'vitest';
import type { JiraIssue } from '../../types/jira.ts';
import { buildBurnDownData } from './SprintDashboardView.tsx';

describe('buildBurnDownData', () => {
  const startDate = '2025-01-01T09:00:00.000Z';
  const endDate = '2025-01-11T09:00:00.000Z'; // 10 days

  it('calculates the ideal burndown correctly', () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'TBX-1',
        fields: {
          summary: 'Issue 1',
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-01T00:00:00.000Z',
        },
      } as any,
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
      {
        id: '1',
        key: 'TBX-1',
        fields: {
          summary: 'Issue 1',
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-01T00:00:00.000Z',
        },
      } as any,
      {
        id: '2',
        key: 'TBX-2',
        fields: {
          summary: 'Issue 2',
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-01T00:00:00.000Z',
        },
      } as any,
    ];
    const result = buildBurnDownData(startDate, endDate, issues, true);

    expect(result[0].projected).toBe(0);
    expect(result[5].projected).toBe(1); // Day 5 is middle of 10 days (2 * 5 / 10 = 1)
    expect(result[10].projected).toBe(2); // Day 10 is end of 10 days (2 * 10 / 10 = 2)
  });

  it('calculates completed and remaining over time with changelog', () => {
    // Issue 1 is completed on Day 5
    const issue1: JiraIssue = {
      id: '1',
      key: 'TBX-1',
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
      fields: {
        summary: 'Issue 1',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-06T08:00:00.000Z',
      },
    } as any;

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
    const issue1: JiraIssue = {
      id: '1',
      key: 'TBX-1',
      fields: {
        summary: 'Issue 1',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-06T08:00:00.000Z', // Day 5
      },
    } as any;

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

    const issue1: JiraIssue = {
      id: '1',
      key: 'TBX-1',
      fields: {
        summary: 'Issue 1',
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
    } as any;

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
