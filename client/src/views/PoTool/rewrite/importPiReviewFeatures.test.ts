// importPiReviewFeatures.test.ts — The Bulk Re-write "Import from PI Review" resolver (spec 030, GH #220).
// Proves it reuses PI Review's pull, applies the Product-Owner roster rule, and blocks honestly when it
// cannot be scoped. pullPiReviewFeatures is mocked so no Jira is contacted.

import { describe, expect, it, vi } from 'vitest';

const { mockPull } = vi.hoisted(() => ({ mockPull: vi.fn() }));

vi.mock('../../ArtView/piReviewPullFeatures.ts', () => ({ pullPiReviewFeatures: mockPull }));
// The real key extractor is fine to use, but pin it so the test does not depend on its wider module graph.
vi.mock('../../ArtView/piReviewJira.ts', () => ({
  extractPiReviewFeatureKey: (feature: string) => feature.split(' - ')[0]?.trim() || null,
}));

import { importPiReviewFeatureKeys, readProductOwnerAssigneeValues } from './importPiReviewFeatures.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

function member(over: Partial<StandupRosterMember> = {}): StandupRosterMember {
  return {
    id: 'm', displayName: 'Someone', assigneeQueryValue: 'Someone', ...over,
  } as StandupRosterMember;
}

const productOwner = member({
  displayName: 'Doe, Jane (CTR)', assigneeQueryValue: 'Doe, Jane (CTR)',
  roleCapabilities: { canProductOwner: true } as StandupRosterMember['roleCapabilities'],
});
const developer = member({
  displayName: 'Roe, Rick (CTR)', assigneeQueryValue: 'Roe, Rick (CTR)',
  roleCapabilities: { canProductOwner: false } as StandupRosterMember['roleCapabilities'],
});

describe('readProductOwnerAssigneeValues', () => {
  it('keeps only members flagged as Product Owner, trimmed and non-empty', () => {
    const emptyPo = member({ assigneeQueryValue: '   ', roleCapabilities: { canProductOwner: true } as StandupRosterMember['roleCapabilities'] });
    expect(readProductOwnerAssigneeValues([productOwner, developer, emptyPo])).toEqual(['Doe, Jane (CTR)']);
  });
});

describe('importPiReviewFeatureKeys', () => {
  it('blocks with no-pi when no Program Increment is selected (no Jira call)', async () => {
    const result = await importPiReviewFeatureKeys('   ', [productOwner]);
    expect(result).toEqual({ keys: [], discoveredCount: 0, blockedReason: 'no-pi' });
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('blocks with no-product-owner when the roster has no PO (no Jira call)', async () => {
    const result = await importPiReviewFeatureKeys('PI 2026.3', [developer]);
    expect(result).toEqual({ keys: [], discoveredCount: 0, blockedReason: 'no-product-owner' });
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('delegates to the reused pull and returns the extracted Feature keys', async () => {
    mockPull.mockResolvedValue({
      rows: [{ feature: 'ABC-1 - First feature' }, { feature: 'ABC-2 - Second feature' }],
      discoveredCount: 2,
      addedCount: 2,
    });
    const result = await importPiReviewFeatureKeys('PI 2026.3', [productOwner]);
    expect(mockPull).toHaveBeenCalledWith('PI 2026.3', ['Doe, Jane (CTR)'], []);
    expect(result).toEqual({ keys: ['ABC-1', 'ABC-2'], discoveredCount: 2, blockedReason: null });
  });
});
