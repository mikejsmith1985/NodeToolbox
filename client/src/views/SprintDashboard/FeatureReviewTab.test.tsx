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
  mockFetchFeatureReviewItemsWithProductOwnerFeatures,
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
  mockFetchFeatureReviewItemsWithProductOwnerFeatures: vi.fn(),
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

vi.mock('./productOwnerFeatureReview.ts', () => ({
  fetchFeatureReviewItemsWithProductOwnerFeatures: mockFetchFeatureReviewItemsWithProductOwnerFeatures,
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

import { useSettingsStore } from '../../store/settingsStore.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
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
    fireEvent.click(screen.getByRole('button', { name: /save all fixes/i }));

    await waitFor(() => {
      expect(mockSaveFeatureReviewSimpleField).toHaveBeenCalledWith(
        'ART-5000',
        'summary',
        'Identity hardening updated',
      );
    });
    expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    expect(mockShowToast).toHaveBeenCalledWith('ART-5000 — 1 fix saved.', 'success');
  });

  it('saves missing child story points through the single Save all fixes button', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    // Only the story-points flag, so the batch contains exactly the points fix we fill in.
    mockFetchFeatureReviewItems.mockResolvedValue([
      createFeatureReviewItem({
        hygieneFlags: [{ checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' }],
      }),
    ]);

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
    fireEvent.click(screen.getByRole('button', { name: /save all fixes/i }));

    await waitFor(() => {
      expect(mockSaveFeatureReviewStoryPoints).toHaveBeenCalledWith('TBX-101', '5');
    });
  });

  it('saves several different fixes with one button and refreshes the data only once', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    mockFetchFeatureReviewItems.mockResolvedValue([
      createFeatureReviewItem({
        hygieneFlags: [
          { checkId: 'missing-summary', label: 'Missing Feature Name / Summary', severity: 'error' },
          { checkId: 'missing-due-date', label: 'Missing Due Date', severity: 'warn' },
          { checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' },
        ],
      }),
    ]);

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
      target: { value: 'Identity hardening v2' },
    });
    fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByPlaceholderText(/story points/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /save all fixes/i }));

    await waitFor(() => {
      expect(mockSaveFeatureReviewSimpleField).toHaveBeenCalledWith('ART-5000', 'summary', 'Identity hardening v2');
    });
    expect(mockSaveFeatureReviewSimpleField).toHaveBeenCalledWith('ART-5000', 'duedate', '2026-07-01');
    expect(mockSaveFeatureReviewStoryPoints).toHaveBeenCalledWith('TBX-101', '8');
    // One batch → exactly one reload (initial load + single post-save refresh).
    expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    expect(mockShowToast).toHaveBeenCalledWith('ART-5000 — 3 fixes saved.', 'success');
  });

  it('shows and saves a direct Jira status transition through the single Save all fixes button', async () => {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    // Story-points-only flag keeps the panel open with no other pending fix, so the batch is just the transition.
    mockFetchFeatureReviewItems.mockResolvedValue([
      createFeatureReviewItem({
        hygieneFlags: [{ checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' }],
      }),
    ]);

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
    fireEvent.click(screen.getByRole('button', { name: /save all fixes/i }));

    await waitFor(() => {
      expect(mockSaveFeatureReviewTransition).toHaveBeenCalledWith('ART-5000', '41');
    });
    expect(mockFetchFeatureReviewItems).toHaveBeenCalledTimes(2);
    expect(mockShowToast).toHaveBeenCalledWith('ART-5000 — 1 fix saved.', 'success');
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
    const transitionOnlyFlags = [{ checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' as const }];
    const updatedFeatureReviewItem = createFeatureReviewItem({ hygieneFlags: transitionOnlyFlags });
    updatedFeatureReviewItem.feature.status = 'Done';
    updatedFeatureReviewItem.featureIssue.fields.status = {
      name: 'Done',
      statusCategory: { key: 'done' },
    } as JiraIssue['fields']['status'];

    mockFetchFeatureReviewItems
      .mockResolvedValueOnce([createFeatureReviewItem({ hygieneFlags: transitionOnlyFlags })])
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
    fireEvent.click(screen.getByRole('button', { name: /save all fixes/i }));

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

// ── Team-profile scoping (feature 017: PO Tool reuse seam) ──
//
// The PO Tool mounts THIS component with its own team selection, so the tab must be able to take the
// team profile as an input instead of always reading the app-wide active team. Omitting the prop must
// behave exactly as it did before, which is what keeps the Team Dashboard from regressing.
// See specs/017-po-feature-tools/contracts/tab-reuse.md (INV-T2).

describe('FeatureReviewTab — dashboardTeamProfileId scoping', () => {
  const ALPHA_POINTS_FIELD_ID = 'customfield_ALPHA';
  const BETA_POINTS_FIELD_ID = 'customfield_BETA';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchFeatureReviewFieldConfig.mockResolvedValue({
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: ['customfield_10108'],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    });
    mockFetchFeatureReviewItems.mockResolvedValue([createFeatureReviewItem()]);
    mockFetchFeatureReviewEditMeta.mockResolvedValue({});
    mockFetchFeatureReviewFixVersions.mockResolvedValue([]);
    mockFetchFeatureReviewTransitions.mockResolvedValue([]);
  });

  function seedTeamScopedConfigs(): void {
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    // Two teams' configs, each with a distinct story-points field, so we can see which one was read.
    localStorage.setItem(
      'tbxSprintDashboardConfig:profile-alpha',
      JSON.stringify({ customStoryPointsFieldId: ALPHA_POINTS_FIELD_ID }),
    );
    localStorage.setItem(
      'tbxSprintDashboardConfig:profile-beta',
      JSON.stringify({ customStoryPointsFieldId: BETA_POINTS_FIELD_ID }),
    );
    useSettingsStore.setState({
      sprintDashboardActiveTeamProfileId: 'profile-alpha',
      sprintDashboardTeamProfiles: [
        {
          id: 'profile-alpha', name: 'Alpha Team', projectKey: 'TBX', boardId: '42',
          boardName: 'Alpha Board', boardType: 'scrum', scopeMode: 'pi', selectedSprintId: '',
          selectedFixVersion: '', selectedPiValue: 'PI 26.3', piReviewPages: [],
        },
        {
          id: 'profile-beta', name: 'Beta Team', projectKey: 'TBX', boardId: '42',
          boardName: 'Beta Board', boardType: 'scrum', scopeMode: 'pi', selectedSprintId: '',
          selectedFixVersion: '', selectedPiValue: 'PI 26.4', piReviewPages: [],
        },
      ],
    });
  }

  /** The story-points field id the tab resolved — proves WHICH team profile's config it read. */
  function readStoryPointsFieldIdPassedToFetch(): unknown {
    return mockFetchFeatureReviewItems.mock.calls[0]?.[3];
  }

  it('scopes the dashboard config to the supplied team profile', async () => {
    seedTeamScopedConfigs();

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Beta Board"
        projectKey="TBX"
        selectedPiName="PI 26.4"
        dashboardTeamProfileId="profile-beta"
      />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItems).toHaveBeenCalled());
    expect(readStoryPointsFieldIdPassedToFetch()).toBe(BETA_POINTS_FIELD_ID);
  });

  it('falls back to the app-wide active team when no profile is supplied (Team Dashboard behaviour)', async () => {
    seedTeamScopedConfigs();

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
      />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItems).toHaveBeenCalled());
    expect(readStoryPointsFieldIdPassedToFetch()).toBe(ALPHA_POINTS_FIELD_ID);
  });

  it('resolves the team name from the supplied profile, not the active one', async () => {
    // The team name disambiguates ART teams sharing a project key, so it must follow the same profile.
    seedTeamScopedConfigs();

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Beta Board"
        projectKey="TBX"
        selectedPiName="PI 26.4"
        dashboardTeamProfileId="profile-beta"
      />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItems).toHaveBeenCalled());
    const artTeamPassedToFetch = mockFetchFeatureReviewItems.mock.calls[0]?.[0] as { name?: string };
    expect(artTeamPassedToFetch.name).toBe('Alpha Team');
  });

  it('does not write the app-wide active team profile id', async () => {
    seedTeamScopedConfigs();

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Beta Board"
        projectKey="TBX"
        selectedPiName="PI 26.4"
        dashboardTeamProfileId="profile-beta"
      />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItems).toHaveBeenCalled());
    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('profile-alpha');
  });
});

// ── Product Owner feature discovery (PO Tool opt-in) ──
//
// A brand-new PI has no child stories, so blueprint bottom-up discovery finds nothing. The PO Tool opts
// into the additional PI-Review-style query; the Team Dashboard must keep the blueprint-only rollup.

describe('FeatureReviewTab — Product Owner feature discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify([
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'TBX',
        piReviewPageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha',
      },
    ]));
    mockFetchFeatureReviewFieldConfig.mockResolvedValue({
      acceptanceCriteriaFieldIds: ['customfield_10200'],
      applicationFieldIds: [],
      featureLinkFieldIds: [],
      initiativeTypeFieldIds: [],
      parentLinkFieldIds: ['parent'],
      productOwnerFieldIds: [],
      programIncrementFieldIds: ['customfield_10301'],
      targetEndFieldIds: ['customfield_10102'],
      targetStartFieldIds: ['customfield_10101'],
    });
    mockFetchFeatureReviewItems.mockResolvedValue([createFeatureReviewItem()]);
    mockFetchFeatureReviewItemsWithProductOwnerFeatures.mockResolvedValue({
      items: [createFeatureReviewItem()],
      productOwnerOnlyCount: 1,
      productOwnerQueryWarning: null,
    });
    mockFetchFeatureReviewEditMeta.mockResolvedValue({});
    mockFetchFeatureReviewFixVersions.mockResolvedValue([]);
    mockFetchFeatureReviewTransitions.mockResolvedValue([]);
    // Only the member flagged with the Product Owner capability may scope the Feature query.
    useStandupRosterStore.setState({
      rosterMembers: [
        {
          id: 'roster-member:smith, jane (ctr)',
          displayName: 'Smith, Jane (CTR)',
          assigneeQueryValue: 'Smith, Jane (CTR)',
          roleCapabilities: { canProductOwner: true, canDevelop: false, canInternalTest: false, canExternalTest: false },
        },
        {
          id: 'roster-member:doe, john (ctr)',
          displayName: 'Doe, John (CTR)',
          assigneeQueryValue: 'Doe, John (CTR)',
          roleCapabilities: { canProductOwner: false, canDevelop: true, canInternalTest: false, canExternalTest: false },
        },
      ],
    });
  });

  it('keeps the Team Dashboard on blueprint-only discovery when the opt-in prop is omitted', async () => {
    render(
      <FeatureReviewTab boardId={42} boardName="Alpha Board" projectKey="TBX" selectedPiName="PI 26.3" />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItems).toHaveBeenCalled());
    expect(mockFetchFeatureReviewItemsWithProductOwnerFeatures).not.toHaveBeenCalled();
  });

  it('queries only the roster Product Owners when the PO Tool opts in', async () => {
    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
        shouldIncludeProductOwnerFeatures
      />,
    );

    await waitFor(() => expect(mockFetchFeatureReviewItemsWithProductOwnerFeatures).toHaveBeenCalled());
    expect(mockFetchFeatureReviewItemsWithProductOwnerFeatures.mock.calls[0][2]).toEqual(['Smith, Jane (CTR)']);
    expect(mockFetchFeatureReviewItems).not.toHaveBeenCalled();
    expect(await screen.findByText('Identity hardening')).toBeInTheDocument();
  });

  it('shows the Product Owner query warning instead of implying the rollup is complete', async () => {
    mockFetchFeatureReviewItemsWithProductOwnerFeatures.mockResolvedValue({
      items: [createFeatureReviewItem()],
      productOwnerOnlyCount: 0,
      productOwnerQueryWarning: 'No Product Owner is flagged in the team roster, so only Features that already have team stories are listed.',
    });

    render(
      <FeatureReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        selectedPiName="PI 26.3"
        shouldIncludeProductOwnerFeatures
      />,
    );

    expect(await screen.findByText(/No Product Owner is flagged in the team roster/)).toBeInTheDocument();
  });
});
