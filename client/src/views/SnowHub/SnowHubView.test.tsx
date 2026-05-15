// SnowHubView.test.tsx — Unit tests for the top-level SNow Hub tabbed view.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' } },
    prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' } },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' } },
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
    }>,
    isLoadingMyChanges: false,
    myChangesError: null as string | null,
    activityLog: [] as Array<{
      timestamp: string;
      message: string;
      level: 'info' | 'success' | 'warning' | 'error';
    }>,
  },
  mockReleaseActions: {
    setChgNumber: vi.fn(),
    loadChg: vi.fn().mockResolvedValue(undefined),
    loadMyActiveChanges: vi.fn().mockResolvedValue(undefined),
    appendLogEntry: vi.fn(),
    clearLog: vi.fn(),
    clearLoadedChg: vi.fn(),
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

import SnowHubView from './SnowHubView.tsx';

function resetMockState(): void {
  mockCrgState.currentStep = 1;
  mockPrbState.prbData = null;
  mockReleaseState.loadedChg = null;
  mockReleaseState.activityLog = [];
}

describe('SnowHubView', () => {
  beforeEach(() => {
    resetMockState();
    Object.values(mockCrgActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockPrbActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockReleaseActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockSyncEngineActions).forEach((mockAction) => mockAction.mockReset());
    mockSyncEngineActions.runNow.mockResolvedValue(undefined);
    mockSyncEngineActions.fetchJiraStatuses.mockResolvedValue(undefined);
  });

  it('renders the SNow Hub heading', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('heading', { name: 'SNow Hub' })).toBeInTheDocument();
  });

  it('renders the five tab buttons', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('tab', { name: 'CHG' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PRB Generator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Release Management' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sync Monitor' })).toBeInTheDocument();
  });

  it('shows the CRG tab content by default', () => {
    render(<SnowHubView />);

    expect(screen.getByLabelText('Project Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch Issues' })).toBeInTheDocument();
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

  it('switches to the Sync Monitor tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Sync Monitor' }));

    expect(screen.getByRole('heading', { name: 'PRB Sync Monitor' })).toBeInTheDocument();
  });
});
