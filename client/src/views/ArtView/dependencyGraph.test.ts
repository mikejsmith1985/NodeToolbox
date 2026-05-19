// dependencyGraph.test.ts — Unit tests for the legacy-style dependency graph data model.

import { describe, expect, it } from 'vitest';

import {
  buildDependencyGraphData,
  createDefaultDependencyFilterState,
  filterDependencyGraphData,
  type DependencySourceIssue,
} from './dependencyGraph.ts';

const MOCK_TEAM_OPTIONS = [
  { key: 'ALPHA', label: 'Alpha Team' },
  { key: 'BETA', label: 'Beta Team' },
];

const MOCK_SOURCE_ISSUES: DependencySourceIssue[] = [
  {
    key: 'PE-1',
    summary: 'Platform resilience',
    status: 'In Progress',
    issueType: 'Program Epic',
    nodeType: 'pe',
    teamName: null,
    projectKey: 'PE',
    inTeam: false,
    featureKey: null,
    programEpicKey: 'PE-1',
    issueLinks: [],
  },
  {
    key: 'FEAT-10',
    summary: 'Authentication hardening',
    status: 'In Progress',
    issueType: 'Feature',
    nodeType: 'feature',
    teamName: null,
    projectKey: 'FEAT',
    inTeam: false,
    featureKey: 'FEAT-10',
    programEpicKey: 'PE-1',
    issueLinks: [],
  },
  {
    key: 'ALPHA-1',
    summary: 'Deploy shared library',
    status: 'In Progress',
    issueType: 'Story',
    nodeType: 'story',
    teamName: 'Alpha Team',
    projectKey: 'ALPHA',
    inTeam: true,
    featureKey: 'FEAT-10',
    programEpicKey: 'PE-1',
    issueLinks: [
      {
        id: 'edge-1',
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        outwardIssue: {
          key: 'BETA-7',
          fields: {
            summary: 'Integrate shared library',
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            issuetype: { name: 'Story' },
          },
        },
      },
      {
        id: 'edge-2',
        type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
        outwardIssue: {
          key: 'GAMMA-9',
          fields: {
            summary: 'External partner dependency',
            status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Story' },
          },
        },
      },
    ],
  },
];

const INWARD_ONLY_EXTERNAL_SOURCE_ISSUES: DependencySourceIssue[] = [
  {
    key: 'BETA-7',
    summary: 'Integrate shared library',
    status: 'To Do',
    issueType: 'Story',
    nodeType: 'story',
    teamName: 'Beta Team',
    projectKey: 'BETA',
    inTeam: true,
    featureKey: 'FEAT-10',
    programEpicKey: 'PE-1',
    issueLinks: [
      {
        id: 'edge-3',
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        inwardIssue: {
          key: 'GAMMA-9',
          fields: {
            summary: 'External platform delay',
            status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Task' },
          },
        },
      },
    ],
  },
];

describe('dependencyGraph', () => {
  it('builds placeholder nodes for linked issues outside the loaded Blueprint hierarchy', () => {
    const graphData = buildDependencyGraphData(MOCK_SOURCE_ISSUES, ['blocks', 'relates to'], MOCK_TEAM_OPTIONS);

    expect(graphData.edges).toHaveLength(2);
    expect(graphData.nodes.find((node) => node.key === 'BETA-7')?.isPlaceholder).toBe(true);
    expect(graphData.nodes.find((node) => node.key === 'GAMMA-9')?.inTeam).toBe(false);
  });

  it('filters by team focus with outbound direction only', () => {
    const graphData = buildDependencyGraphData(MOCK_SOURCE_ISSUES, ['blocks', 'relates to'], MOCK_TEAM_OPTIONS);
    const filterState = {
      ...createDefaultDependencyFilterState(),
      focusMode: 'team' as const,
      focusTeamProjectKey: 'ALPHA',
      directionFilter: 'outbound' as const,
    };

    const filteredGraph = filterDependencyGraphData(graphData, filterState);

    expect(filteredGraph.visibleEdges).toHaveLength(2);
    expect(filteredGraph.visibleNodes.map((node) => node.key)).toContain('ALPHA-1');
  });

  it('filters to only off-train dependencies when requested', () => {
    const graphData = buildDependencyGraphData(MOCK_SOURCE_ISSUES, ['blocks', 'relates to'], MOCK_TEAM_OPTIONS);
    const filterState = {
      ...createDefaultDependencyFilterState(),
      isOffTrainOnly: true,
    };

    const filteredGraph = filterDependencyGraphData(graphData, filterState);

    expect(filteredGraph.visibleEdges).toHaveLength(1);
    expect(filteredGraph.visibleEdges[0].toKey).toBe('GAMMA-9');
  });

  it('creates placeholders for inward-only external links so those dependencies remain visible', () => {
    const graphData = buildDependencyGraphData(INWARD_ONLY_EXTERNAL_SOURCE_ISSUES, ['blocks'], MOCK_TEAM_OPTIONS);

    expect(graphData.nodes.find((node) => node.key === 'GAMMA-9')?.isPlaceholder).toBe(true);
    expect(graphData.edges).toHaveLength(1);
    expect(graphData.edges[0].fromKey).toBe('GAMMA-9');
    expect(graphData.edges[0].toKey).toBe('BETA-7');
  });
});
