// CrgTab.test.tsx — Unit tests for the Change Request Generator tab.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MOCK_ISSUES = [
  {
    id: '10001',
    key: 'ABC-123',
    fields: {
      summary: 'Fix the release blocker',
      status: { name: 'Done' },
    },
  },
];

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
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
    relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    isSubmitting: false,
    submitResult: null as string | null,
  },
  mockActions: {
    setFetchMode: vi.fn(),
    setProjectKey: vi.fn(),
    setFixVersion: vi.fn(),
    setCustomJql: vi.fn(),
    fetchIssues: vi.fn().mockResolvedValue(undefined),
    toggleIssueSelection: vi.fn(),
    selectAllIssues: vi.fn(),
    generateDocs: vi.fn(),
    updateGeneratedField: vi.fn(),
    updateEnvironment: vi.fn(),
    goToStep: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../hooks/useCrgState.ts', () => ({
  useCrgState: () => ({ state: mockState, actions: mockActions }),
}));

import CrgTab from './CrgTab.tsx';

function resetMockState(): void {
  Object.assign(mockState, {
    currentStep: 1,
    fetchMode: 'project',
    projectKey: '',
    fixVersion: '',
    customJql: '',
    availableFixVersions: [],
    fetchedIssues: [],
    selectedIssueKeys: new Set<string>(),
    isFetchingIssues: false,
    fetchError: null,
    generatedShortDescription: '',
    generatedDescription: '',
    generatedJustification: '',
    generatedRiskImpact: '',
    relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    isSubmitting: false,
    submitResult: null,
  });
}

describe('CrgTab', () => {
  beforeEach(() => {
    resetMockState();
    Object.values(mockActions).forEach((mockAction) => mockAction.mockReset());
    mockActions.fetchIssues.mockResolvedValue(undefined);
  });

  it('renders step 1 with the project key input and fetch button', () => {
    render(<CrgTab />);

    expect(screen.getByRole('heading', { name: 'Change Request Generator' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch Issues' })).toBeInTheDocument();
  });

  it('renders a fix version dropdown when fix versions are available', () => {
    mockState.availableFixVersions = ['1.2.3', '1.2.4'] as never[];
    render(<CrgTab />);

    expect(screen.getByRole('combobox', { name: 'Fix Version' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '1.2.3' })).toBeInTheDocument();
    mockState.availableFixVersions = [];
  });

  it('shows an error message when fetchError is set', () => {
    mockState.fetchError = 'Project key and fix version are required.';

    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent('Project key and fix version are required.');
    mockState.fetchError = null;
  });

  it('shows the step 2 issue list after fetchIssues resolves', async () => {
    const user = userEvent.setup();
    mockActions.fetchIssues.mockImplementation(async () => {
      Object.assign(mockState, {
        currentStep: 2,
        fetchedIssues: MOCK_ISSUES,
        selectedIssueKeys: new Set<string>(['ABC-123']),
      });
    });

    const { rerender } = render(<CrgTab />);

    await user.click(screen.getByRole('button', { name: 'Fetch Issues' }));
    await waitFor(() => {
      expect(mockActions.fetchIssues).toHaveBeenCalledTimes(1);
    });

    rerender(<CrgTab />);

    expect(screen.getByRole('checkbox', { name: 'Select All' })).toBeInTheDocument();
    expect(screen.getByText('ABC-123')).toBeInTheDocument();
    expect(screen.getByText('Fix the release blocker')).toBeInTheDocument();
  });

  it('renders step 3 with editable textareas', () => {
    Object.assign(mockState, {
      currentStep: 3,
      generatedShortDescription: 'Deploy ABC 1.0.0',
      generatedDescription: 'Release notes',
      generatedJustification: 'Required for release readiness',
      generatedRiskImpact: 'Standard deployment risk',
    });

    render(<CrgTab />);

    expect(screen.getByLabelText('Short Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Justification')).toBeInTheDocument();
    expect(screen.getByLabelText('Risk & Impact')).toBeInTheDocument();
  });

  it('renders the environments table on step 4', () => {
    mockState.currentStep = 4;

    render(<CrgTab />);

    expect(screen.getByRole('table', { name: 'Environment schedule table' })).toBeInTheDocument();
    expect(screen.getByText('REL')).toBeInTheDocument();
    expect(screen.getByText('PRD')).toBeInTheDocument();
    expect(screen.getByText('PFIX')).toBeInTheDocument();
  });

  it('renders fetch mode radio buttons on step 1', () => {
    render(<CrgTab />);

    expect(screen.getByRole('radio', { name: 'By Project & Version' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Custom JQL' })).toBeInTheDocument();
  });

  it('shows project key and fix version fields when fetch mode is project', () => {
    mockState.fetchMode = 'project';
    render(<CrgTab />);

    expect(screen.getByLabelText('Project Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Fix Version')).toBeInTheDocument();
    expect(screen.queryByLabelText('JQL Query')).not.toBeInTheDocument();
  });

  it('shows the JQL textarea and hides project fields when fetch mode is jql', () => {
    mockState.fetchMode = 'jql';
    render(<CrgTab />);

    expect(screen.getByLabelText('JQL Query')).toBeInTheDocument();
    expect(screen.queryByLabelText('Project Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fix Version')).not.toBeInTheDocument();
  });

  it('calls setFetchMode with jql when the Custom JQL radio is selected', async () => {
    const user = userEvent.setup();
    render(<CrgTab />);

    await user.click(screen.getByRole('radio', { name: 'Custom JQL' }));

    expect(mockActions.setFetchMode).toHaveBeenCalledWith('jql');
  });

  it('calls setCustomJql when the JQL textarea value changes', async () => {
    const user = userEvent.setup();
    mockState.fetchMode = 'jql';
    render(<CrgTab />);

    await user.type(screen.getByLabelText('JQL Query'), 'project = TEST');

    expect(mockActions.setCustomJql).toHaveBeenCalled();
  });

  it('shows a JQL required error when fetchError is set in jql mode', () => {
    mockState.fetchMode = 'jql';
    mockState.fetchError = 'A JQL query is required.';

    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent('A JQL query is required.');
  });
});
