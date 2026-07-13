// piReviewPullFeatures.test.ts — Unit tests for pulling Program Increment Features into PI Review rows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockFetchScopedTeamFeatures } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchScopedTeamFeatures: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
  jiraPut: vi.fn(),
}));

vi.mock('../SprintDashboard/scopedTeamFeatures.ts', () => ({
  fetchScopedTeamFeatures: mockFetchScopedTeamFeatures,
}));

import type { ArtTeam } from './hooks/useArtData.ts';
import type { PiReviewRow } from './piReviewTable.ts';
import { createEmptyPiReviewRow } from './piReviewTable.ts';
import { buildDirectFeatureJql, pullPiReviewFeatures } from './piReviewPullFeatures.ts';

const DEFAULT_PI_FIELD_ID = 'customfield_10301';

function createTeam(overrides: Partial<ArtTeam> = {}): ArtTeam {
  return {
    id: 'team-1',
    name: 'Alpha Team',
    boardId: '42',
    projectKey: 'ALPHA',
    piReviewPages: [],
    sprintIssues: [],
    isLoading: false,
    loadError: null,
    ...overrides,
  };
}

function createRowForFeature(featureCellValue: string): PiReviewRow {
  const row = createEmptyPiReviewRow();
  row.feature = featureCellValue;
  return row;
}

const NO_FILTER = { labels: [], assigneeQueryValues: [] };
const PULL_SETTINGS = { piFieldId: DEFAULT_PI_FIELD_ID, featureProjectKeys: [] as string[] };

describe('buildDirectFeatureJql', () => {
  it('combines project, issuetype=Feature, PI, and label OR assignee filters', () => {
    const jql = buildDirectFeatureJql(
      createTeam(),
      'PI 26.4',
      { labels: ['Transformers'], assigneeQueryValues: ['user-1'] },
      DEFAULT_PI_FIELD_ID,
    );
    expect(jql).toBe(
      'project = "ALPHA" AND issuetype = Feature AND cf[10301] = "PI 26.4" '
      + 'AND (labels in ("Transformers") OR assignee in ("user-1"))',
    );
  });

  it('omits the parentheses when only one filter kind is provided', () => {
    const jql = buildDirectFeatureJql(
      createTeam(),
      'PI 26.4',
      { labels: ['Transformers'], assigneeQueryValues: [] },
      DEFAULT_PI_FIELD_ID,
    );
    expect(jql).toBe('project = "ALPHA" AND issuetype = Feature AND cf[10301] = "PI 26.4" AND labels in ("Transformers")');
  });

  it('returns null without a project key (cannot scope a direct Feature query)', () => {
    expect(buildDirectFeatureJql(createTeam({ projectKey: '' }), 'PI 26.4', NO_FILTER, DEFAULT_PI_FIELD_ID)).toBeNull();
  });

  it('returns null when there is no PI and no filters (would pull every Feature in the project)', () => {
    expect(buildDirectFeatureJql(createTeam(), '', NO_FILTER, DEFAULT_PI_FIELD_ID)).toBeNull();
  });
});

describe('pullPiReviewFeatures', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
    mockFetchScopedTeamFeatures.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('merges Blueprint and direct Features, de-duplicates by key, and builds "KEY - summary" rows', async () => {
    mockFetchScopedTeamFeatures.mockResolvedValue([
      { feature: { key: 'ALPHA-1', summary: 'Feature One' }, featureIssue: null },
    ]);
    mockJiraGet.mockResolvedValue({
      issues: [
        { key: 'ALPHA-2', fields: { summary: 'Feature Two' } },
        { key: 'ALPHA-1', fields: { summary: 'Feature One (from direct)' } },
      ],
    });

    const result = await pullPiReviewFeatures(
      createTeam(),
      'PI 26.4',
      { labels: ['Transformers'], assigneeQueryValues: [] },
      [],
      PULL_SETTINGS,
    );

    expect(result.discoveredCount).toBe(2);
    expect(result.addedCount).toBe(2);
    // Sorted by key; Blueprint's summary wins the ALPHA-1 tie.
    expect(result.rows.map((row) => row.feature)).toEqual([
      'ALPHA-1 - Feature One',
      'ALPHA-2 - Feature Two',
    ]);
  });

  it('does not re-add Features already present in the table', async () => {
    mockFetchScopedTeamFeatures.mockResolvedValue([
      { feature: { key: 'ALPHA-1', summary: 'Feature One' }, featureIssue: null },
    ]);
    mockJiraGet.mockResolvedValue({ issues: [{ key: 'ALPHA-2', fields: { summary: 'Feature Two' } }] });

    const result = await pullPiReviewFeatures(
      createTeam(),
      'PI 26.4',
      { labels: [], assigneeQueryValues: ['user-1'] },
      [createRowForFeature('ALPHA-1 - already in the table')],
      PULL_SETTINGS,
    );

    expect(result.discoveredCount).toBe(2);
    expect(result.addedCount).toBe(1);
    expect(result.rows.map((row) => row.feature)).toEqual(['ALPHA-2 - Feature Two']);
  });

  it('still returns results when one source fails (direct query errors, Blueprint succeeds)', async () => {
    mockFetchScopedTeamFeatures.mockResolvedValue([
      { feature: { key: 'ALPHA-1', summary: 'Feature One' }, featureIssue: null },
    ]);
    mockJiraGet.mockRejectedValue(new Error('Jira 500'));

    const result = await pullPiReviewFeatures(
      createTeam(),
      'PI 26.4',
      { labels: ['Transformers'], assigneeQueryValues: [] },
      [],
      PULL_SETTINGS,
    );

    expect(result.addedCount).toBe(1);
    expect(result.rows[0].feature).toBe('ALPHA-1 - Feature One');
  });

  it('throws when both sources fail', async () => {
    mockFetchScopedTeamFeatures.mockRejectedValue(new Error('Blueprint down'));
    mockJiraGet.mockRejectedValue(new Error('Jira 500'));

    await expect(
      pullPiReviewFeatures(createTeam(), 'PI 26.4', { labels: ['Transformers'], assigneeQueryValues: [] }, [], PULL_SETTINGS),
    ).rejects.toThrow();
  });
});
