// SnowHubView.test.tsx — Unit tests for the top-level SNow Hub tabbed view.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import viewFrameStyles from '../../components/ViewFrame/ViewFrame.module.css';

const { mockCrgState, mockCrgActions, mockPrbState, mockPrbActions, mockReleaseState, mockReleaseActions, mockSyncEngineState, mockSyncEngineActions } = vi.hoisted(() => ({
  mockCrgState: {
    currentStep: 1,
    fetchMode: 'project' as 'project' | 'jql',
    projectKey: '',
    fixVersion: '',
    customJql: '',
    availableFixVersions: [],
    fetchedIssues: [],
    selectedIssueKeys: new Set<string>(),
    isFetchingIssues: false,
    fetchError: null as string | null,
    generatedShortDescription: '',
    generatedDescription: '',
    generatedJustification: '',
    generatedRiskImpact: '',
    shortDescriptionConfig: {
      application: '',
      team: '',
      changeDetailsOverride: '',
    },
    cloneChgNumber: '',
    isCloning: false,
    cloneError: null as string | null,
    chgBasicInfo: {
      category: '', changeType: '', environment: '',
      requestedBy: { sysId: '', displayName: '' },
      configItem: { sysId: '', displayName: '' },
      assignmentGroup: { sysId: '', displayName: '' },
      assignedTo: { sysId: '', displayName: '' },
      changeManager: { sysId: '', displayName: '' },
      tester: { sysId: '', displayName: '' },
      serviceManager: { sysId: '', displayName: '' },
      isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '',
      systemAvailabilityImplication: '',
      hasBeenTested: '',
      impactedPersonsAware: '',
      hasBeenPerformedPreviously: '',
      successProbability: '',
      canBeBackedOut: '',
    },
    chgPlanningContent: {
      implementationPlan: '',
      backoutPlan: '',
      testPlan: '',
    },
    relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '' },
    changeTasks: [] as unknown[],
    isSubmitting: false,
    submitResult: null as string | null,
  },
  mockCrgActions: {
    setFetchMode: vi.fn(),
    setProjectKey: vi.fn(),
    setFixVersion: vi.fn(),
    setCustomJql: vi.fn(),
    fetchIssues: vi.fn().mockResolvedValue(undefined),
    toggleIssueSelection: vi.fn(),
    selectAllIssues: vi.fn(),
    generateDocs: vi.fn(),
    updateGeneratedField: vi.fn(),
    setShortDescriptionConfig: vi.fn(),
    setChgBasicInfo: vi.fn(),
    setChgPlanningAssessment: vi.fn(),
    setChgPlanningContent: vi.fn(),
    setCloneChgNumber: vi.fn(),
    cloneFromChg: vi.fn().mockResolvedValue(undefined),
    applyTemplate: vi.fn(),
    updateEnvironment: vi.fn(),
    addChangeTask: vi.fn(),
    removeChangeTask: vi.fn(),
    appendTasksToExistingChg: vi.fn().mockResolvedValue(undefined),
    cloneCtaskTemplate: vi.fn().mockResolvedValue({}),
    goToStep: vi.fn(),
    reset: vi.fn(),
    createChg: vi.fn().mockResolvedValue(undefined),
  },
  mockPrbState: {
    prbNumber: '',
    prbData: null as {
      sysId: string;
      number: string;
      incidentNumber: string;
      shortDescription: string;
      description: string;
      state: string;
      severity: string;
      assignedTo: { sysId: string; name: string; email: string } | null;
    } | null,
    isFetchingPrb: false,
    fetchError: null as string | null,
    fetchWarning: null as string | null,
    jiraProjectKey: '',
    isPrimaryIssueDefect: true,
    primaryIssueSummaryTemplate: '',
    slStorySummaryTemplate: '',
    isCreatingIssues: false,
    createError: null as string | null,
    createdIssueKeys: [] as string[],
  },
  mockPrbActions: {
    setPrbNumber: vi.fn(),
    fetchPrb: vi.fn().mockResolvedValue(undefined),
    setJiraProjectKey: vi.fn(),
    setIsPrimaryIssueDefect: vi.fn(),
    setPrimaryIssueSummary: vi.fn(),
    setSlStorySummary: vi.fn(),
    createJiraIssues: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  },
  mockReleaseState: {
    chgNumber: '',
    loadedChg: null as {
      sysId: string;
      number: string;
      shortDescription: string;
      state: string;
      assignedTo: { sysId: string; name: string; email: string } | null;
      plannedStartDate: string;
      plannedEndDate: string;
      risk: string;
      impact: string;
    } | null,
    isLoadingChg: false,
    loadError: null as string | null,
    myActiveChanges: [] as Array<{
      sysId: string;
      number: string;
      shortDescription: string;
      state: string;
      plannedStartDate: string;
      plannedEndDate: string;
      alertSeverity: 'healthy' | 'warning' | 'error';
      alertMessage: string | null;
    }>,
    isLoadingMyChanges: false,
    myChangesError: null as string | null,
    activityLog: [] as Array<{
      timestamp: string;
      message: string;
      level: 'info' | 'success' | 'warning' | 'error';
    }>,
    monitorSettings: {
      shouldAlertOnPlannedStartMiss: true,
      shouldAlertOnPlannedEndMiss: true,
    },
  },
  mockReleaseActions: {
    setChgNumber: vi.fn(),
    loadChg: vi.fn().mockResolvedValue(undefined),
    loadMyActiveChanges: vi.fn().mockResolvedValue(undefined),
    appendLogEntry: vi.fn(),
    clearLog: vi.fn(),
    clearLoadedChg: vi.fn(),
    setMonitorSetting: vi.fn(),
  },
  mockSyncEngineState: {
    isRunning: false,
    logEntries: [],
    settings: {
      jqlTemplate: 'issuetype = Problem AND status changed AFTER -{interval}h',
      intervalMin: 15,
      workNotePrefix: '[Jira Sync]',
      shouldSyncComments: true,
      lastCheckTime: null as string | null,
    },
    statusMap: {} as Record<string, string>,
    jiraStatuses: [] as string[],
    isFetchingStatuses: false,
    nextRunAt: null as number | null,
    trackedIssueCount: 0,
  },
  mockSyncEngineActions: {
    startSync: vi.fn(),
    stopSync: vi.fn(),
    runNow: vi.fn().mockResolvedValue(undefined),
    clearLog: vi.fn(),
    updateSettings: vi.fn(),
    saveSettings: vi.fn(),
    fetchJiraStatuses: vi.fn().mockResolvedValue(undefined),
    saveStatusMappings: vi.fn(),
    exportPs1: vi.fn(),
  },
}));

const { mockUserAssignmentGroupsState, mockUserAssignmentGroupsActions } = vi.hoisted(() => ({
  mockUserAssignmentGroupsState: {
    assignmentGroupMemberships: [] as Array<{
      membershipSysId: string;
      groupSysId: string;
      groupDisplayName: string;
    }>,
    isLoadingAssignmentGroups: false,
    lookupErrorMessage: null as string | null,
  },
  mockUserAssignmentGroupsActions: {
    lookupAssignmentGroupsForUser: vi.fn().mockResolvedValue(undefined),
    clearAssignmentGroupResults: vi.fn(),
  },
}));

vi.mock('./hooks/useCrgState.ts', () => ({
  useCrgState: () => ({ state: mockCrgState, actions: mockCrgActions }),
}));

vi.mock('./hooks/usePrbState.ts', () => ({
  usePrbState: () => ({ state: mockPrbState, actions: mockPrbActions }),
}));

vi.mock('./hooks/useReleaseManagement.ts', () => ({
  useReleaseManagement: () => ({ state: mockReleaseState, actions: mockReleaseActions }),
}));

vi.mock('./hooks/useSnowSyncEngine.ts', () => ({
  useSnowSyncEngine: () => ({ state: mockSyncEngineState, actions: mockSyncEngineActions }),
  SNOW_PROBLEM_STATES: {
    '101': 'New',
    '102': 'Assess',
    '103': 'Root Cause Analysis',
    '104': 'Fix in Progress',
    '106': 'Resolved',
    '107': 'Closed',
  },
}));

vi.mock('./hooks/useUserAssignmentGroups.ts', () => ({
  useUserAssignmentGroups: () => ({
    ...mockUserAssignmentGroupsState,
    ...mockUserAssignmentGroupsActions,
  }),
}));

const mockChangeModifierState = {
  change: null as {
    number: string;
    shortDescription: string;
    description: string;
    justification: string;
    riskImpactAnalysis: string;
    chgBasicInfo: { category: string; changeType: string; environment: string };
    chgPlanningAssessment: Record<string, string>;
    chgPlanningContent: Record<string, string>;
  } | null,
  ctasks: [] as Array<{
    sysId: string;
    number: string;
    shortDescription: string;
    description: string;
    assignmentGroup: { sysId: string; displayName: string };
    assignedTo: { sysId: string; displayName: string };
    plannedStartDate: string;
    plannedEndDate: string;
  }>,
  isLoading: false,
  isSaving: false,
  isDirty: false,
  error: null as string | null,
  isSavingSuccess: false,
};

const mockChangeModifierActions = {
  fetchChangeByKey: vi.fn().mockResolvedValue(undefined),
  updateChangeField: vi.fn(),
  removeCtask: vi.fn(),
  saveChange: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./hooks/useChangeModifier.ts', () => ({
  useChangeModifier: () => ({
    state: mockChangeModifierState,
    actions: mockChangeModifierActions,
  }),
}));

import SnowHubView from './SnowHubView.tsx';

function resetMockState(): void {
  mockCrgState.currentStep = 1;
  mockPrbState.prbData = null;
  mockReleaseState.loadedChg = null;
  mockReleaseState.activityLog = [];
  mockChangeModifierState.change = null;
  mockChangeModifierState.ctasks = [];
  mockChangeModifierState.isLoading = false;
  mockChangeModifierState.isSaving = false;
  mockChangeModifierState.isDirty = false;
  mockChangeModifierState.error = null;
  mockChangeModifierState.isSavingSuccess = false;
}

describe('SnowHubView', () => {
  beforeEach(() => {
    resetMockState();
    Object.values(mockCrgActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockPrbActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockReleaseActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockSyncEngineActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockUserAssignmentGroupsActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockChangeModifierActions).forEach((mockAction) => mockAction.mockReset());
    mockSyncEngineActions.runNow.mockResolvedValue(undefined);
    mockSyncEngineActions.fetchJiraStatuses.mockResolvedValue(undefined);
    mockUserAssignmentGroupsActions.lookupAssignmentGroupsForUser.mockResolvedValue(undefined);
  });

  it('renders the SNow Hub heading', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('heading', { name: 'SNow Hub' })).toBeInTheDocument();
  });

  it('renders the six tab buttons (CHG tabs consolidated)', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('tab', { name: 'CHG Generator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PRB Generator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Assignment Groups' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Release Management' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sync Monitor' })).toBeInTheDocument();
  });

  it('shows the CRG tab content by default', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('button', { name: 'Create CHG' })).toBeInTheDocument();
  });

  it('switches to the Modify mode when Modify CHG button is clicked', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    // Click on CHG Generator tab first (should already be selected by default)
    const chgTab = screen.getByRole('tab', { name: 'CHG Generator' });
    expect(chgTab).toBeInTheDocument();

    // Click on Modify CHG button to switch modes
    const modifyButton = screen.getByRole('button', { name: 'Modify CHG' });
    await user.click(modifyButton);

    expect(screen.getByRole('button', { name: 'Fetch Change' })).toBeInTheDocument();
  });

  it('switches to the PRB tab when PRB Generator is clicked', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'PRB Generator' }));

    expect(screen.getByLabelText('PRB Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load PRB' })).toBeInTheDocument();
  });

  it('switches to the Configuration tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Configuration' }));

    expect(screen.getByRole('heading', { name: 'CRG Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load CHG' })).toBeInTheDocument();
  });

  it('switches to the Release Management tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Release Management' }));

    expect(screen.getByLabelText('CHG Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Change' })).toBeInTheDocument();
  });

  it('switches to the Assignment Groups tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Assignment Groups' }));

    expect(screen.getByRole('heading', { name: 'User Assignment Groups' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find Assignment Groups' })).toBeInTheDocument();
  });

  it('switches to the Sync Monitor tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Sync Monitor' }));

    expect(screen.getByRole('heading', { name: 'PRB Sync Monitor' })).toBeInTheDocument();
  });

  it('uses the full-width shared view frame so responsive sizing can expand the workspace', () => {
    const { container } = render(<SnowHubView />);

    expect(container.firstElementChild?.className).toContain(viewFrameStyles.widthFull);
  });
});
