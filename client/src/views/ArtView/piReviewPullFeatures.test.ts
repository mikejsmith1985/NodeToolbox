// piReviewPullFeatures.test.ts — Unit tests for pulling Program Increment Features into PI Review rows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
  jiraPut: vi.fn(),
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

const PULL_SETTINGS = { piFieldId: DEFAULT_PI_FIELD_ID };

describe('buildDirectFeatureJql', () => {
  it('combines project, issuetype=Feature, PI, and a single-PO assignee equality', () => {
    const jql = buildDirectFeatureJql(createTeam(), 'PI 26.4', ['C73130'], DEFAULT_PI_FIELD_ID);
    expect(jql).toBe(
      'project = "ALPHA" AND issuetype = Feature AND cf[10301] = "PI 26.4" AND assignee = "C73130"',
    );
  });

  it('uses an assignee IN clause when the roster has more than one Product Owner', () => {
    const jql = buildDirectFeatureJql(createTeam(), 'PI 26.4', ['C73130', 'C99999'], DEFAULT_PI_FIELD_ID);
    expect(jql).toBe(
      'project = "ALPHA" AND issuetype = Feature AND cf[10301] = "PI 26.4" '
      + 'AND assignee in ("C73130", "C99999")',
    );
  });

  it('returns null without a project key (cannot scope a direct Feature query)', () => {
    expect(buildDirectFeatureJql(createTeam({ projectKey: '' }), 'PI 26.4', ['C73130'], DEFAULT_PI_FIELD_ID)).toBeNull();
  });

  it('returns null without a PI (the page PI is required to scope the pull)', () => {
    expect(buildDirectFeatureJql(createTeam(), '', ['C73130'], DEFAULT_PI_FIELD_ID)).toBeNull();
  });

  it('returns null without a Product Owner (would pull every Feature in the PI)', () => {
    expect(buildDirectFeatureJql(createTeam(), 'PI 26.4', [], DEFAULT_PI_FIELD_ID)).toBeNull();
  });
});

describe('pullPiReviewFeatures', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds "KEY - summary" rows from the direct Feature query, sorted by key', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        { key: 'ALPHA-2', fields: { summary: 'Feature Two' } },
        { key: 'ALPHA-1', fields: { summary: 'Feature One' } },
      ],
    });

    const result = await pullPiReviewFeatures(createTeam(), 'PI 26.4', ['C73130'], [], PULL_SETTINGS);

    expect(result.discoveredCount).toBe(2);
    expect(result.addedCount).toBe(2);
    expect(result.rows.map((row) => row.feature)).toEqual([
      'ALPHA-1 - Feature One',
      'ALPHA-2 - Feature Two',
    ]);
  });

  it('does not re-add Features already present in the table', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        { key: 'ALPHA-1', fields: { summary: 'Feature One' } },
        { key: 'ALPHA-2', fields: { summary: 'Feature Two' } },
      ],
    });

    const result = await pullPiReviewFeatures(
      createTeam(),
      'PI 26.4',
      ['C73130'],
      [createRowForFeature('ALPHA-1 - already in the table')],
      PULL_SETTINGS,
    );

    expect(result.discoveredCount).toBe(2);
    expect(result.addedCount).toBe(1);
    expect(result.rows.map((row) => row.feature)).toEqual(['ALPHA-2 - Feature Two']);
  });

  it('returns an empty result without ever calling Jira when no Product Owner is supplied', async () => {
    const result = await pullPiReviewFeatures(createTeam(), 'PI 26.4', [], [], PULL_SETTINGS);

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(result.discoveredCount).toBe(0);
    expect(result.addedCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('throws when the direct Feature query fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira 500'));

    await expect(
      pullPiReviewFeatures(createTeam(), 'PI 26.4', ['C73130'], [], PULL_SETTINGS),
    ).rejects.toThrow('Jira 500');
  });
});
