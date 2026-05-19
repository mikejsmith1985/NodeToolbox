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
              status: { name: 'To Do', statusCategory: { key: 'new' } },
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
