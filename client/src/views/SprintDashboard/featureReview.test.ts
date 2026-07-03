// featureReview.test.ts — Unit tests for Team Dashboard Feature Review Jira field loading and hygiene evaluation.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';
import type { BlueprintFeatureNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';

const { mockFetchScopedTeamFeatures, mockReadArtFeatureScopeSettings, mockJiraGet } = vi.hoisted(() => ({
  mockFetchScopedTeamFeatures: vi.fn(),
  mockReadArtFeatureScopeSettings: vi.fn(),
  mockJiraGet: vi.fn(),
}));

vi.mock('./scopedTeamFeatures.ts', () => ({
  fetchScopedTeamFeatures: mockFetchScopedTeamFeatures,
}));

vi.mock('../ArtView/artFeatureScopeSettings.ts', () => ({
  readArtFeatureScopeSettings: mockReadArtFeatureScopeSettings,
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import { fetchFeatureReviewFieldConfig, fetchFeatureReviewItems, fetchFeatureReviewItemsByJql } from './featureReview.ts';

function createFeatureNode(): BlueprintFeatureNode {
  return {
    type: 'feature',
    key: 'ART-5000',
    summary: 'Identity hardening',
    status: 'In Progress',
    health: 'yellow',
    completionPercent: 55,
    children: [],
    offTrain: [],
    isExternal: true,
  };
}

function createFeatureIssueWithAssignee(): JiraIssue {
  const issueFields = {
    summary: 'Identity hardening',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: null,
    assignee: {
      accountId: 'account-1',
      displayName: 'Jordan Watkins',
      emailAddress: 'jordan.watkins@example.com',
      avatarUrls: {},
    },
    reporter: null,
    issuetype: { name: 'Feature', iconUrl: '' },
    created: '2026-05-01T00:00:00.000Z',
    updated: '2026-05-02T00:00:00.000Z',
    description: null,
    duedate: null,
    fixVersions: [{ name: '26.3' }],
    parent: null,
    customfield_10301: { value: 'PI 26.3' },
  } as JiraIssue['fields'] & Record<string, unknown>;
  issueFields.customfield_10101 = '2026-05-21';
  issueFields.customfield_10102 = '2026-06-03';

  return {
    id: '1001',
    key: 'ART-5000',
    fields: issueFields,
  };
}

describe('featureReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockReadArtFeatureScopeSettings.mockReturnValue({
      piFieldId: 'customfield_10301',
      featureProjectKeys: [],
    });
  });

  it('requests assignee when loading feature issues for Feature Review', async () => {
    const fieldConfig = {
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    };
    mockFetchScopedTeamFeatures.mockResolvedValue([]);

    await fetchFeatureReviewItems({
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    } as ArtTeam, 'PI 26.3', fieldConfig);

    expect(mockFetchScopedTeamFeatures).toHaveBeenCalledWith(
      expect.anything(),
      'PI 26.3',
      expect.objectContaining({
        requestedFieldIds: expect.arrayContaining(['assignee']),
      }),
    );
  });

  it('does not flag no-assignee when the loaded feature issue already has an assignee', async () => {
    const fieldConfig = {
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    };
    mockFetchScopedTeamFeatures.mockResolvedValue([
      {
        feature: createFeatureNode(),
        featureIssue: createFeatureIssueWithAssignee(),
      },
    ]);

    const featureReviewItems = await fetchFeatureReviewItems({
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    } as ArtTeam, 'PI 26.3', fieldConfig);

    expect(featureReviewItems).toHaveLength(1);
    expect(featureReviewItems[0].hygieneFlags.some((hygieneFlag) => hygieneFlag.checkId === 'no-assignee')).toBe(false);
  });

  it('does not flag missing AC when the loaded feature issue has descriptive acceptance criteria text', async () => {
    const fieldConfig = {
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    };
    const featureIssue = createFeatureIssueWithAssignee();
    (featureIssue.fields as Record<string, unknown>).customfield_10200 =
      'Demonstrate the ability to correctly determine whether the member identifier exists and distinguish a new enrollment from an update.';
    mockFetchScopedTeamFeatures.mockResolvedValue([
      {
        feature: createFeatureNode(),
        featureIssue,
      },
    ]);

    const featureReviewItems = await fetchFeatureReviewItems({
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    } as ArtTeam, 'PI 26.3', fieldConfig);

    expect(featureReviewItems).toHaveLength(1);
    expect(featureReviewItems[0].hygieneFlags.some((hygieneFlag) => hygieneFlag.checkId === 'no-ac')).toBe(false);
  });

  it('requests custom enterprise-rule fields and applies the custom feature flag', async () => {
    window.localStorage.setItem('tbxEnterpriseStandards', JSON.stringify([
      {
        id: 'custom-1',
        name: 'Missing Business Owner',
        description: 'Business Owner is required.',
        isBuiltIn: false,
        isEnabled: true,
        severity: 'error',
        ruleType: 'required-field',
        fieldId: 'customfield_12345',
        fieldLabel: 'Business Owner',
        issueTypeNames: ['Feature'],
      },
    ]));
    const fieldConfig = {
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    };
    const featureIssue = createFeatureIssueWithAssignee();
    (featureIssue.fields as Record<string, unknown>).customfield_12345 = null;
    mockFetchScopedTeamFeatures.mockResolvedValue([
      {
        feature: createFeatureNode(),
        featureIssue,
      },
    ]);

    const featureReviewItems = await fetchFeatureReviewItems({
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    } as ArtTeam, 'PI 26.3', fieldConfig);

    expect(mockFetchScopedTeamFeatures).toHaveBeenCalledWith(
      expect.anything(),
      'PI 26.3',
      expect.objectContaining({
        requestedFieldIds: expect.arrayContaining(['customfield_12345']),
      }),
    );
    expect(featureReviewItems[0].hygieneFlags.map((hygieneFlag) => hygieneFlag.checkId)).toContain('custom-1');
  });

  it('builds field config from Jira field metadata', async () => {
    mockJiraGet.mockResolvedValue([
      { id: 'customfield_10101', name: 'Target Start' },
      { id: 'customfield_10102', name: 'Target End' },
      { id: 'customfield_10301', name: 'Program Increment' },
    ]);

    await expect(fetchFeatureReviewFieldConfig()).resolves.toEqual(
      expect.objectContaining({
        targetStartFieldIds: ['customfield_10101'],
        targetEndFieldIds: ['customfield_10102'],
        programIncrementFieldIds: ['customfield_10301'],
      }),
    );
  });
});

describe('fetchFeatureReviewItemsByJql', () => {
  const EMPTY_FIELD_CONFIG = {
    acceptanceCriteriaFieldIds: [],
    applicationFieldIds: [],
    featureLinkFieldIds: [],
    initiativeTypeFieldIds: [],
    parentLinkFieldIds: [],
    productOwnerFieldIds: [],
    programIncrementFieldIds: [],
    targetEndFieldIds: [],
    targetStartFieldIds: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem('tbxARTSettings', JSON.stringify({ featureLinkField: 'customfield_10108', piFieldId: 'customfield_10301' }));
  });

  it('surfaces features matching an arbitrary JQL with health/completion and hygiene flags', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('project = TEST')) {
        // The user's query returns the feature issues (with hygiene fields).
        return Promise.resolve({ issues: [{ key: 'F-1', fields: { summary: 'Feature One', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } }] });
      }
      if (decoded.includes('key in (')) {
        return Promise.resolve({ issues: [{ key: 'F-1', fields: { summary: 'Feature One', status: { name: 'In Progress' } } }] });
      }
      // Child discovery.
      return Promise.resolve({
        issues: [
          { key: 'S-1', fields: { summary: 'S1', status: { name: 'Done', statusCategory: { key: 'done' } }, parent: { key: 'F-1' }, customfield_10016: 3 } },
          { key: 'S-2', fields: { summary: 'S2', status: { name: 'To Do', statusCategory: { key: 'new' } }, parent: { key: 'F-1' }, customfield_10016: 2 } },
        ],
      });
    });

    const items = await fetchFeatureReviewItemsByJql('project = TEST', EMPTY_FIELD_CONFIG);

    expect(items).toHaveLength(1);
    expect(items[0].feature.key).toBe('F-1');
    expect(items[0].feature.health).toBe('yellow');
    expect(items[0].totalChildCount).toBe(2);
    expect(items[0].doneChildCount).toBe(1);
    expect(Array.isArray(items[0].hygieneFlags)).toBe(true);
  });

  it('returns an empty list when the query matches nothing', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    expect(await fetchFeatureReviewItemsByJql('project = EMPTY', EMPTY_FIELD_CONFIG)).toEqual([]);
  });

  it('rejects when the query is invalid so the caller can surface the error', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira GET failed: 400 (jql error)'));
    await expect(fetchFeatureReviewItemsByJql('bad jql', EMPTY_FIELD_CONFIG)).rejects.toThrow(/jql error/);
  });
});
