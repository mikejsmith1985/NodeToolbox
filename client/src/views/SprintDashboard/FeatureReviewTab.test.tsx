// FeatureReviewTab.test.tsx — Render tests for the Team Dashboard Feature Review workspace.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

const {
  mockFetchFeatureReviewEditMeta,
  mockFetchFeatureReviewFieldConfig,
  mockFetchFeatureReviewFixVersions,
  mockFetchFeatureReviewTransitions,
  mockFetchFeatureReviewItems,
  mockSaveFeatureReviewFixVersion,
  mockSaveFeatureReviewIssueLinkField,
  mockSaveFeatureReviewOptionField,
  mockSaveFeatureReviewSimpleField,
  mockSaveFeatureReviewTransition,
  mockSaveFeatureReviewStoryPoints,
  mockSaveFeatureReviewUserField,
  mockSearchFeatureReviewUsers,
  mockShowToast,
} = vi.hoisted(() => ({
  mockFetchFeatureReviewEditMeta: vi.fn(),
  mockFetchFeatureReviewFieldConfig: vi.fn(),
  mockFetchFeatureReviewFixVersions: vi.fn(),
  mockFetchFeatureReviewTransitions: vi.fn(),
  mockFetchFeatureReviewItems: vi.fn(),
  mockSaveFeatureReviewFixVersion: vi.fn(),
  mockSaveFeatureReviewIssueLinkField: vi.fn(),
  mockSaveFeatureReviewOptionField: vi.fn(),
  mockSaveFeatureReviewSimpleField: vi.fn(),
  mockSaveFeatureReviewTransition: vi.fn(),
  mockSaveFeatureReviewStoryPoints: vi.fn(),
  mockSaveFeatureReviewUserField: vi.fn(),
  mockSearchFeatureReviewUsers: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('./featureReview.ts', () => ({
  fetchFeatureReviewFieldConfig: mockFetchFeatureReviewFieldConfig,
  fetchFeatureReviewItems: mockFetchFeatureReviewItems,
}));

vi.mock('./featureReviewFixes.ts', () => ({
  fetchFeatureReviewEditMeta: mockFetchFeatureReviewEditMeta,
  fetchFeatureReviewFixVersions: mockFetchFeatureReviewFixVersions,
  fetchFeatureReviewTransitions: mockFetchFeatureReviewTransitions,
  readFeatureReviewFieldValue: (issue: JiraIssue, fieldId: string) => {
    const fieldValue = (issue.fields as Record<string, unknown>)[fieldId];
    if (typeof fieldValue === 'string') {
      return fieldValue;
    }

    if (fieldValue && typeof fieldValue === 'object' && 'value' in fieldValue && typeof fieldValue.value === 'string') {
      return fieldValue.value;
    }

    return '';
  },
  readFeatureReviewSelectOptions: () => [],
  readProjectKeyFromIssueKey: (issueKey: string) => issueKey.split('-', 1)[0] ?? '',
  saveFeatureReviewFixVersion: mockSaveFeatureReviewFixVersion,
  saveFeatureReviewIssueLinkField: mockSaveFeatureReviewIssueLinkField,
  saveFeatureReviewOptionField: mockSaveFeatureReviewOptionField,
  saveFeatureReviewSimpleField: mockSaveFeatureReviewSimpleField,
  saveFeatureReviewTransition: mockSaveFeatureReviewTransition,
  saveFeatureReviewStoryPoints: mockSaveFeatureReviewStoryPoints,
  saveFeatureReviewUserField: mockSaveFeatureReviewUserField,
  searchFeatureReviewUsers: mockSearchFeatureReviewUsers,
}));

import FeatureReviewTab from './FeatureReviewTab.tsx';

function createFeatureIssue(): JiraIssue {
  const issueFields = {
    summary: 'Identity hardening',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: null,
    assignee: null,
    reporter: null,
    issuetype: { name: 'Feature', iconUrl: '' },
    created: '2026-05-01T00:00:00.000Z',
    updated: '2026-05-02T00:00:00.000Z',
    description: null,
    duedate: null,
    fixVersions: [],
    parent: null,
    customfield_10301: { value: 'PI 26.3' },
    customfield_10200: '',
  } as JiraIssue['fields'] & Record<string, unknown>;
  issueFields.customfield_10101 = '';
  issueFields.customfield_10102 = '';

  return {
    id: '1001',
    key: 'ART-5000',
    fields: issueFields,
  };
}

function createFeatureReviewItem(overrides: {
  hygieneFlags?: Array<{ checkId: string; label: string; severity: 'warn' | 'error' }>;
} = {}) {
  return {
    feature: {
      type: 'feature',
      key: 'ART-5000',
      summary: 'Identity hardening',
      status: 'In Progress',
      health: 'yellow',
      completionPercent: 55,
      children: [
        {
          type: 'story',
          key: 'TBX-101',
          summary: 'Wire API changes',
          status: 'In Progress',
          issueType: 'Story',
          assignee: null,
          assigneeAvatar: null,
          storyPoints: null,
          teamName: 'Alpha Team',
          isOffTrain: false,
          offTrainReasons: [],
          subtasks: [],
        },
      ],
      offTrain: [],
      isExternal: true,
    },
    featureIssue: createFeatureIssue(),
    hygieneFlags: overrides.hygieneFlags ?? [
      { checkId: 'missing-summary', label: 'Missing Feature Name / Summary', severity: 'error' },
      { checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' },
    ],
    blockedChildCount: 0,
    doneChildCount: 0,
    inFlightChildCount: 1,
    totalChildCount: 1,
  };
}

describe('FeatureReviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchFeatureReviewFieldConfig.mockResolvedValue({
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: ['customfield_12345'],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: ['customfield_12346'],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: ['customfield_12347'],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    });
    mockFetchFeatureReviewItems.mockResolvedValue([createFeatureReviewItem()]);
    mockFetchFeatureReviewEditMeta.mockResolvedValue({});
    mockFetchFeatureReviewFixVersions.mockResolvedValue([{ label: '26.3', value: '26.3' }]);
    mockFetchFeatureReviewTransitions.mockResolvedValue([
      { id: '31', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { name: 'In Progress' } } },
      { id: '41', name: 'Done', to: { name: 'Done', statusCategory: { name: 'Done' } } },
    ]);
    mockSaveFeatureReviewSimpleField.mockResolvedValue(undefined);
    mockSaveFeatureReviewStoryPoints.mockResolvedValue(undefined);
    mockSaveFeatureReviewOptionField.mockResolvedValue(undefined);
    mockSaveFeatureReviewIssueLinkField.mockResolvedValue(undefined);
    mockSaveFeatureReviewFixVersion.mockResolvedValue(undefined);
    mockSaveFeatureReviewTransition.mockResolvedValue(undefined);
    mockSaveFeatureReviewUserField.mockResolvedValue(undefined);
    mockSearchFeatureReviewUsers.mockResolvedValue([]);
  });

  it('renders feature rollup cards, Jira links, and direct fix controls for the matched ART team', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    expect(screen.getByText('Feature Review')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'ART-5000' })).toHaveAttribute(
      'href',
      'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/ART-5000',
    );
    expect(screen.getByText('Missing Feature Name / Summary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show fixes/i }));
    expect(await screen.findByText('Direct hygiene fixes')).toBeInTheDocument();
    expect(screen.getByText('Point child stories')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'TBX-101' })).toHaveLength(2);
  });

  it('saves a summary fix directly from the feature review card and reloads the data', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /show fixes/i }));
    fireEvent.change(screen.getByDisplayValue('Identity hardening'), {
      target: { value: 'Identity hardening updated' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    await waitFor(() => {
      expect(mockSaveFeatureReviewSimpleField).toHaveBeenCalledWith(
        'ART-5000',
        'summary',
        'Identity hardening updated',
      );
    });
    expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    expect(mockShowToast).toHaveBeenCalledWith('ART-5000 updated.', 'success');
  });

  it('saves missing child story points directly from the feature review card', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /show fixes/i }));
    fireEvent.change(screen.getByPlaceholderText(/story points/i), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i }).at(-1)!);

    await waitFor(() => {
      expect(mockSaveFeatureReviewStoryPoints).toHaveBeenCalledWith('TBX-101', '5');
    });
  });

  it('shows and saves direct Jira status transitions from the feature review card', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /show fixes/i }));
    expect(await screen.findByText('Change Status')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Change Status'), {
      target: { value: '41' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save status/i }));

    await waitFor(() => {
      expect(mockSaveFeatureReviewTransition).toHaveBeenCalledWith('ART-5000', '41');
    });
    expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    expect(mockShowToast).toHaveBeenCalledWith('ART-5000 status updated.', 'success');
  });

  it('reloads transition options after a status change when the fix panel is reopened', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    const updatedFeatureReviewItem = createFeatureReviewItem();
    updatedFeatureReviewItem.feature.status = 'Done';
    updatedFeatureReviewItem.featureIssue.fields.status = {
      name: 'Done',
      statusCategory: { key: 'done' },
    } as JiraIssue['fields']['status'];

    mockFetchFeatureReviewItems
      .mockResolvedValueOnce([createFeatureReviewItem()])
      .mockResolvedValueOnce([updatedFeatureReviewItem]);

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /show fixes/i }));
    expect(await screen.findByText('Change Status')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Change Status'), {
      target: { value: '41' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save status/i }));

    await waitFor(() => {
      expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(await screen.findByRole('button', { name: /show fixes/i }));

    await waitFor(() => {
      expect(mockFetchFeatureReviewTransitions).toHaveBeenCalledTimes(2);
    });
  });

  it('shows ART setup guidance when the current board does not map to a saved ART team', () => {
    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    expect(screen.getByText(/can only build feature review after this board is matched to an art team/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open art settings/i })).toHaveAttribute('href', '/art');
  });

  it('surfaces load errors from the shared feature review loader', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    mockFetchFeatureReviewFieldConfig.mockRejectedValue(new Error('Feature review failed.'));

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Feature review failed.')).toBeInTheDocument();
    });
    expect(mockShowToast).toHaveBeenCalledWith('Feature review failed.', 'error');
  });
});
