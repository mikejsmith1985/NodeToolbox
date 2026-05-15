// CrgTab.test.tsx — Unit tests for the Change Request Generator tab.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const DEFAULT_CTASK_TEMPLATE = {
  id:               'ctask-template-001',
  name:             'Deployment Validation',
  createdAt:        '2026-01-01T00:00:00.000Z',
  shortDescription: 'Validate production deployment',
  description:      'Confirm smoke tests pass after deployment.',
  assignmentGroup:  { sysId: 'grp-001', displayName: 'Platform Team' },
  assignedTo:       { sysId: 'usr-001', displayName: 'Jane Smith' },
  plannedStartDate: '2026-01-01T10:00',
  plannedEndDate:   '2026-01-01T11:00',
  closeNotes:       'Validation complete.',
};

const {
  mockState,
  mockActions,
  mockSnowChoiceConfig,
  mockTemplates,
  mockTemplateActions,
  mockPinnedFields,
  mockFieldPinActions,
  mockCtaskTemplates,
  mockCtaskTemplateActions,
} = vi.hoisted(() => {
  const mockPinnedFields = [] as Array<{ id: string; key: string; label: string; section: string; value: unknown }>;
  const emptySnowReference = { sysId: '', displayName: '' };

  return {
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
    relEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...emptySnowReference } },
    prdEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...emptySnowReference } },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...emptySnowReference } },
    changeTasks: [] as unknown[],
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
    addChangeTask: vi.fn(),
    removeChangeTask: vi.fn(),
    appendTasksToExistingChg: vi.fn().mockResolvedValue(undefined),
    cloneCtaskTemplate: vi.fn().mockResolvedValue({
      shortDescription: 'Validate cloned deployment',
      description:      'Run cloned CTASK validation steps.',
      assignmentGroup:  { sysId: 'grp-clone', displayName: 'Clone Team' },
      assignedTo:       { sysId: 'usr-clone', displayName: 'Clone User' },
      plannedStartDate: '2026-01-03T10:00',
      plannedEndDate:   '2026-01-03T11:00',
      closeNotes:       'Cloned task complete.',
    }),
    goToStep: vi.fn(),
    reset: vi.fn(),
    createChg: vi.fn().mockResolvedValue(undefined),
  },
    /** Mutable config read by the useSnowChoiceOptions mock — set per-test to simulate failure. */
    mockSnowChoiceConfig: {
    isFetchFailed: false,
    isLoadingChoices: false,
    isRelayConnected: true,
    hasRelaySessionToken: true,
    hasChoiceOptions: true,
  },
    mockTemplates: [] as unknown[],
    mockTemplateActions: {
      saveTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
    },
    mockPinnedFields,
    mockFieldPinActions: {
      upsertPin: vi.fn(),
      removePin: vi.fn(),
      clearPins: vi.fn(),
      getPinnedFields: vi.fn((fieldKey: string) => (
        mockPinnedFields.filter((pinnedField) => pinnedField.key === fieldKey)
      )),
      findPinnedField: vi.fn((fieldKey: string, fieldValue: unknown) => (
        mockPinnedFields.find((pinnedField) => (
          pinnedField.key === fieldKey && JSON.stringify(pinnedField.value) === JSON.stringify(fieldValue)
        ))
      )),
    },
    mockCtaskTemplates: [] as unknown[],
    mockCtaskTemplateActions: {
      saveTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
    },
  };
});

vi.mock('../hooks/useCrgState.ts', () => ({
  useCrgState: () => ({ state: mockState, actions: mockActions }),
}));

// Mock the templates hook — no templates by default; tests can override via the mock.
vi.mock('../hooks/useCrgTemplates.ts', () => ({
  useCrgTemplates: () => ({
    templates:      mockTemplates,
    saveTemplate:   mockTemplateActions.saveTemplate,
    updateTemplate: mockTemplateActions.updateTemplate,
    deleteTemplate: mockTemplateActions.deleteTemplate,
  }),
}));

vi.mock('../hooks/useCrgFieldPins.ts', () => ({
  useCrgFieldPins: () => ({
    pinnedFields:   mockPinnedFields,
    upsertPin:      mockFieldPinActions.upsertPin,
    removePin:      mockFieldPinActions.removePin,
    clearPins:      mockFieldPinActions.clearPins,
    getPinnedFields: mockFieldPinActions.getPinnedFields,
    findPinnedField: mockFieldPinActions.findPinnedField,
  }),
}));

vi.mock('../hooks/useCtaskTemplates.ts', () => ({
  useCtaskTemplates: () => ({
    templates:      mockCtaskTemplates,
    saveTemplate:   mockCtaskTemplateActions.saveTemplate,
    updateTemplate: mockCtaskTemplateActions.updateTemplate,
    deleteTemplate: mockCtaskTemplateActions.deleteTemplate,
  }),
}));

// Mock the choice options hook — returns minimal option maps from live SNow (isFetchFailed=false by
// default). Tests can set mockSnowChoiceConfig.isFetchFailed=true to simulate relay unavailability.
vi.mock('../hooks/useSnowChoiceOptions.ts', () => ({
  useSnowChoiceOptions: () => ({
    choiceOptions: mockSnowChoiceConfig.isFetchFailed || !mockSnowChoiceConfig.hasChoiceOptions ? {} : {
      category:                [{ value: '', label: '' }, { value: 'software', label: 'Software' }],
      type:                    [{ value: '', label: '' }, { value: 'normal', label: 'Normal' }],
      u_environment:           [{ value: '', label: '' }, { value: 'prod', label: 'Production' }, { value: 'pfix', label: 'Production Fix' }],
      impact:                  [{ value: '', label: '' }, { value: '3', label: '3 - Low' }],
      u_availability_impact:   [{ value: '', label: '' }, { value: 'no_impact', label: 'No Impact' }],
      u_change_tested:         [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
      u_impacted_persons_aware:[{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
      u_performed_previously:  [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
      u_success_probability:   [{ value: '', label: '' }, { value: '100', label: '100%' }],
      u_can_be_backed_out:     [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
    },
    isLoadingChoices:   mockSnowChoiceConfig.isLoadingChoices,
    areChoicesFromSnow: !mockSnowChoiceConfig.isFetchFailed && !mockSnowChoiceConfig.isLoadingChoices,
    isFetchFailed:      mockSnowChoiceConfig.isFetchFailed,
    fetchErrorMessage:  mockSnowChoiceConfig.isFetchFailed ? 'SNow relay fetch failed: 401' : null,
    isRelayConnected:   mockSnowChoiceConfig.isRelayConnected,
    hasRelaySessionToken: mockSnowChoiceConfig.hasRelaySessionToken,
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
    relEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...EMPTY_SNOW_REFERENCE } },
    prdEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...EMPTY_SNOW_REFERENCE } },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { ...EMPTY_SNOW_REFERENCE } },
    changeTasks: [],
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
    mockActions.cloneCtaskTemplate.mockResolvedValue({
      shortDescription: 'Validate cloned deployment',
      description:      'Run cloned CTASK validation steps.',
      assignmentGroup:  { sysId: 'grp-clone', displayName: 'Clone Team' },
      assignedTo:       { sysId: 'usr-clone', displayName: 'Clone User' },
      plannedStartDate: '2026-01-03T10:00',
      plannedEndDate:   '2026-01-03T11:00',
      closeNotes:       'Cloned task complete.',
    });
    // Reset the choice options config so tests don't bleed state into each other.
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isLoadingChoices = false;
    mockSnowChoiceConfig.isRelayConnected = true;
    mockSnowChoiceConfig.hasRelaySessionToken = true;
    mockSnowChoiceConfig.hasChoiceOptions = true;
    mockTemplates.splice(0, mockTemplates.length);
    mockPinnedFields.splice(0, mockPinnedFields.length);
    mockCtaskTemplates.splice(0, mockCtaskTemplates.length);
    Object.values(mockTemplateActions).forEach((mockAction) => mockAction.mockReset());
    Object.values(mockFieldPinActions).forEach((mockAction) => mockAction.mockReset());
    mockFieldPinActions.getPinnedFields.mockImplementation((fieldKey: string) => (
      mockPinnedFields.filter((pinnedField) => pinnedField.key === fieldKey)
    ));
    mockFieldPinActions.findPinnedField.mockImplementation((fieldKey: string, fieldValue: unknown) => (
      mockPinnedFields.find((pinnedField) => (
        pinnedField.key === fieldKey && JSON.stringify(pinnedField.value) === JSON.stringify(fieldValue)
      ))
    ));
    Object.values(mockCtaskTemplateActions).forEach((mockAction) => mockAction.mockReset());
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

  it('renders the environment mapping cards on step 5', () => {
    mockState.currentStep = 5;

    render(<CrgTab />);

    expect(screen.getByRole('combobox', { name: 'ServiceNow Environment' })).toBeInTheDocument();
    expect(screen.getByText('REL')).toBeInTheDocument();
    expect(screen.getByText('PRD')).toBeInTheDocument();
    expect(screen.getByText('PFIX')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-rel-config-item')).toBeInTheDocument();
  });

  it('allows all environment rows to be selected or unselected on step 5', () => {
    mockState.currentStep = 5;

    render(<CrgTab />);

    expect(screen.getByRole('checkbox', { name: 'REL enabled' })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'PRD enabled' })).not.toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'PFIX enabled' })).not.toBeDisabled();
  });

  it('maps selected PRD environment to the live SNow environment choice on step 5', async () => {
    const user = userEvent.setup();
    mockState.currentStep = 5;

    render(<CrgTab />);

    await user.click(screen.getByRole('checkbox', { name: 'PRD enabled' }));

    expect(mockActions.updateEnvironment).toHaveBeenCalledWith('prd', { isEnabled: true });
    expect(mockActions.setChgBasicInfo).toHaveBeenCalledWith({ environment: 'prod' });
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

  it('adds a selected CTASK template to the change from configuration mode', async () => {
    const user = userEvent.setup();
    mockCtaskTemplates.push(DEFAULT_CTASK_TEMPLATE);

    render(<CrgTab mode="configuration" />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Select CTASK template' }), 'ctask-template-001');
    await user.click(screen.getByRole('button', { name: 'Add CTASK to Change' }));

    expect(mockActions.addChangeTask).toHaveBeenCalledWith(DEFAULT_CTASK_TEMPLATE);
  });

  it('saves the current CTASK editor values as a reusable template from configuration mode', async () => {
    const user = userEvent.setup();

    render(<CrgTab mode="configuration" />);

    await user.click(screen.getByRole('button', { name: '+ Create CTASK template' }));
    await user.type(screen.getByRole('textbox', { name: 'CTASK template name' }), 'Smoke Test');
    await user.type(screen.getByRole('textbox', { name: 'CTASK short description' }), 'Run smoke tests');
    await user.click(screen.getByRole('button', { name: 'Save CTASK Template' }));

    expect(mockCtaskTemplateActions.saveTemplate).toHaveBeenCalledWith(
      'Smoke Test',
      expect.objectContaining({ shortDescription: 'Run smoke tests' }),
    );
  });

  it('removes a selected CTASK from the pending change task list in configuration mode', async () => {
    const user = userEvent.setup();
    mockState.changeTasks = [DEFAULT_CTASK_TEMPLATE];

    render(<CrgTab mode="configuration" />);

    expect(screen.getByText('Validate production deployment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove CTASK Validate production deployment' }));

    expect(mockActions.removeChangeTask).toHaveBeenCalledWith('ctask-template-001');
  });

  it('appends selected CTASKs to an existing CHG from configuration mode', async () => {
    const user = userEvent.setup();
    mockState.changeTasks = [DEFAULT_CTASK_TEMPLATE];

    render(<CrgTab mode="configuration" />);

    await user.type(screen.getByRole('textbox', { name: 'Existing CHG for CTASK append' }), 'chg0001234');
    await user.click(screen.getByRole('button', { name: 'Append CTASKs to Existing CHG' }));

    expect(mockActions.appendTasksToExistingChg).toHaveBeenCalledWith('CHG0001234');
  });

  it('creates a CTASK template draft by cloning an existing CTASK in configuration mode', async () => {
    const user = userEvent.setup();

    render(<CrgTab mode="configuration" />);

    await user.type(screen.getByRole('textbox', { name: 'Existing CTASK for template clone' }), 'ctask0001234');
    await user.click(screen.getByRole('button', { name: 'Load CTASK as Template' }));

    await waitFor(() => {
      expect(mockActions.cloneCtaskTemplate).toHaveBeenCalledWith('CTASK0001234');
    });
    expect(screen.getByRole('status')).toHaveTextContent('CTASK0001234 loaded into the CTASK template editor.');
    expect(screen.getByRole('textbox', { name: 'CTASK template name' })).toHaveValue('Validate cloned deployment');
    expect(screen.getByRole('textbox', { name: 'CTASK short description' })).toHaveValue('Validate cloned deployment');

    await user.click(screen.getByRole('button', { name: 'Save CTASK Template' }));

    expect(mockCtaskTemplateActions.saveTemplate).toHaveBeenCalledWith(
      'Validate cloned deployment',
      expect.objectContaining({
        shortDescription: 'Validate cloned deployment',
        assignmentGroup:  { sysId: 'grp-clone', displayName: 'Clone Team' },
      }),
    );
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

  it('renders the clone-from-CHG input and Load CHG button in configuration mode', () => {
    render(<CrgTab mode="configuration" />);

    expect(screen.getByRole('textbox', { name: 'Existing CHG number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load CHG' })).toBeInTheDocument();
  });

  it('shows the shared clone/template/defaults workspace in configuration mode', () => {
    render(<CrgTab mode="configuration" />);

    expect(screen.getByRole('heading', { name: 'Clone, Templates & Defaults' })).toBeInTheDocument();
    expect(screen.getByText('No CHG templates saved yet.')).toBeInTheDocument();
    expect(screen.getByText(/No field options saved yet\./)).toBeInTheDocument();
  });

  it('does not show the configuration workspace inside the wizard flow', () => {
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.queryByRole('heading', { name: 'Clone, Templates & Defaults' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Save current Steps 3-5 as template' })).not.toBeInTheDocument();
  });

  it('reveals the template name input when "Save as template" is clicked', async () => {
    const user = userEvent.setup();
    render(<CrgTab mode="configuration" />);

    await user.click(screen.getByRole('button', { name: '+ Save current Steps 3-5 as template' }));

    expect(screen.getByRole('textbox', { name: 'CHG template name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('saves current change details and environment schedules as a template', async () => {
    const user = userEvent.setup();
    mockState.chgBasicInfo = { ...mockState.chgBasicInfo, category: 'software', environment: 'prod' };
    mockState.relEnvironment = { isEnabled: true, plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00', configItem: { ...EMPTY_SNOW_REFERENCE } };

    render(<CrgTab mode="configuration" />);

    await user.click(screen.getByRole('button', { name: '+ Save current Steps 3-5 as template' }));
    await user.type(screen.getByRole('textbox', { name: 'CHG template name' }), 'Release Defaults');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockTemplateActions.saveTemplate).toHaveBeenCalledWith(
      'Release Defaults',
      expect.objectContaining({
        chgBasicInfo:   expect.objectContaining({ category: 'software', environment: 'prod' }),
        relEnvironment: expect.objectContaining({ isEnabled: true, plannedStartDate: '2026-01-01T10:00' }),
      }),
    );
  });

  it('updates the selected saved template from the current form state', async () => {
    const user = userEvent.setup();
    mockState.chgBasicInfo = { ...mockState.chgBasicInfo, category: 'software', environment: 'prod' };
    mockState.prdEnvironment = { isEnabled: true, plannedStartDate: '2026-01-02T10:00', plannedEndDate: '2026-01-02T11:00', configItem: { ...EMPTY_SNOW_REFERENCE } };
    mockTemplates.push({
      id: 'tpl-001',
      name: 'Release Defaults',
      createdAt: '2026-01-01T00:00:00.000Z',
      chgBasicInfo: DEFAULT_BASIC_INFO,
      chgPlanningAssessment: DEFAULT_PLANNING_ASSESSMENT,
      chgPlanningContent: DEFAULT_PLANNING_CONTENT,
    });

    render(<CrgTab mode="configuration" />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Select CHG template' }), 'tpl-001');
    await user.click(screen.getAllByRole('button', { name: 'Update selected' })[0]);

    expect(mockTemplateActions.updateTemplate).toHaveBeenCalledWith(
      'tpl-001',
      expect.objectContaining({
        chgBasicInfo:   expect.objectContaining({ category: 'software', environment: 'prod' }),
        prdEnvironment: expect.objectContaining({ isEnabled: true, plannedStartDate: '2026-01-02T10:00' }),
      }),
    );
  });

  it('shows the Category dropdown on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
  });

  it('does not show the ServiceNow Environment mapping on step 3', () => {
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.queryByRole('combobox', { name: 'ServiceNow Environment' })).not.toBeInTheDocument();
  });

  it('normalizes legacy display labels to SNow internal choice values after choices load', async () => {
    mockState.currentStep = 3;
    mockState.chgBasicInfo = {
      ...mockState.chgBasicInfo,
      category:    'Software',
      changeType:  'Normal',
      environment: 'Production',
    };
    mockState.chgPlanningAssessment = {
      ...mockState.chgPlanningAssessment,
      impact: '3 - Low',
    };

    render(<CrgTab />);

    await waitFor(() => {
      expect(mockActions.setChgBasicInfo).toHaveBeenCalledWith({
        category:    'software',
        changeType:  'normal',
        environment: 'prod',
      });
    });
    expect(mockActions.setChgPlanningAssessment).toHaveBeenCalledWith({ impact: '3' });
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

  it('keeps step 3 values editable when choice fetch fails', () => {
    mockSnowChoiceConfig.isFetchFailed = true;
    mockSnowChoiceConfig.isRelayConnected = true;
    mockState.currentStep = 3;
    render(<CrgTab />);

    // Warning must describe the fetch failure (not a "relay not connected" message).
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load dropdown options/);
    // Retry button must be present so the user can re-trigger without reloading the page.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The field stays editable so cloned/template values are not trapped behind blocked metadata.
    const categoryInput = screen.getByRole('textbox', { name: 'Category' });
    fireEvent.change(categoryInput, { target: { value: 'software' } });
    expect(mockActions.setChgBasicInfo).toHaveBeenLastCalledWith({ category: 'software' });
    expect(screen.getByText(/saved field options shown inline below/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Category' })).not.toBeInTheDocument();
  });

  it('keeps step 3 values editable when relay is disconnected', () => {
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isRelayConnected = false;
    mockState.currentStep = 3;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/SNow relay not connected/);
    expect(screen.getByRole('textbox', { name: 'Category' })).toBeEnabled();
  });

  it('uses manual planning inputs when live SNow options are unavailable', async () => {
    const user = userEvent.setup();
    mockSnowChoiceConfig.hasChoiceOptions = false;
    mockState.currentStep = 4;

    render(<CrgTab />);

    const impactInput = screen.getByRole('textbox', { name: 'Impact' });
    expect(impactInput).toBeEnabled();
    await user.clear(impactInput);
    await user.type(impactInput, '1');
    expect(mockActions.setChgPlanningAssessment).toHaveBeenLastCalledWith({ impact: '1' });
    expect(screen.getByText(/Live planning choices are unavailable/i)).toBeInTheDocument();
  });

  it('keeps step 4 values editable when choice fetch fails', () => {
    mockSnowChoiceConfig.isFetchFailed = true;
    mockSnowChoiceConfig.isRelayConnected = true;
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load dropdown options/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Impact' })).toBeEnabled();
  });

  it('keeps step 4 values editable when relay is disconnected', () => {
    mockSnowChoiceConfig.isFetchFailed = false;
    mockSnowChoiceConfig.isRelayConnected = false;
    mockState.currentStep = 4;
    render(<CrgTab />);

    expect(screen.getByRole('alert')).toHaveTextContent(/SNow relay not connected/);
    expect(screen.getByRole('textbox', { name: 'Impact' })).toBeEnabled();
  });

  it('uses a manual ServiceNow Environment input when environment options are unavailable', () => {
    mockSnowChoiceConfig.hasChoiceOptions = false;
    mockState.currentStep = 5;
    mockState.chgBasicInfo.environment = '';

    render(<CrgTab />);

    const environmentInput = screen.getByRole('textbox', { name: 'ServiceNow Environment' });
    expect(environmentInput).toBeEnabled();
    fireEvent.change(environmentInput, { target: { value: 'prd' } });
    expect(mockActions.setChgBasicInfo).toHaveBeenLastCalledWith({ environment: 'prd' });
    expect(screen.getByText(/Live SNow environment choices are unavailable\./)).toBeInTheDocument();
  });

  it('pins boolean and reference values from step fields', async () => {
    const user = userEvent.setup();
    mockState.chgBasicInfo = {
      ...mockState.chgBasicInfo,
      assignmentGroup: { sysId: 'group-123', displayName: 'Release Managers' },
      isExpedited: true,
    };

    render(<CrgTab mode="configuration" />);

    await user.click(screen.getByRole('button', { name: 'Save Assignment Group' }));
    await user.click(screen.getByRole('button', { name: 'Save Expedited Change' }));

    expect(mockFieldPinActions.upsertPin).toHaveBeenNthCalledWith(1, expect.objectContaining({
      key: 'chgBasicInfo.assignmentGroup',
      label: 'Assignment Group',
      section: 'Change Details',
      value: { sysId: 'group-123', displayName: 'Release Managers' },
    }));
    expect(mockFieldPinActions.upsertPin).toHaveBeenNthCalledWith(2, expect.objectContaining({
      key: 'chgBasicInfo.isExpedited',
      label: 'Expedited Change',
      section: 'Change Details',
      value: true,
    }));
  });

  it('applies saved field options from inline selectors and clears them from the workspace', async () => {
    const user = userEvent.setup();
    mockPinnedFields.push(
      { id: 'chgBasicInfo.category:string:software', key: 'chgBasicInfo.category', label: 'Category', section: 'Change Details', value: 'software' },
      { id: 'chgBasicInfo.assignmentGroup:reference:group-001|Release Managers', key: 'chgBasicInfo.assignmentGroup', label: 'Assignment Group', section: 'Change Details', value: { sysId: 'group-001', displayName: 'Release Managers' } },
    );

    render(<CrgTab mode="configuration" />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Pinned Category values' }), 'chgBasicInfo.category:string:software');
    expect(mockActions.setChgBasicInfo).toHaveBeenCalledWith({ category: 'software' });

    await user.click(screen.getByRole('button', { name: 'Clear all saved options' }));
    expect(mockFieldPinActions.clearPins).toHaveBeenCalled();
  });
});
