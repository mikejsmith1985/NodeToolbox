// SnowHubView.test.tsx — Unit tests for the top-level SNow Hub tabbed view.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCrgState, mockCrgActions, mockPrbState, mockPrbActions, mockReleaseState, mockReleaseActions } = vi.hoisted(() => ({
  mockCrgState: {
    currentStep: 1,
    projectKey: '',
    fixVersion: '',
    availableFixVersions: [],
    fetchedIssues: [],
    selectedIssueKeys: new Set<string>(),
    isFetchingIssues: false,
    fetchError: null as string | null,
    generatedShortDescription: '',
    generatedDescription: '',
    generatedJustification: '',
    generatedRiskImpact: '',
    relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    isSubmitting: false,
    submitResult: null as string | null,
  },
  mockCrgActions: {
    setProjectKey: vi.fn(),
    setFixVersion: vi.fn(),
    fetchIssues: vi.fn().mockResolvedValue(undefined),
    toggleIssueSelection: vi.fn(),
    selectAllIssues: vi.fn(),
    generateDocs: vi.fn(),
    updateGeneratedField: vi.fn(),
    updateEnvironment: vi.fn(),
    goToStep: vi.fn(),
    reset: vi.fn(),
  },
  mockPrbState: {
    prbNumber: '',
    prbData: null as {
      sysId: string;
      number: string;
      shortDescription: string;
      description: string;
      state: string;
      severity: string;
      assignedTo: { sysId: string; name: string; email: string } | null;
    } | null,
    isFetchingPrb: false,
    fetchError: null as string | null,
    jiraProjectKey: '',
    defectSummaryTemplate: '',
    storySummaryTemplate: '',
    isCreatingIssues: false,
    createError: null as string | null,
    createdIssueKeys: [] as string[],
  },
  mockPrbActions: {
    setPrbNumber: vi.fn(),
    fetchPrb: vi.fn().mockResolvedValue(undefined),
    setJiraProjectKey: vi.fn(),
    setDefectSummary: vi.fn(),
    setStorySummary: vi.fn(),
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
  });

  it('renders the SNow Hub heading', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('heading', { name: 'SNow Hub' })).toBeInTheDocument();
  });

  it('renders the three tab buttons', () => {
    render(<SnowHubView />);

    expect(screen.getByRole('tab', { name: 'CRG' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PRB Generator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Release Management' })).toBeInTheDocument();
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

  it('switches to the Release Management tab', async () => {
    const user = userEvent.setup();
    render(<SnowHubView />);

    await user.click(screen.getByRole('tab', { name: 'Release Management' }));

    expect(screen.getByLabelText('CHG Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Change' })).toBeInTheDocument();
  });
});
