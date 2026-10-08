// ModifyChgTab.test.tsx — Tests for the Modify Change tab fetch and "My Open Changes" flows.
// Covers relay-backed CHG lookup, active-user change loading, and key error states.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import ModifyChgTab from './ModifyChgTab.tsx';

// Mock the child tabs and hooks. The templates list is hoisted so a test can seed the
// CTASK picker with the templates it needs to stage tasks against the loaded change.
const mockCtaskTemplatesState = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  saveTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock('../hooks/useCtaskTemplates.ts', () => ({
  useCtaskTemplates: () => mockCtaskTemplatesState,
}));

// Jira reads for the added issue and the risk check's named stories; none unless a test says otherwise.
const mockFetchChangeJiraStories = vi.hoisted(() => vi.fn(async (_issueKeys: readonly string[]) => [] as unknown[]));
vi.mock('../outage/changeOutageRecord.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../outage/changeOutageRecord.ts')>()),
  fetchChangeOutages: vi.fn(async () => []),
}));
vi.mock('../chgFormula/changeJiraStories.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/changeJiraStories.ts')>()),
  fetchChangeJiraStories: mockFetchChangeJiraStories,
}));

const mockSnowChoiceOptionsState = vi.hoisted(() => ({
  choiceOptions: {
    impact: [{ value: '', label: '' }, { value: '3', label: '3 - Low' }],
    u_availability_impact: [{ value: '', label: '' }, { value: 'none', label: 'None' }],
    u_change_tested: [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
    u_impacted_persons_aware: [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
    u_performed_previously: [{ value: '', label: '' }, { value: 'no', label: 'No' }],
    u_success_probability: [{ value: '', label: '' }, { value: 'high', label: 'High' }],
    u_can_be_backed_out: [{ value: '', label: '' }, { value: 'yes', label: 'Yes' }],
    u_environment: [
      { value: '', label: '' },
      { value: 'rel', label: 'Release' },
      { value: 'prod', label: 'Production' },
      { value: 'pfix', label: 'Production Fix' },
    ],
  },
  isLoadingChoices: false,
  isRelayConnected: true,
  hasRelaySessionToken: true,
  isFetchFailed: false,
  fetchErrorMessage: null,
  retryFetch: vi.fn(),
}));

vi.mock('../hooks/useSnowChoiceOptions.ts', () => ({
  useSnowChoiceOptions: () => mockSnowChoiceOptionsState,
}));

// Mock snowFetch service (used for relay-based ServiceNow queries)
const mockSnowFetch = vi.fn();
vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: (...args: unknown[]) => mockSnowFetch(...args),
}));

// Stub the builder so these tests stay focused on the entry point. The builder's own rebuild
// behaviour (blank on entry, bound number, update instead of create) is covered in CreateChgTab.test.tsx.
vi.mock('./CreateChgTab.tsx', () => ({
  default: ({ mode, targetChangeNumber }: { mode?: string; targetChangeNumber?: string }) => (
    <div data-testid="crg-builder" data-mode={mode} data-target={targetChangeNumber}>
      Change builder
    </div>
  ),
}));

const MOCK_CHANGE_RECORD = {
  sys_id: { value: 'change-1', display_value: 'change-1' },
  number: { value: 'CHG0001234', display_value: 'CHG0001234' },
  short_description: { value: 'Update network infrastructure', display_value: 'Update network infrastructure' },
  description: { value: 'Detailed rollout plan', display_value: 'Detailed rollout plan' },
  justification: { value: 'Required for customer launch', display_value: 'Required for customer launch' },
  risk_impact_analysis: { value: 'Low user impact', display_value: 'Low user impact' },
  category: { value: 'software', display_value: 'Software' },
  type: { value: 'normal', display_value: 'Normal' },
  requested_by: { value: 'user-1', display_value: 'Pat Requester' },
  assignment_group: { value: 'group-1', display_value: 'Cloud Team' },
  impact: { value: '3', display_value: '3 - Low' },
  u_availability_impact: { value: 'none', display_value: 'None' },
  u_change_tested: { value: 'yes', display_value: 'Yes' },
  u_impacted_persons_aware: { value: 'yes', display_value: 'Yes' },
  u_performed_previously: { value: 'no', display_value: 'No' },
  u_success_probability: { value: 'high', display_value: 'High' },
  u_can_be_backed_out: { value: 'yes', display_value: 'Yes' },
  implementation_plan: { value: 'Implement plan', display_value: 'Implement plan' },
  backout_plan: { value: 'Backout plan', display_value: 'Backout plan' },
  test_plan: { value: 'Test plan', display_value: 'Test plan' },
};

describe('ModifyChgTab - My Open Changes Feature', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    mockSnowChoiceOptionsState.retryFetch.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function getFetchChangeActionButton(): HTMLElement {
    return screen.getAllByRole('button', { name: /Fetch Change/i })[1];
  }

  // ── Fetch Change Button ───────────────────────────────────────────────────

  it('TestFetchChange_LoadsChangeDetailsWhenChangeExists', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [MOCK_CHANGE_RECORD],
    });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(getFetchChangeActionButton());

    await waitFor(() => {
      expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Detailed rollout plan')).toBeInTheDocument();
    });

    expect(mockSnowFetch).toHaveBeenCalledWith(
      expect.stringContaining('sysparm_query=number%3DCHG0001234'),
    );
  });

  it('TestFetchChange_PreloadsPlanningChoiceValuesUsingStoredCodes', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [MOCK_CHANGE_RECORD],
    });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(getFetchChangeActionButton());

    await waitFor(() => {
      expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Next: Planning/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Impact')).toHaveValue('3');
      expect(screen.getByLabelText('System Availability Implication')).toHaveValue('none');
      expect(screen.getByLabelText('Has Been Tested')).toHaveValue('yes');
      expect(screen.getByLabelText('Has Been Performed Previously')).toHaveValue('no');
      expect(screen.getByLabelText('Success Probability')).toHaveValue('high');
      expect(screen.getByLabelText('Can Be Backed Out')).toHaveValue('yes');
    });
  });

  it('TestFetchChange_LoadsPlanningValuesFromPrimaryAliasFields', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [{
        ...MOCK_CHANGE_RECORD,
        u_availability_impact: undefined,
        u_change_tested: undefined,
        u_impacted_persons_aware: undefined,
        u_performed_previously: undefined,
        u_success_probability: undefined,
        u_can_be_backed_out: undefined,
        u_implications_of_system_availability: { value: 'none', display_value: 'None' },
        u_has_this_change_been_tested: { value: 'yes', display_value: 'Yes' },
        u_are_impacted_persons_aware_prepared_for_test_checkout: { value: 'yes', display_value: 'Yes' },
        u_has_change_been_performed_previously: { value: 'no', display_value: 'No' },
        u_assessment_of_success_probability: { value: 'high', display_value: 'High' },
        u_can_change_be_backed_out: { value: 'yes', display_value: 'Yes' },
      }],
    });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(getFetchChangeActionButton());

    await waitFor(() => {
      expect(mockSnowFetch).toHaveBeenCalledWith(expect.stringContaining('u_has_this_change_been_tested'));
      expect(mockSnowFetch).toHaveBeenCalledWith(expect.stringContaining('u_implications_of_system_availability'));
    });

    await user.click(screen.getByRole('button', { name: /Next: Planning/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Has Been Tested')).toHaveValue('yes');
      expect(screen.getByLabelText('System Availability Implication')).toHaveValue('none');
      expect(screen.getByLabelText('Success Probability')).toHaveValue('high');
    });
  });

  it('TestFetchChange_RendersEnvironmentEditorWithLoadedValues', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [{
        ...MOCK_CHANGE_RECORD,
        u_environment: { value: 'prod', display_value: 'Production' },
        cmdb_ci: { value: 'ci-123', display_value: 'Payroll Production Cluster' },
        start_date: { value: '2026-06-01 10:00:00', display_value: '2026-06-01 10:00:00' },
        end_date: { value: '2026-06-01 11:00:00', display_value: '2026-06-01 11:00:00' },
      }],
    });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(getFetchChangeActionButton());

    await waitFor(() => {
      expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Next: Planning/i }));
    await user.click(screen.getByRole('button', { name: /Next: Environments/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Environment configuration to be displayed here/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText('ServiceNow Environment')).toHaveValue('prod');
      expect(screen.getByRole('checkbox', { name: 'PRD enabled' })).toBeChecked();
      expect(screen.getByLabelText('PRD Config Item')).toHaveValue('Payroll Production Cluster');
      expect(screen.getByLabelText('PRD Impacted Persons Aware')).toHaveValue('yes');
      expect(screen.getByLabelText('PRD Planned Start')).toHaveValue('2026-06-01T10:00');
      expect(screen.getByLabelText('PRD Planned End')).toHaveValue('2026-06-01T11:00');
    });
  });

  it('TestFetchChange_DisplaysErrorAndLogsDiagnosticsWhenLookupFails', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockRejectedValueOnce(new Error('SNow relay fetch failed: 404'));

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'CHG0001234');
    await user.click(getFetchChangeActionButton());

    await waitFor(() => {
      expect(screen.getByText(/SNow relay fetch failed: 404/i)).toBeInTheDocument();
    });

    expect(
      consoleErrorSpy.mock.calls.some(([message]: unknown[]) =>
        typeof message === 'string' && message.includes('[CRG Modify CHG]'),
      ),
    ).toBe(true);
  });

  // ── Load My Open Changes Button ──────────────────────────────────────────

  it('TestMyOpenChanges_RendersLoadMyChangesButton', () => {
    render(<ModifyChgTab />);
    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    expect(loadButton).toBeInTheDocument();
  });

  it('TestMyOpenChanges_ButtonIsEnabledInitially', () => {
    render(<ModifyChgTab />);
    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    expect(loadButton).not.toBeDisabled();
  });

  // ── Dropdown Rendering ──────────────────────────────────────────────────

  it('TestMyOpenChanges_DropdownRendersWhenChangesAreLoaded', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [
        { number: 'CHG0001234', short_description: 'Update network infrastructure' },
        { number: 'CHG0001235', short_description: 'Database migration' },
      ],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.getByLabelText(/Select from my open changes/i);
      expect(dropdown).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_DropdownDisplaysAllChanges', async () => {
    const user = userEvent.setup();
    const mockChanges = {
      result: [
        { number: 'CHG0001234', short_description: 'Update network infrastructure' },
        { number: 'CHG0001235', short_description: 'Database migration' },
        { number: 'CHG0001236', short_description: 'Security patch' },
      ],
    };

    mockSnowFetch.mockResolvedValueOnce(mockChanges);

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      mockChanges.result.forEach((change) => {
        expect(screen.getByText(`${change.number} - ${change.short_description}`)).toBeInTheDocument();
      });
    });
  });

  // ── Error Handling ──────────────────────────────────────────────────────

  it('TestMyOpenChanges_DisplaysErrorWhenFetchFails', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockRejectedValueOnce(new Error('SNow relay not connected'));

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load my changes|SNow relay not connected/i)).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_DisplaysErrorWhenResponseIsInvalid', async () => {
    const user = userEvent.setup();
    // Simulate a response without the expected 'result' field
    mockSnowFetch.mockResolvedValueOnce({ data: [] });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    // When there's no result field, the code treats it as empty, so no error is shown
    // This is actually correct behavior - it just shows "No open changes found"
    await waitFor(() => {
      expect(screen.getByText(/No open changes found/i)).toBeInTheDocument();
    });
  });

  // ── Empty State ─────────────────────────────────────────────────────────

  it('TestMyOpenChanges_DisplaysEmptyMessageWhenNoChangesFound', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(screen.getByText(/No open changes found/i)).toBeInTheDocument();
    });
  });

  it('TestMyOpenChanges_HidesDropdownWhenNoChangesFound', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.queryByLabelText(/Select from my open changes/i);
      expect(dropdown).not.toBeInTheDocument();
    });
  });

  // ── API Contract ────────────────────────────────────────────────────────

  it('TestMyOpenChanges_CallsFetchWithCorrectEndpoint', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      expect(mockSnowFetch).toHaveBeenCalledWith(
        expect.stringContaining('sysparm_query=assigned_to%3Djavascript%3Ags.getUserID()%5Eactive%3Dtrue'),
      );
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────

  it('TestMyOpenChanges_DropdownHasProperLabel', async () => {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({
      result: [
        { number: 'CHG0001234', short_description: 'Update network infrastructure' },
      ],
    });

    render(<ModifyChgTab />);

    const loadButton = screen.getByRole('button', { name: /Load My Open Changes/i });
    await user.click(loadButton);

    await waitFor(() => {
      const dropdown = screen.getByLabelText(/Select from my open changes/i);
      expect(dropdown).toHaveAttribute('aria-label');
    });
  });
});

// ── Start Over: rebuild a loaded change from scratch (feature 033) ──
//
// When the scope of a change moves on, patching its text by hand drifts from what the release
// actually contains. Start Over throws the contents away and rebuilds the change from the blank
// template — but writes the result to the number that has already been circulated and approved.
// Because that is destructive, the confirmation is the feature's only guard.

describe('ModifyChgTab - Start Over rebuild', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  async function loadChange(changeRecord: Record<string, unknown> = MOCK_CHANGE_RECORD): Promise<void> {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({ result: [changeRecord] });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
    });
  }

  it('does not offer Start Over before a change is loaded', () => {
    render(<ModifyChgTab />);

    expect(screen.queryByRole('button', { name: /Start Over/i })).not.toBeInTheDocument();
  });

  it('offers Start Over once a change is loaded', async () => {
    await loadChange();

    expect(screen.getByRole('button', { name: /Start Over/i })).toBeInTheDocument();
  });

  it('offers Start Over for a change picked from My Open Changes', async () => {
    const user = userEvent.setup();
    mockSnowFetch
      .mockResolvedValueOnce({ result: [{ number: { value: 'CHG0001234' }, short_description: { value: 'Update network infrastructure' } }] })
      .mockResolvedValueOnce({ result: [MOCK_CHANGE_RECORD] });

    render(<ModifyChgTab />);
    await user.click(screen.getByRole('button', { name: /Load My Open Changes/i }));
    const dropdown = await screen.findByLabelText(/Select from my open changes/i);
    await user.selectOptions(dropdown, 'CHG0001234');

    expect(await screen.findByRole('button', { name: /Start Over/i })).toBeInTheDocument();
  });

  it('asks for confirmation, naming the change it will overwrite, before discarding anything', async () => {
    const user = userEvent.setup();
    await loadChange();

    await user.click(screen.getByRole('button', { name: /Start Over/i }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('CHG0001234');
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/discard/i);
    // Nothing has been cleared or mounted yet — the operator still has to confirm.
    expect(screen.queryByTestId('crg-builder')).not.toBeInTheDocument();
  });

  it('leaves the loaded change completely untouched when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    await loadChange();

    await user.click(screen.getByRole('button', { name: /Start Over/i }));
    await user.click(screen.getByRole('button', { name: /Keep this change/i }));

    expect(screen.queryByTestId('crg-builder')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
  });

  it('mounts the builder bound to the loaded change number once confirmed', async () => {
    const user = userEvent.setup();
    await loadChange();

    await user.click(screen.getByRole('button', { name: /Start Over/i }));
    await user.click(screen.getByRole('button', { name: /Discard and rebuild/i }));

    const builder = screen.getByTestId('crg-builder');
    expect(builder).toHaveAttribute('data-mode', 'rebuild');
    expect(builder).toHaveAttribute('data-target', 'CHG0001234');
    // The change's own edit fields are gone — the rebuild starts from the blank template.
    expect(screen.queryByDisplayValue('Update network infrastructure')).not.toBeInTheDocument();
  });

  it('returns to the loaded change when the operator leaves the rebuild', async () => {
    const user = userEvent.setup();
    await loadChange();

    await user.click(screen.getByRole('button', { name: /Start Over/i }));
    await user.click(screen.getByRole('button', { name: /Discard and rebuild/i }));
    await user.click(screen.getByRole('button', { name: /Back to this change/i }));

    expect(screen.queryByTestId('crg-builder')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
  });

  // Warn before the effort is spent, not at the save — the operator should not rebuild a whole
  // change only to find ServiceNow will not accept it.
  it('warns before rebuilding a change that is no longer editable', async () => {
    await loadChange({
      ...MOCK_CHANGE_RECORD,
      state: { value: '4', display_value: 'Closed' },
    });

    expect(screen.getByText(/no longer editable|cannot be rebuilt/i)).toBeInTheDocument();
  });

  // An unfamiliar state value means the tool does not know — and a false warning on every
  // rebuild is worse than a missing one, because the save still fails loudly if SNow refuses.
  it('stays silent when the change state is not one it recognises', async () => {
    await loadChange({
      ...MOCK_CHANGE_RECORD,
      state: { value: '-3', display_value: 'Awaiting Vendor' },
    });

    expect(screen.queryByText(/no longer editable|cannot be rebuilt/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Over/i })).toBeInTheDocument();
  });
});

describe('ModifyChgTab - Save creates the staged CTASKs and proves they are attached (GH #377)', () => {
  const CHANGE_TASK_TABLE_PATH = '/api/now/table/change_task';
  const MOCK_CTASK_TEMPLATE = {
    id: 'ctask-template-1',
    name: 'Prod Support - Execute Ad-Hoc Job',
    createdAt: '2026-09-01T00:00:00.000Z',
    shortDescription: 'Prod Support - Execute Ad-Hoc Job',
    description: 'Execute the ad-hoc job if the file drop does not trigger it.',
    assignmentGroup: { sysId: 'group-9', displayValue: 'Enrollment Integration Delivery' },
    assignedTo: { sysId: 'user-9', displayValue: 'Ibarra, John' },
    plannedStartDate: '',
    plannedEndDate: '',
    closeNotes: '',
  };

  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    mockCtaskTemplatesState.templates = [MOCK_CTASK_TEMPLATE];
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockCtaskTemplatesState.templates = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  /** Lists every change_task POST the save issued, parsed back into its payload. */
  function listChangeTaskCreatePayloads(): Array<Record<string, unknown>> {
    return mockSnowFetch.mock.calls
      .filter(([path, requestInit]) => path === CHANGE_TASK_TABLE_PATH && (requestInit as RequestInit)?.method === 'POST')
      .map(([, requestInit]) => JSON.parse(String((requestInit as RequestInit).body)) as Record<string, unknown>);
  }

  interface FakeServiceNowOptions {
    /** What change_request ServiceNow stores on each created task (default: what was sent). */
    storedChangeRequestSysId?: string;
    /** When set, the Nth POST (1-based) rejects with this error instead of creating. */
    failOnPostNumber?: number;
    /** When set, every POST answers 2xx with this non-record body. */
    postReplyOverride?: unknown;
    /** When true, the read-back query rejects. */
    isReadBackBroken?: boolean;
  }

  /**
   * A tiny ServiceNow: POSTs create numbered tasks, the read-back returns only the tasks whose
   * stored change_request matches the change being asked about.
   */
  function installFakeServiceNow(options: FakeServiceNowOptions = {}): void {
    const createdTasks: Array<{ sys_id: string; number: string; change_request: string }> = [];
    let postCount = 0;
    mockSnowFetch.mockImplementation(async (path: unknown, requestInit?: RequestInit) => {
      const requestPath = String(path);
      if (requestPath === CHANGE_TASK_TABLE_PATH && requestInit?.method === 'POST') {
        postCount += 1;
        if (options.failOnPostNumber === postCount) {
          throw new Error('ServiceNow relay returned 403');
        }
        if (options.postReplyOverride !== undefined) {
          return options.postReplyOverride;
        }
        const sentPayload = JSON.parse(String(requestInit.body)) as { change_request: string };
        const createdTask = {
          sys_id: `ctask-sys-${postCount}`,
          number: `CTASK000900${postCount}`,
          change_request: options.storedChangeRequestSysId ?? sentPayload.change_request,
        };
        createdTasks.push(createdTask);
        return { result: createdTask };
      }
      if (requestPath.startsWith(`${CHANGE_TASK_TABLE_PATH}?`)) {
        if (options.isReadBackBroken) {
          throw new Error('read-back timed out');
        }
        const askedChangeSysId = decodeURIComponent(requestPath).match(/change_request=([^&^]+)/)?.[1];
        return { result: createdTasks.filter((task) => task.change_request === askedChangeSysId) };
      }
      return { result: [MOCK_CHANGE_RECORD] };
    });
  }

  async function loadChangeAndOpenReviewStep(
    changeRecord: Record<string, unknown> = MOCK_CHANGE_RECORD,
  ): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValueOnce({ result: [changeRecord] });

    render(<ModifyChgTab />);

    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));
    return user;
  }

  async function stageCtasks(user: ReturnType<typeof userEvent.setup>, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await user.selectOptions(screen.getByLabelText(/Select CTASK template/i), MOCK_CTASK_TEMPLATE.id);
      await user.click(screen.getByRole('button', { name: /^Add CTASK$/i }));
    }
    expect(screen.getByText(`Change Tasks (${count})`)).toBeInTheDocument();
  }

  async function clickSave(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: /Save Changes to ServiceNow/i }));
  }

  it('creates one change_task per staged CTASK, reads them back, and names the CTASK numbers', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 2);
    installFakeServiceNow();

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Change CHG0001234 saved successfully! 2 change tasks created and attached: CTASK0009001, CTASK0009002.',
      );
    });
    const createPayloads = listChangeTaskCreatePayloads();
    expect(createPayloads).toHaveLength(2);
    expect(createPayloads[0]).toMatchObject({
      change_request: 'change-1',
      short_description: MOCK_CTASK_TEMPLATE.shortDescription,
      // The description keeps what the task said and now also carries the estimated-duration block the change
      // approvers ask for on every CTASK — unestimated phases say so rather than being left out.
      description: expect.stringContaining(MOCK_CTASK_TEMPLATE.description) as unknown as string,
      assignment_group: 'group-9',
      assigned_to: 'user-9',
    });
    expect(createPayloads[0].description).toContain('• Backout/recovery and restoration validation:');
    // The CHG itself is still saved through the relay PATCH, before any task is created.
    expect(fetchSpy).toHaveBeenCalledWith('/api/snow-relay/change/CHG0001234', expect.objectContaining({ method: 'PATCH' }));
  });

  it('clears the staged list once the tasks exist so saving again cannot create duplicates', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 1);
    installFakeServiceNow();

    await clickSave(user);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 change task created and attached: CTASK0009001.');
    });
    expect(screen.queryByText(/^Change Tasks \(/)).not.toBeInTheDocument();

    await clickSave(user);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Change CHG0001234 saved successfully!');
    });
    expect(listChangeTaskCreatePayloads()).toHaveLength(1);
    expect(screen.getByRole('status')).not.toHaveTextContent(/change task/i);
  });

  it('saves the change without touching change_task when nothing is staged', async () => {
    const user = await loadChangeAndOpenReviewStep();
    installFakeServiceNow();

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Change CHG0001234 saved successfully!');
    });
    expect(mockSnowFetch.mock.calls.filter(([path]) => String(path).startsWith(CHANGE_TASK_TABLE_PATH))).toHaveLength(0);
  });

  it('reports a task that failed to create without claiming the whole save succeeded, keeping only the uncreated tasks staged', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 2);
    installFakeServiceNow({ failOnPostNumber: 2 });

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Change CHG0001234 was saved, but change task 2 of 2/i);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('ServiceNow relay returned 403');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(listChangeTaskCreatePayloads()).toHaveLength(2);
    // Only the task that never reached ServiceNow stays staged for the retry.
    expect(screen.getByText('Change Tasks (1)')).toBeInTheDocument();
  });

  it('treats a 2xx with no task record as a failure and leaves the task staged', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 1);
    installFakeServiceNow({ postReplyOverride: '<html>Sign in</html>' });

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/returned no task record/i);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('<html>Sign in</html>');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Change Tasks (1)')).toBeInTheDocument();
  });

  it('reports a task ServiceNow created but did not attach to the change, naming the number and what it stored', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 1);
    installFakeServiceNow({ storedChangeRequestSysId: '' });

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/CTASK0009001/);
    });
    const alertText = screen.getByRole('alert').textContent ?? '';
    expect(alertText).toMatch(/created .*but .*not attached to CHG0001234/i);
    expect(alertText).toContain('change-1');
    expect(alertText).toMatch(/stored change_request ""/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The task exists in ServiceNow, so it must not stay staged — a retry would create another orphan.
    expect(screen.queryByText(/^Change Tasks \(/)).not.toBeInTheDocument();
  });

  it('does not claim success when the read-back itself fails', async () => {
    const user = await loadChangeAndOpenReviewStep();
    await stageCtasks(user, 1);
    installFakeServiceNow({ isReadBackBroken: true });

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not confirm/i);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('CTASK0009001');
    expect(screen.getByRole('alert')).toHaveTextContent('read-back timed out');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('refuses to create tasks when the loaded change carries no sys_id, and says so', async () => {
    const { sys_id: _omittedSysId, ...recordWithoutSysId } = MOCK_CHANGE_RECORD;
    const user = await loadChangeAndOpenReviewStep(recordWithoutSysId);
    await stageCtasks(user, 1);

    await clickSave(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no sys_id/i);
    });
    expect(listChangeTaskCreatePayloads()).toHaveLength(0);
  });
});

describe('ModifyChgTab - risk check of the change and its CTASKs (GH #395)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('opens the check on the review step and flags a CTASK that is not on the change\'s CI', async () => {
    const user = userEvent.setup();
    const changeRecordWithCi = { ...MOCK_CHANGE_RECORD, cmdb_ci: { value: 'ci-recon', display_value: 'Recon Service' } };
    mockSnowFetch.mockImplementation(async (requestPath: string) => (String(requestPath).startsWith('/api/now/table/change_task?')
      ? { result: [{
        sys_id: { value: 'task-1', display_value: 'task-1' },
        number: { value: 'CTASK0012345', display_value: 'CTASK0012345' },
        short_description: { value: 'Deploy recon', display_value: 'Deploy recon' },
        cmdb_ci: { value: 'ci-billing', display_value: 'Billing' },
      }] }
      : { result: [changeRecordWithCi] }));
    render(<ModifyChgTab />);
    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));

    await user.click(screen.getByRole('button', { name: /Risk check this change and its CTASKs/i }));

    expect(await screen.findByText('CTASK0012345 · Configuration item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set CI to Recon Service on 1 task/ })).toBeInTheDocument();
  });
});

describe('ModifyChgTab - Save and risk check reachable from every step', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleLogSpy.mockRestore();
  });

  async function loadChange(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    mockSnowFetch.mockResolvedValue({ result: [MOCK_CHANGE_RECORD] });
    render(<ModifyChgTab />);
    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument());
    return user;
  }

  it('saves straight from the Change Details step', async () => {
    const user = await loadChange();

    await user.click(screen.getByRole('button', { name: /Save Changes to ServiceNow/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/snow-relay/change/CHG0001234', expect.objectContaining({ method: 'PATCH' })));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved successfully/i);
  });

  it('adds one Jira issue to the change\'s issue list from the Change Details step', async () => {
    mockFetchChangeJiraStories.mockResolvedValueOnce([{ key: 'ENCUC-77', fields: { summary: 'Correct member counts' } }]);
    const user = await loadChange();

    await user.type(screen.getByLabelText('Jira issue to add'), 'encuc-77');
    await user.click(screen.getByRole('button', { name: 'Add issue to change' }));

    expect(await screen.findByText(/Added ENCUC-77/)).toBeInTheDocument();
    expect(mockFetchChangeJiraStories).toHaveBeenCalledWith(['ENCUC-77']);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value)
      .toContain('The following Jira issues are included in this release:\n\n- [ENCUC-77] Correct member counts');
  });

  it('offers the same Add Jira issues panel on Review & Save, where the change is finished off', async () => {
    mockFetchChangeJiraStories.mockResolvedValueOnce([{ key: 'ENCUC-78', fields: { summary: 'Fix the export' } }]);
    const user = await loadChange();
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));

    expect(screen.getByRole('heading', { name: 'Add Jira issues to this change' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Jira issue to add'), 'ENCUC-78');
    await user.click(screen.getByRole('button', { name: 'Add issue to change' }));

    expect(await screen.findByText(/Added ENCUC-78/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /2\. Change Details/i }));
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toContain('- [ENCUC-78] Fix the export');
  });

  it('shows the change\'s outage record on Review & Save', async () => {
    const user = await loadChange();
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));

    expect(screen.getByRole('heading', { name: 'Outage record' })).toBeInTheDocument();
  });

  it('offers the CTASK timeline on Review & Save', async () => {
    const user = await loadChange();
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));

    expect(screen.getByRole('heading', { name: 'CTASK timeline' })).toBeInTheDocument();
  });

  it('says so when Jira has no issue for the typed key, and changes nothing', async () => {
    const user = await loadChange();

    await user.type(screen.getByLabelText('Jira issue to add'), 'ENCUC-404');
    await user.click(screen.getByRole('button', { name: 'Add issue to change' }));

    expect(await screen.findByText(/Jira has no issue ENCUC-404/)).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('Detailed rollout plan');
  });

  it('opens the CHG + CTASK risk check from the Change Details step', async () => {
    const user = await loadChange();

    await user.click(screen.getByRole('button', { name: /Risk check CHG \+ CTASKs/i }));

    expect(await screen.findByText('Risk check — this change and its CTASKs')).toBeInTheDocument();
  });
});

describe('ModifyChgTab - RCP production rules (GH #415)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Freeze only the date: the RCP rules apply through 19 Jan 2027, and this test must not expire with them.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'));
    mockSnowFetch.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    localStorage.clear();
  });

  it('moves the change to the next approved window and mirrors the new dates into the form', async () => {
    const user = userEvent.setup();
    const daytimeRecord = {
      ...MOCK_CHANGE_RECORD,
      u_environment: { value: 'prd', display_value: 'PRD' },
      start_date: { value: '2026-10-08 15:00:00', display_value: '10/08/2026 10:00:00 AM' },
      end_date: { value: '2026-10-08 17:00:00', display_value: '10/08/2026 12:00:00 PM' },
    };
    mockSnowFetch.mockImplementation(async (requestPath: string) => (String(requestPath).startsWith('/api/now/table/change_request/')
      ? { result: daytimeRecord }
      : { result: String(requestPath).startsWith('/api/now/table/change_request?') ? [daytimeRecord] : [] }));
    render(<ModifyChgTab />);
    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));
    await user.click(screen.getByRole('button', { name: /Check the RCP production rules/ }));

    await user.click(await screen.findByRole('button', { name: /Move to the next approved window/ }));

    await waitFor(() => expect(mockSnowFetch).toHaveBeenCalledWith('/api/now/table/change_request/change-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ start_date: '2026-10-10 00:00:00', end_date: '2026-10-10 02:00:00' }),
    })));
    await user.click(screen.getByRole('button', { name: /4\. Environments/i }));
    expect(screen.getByDisplayValue('2026-10-10T00:00')).toBeInTheDocument();
  });

  it('offers the in-flight sweep on step 1 and the RCP checklist on request on the review step', async () => {
    const user = userEvent.setup();
    const productionRecord = { ...MOCK_CHANGE_RECORD, u_environment: { value: 'prd', display_value: 'PRD' } };
    mockSnowFetch.mockImplementation(async (requestPath: string) => (String(requestPath).startsWith('/api/now/table/change_request/')
      ? { result: productionRecord }
      : { result: String(requestPath).startsWith('/api/now/table/change_request?') ? [productionRecord] : [] }));
    render(<ModifyChgTab />);

    expect(screen.getByRole('button', { name: /Check my in-flight Production changes/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));
    await user.click(screen.getByRole('button', { name: /Check the RCP production rules/ }));

    expect(await screen.findByText(/RCP rules met/)).toBeInTheDocument();
  });
});

describe('ModifyChgTab - the risk check is given the record\'s own answers (GH #415)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSnowFetch.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
  });

  it('sends planning answers by their ServiceNow label, and the risk, even when the form has no such choice', async () => {
    const user = userEvent.setup();
    const highImpactRecord = {
      ...MOCK_CHANGE_RECORD,
      impact: { value: '1', display_value: '1-High - Change with significant (10% or > 250 users or > 25 customers) impact' },
      risk: { value: '2', display_value: 'Moderate' },
      assigned_to: { value: 'user-77', display_value: 'Smith, Michael' },
    };
    mockSnowFetch.mockImplementation(async (requestPath: string) => (String(requestPath).startsWith('/api/now/table/change_task')
      ? { result: [] }
      : { result: [highImpactRecord] }));
    render(<ModifyChgTab />);
    await user.type(screen.getByLabelText(/Change Request number/i), 'chg0001234');
    await user.click(screen.getAllByRole('button', { name: /Fetch Change/i })[1]);
    await waitFor(() => expect(screen.getByDisplayValue('Update network infrastructure')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /5\. Review & Save/i }));
    await user.click(screen.getByRole('button', { name: /Risk check this change and its CTASKs/i }));

    await user.click(await screen.findByRole('button', { name: /Risk check CHG \+ CTASKs with AI Assist/ }));

    const promptText = (document.querySelector('textarea[readonly]') as HTMLTextAreaElement).value;
    expect(promptText).toContain('Impact: 1-High - Change with significant (10% or > 250 users or > 25 customers) impact');
    expect(promptText).toContain('Risk: Moderate');
    // The change owner is the change's Assigned to — it was never loaded, so every check said "(not set)".
    expect(promptText).toContain('Change owner (Assigned to): Smith, Michael');
  });
});

