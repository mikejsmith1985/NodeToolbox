// featureLinkInheritFix.test.ts — Fetching the siblings' Feature links and writing the inherited one.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockSaveIssueLinkField } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockSaveIssueLinkField: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewIssueLinkField: mockSaveIssueLinkField,
}));

import { planInheritedFeatureLink, applyInheritedFeatureLink } from './featureLinkInheritFix.ts';
import type { JiraIssue } from './checks/hygieneChecks.ts';

const FEATURE_LINK_FIELD_ID = 'customfield_10108';

function slStory(linkedKeys: string[]): JiraIssue {
  return {
    key: 'ENFCT-2042',
    fields: {
      summary: '[SL] SL Test',
      issuelinks: linkedKeys.map((linkedKey) => ({ type: { name: 'Relates' }, outwardIssue: { key: linkedKey } })),
    },
  } as unknown as JiraIssue;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveIssueLinkField.mockResolvedValue(undefined);
});

describe('planInheritedFeatureLink', () => {
  it('reads the Feature link off the linked story and proposes it', async () => {
    mockJiraGet.mockResolvedValue({ fields: { [FEATURE_LINK_FIELD_ID]: 'ENFCT-1900' } });

    const plan = await planInheritedFeatureLink(slStory(['ENFCT-2041']), FEATURE_LINK_FIELD_ID);

    expect(plan.featureLinkValue).toBe('ENFCT-1900');
    expect(plan.sourceIssueKey).toBe('ENFCT-2041');
  });

  it('reads a Feature link Jira returns as an object rather than a bare key', async () => {
    mockJiraGet.mockResolvedValue({ fields: { [FEATURE_LINK_FIELD_ID]: { key: 'ENFCT-1900' } } });

    const plan = await planInheritedFeatureLink(slStory(['ENFCT-2041']), FEATURE_LINK_FIELD_ID);

    expect(plan.featureLinkValue).toBe('ENFCT-1900');
  });

  it('makes no request at all when the issue has no same-project link', async () => {
    const plan = await planInheritedFeatureLink(slStory([]), FEATURE_LINK_FIELD_ID);

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(plan.featureLinkValue).toBeNull();
    expect(plan.declinedReason).toMatch(/no linked issue/i);
  });

  it('treats a sibling that cannot be read as carrying nothing, not as a failure', async () => {
    // One unreadable sibling must not cost the fix; a permission error on a linked issue is common.
    mockJiraGet
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce({ fields: { [FEATURE_LINK_FIELD_ID]: 'ENFCT-1900' } });

    const plan = await planInheritedFeatureLink(slStory(['ENFCT-2040', 'ENFCT-2041']), FEATURE_LINK_FIELD_ID);

    expect(plan.featureLinkValue).toBe('ENFCT-1900');
  });
});

describe('applyInheritedFeatureLink', () => {
  it('writes the inherited value through the existing Feature-link writer', async () => {
    mockJiraGet.mockResolvedValue({ fields: { [FEATURE_LINK_FIELD_ID]: 'ENFCT-1900' } });

    const written = await applyInheritedFeatureLink(slStory(['ENFCT-2041']), FEATURE_LINK_FIELD_ID);

    expect(mockSaveIssueLinkField).toHaveBeenCalledWith('ENFCT-2042', FEATURE_LINK_FIELD_ID, 'ENFCT-1900');
    expect(written.featureLinkValue).toBe('ENFCT-1900');
  });

  it('writes NOTHING when the siblings disagree', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ fields: { [FEATURE_LINK_FIELD_ID]: 'ENFCT-1900' } })
      .mockResolvedValueOnce({ fields: { [FEATURE_LINK_FIELD_ID]: 'ENFCT-1877' } });

    await expect(applyInheritedFeatureLink(slStory(['ENFCT-2040', 'ENFCT-2041']), FEATURE_LINK_FIELD_ID))
      .rejects.toThrow(/disagree/i);
    expect(mockSaveIssueLinkField).not.toHaveBeenCalled();
  });
});
