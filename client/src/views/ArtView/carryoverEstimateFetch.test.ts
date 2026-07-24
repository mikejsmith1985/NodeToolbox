// carryoverEstimateFetch.test.ts — Tests for fetching + shaping a carried Feature's children.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { fetchCarryoverChildrenByFeature } from './carryoverEstimateFetch.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

const FEATURE_LINK_FIELD = 'customfield_10108';

beforeEach(() => {
  mockJiraGet.mockReset();
  localStorage.clear();
});

/** Builds a raw child issue linked to a feature via the feature-link field. */
function rawChild(options: {
  key: string;
  summary: string;
  featureKey: string;
  statusName?: string;
  statusCategoryKey?: string;
  points?: number;
  assignee?: { displayName?: string } | null;
}) {
  return {
    key: options.key,
    fields: {
      summary: options.summary,
      status: { name: options.statusName ?? 'To Do', statusCategory: { key: options.statusCategoryKey ?? 'new' } },
      assignee: options.assignee ?? null,
      customfield_10028: options.points ?? null,
      [FEATURE_LINK_FIELD]: options.featureKey,
    },
  };
}

describe('fetchCarryoverChildrenByFeature', () => {
  it('queries by the feature-link field and groups children under their feature', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        rawChild({ key: 'DEV-1', summary: 'DEV: build', featureKey: 'FEAT-1', points: 5 }),
        rawChild({ key: 'QA-1', summary: 'QA: test', featureKey: 'FEAT-1' }),
        rawChild({ key: 'DEV-2', summary: 'DEV: other', featureKey: 'FEAT-2' }),
      ],
    });

    const grouped = await fetchCarryoverChildrenByFeature(['FEAT-1', 'FEAT-2'], []);

    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('cf[10108] in ("FEAT-1", "FEAT-2")');
    expect(grouped.get('FEAT-1')).toHaveLength(2);
    expect(grouped.get('FEAT-2')).toHaveLength(1);
    expect(grouped.get('FEAT-1')?.[0]).toMatchObject({ summary: 'DEV: build', storyPoints: 5 });
  });

  it('resolves the assignee roster role for the classifier fallback', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [rawChild({ key: 'X-1', summary: 'Update mapping', featureKey: 'FEAT-1', assignee: { displayName: 'Tester, Sam' } })],
    });
    const roster: StandupRosterMember[] = [
      {
        id: 'roster:sam', displayName: 'Tester, Sam', assigneeQueryValue: 'sam.qa',
        roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false },
      },
    ];

    const grouped = await fetchCarryoverChildrenByFeature(['FEAT-1'], roster);

    // Summary is silent, so the estimator will need the assignee role — resolved to 'test' here.
    expect(grouped.get('FEAT-1')?.[0].assigneeRoleKind).toBe('test');
  });

  it('unwraps a dropdown story-points option into a number', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [{
        key: 'DEV-1',
        fields: {
          summary: 'DEV: build',
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          assignee: null,
          customfield_10028: { value: '8' },
          [FEATURE_LINK_FIELD]: 'FEAT-1',
        },
      }],
    });

    const grouped = await fetchCarryoverChildrenByFeature(['FEAT-1'], []);

    expect(grouped.get('FEAT-1')?.[0].storyPoints).toBe(8);
  });

  it('makes no Jira call and returns empty for no feature keys', async () => {
    const grouped = await fetchCarryoverChildrenByFeature([], []);

    expect(grouped.size).toBe(0);
    expect(mockJiraGet).not.toHaveBeenCalled();
  });
});
