// scopedTeamFeatures.test.ts — Unit tests for Team Dashboard feature scoping by project, PI, and team children.

import { describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import type { BlueprintFeatureNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';

const { mockJiraGet, mockFetchBlueprintHierarchy } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchBlueprintHierarchy: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

vi.mock('../ArtView/blueprintHierarchy.ts', () => ({
  fetchBlueprintHierarchy: mockFetchBlueprintHierarchy,
  flattenProgramEpicFeatures: (featureNodes: BlueprintFeatureNode[]) => featureNodes,
}));

import { fetchScopedTeamFeatures } from './scopedTeamFeatures.ts';

function createFeatureNode(overrides: Partial<BlueprintFeatureNode> & Pick<BlueprintFeatureNode, 'key' | 'summary'>): BlueprintFeatureNode {
  return {
    type: 'feature',
    key: overrides.key,
    summary: overrides.summary,
    status: overrides.status ?? 'In Progress',
    health: overrides.health ?? 'green',
    completionPercent: overrides.completionPercent ?? 50,
    children: overrides.children ?? [],
    offTrain: overrides.offTrain ?? [],
    isExternal: overrides.isExternal ?? true,
  };
}

function createJiraIssue(overrides: { key: string; piValue?: string }): JiraIssue {
  return {
    id: overrides.key,
    key: overrides.key,
    fields: {
      summary: `${overrides.key} summary`,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Feature', iconUrl: '' },
      created: '',
      updated: '',
      description: null,
      customfield_10301: overrides.piValue ?? '',
    },
  };
}

describe('fetchScopedTeamFeatures', () => {
  it('filters out features outside the allowed project list, wrong PI, or missing team children', async () => {
    const team: ArtTeam = {
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      projectKey: 'ENFCT',
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    };

    mockFetchBlueprintHierarchy.mockResolvedValue([
      createFeatureNode({
        key: 'DENP-100',
        summary: 'Current PI feature',
        children: [{ key: 'ENFCT-1' }] as BlueprintFeatureNode['children'],
      }),
      createFeatureNode({
        key: 'OLD-200',
        summary: 'Old PI feature',
        children: [{ key: 'ENFCT-2' }] as BlueprintFeatureNode['children'],
      }),
      createFeatureNode({
        key: 'DENP-300',
        summary: 'No team children',
        children: [],
      }),
      createFeatureNode({
        key: 'OTHR-400',
        summary: 'Other project feature',
        children: [{ key: 'ENFCT-3' }] as BlueprintFeatureNode['children'],
      }),
    ]);
    mockJiraGet.mockResolvedValue({
      issues: [
        createJiraIssue({ key: 'DENP-100', piValue: 'PI 26.3' }),
        createJiraIssue({ key: 'OLD-200', piValue: 'PI 25.4' }),
        createJiraIssue({ key: 'OTHR-400', piValue: 'PI 26.3' }),
      ],
    });

    const scopedFeatures = await fetchScopedTeamFeatures(team, 'PI 26.3', {
      piFieldId: 'customfield_10301',
      featureProjectKeys: ['DENP'],
      requestedFieldIds: ['summary'],
    });

    expect(scopedFeatures.map((featureRecord) => featureRecord.feature.key)).toEqual(['DENP-100']);
  });
});
