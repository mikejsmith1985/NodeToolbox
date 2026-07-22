// productOwnerFeatureReview.test.ts — Unit tests for union feature discovery (blueprint + PO-assigned).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import type { FeatureReviewItem } from './featureReview.ts';

const { mockFetchFeatureReviewItems, mockFetchFeatureReviewItemsByJql, mockReadPiReviewPullSettings } = vi.hoisted(() => ({
  mockFetchFeatureReviewItems: vi.fn(),
  mockFetchFeatureReviewItemsByJql: vi.fn(),
  mockReadPiReviewPullSettings: vi.fn(),
}));

vi.mock('./featureReview.ts', () => ({
  fetchFeatureReviewItems: mockFetchFeatureReviewItems,
  fetchFeatureReviewItemsByJql: mockFetchFeatureReviewItemsByJql,
}));

// The PI field id is read from ART settings in the real module; the JQL builder itself is NOT mocked,
// so these tests assert against the genuine PI Review query text.
vi.mock('../ArtView/piReviewPullFeatures.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ArtView/piReviewPullFeatures.ts')>()),
  readPiReviewPullSettings: mockReadPiReviewPullSettings,
}));

import {
  fetchFeatureReviewItemsWithProductOwnerFeatures,
  mergeFeatureReviewItemsByKey,
} from './productOwnerFeatureReview.ts';

/** Minimal Feature Review item — only the fields the union logic actually reads. */
function createReviewItem(featureKey: string, summary = `Summary for ${featureKey}`): FeatureReviewItem {
  return {
    feature: {
      type: 'feature',
      key: featureKey,
      summary,
      status: 'New',
      health: 'gray',
      completionPercent: 0,
      children: [],
      offTrain: [],
      isExternal: false,
    },
    featureIssue: { key: featureKey, fields: { summary } } as unknown as JiraIssue,
    hygieneFlags: [],
    blockedChildCount: 0,
    doneChildCount: 0,
    inFlightChildCount: 0,
    totalChildCount: 0,
  };
}

const TEAM: ArtTeam = {
  id: 'team-1',
  name: 'Transformers',
  projectKey: 'TRAN',
  boardId: '77',
  sprintIssues: [],
  isLoading: false,
  loadError: null,
} as unknown as ArtTeam;

beforeEach(() => {
  vi.clearAllMocks();
  mockReadPiReviewPullSettings.mockReturnValue({ piFieldId: 'customfield_10301' });
  mockFetchFeatureReviewItems.mockResolvedValue([]);
  mockFetchFeatureReviewItemsByJql.mockResolvedValue([]);
});

describe('mergeFeatureReviewItemsByKey', () => {
  it('keeps every distinct feature, sorted by key', () => {
    const merged = mergeFeatureReviewItemsByKey([createReviewItem('TRAN-2')], [createReviewItem('TRAN-1')]);

    expect(merged.map((item) => item.feature.key)).toEqual(['TRAN-1', 'TRAN-2']);
  });

  it('prefers the blueprint item when both sources return the same feature', () => {
    const blueprintItem = createReviewItem('TRAN-1', 'From blueprint');
    const productOwnerItem = createReviewItem('tran-1', 'From PO query');

    const merged = mergeFeatureReviewItemsByKey([blueprintItem], [productOwnerItem]);

    expect(merged).toHaveLength(1);
    expect(merged[0].feature.summary).toBe('From blueprint');
  });
});

describe('fetchFeatureReviewItemsWithProductOwnerFeatures', () => {
  it('returns PO-assigned features when the PI is brand new and has no child stories', async () => {
    mockFetchFeatureReviewItems.mockResolvedValue([]);
    mockFetchFeatureReviewItemsByJql.mockResolvedValue([createReviewItem('TRAN-9')]);

    const discovery = await fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', ['Smith, Jane (CTR)']);

    expect(discovery.items.map((item) => item.feature.key)).toEqual(['TRAN-9']);
    expect(discovery.productOwnerOnlyCount).toBe(1);
    expect(discovery.productOwnerQueryWarning).toBeNull();
  });

  it('queries Jira with the same JQL the PI Review pull uses', async () => {
    await fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', ['Smith, Jane (CTR)', 'Doe, John (CTR)']);

    expect(mockFetchFeatureReviewItemsByJql).toHaveBeenCalledWith(
      'issuetype = Feature AND assignee in ("Smith, Jane (CTR)", "Doe, John (CTR)") AND cf[10301] = "PI 26.4"',
      undefined,
      '',
    );
  });

  it('unions both sources without duplicating a feature they both return', async () => {
    mockFetchFeatureReviewItems.mockResolvedValue([createReviewItem('TRAN-1'), createReviewItem('TRAN-2')]);
    mockFetchFeatureReviewItemsByJql.mockResolvedValue([createReviewItem('TRAN-2'), createReviewItem('TRAN-3')]);

    const discovery = await fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', ['Smith, Jane (CTR)']);

    expect(discovery.items.map((item) => item.feature.key)).toEqual(['TRAN-1', 'TRAN-2', 'TRAN-3']);
    expect(discovery.productOwnerOnlyCount).toBe(1);
  });

  it('skips the PO query and explains why when no Product Owner is flagged in the roster', async () => {
    mockFetchFeatureReviewItems.mockResolvedValue([createReviewItem('TRAN-1')]);

    const discovery = await fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', []);

    expect(mockFetchFeatureReviewItemsByJql).not.toHaveBeenCalled();
    expect(discovery.items.map((item) => item.feature.key)).toEqual(['TRAN-1']);
    expect(discovery.productOwnerQueryWarning).toContain('Product Owner');
  });

  it('still shows blueprint features when the PO query fails, and warns instead of erroring', async () => {
    mockFetchFeatureReviewItems.mockResolvedValue([createReviewItem('TRAN-1')]);
    mockFetchFeatureReviewItemsByJql.mockRejectedValue(new Error('Field assignee does not exist'));

    const discovery = await fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', ['Smith, Jane (CTR)']);

    expect(discovery.items.map((item) => item.feature.key)).toEqual(['TRAN-1']);
    expect(discovery.productOwnerQueryWarning).toContain('Field assignee does not exist');
  });

  it('propagates a blueprint failure so the tab can surface a real load error', async () => {
    mockFetchFeatureReviewItems.mockRejectedValue(new Error('Jira unreachable'));

    await expect(
      fetchFeatureReviewItemsWithProductOwnerFeatures(TEAM, 'PI 26.4', ['Smith, Jane (CTR)']),
    ).rejects.toThrow('Jira unreachable');
  });
});
