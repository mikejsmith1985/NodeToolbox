// deliveryHealthFetch.test.ts — One read of Jira, feeding every panel on the dashboard.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import {
  fetchDeliveryHealth,
  readCurrentStatusEntryIso,
  readStatusHistory,
  toDeliveryHealthData,
} from './deliveryHealthFetch.ts';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';

// Read from the central resolver: the field-mapping boundary fails any NEW file naming a custom id.
const [STORY_POINTS_FIELD] = resolveStoryPointsFieldIds('');

/** One changelog entry moving an issue between two named statuses. */
function statusChange(fromName: string, toName: string, createdIso: string) {
  return { created: createdIso, items: [{ field: 'status', fromString: fromName, toString: toName }] };
}

/** One issue as Jira returns it. */
function issue(
  key: string,
  statusName: string,
  categoryKey: string,
  histories: ReturnType<typeof statusChange>[] = [],
) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      created: '2026-08-01T00:00:00.000Z',
      status: { name: statusName, statusCategory: { key: categoryKey } },
      assignee: { displayName: 'Reynolds, Kevin' },
      [STORY_POINTS_FIELD]: 5,
    },
    changelog: { histories },
  };
}

describe('readCurrentStatusEntryIso', () => {
  it('takes the LAST status change, not the first', () => {
    // Dating it from the first move would report a wait that includes the time somebody spent working.
    const entered = readCurrentStatusEntryIso(issue('A-1', 'Ready for Testing', 'indeterminate', [
      statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z'),
      statusChange('In Progress', 'Ready for Testing', '2026-08-20T00:00:00.000Z'),
    ]));

    expect(entered).toBe('2026-08-20T00:00:00.000Z');
  });

  it('falls back to creation for an issue that never moved', () => {
    expect(readCurrentStatusEntryIso(issue('A-1', 'To Do', 'new'))).toBe('2026-08-01T00:00:00.000Z');
  });

  it('ignores changes to other fields when finding the last status move', () => {
    const entered = readCurrentStatusEntryIso({
      ...issue('A-1', 'In Progress', 'indeterminate', [statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z')]),
      changelog: {
        histories: [
          statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z'),
          { created: '2026-08-25T00:00:00.000Z', items: [{ field: 'assignee', toString: 'Somebody' }] },
        ],
      },
    });

    expect(entered).toBe('2026-08-03T00:00:00.000Z');
  });
});

describe('readStatusHistory', () => {
  it('reads the status it was created in from the first change', () => {
    const history = readStatusHistory(issue('A-1', 'Done', 'done', [
      statusChange('To Do', 'In Progress', '2026-08-03T00:00:00.000Z'),
      statusChange('In Progress', 'Done', '2026-08-06T00:00:00.000Z'),
    ]));

    expect(history.initialStatusName).toBe('To Do');
    expect(history.statusTransitions).toHaveLength(2);
  });
});

describe('toDeliveryHealthData', () => {
  it('counts only OPEN work as waiting', () => {
    // A finished issue's "time in status" is time since it shipped, which is not a queue.
    const data = toDeliveryHealthData([
      issue('OPEN-1', 'Ready for Testing', 'indeterminate'),
      issue('DONE-1', 'Done', 'done'),
    ], STORY_POINTS_FIELD, false);

    expect(data.queueIssues.map((each) => each.key)).toEqual(['OPEN-1']);
  });

  it('gives the rework scan EVERY issue, finished or not', () => {
    // A closed issue that bounced on its way to closing is exactly what rework means.
    const data = toDeliveryHealthData([
      issue('OPEN-1', 'Ready for Testing', 'indeterminate'),
      issue('DONE-1', 'Done', 'done'),
    ], STORY_POINTS_FIELD, false);

    expect(data.reworkIssues).toHaveLength(2);
  });

  it('carries the points, status and holder each panel needs', () => {
    const [queued] = toDeliveryHealthData(
      [issue('A-1', 'Ready for Testing', 'indeterminate')],
      STORY_POINTS_FIELD,
      false,
    ).queueIssues;

    expect(queued.statusName).toBe('Ready for Testing');
    expect(queued.assigneeName).toBe('Reynolds, Kevin');
    expect(queued.storyPoints).toBe(5);
  });

  it('survives an issue that states almost nothing', () => {
    const data = toDeliveryHealthData([{ key: 'A-1', fields: {} }], STORY_POINTS_FIELD, false);

    expect(data.queueIssues[0].statusName).toBe('Unknown');
    expect(data.queueIssues[0].assigneeName).toBeNull();
  });
});

describe('fetchDeliveryHealth', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('reads the scope ONCE for every panel', async () => {
    // Four reports asking the same scope four times is four chances to disagree with each other.
    mockJiraGet.mockResolvedValue({ issues: [issue('A-1', 'In Progress', 'indeterminate')] });

    const data = await fetchDeliveryHealth('project = ENCUC', 90);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(data.queueIssues).toHaveLength(1);
    expect(data.reworkIssues).toHaveLength(1);
  });

  it('asks for the changelog, without which nothing can be aged', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchDeliveryHealth('', 90);

    expect(String(mockJiraGet.mock.calls[0][0])).toContain('expand=changelog');
  });

  it('reads a bare project key as a project rather than erroring', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    await fetchDeliveryHealth('ENCUC', 90);

    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('project = ENCUC');
  });

  it('says when it stopped short, so a sample is never quoted as the whole scope', async () => {
    const fullPage = Array.from({ length: 100 }, (_unused, index) =>
      issue(`A-${index}`, 'In Progress', 'indeterminate'));
    mockJiraGet.mockResolvedValue({ issues: fullPage });

    const data = await fetchDeliveryHealth('', 90);

    expect(data.wasTruncated).toBe(true);
  });

  it('stops on a short page rather than asking for another', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issue('A-1', 'In Progress', 'indeterminate')] });

    await fetchDeliveryHealth('', 90);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });
});
