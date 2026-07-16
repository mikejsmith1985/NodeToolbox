// blueprintHierarchy.test.ts — Unit tests for the legacy-style Blueprint hierarchy loader.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import type { ArtTeam } from './hooks/useArtData.ts';
import {
  fetchBlueprintHierarchy,
  fetchFeatureNodesByKeys,
  filterProgramEpicsBySearch,
  flattenProgramEpicFeatures,
} from './blueprintHierarchy.ts';

const MOCK_TEAMS: ArtTeam[] = [
  {
    id: 'team-1',
    name: 'Alpha Team',
    boardId: '42',
    projectKey: 'ALPHA',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  },
];

describe('blueprintHierarchy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('builds the legacy PE → Feature → Story hierarchy with external features, off-train children, and subtasks', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      featureLinkField: 'customfield_10108',
      parentLinkField: 'customfield_10100',
      piFieldId: 'customfield_10301',
    }));

    mockJiraGet
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-1',
            key: 'ALPHA-1',
            fields: {
              summary: 'Build login form',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: { displayName: 'Jane Doe' },
              customfield_10108: 'FEAT-10',
              customfield_10016: 5,
              project: { key: 'ALPHA' },
            },
          },
          {
            id: 'ALPHA-2',
            key: 'ALPHA-2',
            fields: {
              summary: 'Write unit tests',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10108: 'FEAT-10',
              customfield_10016: 3,
              project: { key: 'ALPHA' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'FEAT-10',
            key: 'FEAT-10',
            fields: {
              summary: 'User Authentication',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Feature' },
              customfield_10100: 'PE-1',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'PE-1',
            key: 'PE-1',
            fields: {
              summary: 'Member Onboarding',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Program Epic' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'FEAT-20',
            key: 'FEAT-20',
            fields: {
              summary: 'External Shared Capability',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              issuetype: { name: 'Feature' },
              customfield_10100: 'PE-1',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'BETA-1',
            key: 'BETA-1',
            fields: {
              summary: 'Off-train dependency story',
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: { displayName: 'Bob Builder' },
              parent: { key: 'FEAT-10' },
              project: { key: 'BETA' },
              customfield_10301: 'PI 25.2',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-1-S1',
            key: 'ALPHA-1-S1',
            fields: {
              summary: 'Add unit coverage',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Sub-task' },
              assignee: { displayName: 'Jane Doe' },
              parent: { key: 'ALPHA-1' },
            },
          },
        ],
      });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, 'PI 25.1');

    expect(programEpics).toHaveLength(1);
    expect(programEpics[0].key).toBe('PE-1');
    expect(programEpics[0].summary).toBe('Member Onboarding');
    expect(programEpics[0].features).toHaveLength(2);
    expect(programEpics[0].features[0].key).toBe('FEAT-10');
    expect(programEpics[0].features[0].children).toHaveLength(2);
    expect(programEpics[0].features[0].offTrain).toHaveLength(1);
    expect(programEpics[0].features[0].health).toBe('yellow');
    expect(programEpics[0].features[0].completionPercent).toBe(44);
    expect(programEpics[0].health).toBe('yellow');
    expect(programEpics[0].completionPercent).toBe(44);
    expect(programEpics[0].features[0].offTrain[0].offTrainReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNKNOWN_PROJECT' }),
        expect.objectContaining({ code: 'MISSING_PI', canFix: true }),
      ]),
    );
    expect(programEpics[0].features[0].children[0].subtasks).toEqual([
      expect.objectContaining({ key: 'ALPHA-1-S1', summary: 'Add unit coverage' }),
    ]);
    expect(programEpics[0].features[1]).toEqual(
      expect.objectContaining({ key: 'FEAT-20', isExternal: true }),
    );
  });

  it('uses the legacy fallback fields when the configured feature link is empty', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      featureLinkField: 'customfield_99999',
      parentLinkField: 'customfield_10100',
      piFieldId: 'customfield_10301',
    }));

    mockJiraGet
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-7',
            key: 'ALPHA-7',
            fields: {
              summary: 'Fallback issue link discovery',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10014: { data: { key: 'FEAT-77' } },
              project: { key: 'ALPHA' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'FEAT-77',
            key: 'FEAT-77',
            fields: {
              summary: 'Fallback Feature',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              issuetype: { name: 'Feature' },
              customfield_10100: { inwardIssue: { key: 'PE-77' } },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'PE-77',
            key: 'PE-77',
            fields: {
              summary: 'Fallback Program Epic',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              issuetype: { name: 'Program Epic' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, 'PI 25.1');

    expect(programEpics[0].key).toBe('PE-77');
    expect(programEpics[0].features[0].key).toBe('FEAT-77');
  });

  it('weights completion by status and includes off-train children in the feature percent', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      featureLinkField: 'customfield_10108',
      parentLinkField: 'customfield_10100',
      piFieldId: 'customfield_10301',
    }));

    mockJiraGet
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-10',
            key: 'ALPHA-10',
            fields: {
              summary: 'Build workflow',
              status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10108: 'FEAT-55',
              project: { key: 'ALPHA' },
            },
          },
          {
            id: 'ALPHA-11',
            key: 'ALPHA-11',
            fields: {
              summary: 'Prepare business review',
              status: { name: 'Ready to Accept', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10108: 'FEAT-55',
              project: { key: 'ALPHA' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'FEAT-55',
            key: 'FEAT-55',
            fields: {
              summary: 'Feature Fifty Five',
              status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Feature' },
              customfield_10100: 'PE-55',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'PE-55',
            key: 'PE-55',
            fields: {
              summary: 'Program Epic Fifty Five',
              status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Program Epic' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'BETA-55',
            key: 'BETA-55',
            fields: {
              summary: 'Cross-team test execution',
              status: { name: 'Integrated Testing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: null,
              parent: { key: 'FEAT-55' },
              project: { key: 'BETA' },
              customfield_10016: 8,
              customfield_10301: 'PI 25.2',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ issues: [] });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, 'PI 25.1');

    // Implementing 0.2×1pt + Ready to Accept 1.0×1pt (delivered rule: full credit) +
    // Integrated Testing 0.5×8pt = 5.2 of 10 weighted points → 52%.
    expect(programEpics[0].features[0].completionPercent).toBe(52);
    expect(programEpics[0].completionPercent).toBe(52);
  });

  it('weights completion by story points instead of treating every child equally', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({
      featureLinkField: 'customfield_10108',
      parentLinkField: 'customfield_10100',
      piFieldId: 'customfield_10301',
    }));

    mockJiraGet
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-20',
            key: 'ALPHA-20',
            fields: {
              summary: 'Large completed story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10108: 'FEAT-88',
              customfield_10016: 8,
              project: { key: 'ALPHA' },
            },
          },
          {
            id: 'ALPHA-21',
            key: 'ALPHA-21',
            fields: {
              summary: 'Small working story',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Story' },
              assignee: null,
              customfield_10108: 'FEAT-88',
              customfield_10016: 2,
              project: { key: 'ALPHA' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'FEAT-88',
            key: 'FEAT-88',
            fields: {
              summary: 'Feature Eighty Eight',
              status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Feature' },
              customfield_10100: 'PE-88',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'PE-88',
            key: 'PE-88',
            fields: {
              summary: 'Program Epic Eighty Eight',
              status: { name: 'Implementing', statusCategory: { key: 'indeterminate' } },
              issuetype: { name: 'Program Epic' },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, 'PI 25.1');

    expect(programEpics[0].features[0].completionPercent).toBe(84);
    expect(programEpics[0].completionPercent).toBe(84);
  });

  it('returns an empty hierarchy when no feature links are found on the team issues', async () => {
    mockJiraGet.mockResolvedValueOnce({
      issues: [
        {
          id: 'ALPHA-1',
          key: 'ALPHA-1',
          fields: {
            summary: 'Standalone defect',
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            issuetype: { name: 'Bug' },
            assignee: null,
            project: { key: 'ALPHA' },
          },
        },
      ],
    });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, 'PI 25.1');

    expect(programEpics).toEqual([]);
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('queries open sprint issues by project key when no PI is selected', async () => {
    mockJiraGet.mockResolvedValueOnce({ issues: [] });

    const programEpics = await fetchBlueprintHierarchy(MOCK_TEAMS, '');

    expect(programEpics).toEqual([]);
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    const firstRequestPath = String(mockJiraGet.mock.calls[0][0]);
    expect(decodeURIComponent(firstRequestPath)).toContain('project = "ALPHA" AND sprint in openSprints()');
    expect(decodeURIComponent(firstRequestPath)).not.toContain('board =');
  });

  it('falls back to board issue endpoint when the team project key is missing', async () => {
    const teamWithoutProjectKey: ArtTeam = {
      ...MOCK_TEAMS[0],
      projectKey: '',
    };
    mockJiraGet.mockResolvedValueOnce({ issues: [] });

    const programEpics = await fetchBlueprintHierarchy([teamWithoutProjectKey], '');

    expect(programEpics).toEqual([]);
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(String(mockJiraGet.mock.calls[0][0])).toContain('/rest/agile/1.0/board/42/issue?');
  });

  it('filters program epics by feature or story search matches', () => {
    const filteredProgramEpics = filterProgramEpicsBySearch([
      {
        type: 'pe',
        key: 'PE-1',
        summary: 'Member Onboarding',
        status: 'In Progress',
        health: 'green',
        completionPercent: 50,
        features: [
          {
            type: 'feature',
            key: 'FEAT-10',
            summary: 'Authentication',
            status: 'In Progress',
            health: 'yellow',
            completionPercent: 50,
            isExternal: false,
            children: [
              {
                type: 'story',
                key: 'ALPHA-1',
                summary: 'Build login form',
                status: 'In Progress',
                issueType: 'Story',
                assignee: 'Jane Doe',
                assigneeAvatar: null,
                storyPoints: 5,
                teamName: 'Alpha Team',
                isOffTrain: false,
                offTrainReasons: [],
                subtasks: [],
              },
            ],
            offTrain: [],
          },
        ],
      },
    ], 'login');

    expect(filteredProgramEpics).toHaveLength(1);
    expect(filteredProgramEpics[0].features).toHaveLength(1);
  });

  it('flattens features across all Program Epic buckets', () => {
    const flattenedFeatures = flattenProgramEpicFeatures([
      {
        type: 'pe',
        key: 'PE-1',
        summary: 'One',
        status: 'In Progress',
        health: 'green',
        completionPercent: 100,
        features: [
          {
            type: 'feature',
            key: 'FEAT-1',
            summary: 'Feature One',
            status: 'Done',
            health: 'green',
            completionPercent: 100,
            isExternal: false,
            children: [],
            offTrain: [],
          },
        ],
      },
      {
        type: 'pe',
        key: 'PE-2',
        summary: 'Two',
        status: 'To Do',
        health: 'blue',
        completionPercent: 0,
        features: [
          {
            type: 'feature',
            key: 'FEAT-2',
            summary: 'Feature Two',
            status: 'To Do',
            health: 'blue',
            completionPercent: 0,
            isExternal: false,
            children: [],
            offTrain: [],
          },
        ],
      },
    ]);

    expect(flattenedFeatures.map((feature) => feature.key)).toEqual(['FEAT-1', 'FEAT-2']);
  });
});

describe('fetchFeatureNodesByKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem('tbxARTSettings', JSON.stringify({ featureLinkField: 'customfield_10108', piFieldId: 'customfield_10301' }));
  });

  it('returns an empty array when given no keys (no queries run)', async () => {
    expect(await fetchFeatureNodesByKeys([])).toEqual([]);
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('builds a feature node with health/completion computed from its children', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('key in (')) {
        return Promise.resolve({ issues: [{ key: 'F-1', fields: { summary: 'Feature One', status: { name: 'In Progress' } } }] });
      }
      // Child discovery (Epic Link / parent).
      return Promise.resolve({
        issues: [
          { key: 'S-1', fields: { summary: 'S1', status: { name: 'Done', statusCategory: { key: 'done' } }, parent: { key: 'F-1' }, customfield_10016: 3 } },
          { key: 'S-2', fields: { summary: 'S2', status: { name: 'To Do', statusCategory: { key: 'new' } }, parent: { key: 'F-1' }, customfield_10016: 2 } },
        ],
      });
    });

    const nodes = await fetchFeatureNodesByKeys(['F-1']);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].key).toBe('F-1');
    expect(nodes[0].summary).toBe('Feature One');
    // Two children, one done → 0.5 done ratio → yellow; children sorted not-done first.
    expect(nodes[0].health).toBe('yellow');
    expect(nodes[0].children.map((childStory) => childStory.key)).toEqual(['S-2', 'S-1']);
    expect(nodes[0].completionPercent).toBeGreaterThan(0);
  });

  it('carries statuscategorychangedate onto each child story as statusChangedIso (null when absent)', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('key in (')) {
        return Promise.resolve({ issues: [{ key: 'F-9', fields: { summary: 'Feature Nine', status: { name: 'In Progress' } } }] });
      }
      // Child discovery — one child carries the field, one omits it.
      return Promise.resolve({
        issues: [
          { key: 'S-9', fields: { summary: 'Dated', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, parent: { key: 'F-9' }, statuscategorychangedate: '2026-07-01T09:00:00.000+0000' } },
          { key: 'S-10', fields: { summary: 'Undated', status: { name: 'To Do', statusCategory: { key: 'new' } }, parent: { key: 'F-9' } } },
        ],
      });
    });

    const nodes = await fetchFeatureNodesByKeys(['F-9']);
    const childrenByKey = new Map(nodes[0].children.map((childStory) => [childStory.key, childStory]));

    expect(childrenByKey.get('S-9')?.statusChangedIso).toBe('2026-07-01T09:00:00.000+0000');
    expect(childrenByKey.get('S-10')?.statusChangedIso).toBeNull();
    // The fetch must request the new system field so the value is available to thread downstream.
    const childRequestPath = String(mockJiraGet.mock.calls.find((call) => decodeURIComponent(String(call[0])).includes('parent in ('))?.[0] ?? '');
    expect(decodeURIComponent(childRequestPath)).toContain('statuscategorychangedate');
  });

  it('treats a childless feature as gray / 0% (superset of the old rollup)', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('key in (')) {
        return Promise.resolve({ issues: [{ key: 'F-2', fields: { summary: 'Empty feature', status: { name: 'To Do' } } }] });
      }
      return Promise.resolve({ issues: [] });
    });

    const nodes = await fetchFeatureNodesByKeys(['F-2']);

    expect(nodes[0].health).toBe('gray');
    expect(nodes[0].completionPercent).toBe(0);
    expect(nodes[0].children).toHaveLength(0);
  });
});
