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

// Mock SnowLookupField so tests don't try to call snowFetch for typeahead searches.
vi.mock('../components/SnowLookupField.tsx', () => ({
  SnowLookupField: ({ label }: { label: string }) => (
    <div data-testid={`lookup-${label.replace(/\s+/g, '-').toLowerCase()}`}>{label}</div>
  ),
}));

const EMPTY_SNOW_REFERENCE = { sysId: '', displayName: '' };
const DEFAULT_BASIC_INFO = {
  category: '',
  changeType: '',
  environment: '',
  requestedBy:     { ...EMPTY_SNOW_REFERENCE },
  configItem:      { ...EMPTY_SNOW_REFERENCE },
  assignmentGroup: { ...EMPTY_SNOW_REFERENCE },
  assignedTo:      { ...EMPTY_SNOW_REFERENCE },
  changeManager:   { ...EMPTY_SNOW_REFERENCE },
  tester:          { ...EMPTY_SNOW_REFERENCE },
  serviceManager:  { ...EMPTY_SNOW_REFERENCE },
  isExpedited: false,
};
const DEFAULT_PLANNING_ASSESSMENT = {
  impact: '',
  systemAvailabilityImplication: '',
  hasBeenTested: '',
  impactedPersonsAware: '',
  hasBeenPerformedPreviously: '',
  successProbability: '',
  canBeBackedOut: '',
};
const DEFAULT_PLANNING_CONTENT = {
  implementationPlan: '',
  backoutPlan: '',
  testPlan: '',
};

const { mockState, mockActions, mockSnowChoiceConfig } = vi.hoisted(() => ({
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
    cloneChgNumber: '',
    isCloning: false,
    cloneError: null as string | null,
    chgBasicInfo: {
      category: '', changeType: '', environment: '',
      requestedBy:     { sysId: '', displayName: '' },
      configItem:      { sysId: '', displayName: '' },
      assignmentGroup: { sysId: '', displayName: '' },
      assignedTo:      { sysId: '', displayName: '' },
      changeManager:   { sysId: '', displayName: '' },
      tester:          { sysId: '', displayName: '' },
      serviceManager:  { sysId: '', displayName: '' },
      isExpedited: false,
    },
    chgPlanningAssessment: {
      impact: '', systemAvailabilityImplication: '', hasBeenTested: '',
      impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '',
    },
    chgPlanningContent: {
      implementationPlan: '', backoutPlan: '', testPlan: '',
    },
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
    setChgBasicInfo: vi.fn(),
    setChgPlanningAssessment: vi.fn(),
    setChgPlanningContent: vi.fn(),
    setCloneChgNumber: vi.fn(),
    cloneFromChg: vi.fn().mockResolvedValue(undefined),
    applyTemplate: vi.fn(),
    updateEnvironment: vi.fn(),
    goToStep: vi.fn(),
    reset: vi.fn(),
    createChg: vi.fn().mockResolvedValue(undefined),
  },
  /** Mutable config read by the useSnowChoiceOptions mock — set per-test to simulate failure. */
  mockSnowChoiceConfig: {
    isFetchFailed: false,
    isLoadingChoices: false,
    isRelayConnected: true,
  },
}));

vi.mock('../hooks/useCrgState.ts', () => ({
  useCrgState: () => ({ state: mockState, actions: mockActions }),
}));

// Mock the templates hook — no templates by default; tests can override via the mock.
vi.mock('../hooks/useCrgTemplates.ts', () => ({
  useCrgTemplates: () => ({
    templates:      [],
    saveTemplate:   vi.fn(),
    deleteTemplate: vi.fn(),
  }),
}));

// Mock the choice options hook — returns minimal option maps from live SNow (isFetchFailed=false by
// default). Tests can set mockSnowChoiceConfig.isFetchFailed=true to simulate relay unavailability.
vi.mock('../hooks/useSnowChoiceOptions.ts', () => ({
  useSnowChoiceOptions: () => ({
    choiceOptions: mockSnowChoiceConfig.isFetchFailed ? {} : {
      category:                [{ value: '', label: '' }, { value: 'Software', label: 'Software' }],
      type:                    [{ value: '', label: '' }, { value: 'Normal', label: 'Normal' }],
      u_environment:           [{ value: '', label: '' }, { value: 'Production', label: 'Production' }],
      impact:                  [{ value: '', label: '' }, { value: '3 - Low', label: '3 - Low' }],
      u_availability_impact:   [{ value: '', label: '' }, { value: 'No Impact', label: 'No Impact' }],
      u_change_tested:         [{ value: '', label: '' }, { value: 'Yes', label: 'Yes' }],
      u_impacted_persons_aware:[{ value: '', label: '' }, { value: 'Yes', label: 'Yes' }],
      u_performed_previously:  [{ value: '', label: '' }, { value: 'Yes', label: 'Yes' }],
      u_success_probability:   [{ value: '', label: '' }, { value: '100%', label: '100%' }],
      u_can_be_backed_out:     [{ value: '', label: '' }, { value: 'Yes', label: 'Yes' }],
    },
    isLoadingChoices:   mockSnowChoiceConfig.isLoadingChoices,
    areChoicesFromSnow: !mockSnowChoiceConfig.isFetchFailed && !mockSnowChoiceConfig.isLoadingChoices,
    isFetchFailed:      mockSnowChoiceConfig.isFetchFailed,
    fetchErrorMessage:  mockSnowChoiceConfig.isFetchFailed ? 'SNow relay fetch failed: 401' : null,
    isRelayConnected:   mockSnowChoiceConfig.isRelayConnected,
    retryFetch:         vi.fn(),
  }),
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
    cloneChgNumber: '',
    isCloning: false,
    cloneError: null,
    chgBasicInfo: { ...DEFAULT_BASIC_INFO },
    chgPlanningAssessment: { ...DEFAULT_PLANNING_ASSESSMENT },
    chgPlanningContent: { ...DEFAULT_PLANNING_CONTENT },
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
    mockActions.cloneFromChg.mockResolvedValue(undefined);
    mockActions.createChg.mockResolvedValue(undefined);
    // Reset the choice options config so tests don't bleed state into each other.
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isLoadingChoices = false;
    mockSnowChoiceConfig.isRelayConnected = true;
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

  it('renders step 4 (Planning) with editable textareas for the four generated CHG fields', () => {
    Object.assign(mockState, {
      currentStep: 4,
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

  it('renders the environments table on step 5', () => {
    mockState.currentStep = 5;

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

  it('renders the Create CHG button on step 6 (Review & Create)', () => {
    mockState.currentStep = 6;
    mockState.generatedShortDescription = 'Deploy TOOL 1.0.0';

    render(<CrgTab />);

    expect(screen.getByRole('button', { name: 'Create CHG' })).toBeInTheDocument();
  });

  it('calls createChg when the Create CHG button is clicked on step 6', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 6;
    mockState.generatedShortDescription = 'Deploy TOOL 1.0.0';

    render(<CrgTab />);

    await user.click(screen.getByRole('button', { name: 'Create CHG' }));

    expect(mockActions.createChg).toHaveBeenCalledTimes(1);
  });

  it('disables the Create CHG button when isSubmitting is true', () => {
    mockState.currentStep = 6;
    mockState.isSubmitting = true;
    mockState.generatedShortDescription = 'Deploy TOOL 1.0.0';

    render(<CrgTab />);

    expect(screen.getByRole('button', { name: 'Creating CHG…' })).toBeDisabled();
  });

  it('disables the Create CHG button when there is no generated content', () => {
    mockState.currentStep = 6;
    // All generated fields empty (default mock state)

    render(<CrgTab />);

    expect(screen.getByRole('button', { name: 'Create CHG' })).toBeDisabled();
  });

  it('shows the passphrase modal when Ctrl+Alt+Z is pressed', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 4;
    render(<CrgTab />);

    await user.keyboard('{Control>}{Alt>}z{/Alt}{/Control}');

    expect(screen.getByPlaceholderText('Enter passphrase')).toBeInTheDocument();
  });

  it('closes the passphrase modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 4;
    render(<CrgTab />);

    await user.keyboard('{Control>}{Alt>}z{/Alt}{/Control}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByPlaceholderText('Enter passphrase')).not.toBeInTheDocument();
  });

  it('unlocks Rovo and shows the Enhance button after correct passphrase on step 4', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 4;
    render(<CrgTab />);

    await user.keyboard('{Control>}{Alt>}z{/Alt}{/Control}');
    await user.type(screen.getByPlaceholderText('Enter passphrase'), 'rovonow');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('button', { name: '✦ Enhance with AI' })).toBeInTheDocument();
  });

  it('shows the prompt modal with a textarea when Enhance with AI is clicked', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 4;
    render(<CrgTab />);

    // Unlock
    await user.keyboard('{Control>}{Alt>}z{/Alt}{/Control}');
    await user.type(screen.getByPlaceholderText('Enter passphrase'), 'rovonow');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    // Click enhance
    await user.click(await screen.findByRole('button', { name: '✦ Enhance with AI' }));

    // Prompt modal should appear
    expect(await screen.findByText(/Copy this prompt and paste it into Rovo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '📋 Copy to Clipboard' })).toBeInTheDocument();
  });

  it('closes the prompt modal when Close is clicked', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 4;
    render(<CrgTab />);

    await user.keyboard('{Control>}{Alt>}z{/Alt}{/Control}');
    await user.type(screen.getByPlaceholderText('Enter passphrase'), 'rovonow');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await user.click(await screen.findByRole('button', { name: '✦ Enhance with AI' }));

    // Close prompt modal
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    expect(screen.queryByText(/Copy this prompt and paste it into Rovo/)).not.toBeInTheDocument();
  });

  // ── Step 3: Change Details ──

  it('renders the clone-from-CHG input and Load CHG button on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('textbox', { name: 'Existing CHG number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load CHG' })).toBeInTheDocument();
  });

  it('shows "No templates saved yet" message on step 3 when there are no saved templates', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByText('No templates saved yet.')).toBeInTheDocument();
  });

  it('shows the "Save as template" link on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('button', { name: '+ Save current fields as template' })).toBeInTheDocument();
  });

  it('reveals the template name input when "Save as template" is clicked', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 3;
    render(<CrgTab />);

    await user.click(screen.getByRole('button', { name: '+ Save current fields as template' }));

    expect(screen.getByRole('textbox', { name: 'Template name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows the Category dropdown on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
  });

  it('renders SnowLookupField stubs for reference fields on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByTestId('lookup-requested-by')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-assignment-group')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-assigned-to')).toBeInTheDocument();
  });

  it('renders implementation, backout, and test plan textareas on step 4', () => {
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.getByLabelText('Implementation Plan')).toBeInTheDocument();
    expect(screen.getByLabelText('Backout Plan')).toBeInTheDocument();
    expect(screen.getByLabelText('Test Plan')).toBeInTheDocument();
  });

  it('shows a "fetch failed" warning with Retry button on step 3 when isFetchFailed and relay connected', () => {
    mockSnowChoiceConfig.isFetchFailed = true;
    mockSnowChoiceConfig.isRelayConnected = true;
    mockState.currentStep = 3;
    render(<CrgTab />);

    // Warning must describe the fetch failure (not a "relay not connected" message).
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load dropdown options/);
    // Retry button must be present so the user can re-trigger without reloading the page.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Dropdowns must still be disabled until options are loaded.
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled();
  });

  it('shows a "relay not connected" warning on step 3 when relay is disconnected', () => {
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isRelayConnected = false;
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/SNow relay not connected/);
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled();
  });

  it('shows a "fetch failed" warning with Retry button on step 4 when isFetchFailed and relay connected', () => {
    mockSnowChoiceConfig.isFetchFailed = true;
    mockSnowChoiceConfig.isRelayConnected = true;
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load dropdown options/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const impactDropdown = screen.getByRole('combobox', { name: 'Impact' });
    expect(impactDropdown).toBeDisabled();
  });

  it('shows a "relay not connected" warning on step 4 when relay is disconnected', () => {
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isRelayConnected = false;
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/SNow relay not connected/);
    const impactDropdown = screen.getByRole('combobox', { name: 'Impact' });
    expect(impactDropdown).toBeDisabled();
  });
});
