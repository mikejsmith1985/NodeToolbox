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

import { fetchFeatureReviewFieldConfig, fetchFeatureReviewItems } from './featureReview.ts';

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
