// fixVersionInheritFix.test.ts — Reading the Feature's release and writing it to the child.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockSaveFixVersion } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockSaveFixVersion: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewFixVersion: mockSaveFixVersion,
}));

import { applyInheritedFixVersion, planInheritedFixVersion, readParentFeatureKey } from './fixVersionInheritFix.ts';
import { resolveHygieneFieldConfig, type JiraIssue } from './checks/hygieneChecks.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();
const FEATURE_FIELD = FIELD_CONFIG.featureLinkFieldIds.filter((fieldId) => fieldId !== 'parent')[0];

function issueWith(fields: Record<string, unknown>): JiraIssue {
  return { key: 'ENCUC-2198', fields: { summary: 'A story', ...fields } } as unknown as JiraIssue;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveFixVersion.mockResolvedValue(undefined);
});

describe('readParentFeatureKey', () => {
  it('reads a Feature link stored as a bare key', () => {
    expect(readParentFeatureKey(issueWith({ [FEATURE_FIELD]: 'ENCUC-100' }), FIELD_CONFIG)).toBe('ENCUC-100');
  });

  it('reads a Feature link stored as an object, which is the other shape Jira returns', () => {
    expect(readParentFeatureKey(issueWith({ [FEATURE_FIELD]: { key: 'ENCUC-100' } }), FIELD_CONFIG)).toBe('ENCUC-100');
  });

  it('falls back to the native parent — the link a sub-task actually uses', () => {
    expect(readParentFeatureKey(issueWith({ parent: { key: 'ENCUC-77' } }), FIELD_CONFIG)).toBe('ENCUC-77');
  });

  it('reports no parent rather than an empty key', () => {
    expect(readParentFeatureKey(issueWith({}), FIELD_CONFIG)).toBeNull();
  });
});

describe('planInheritedFixVersion', () => {
  it('costs no request when the issue has no Feature link', async () => {
    const plan = await planInheritedFixVersion(issueWith({}), FIELD_CONFIG);

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(plan.declinedReason).toBe('the issue has no Feature link to copy a release from');
  });

  it('offers the Feature-s release', async () => {
    mockJiraGet.mockResolvedValue({ fields: { fixVersions: [{ name: '2026.09', releaseDate: '2026-09-30' }] } });

    const plan = await planInheritedFixVersion(issueWith({ [FEATURE_FIELD]: 'ENCUC-100' }), FIELD_CONFIG);

    expect(plan.fixVersionName).toBe('2026.09');
    expect(plan.sourceIssueKey).toBe('ENCUC-100');
  });

  it('treats an unreadable Feature as carrying no release, rather than failing the fix', async () => {
    // A permission error on one Feature is ordinary; the button simply does not appear.
    mockJiraGet.mockRejectedValue(new Error('403'));

    const plan = await planInheritedFixVersion(issueWith({ [FEATURE_FIELD]: 'ENCUC-100' }), FIELD_CONFIG);

    expect(plan.fixVersionName).toBeNull();
  });
});

describe('applyInheritedFixVersion', () => {
  it('writes through the same helper the manual picker uses', async () => {
    mockJiraGet.mockResolvedValue({ fields: { fixVersions: [{ name: '2026.09', releaseDate: '2026-09-30' }] } });

    await applyInheritedFixVersion(issueWith({ [FEATURE_FIELD]: 'ENCUC-100' }), FIELD_CONFIG);

    expect(mockSaveFixVersion).toHaveBeenCalledWith('ENCUC-2198', '2026.09');
  });

  it('throws with the obstacle named rather than reporting success after writing nothing', async () => {
    mockJiraGet.mockResolvedValue({ fields: { fixVersions: [{ name: '2026.09' }] } });

    await expect(applyInheritedFixVersion(issueWith({ [FEATURE_FIELD]: 'ENCUC-100' }), FIELD_CONFIG))
      .rejects.toThrow('fix version has no release date in Jira (2026.09)');
    expect(mockSaveFixVersion).not.toHaveBeenCalled();
  });
});
