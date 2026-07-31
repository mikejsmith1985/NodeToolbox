// importPiReviewFeatures.test.ts — The Bulk Re-write "Import from PI Review" resolver (spec 030, GH #220).
// Proves it reads the team's PI Review Confluence page (not a re-query), resolves the right page per PI,
// and blocks honestly when it cannot be scoped. Confluence fetch + table parse are mocked (no network).

import { describe, expect, it, vi } from 'vitest';

const { mockFetchPage, mockParseTable } = vi.hoisted(() => ({
  mockFetchPage: vi.fn(),
  mockParseTable: vi.fn(),
}));

vi.mock('../../../services/confluenceApi.ts', () => ({ fetchConfluencePageByReference: mockFetchPage }));
vi.mock('../../ArtView/piReviewTable.ts', () => ({ parsePiReviewTable: mockParseTable }));
// The real key extractor is fine, but pin it so the test does not depend on its wider module graph.
vi.mock('../../ArtView/piReviewJira.ts', () => ({
  // Mirror the real extractor: a leading Jira key, else null (grouping lines have no key).
  extractPiReviewFeatureKey: (feature: string) => /^([A-Z][A-Z0-9]+-\d+)/.exec(feature.trim())?.[1] ?? null,
}));

import { importPiReviewFeatureKeys, selectPiReviewPageUrl } from './importPiReviewFeatures.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';

function team(piReviewPages: { piName: string; pageUrl: string }[]): ArtTeam {
  return { id: 't1', name: 'Team One', piReviewPages } as ArtTeam;
}

describe('selectPiReviewPageUrl', () => {
  it('prefers the page whose PI matches exactly', () => {
    const artTeam = team([
      { piName: 'PI 2026.2', pageUrl: 'https://c/old' },
      { piName: 'PI 2026.3', pageUrl: 'https://c/current' },
    ]);
    expect(selectPiReviewPageUrl(artTeam, 'PI 2026.3')).toBe('https://c/current');
  });

  it('falls back to a legacy (unnamed) page when no PI matches exactly', () => {
    const artTeam = team([{ piName: '', pageUrl: 'https://c/legacy' }]);
    expect(selectPiReviewPageUrl(artTeam, 'PI 2026.3')).toBe('https://c/legacy');
  });

  it('returns null when the team has no usable PI Review page', () => {
    expect(selectPiReviewPageUrl(team([{ piName: 'PI 2026.3', pageUrl: '   ' }]), 'PI 2026.3')).toBeNull();
  });
});

describe('importPiReviewFeatureKeys', () => {
  it('blocks with no-pi when no Program Increment is selected (no fetch)', async () => {
    const result = await importPiReviewFeatureKeys(team([{ piName: 'PI 2026.3', pageUrl: 'https://c/p' }]), '  ');
    expect(result).toEqual({ keys: [], discoveredCount: 0, blockedReason: 'no-pi' });
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('blocks with no-page when the team has no page for the PI (no fetch)', async () => {
    const result = await importPiReviewFeatureKeys(team([{ piName: 'PI 2026.2', pageUrl: 'https://c/p' }]), 'PI 2026.3');
    expect(result).toEqual({ keys: [], discoveredCount: 0, blockedReason: 'no-page' });
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('reads the page and returns its Feature keys, de-duplicated, across projects', async () => {
    mockFetchPage.mockResolvedValue({ body: { storage: { value: '<table/>' } } });
    // The page mixes two projects plus a grouping line (no key) and a duplicate — all handled.
    mockParseTable.mockReturnValue({
      rows: [
        { feature: 'DENP-1 - Feature one' },
        { feature: 'DASP-7 - Cross-project feature' },
        { feature: 'Committed' }, // grouping line → no key → dropped
        { feature: 'DENP-1 - Feature one (dupe)' },
      ],
    });
    const result = await importPiReviewFeatureKeys(team([{ piName: 'PI 2026.3', pageUrl: 'https://c/p' }]), 'PI 2026.3');
    expect(mockFetchPage).toHaveBeenCalledWith('https://c/p');
    expect(result).toEqual({ keys: ['DENP-1', 'DASP-7'], discoveredCount: 2, blockedReason: null });
  });
});

describe('isCommittedRow', () => {
  const { isCommittedRow } = require('./importPiReviewFeatures.ts');
  const row = (committed: string) => ({ rowId: '1', carryOver: '', priority: '', feature: 'DENP-1 x', pointEstimate: '', dependency: '', risks: '', committed, notes: '', devWork: '', testSupport: '', carryToNext: '', devStart: '', devTest: '', intPvs: '', prodDeploy: '' });

  it('is committed only when the checkbox value is "Yes" (case-insensitive), matching the PI Review tab', () => {
    ['Yes', 'yes', ' YES '].forEach((value) => expect(isCommittedRow(row(value))).toBe(true));
    ['', 'No', 'y', '✓', 'x', 'true', 'Committed'].forEach((value) => expect(isCommittedRow(row(value))).toBe(false));
  });
});

describe('committedFeatureKeys', () => {
  const { committedFeatureKeys } = require('./importPiReviewFeatures.ts');
  const row = (feature: string, committed = '') => ({ rowId: feature, carryOver: '', priority: '', feature, pointEstimate: '', dependency: '', risks: '', committed, notes: '', devWork: '', testSupport: '', carryToNext: '', devStart: '', devTest: '', intPvs: '', prodDeploy: '' });

  it('returns the keys of rows whose Committed checkbox is "Yes" — ignoring the commitment boundary', () => {
    const parsed = {
      rows: [row('DENP-1 a', 'Yes'), row('DENP-2 b', ''), row('DENP-3 c', 'Yes'), row('DENP-4 d', '')],
      commitmentBoundaryIndex: 2, tableBinding: {} as never, customGroupingLines: [],
    };
    expect(committedFeatureKeys(parsed).sort()).toEqual(['DENP-1', 'DENP-3']);
  });

  it('falls back to the whole page when no row is marked committed', () => {
    const parsed = {
      rows: [row('DENP-1 a'), row('DENP-2 b')],
      commitmentBoundaryIndex: null, tableBinding: {} as never, customGroupingLines: [],
    };
    expect(committedFeatureKeys(parsed)).toEqual(['DENP-1', 'DENP-2']);
  });
});
