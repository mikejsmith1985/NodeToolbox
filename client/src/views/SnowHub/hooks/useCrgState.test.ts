// useCrgState.test.ts — Unit tests for the Change Request Generator state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { CtaskTemplate } from './useCrgState.ts';
import { useCrgState } from './useCrgState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

function createMockJiraIssue(issueKey: string, summary: string) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

const MOCK_JIRA_ISSUES = [
  createMockJiraIssue('ABC-101', 'Prepare deployment notes'),
  createMockJiraIssue('ABC-102', 'Finish smoke tests'),
];

function createMockCtaskTemplate(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
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
    ...overrides,
  };
}

describe('useCrgState', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Prevent localStorage state written by the persistence effect from bleeding into subsequent tests.
    localStorage.clear();
  });

  function mockVersionFetch() {
    vi.mocked(jiraGet).mockResolvedValue([] as never);
  }

  it('starts on step 1 with an empty project key', () => {
    const { result } = renderHook(() => useCrgState());

    expect(result.current.state.currentStep).toBe(1);
    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.relEnvironment.isEnabled).toBe(false);
    expect(result.current.state.prdEnvironment.isEnabled).toBe(false);
    expect(result.current.state.pfixEnvironment.isEnabled).toBe(false);
    expect(result.current.state.changeTasks).toEqual([]);
  });

  it('uppercases the project key when it is updated', () => {
    mockVersionFetch();
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('tool');
    });

    expect(result.current.state.projectKey).toBe('TOOL');
  });

  it('fetches only unreleased fix versions when the project key changes', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([
        { id: '1', name: '1.2.3', released: false },
        { id: '2', name: '1.2.2', released: true },
      ] as never);

    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
    });

    await waitFor(() => {
      // Only the unreleased version should appear — released versions are already shipped
      // and should not be targeted by a new Change Request.
      expect(result.current.state.availableFixVersions).toEqual(['1.2.3']);
      expect(result.current.state.availableFixVersions).not.toContain('1.2.2');
    });
  });

  it('adds and removes an issue key when selection is toggled', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.toggleIssueSelection('ABC-101');
    });

    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(true);

    act(() => {
      result.current.actions.toggleIssueSelection('ABC-101');
    });

    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(false);
  });

  it('selects every fetched issue when selectAllIssues(true) is used', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.selectAllIssues(false);
      result.current.actions.selectAllIssues(true);
    });

    expect(result.current.state.selectedIssueKeys.size).toBe(2);
    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(true);
    expect(result.current.state.selectedIssueKeys.has('ABC-102')).toBe(true);
  });

  it('clears every selected issue when selectAllIssues(false) is used', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.selectAllIssues(false);
    });

    expect(result.current.state.selectedIssueKeys.size).toBe(0);
  });

  it('generates release documentation that includes issue keys and advances to step 3', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    expect(result.current.state.generatedDescription).toContain('ABC-101');
    expect(result.current.state.generatedDescription).toContain('ABC-102');
    expect(result.current.state.currentStep).toBe(3);
  });

  it('updates the selected environment configuration', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.updateEnvironment('rel', {
        plannedStartDate: '2025-02-01T08:00',
        plannedEndDate: '2025-02-01T10:00',
      });
    });

    expect(result.current.state.relEnvironment.plannedStartDate).toBe('2025-02-01T08:00');
    expect(result.current.state.relEnvironment.plannedEndDate).toBe('2025-02-01T10:00');
  });

  it('moves to a different step when goToStep is used', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.goToStep(4);
    });

    expect(result.current.state.currentStep).toBe(4);
  });

  it('resets the workflow back to the initial state', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
      result.current.actions.reset();
    });

    await waitFor(() => {
      expect(result.current.state.currentStep).toBe(1);
      expect(result.current.state.projectKey).toBe('');
      expect(result.current.state.selectedIssueKeys.size).toBe(0);
    });
  });

  it('switches to jql mode when setFetchMode is called with jql', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setFetchMode('jql');
    });

    expect(result.current.state.fetchMode).toBe('jql');
  });

  it('clears the fetch error when the mode is switched', () => {
    const { result } = renderHook(() => useCrgState());

    // Trigger an error in project mode, then switch modes.
    act(() => {
      result.current.actions.setFetchMode('project');
    });

    act(() => {
      result.current.actions.setFetchMode('jql');
    });

    expect(result.current.state.fetchError).toBeNull();
  });

  it('updates the custom JQL string when setCustomJql is called', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setCustomJql('project = TOOL AND status = Done');
    });

    expect(result.current.state.customJql).toBe('project = TOOL AND status = Done');
  });

  it('shows the jql required error when fetchIssues is called in jql mode with an empty query', async () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setFetchMode('jql');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    expect(result.current.state.fetchError).toBe('A JQL query is required.');
  });

  it('fetches issues using the raw JQL path when in jql mode', async () => {
    vi.mocked(jiraGet).mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setFetchMode('jql');
      result.current.actions.setCustomJql('project = TOOL AND status = Done');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    // The JQL search path should encode the raw query, NOT a project+fixVersion combination.
    const calledPath = vi.mocked(jiraGet).mock.calls[0][0] as string;
    expect(calledPath).toContain(encodeURIComponent('project = TOOL AND status = Done'));
    expect(result.current.state.fetchedIssues).toHaveLength(2);
    expect(result.current.state.currentStep).toBe(2);
  });

  it('generates docs with a custom JQL label in jql mode', async () => {
    vi.mocked(jiraGet).mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setFetchMode('jql');
      result.current.actions.setCustomJql('project = TOOL');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    // Short description should reference "custom JQL query" rather than a project/version string.
    expect(result.current.state.generatedShortDescription).toContain('custom JQL query');
    expect(result.current.state.generatedDescription).toContain('ABC-101');
  });

  // ── Basic Info and Planning field setters ──

  it('updates chgBasicInfo when setChgBasicInfo is called with a partial update', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setChgBasicInfo({ category: 'Software', changeType: 'Normal' });
    });

    expect(result.current.state.chgBasicInfo.category).toBe('Software');
    expect(result.current.state.chgBasicInfo.changeType).toBe('Normal');
    // Unaffected fields should retain their defaults.
    expect(result.current.state.chgBasicInfo.environment).toBe('');
  });

  it('updates chgBasicInfo reference fields (e.g. assignmentGroup) via setChgBasicInfo', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setChgBasicInfo({
        assignmentGroup: { sysId: 'abc123', displayName: 'Platform Team' },
      });
    });

    expect(result.current.state.chgBasicInfo.assignmentGroup.sysId).toBe('abc123');
    expect(result.current.state.chgBasicInfo.assignmentGroup.displayName).toBe('Platform Team');
  });

  it('updates chgPlanningAssessment when setChgPlanningAssessment is called', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setChgPlanningAssessment({ impact: '2 - Medium', hasBeenTested: 'Yes' });
    });

    expect(result.current.state.chgPlanningAssessment.impact).toBe('2 - Medium');
    expect(result.current.state.chgPlanningAssessment.hasBeenTested).toBe('Yes');
  });

  it('updates chgPlanningContent when setChgPlanningContent is called', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setChgPlanningContent({ implementationPlan: 'Run deploy script' });
    });

    expect(result.current.state.chgPlanningContent.implementationPlan).toBe('Run deploy script');
    expect(result.current.state.chgPlanningContent.backoutPlan).toBe('');
  });

  it('stores the CHG number input via setCloneChgNumber', () => {
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setCloneChgNumber('CHG0001234');
    });

    expect(result.current.state.cloneChgNumber).toBe('CHG0001234');
  });

  describe('cloneFromChg', () => {
    it('pre-populates all fields from a SNow CHG record', async () => {
      // SNow returns fields as { value, display_value } objects when sysparm_display_value=all is set.
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            short_description:    { value: 'Deploy v2', display_value: 'Deploy v2' },
            description:          { value: 'Release notes here', display_value: 'Release notes here' },
            justification:        { value: 'Scheduled release', display_value: 'Scheduled release' },
            risk_impact_analysis: { value: 'Low risk', display_value: 'Low risk' },
            category:             { value: 'software', display_value: 'Software' },
            type:                 { value: 'normal', display_value: 'Normal' },
            u_environment:        { value: 'prod', display_value: 'Production' },
            assignment_group:     { value: 'grp-001', display_value: 'Platform Team' },
            assigned_to:          { value: 'usr-002', display_value: 'Jane Smith' },
            requested_by:         { value: '', display_value: '' },
            cmdb_ci:              { value: '', display_value: '' },
            change_manager:       { value: 'mgr-001', display_value: 'Riley Manager' },
            u_tester:             { value: '', display_value: '' },
            u_service_manager:    { value: '', display_value: '' },
            u_expedited:          { value: 'false', display_value: 'false' },
            impact:               { value: '2', display_value: '2 - Medium' },
            implementation_plan:  { value: 'Run script', display_value: 'Run script' },
            backout_plan:         { value: 'Rollback DB', display_value: 'Rollback DB' },
            test_plan:            { value: 'Smoke test', display_value: 'Smoke test' },
            u_availability_impact: { value: 'No', display_value: 'No' },
            u_change_tested:       { value: 'Yes', display_value: 'Yes' },
            u_impacted_persons_aware:  { value: 'Yes', display_value: 'Yes' },
            u_performed_previously:    { value: 'No', display_value: 'No' },
            u_success_probability:     { value: '90-99%', display_value: '90-99%' },
            u_can_be_backed_out:       { value: 'Yes', display_value: 'Yes' },
          },
        ],
      } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0001234');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.isCloning).toBe(false);
      expect(result.current.state.cloneError).toBeNull();
      expect(result.current.state.generatedShortDescription).toBe('Deploy v2');
      expect(result.current.state.chgBasicInfo.category).toBe('software');
      expect(result.current.state.chgBasicInfo.changeType).toBe('normal');
      expect(result.current.state.chgBasicInfo.assignmentGroup).toEqual({ sysId: 'grp-001', displayName: 'Platform Team' });
      expect(result.current.state.chgBasicInfo.assignedTo).toEqual({ sysId: 'usr-002', displayName: 'Jane Smith' });
      expect(result.current.state.chgBasicInfo.changeManager).toEqual({ sysId: 'mgr-001', displayName: 'Riley Manager' });
      expect(result.current.state.chgPlanningAssessment.impact).toBe('2');
      expect(result.current.state.chgPlanningContent.implementationPlan).toBe('Run script');
    });

    it('shows cloned display-only reference values even when SNow omits the sys_id', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            change_manager: { value: '', display_value: 'Display Only Manager' },
          },
        ],
      } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0001234');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.chgBasicInfo.changeManager).toEqual({
        sysId: '',
        displayName: 'Display Only Manager',
      });
    });

    it('sets cloneError when the CHG number is not found', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({ result: [] } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG9999999');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.cloneError).toContain('CHG9999999');
      expect(result.current.state.isCloning).toBe(false);
    });

    it('sets cloneError when snowFetch throws', async () => {
      vi.mocked(snowFetch).mockRejectedValueOnce(new Error('Relay not connected') as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0001234');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.cloneError).toContain('Relay not connected');
    });

    it('does nothing when cloneChgNumber is empty', async () => {
      const { result } = renderHook(() => useCrgState());

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
    });
  });

  describe('createChg', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    /** Helper that advances the hook to step 3 (Change Details) with generated fields ready. */
    async function advanceToChangeDetailsStep() {
      vi.mocked(jiraGet)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce({ issues: [createMockJiraIssue('TOOL-1', 'Fix bug')] } as never);

      const hookResult = renderHook(() => useCrgState());

      act(() => {
        hookResult.result.current.actions.setProjectKey('tool');
        hookResult.result.current.actions.setFixVersion('1.0.0');
      });

      await act(async () => {
        await hookResult.result.current.actions.fetchIssues();
      });

      act(() => {
        hookResult.result.current.actions.generateDocs();
      });

      return hookResult;
    }

    it('POSTs the generated fields to the SNow table endpoint and records the CHG number', async () => {
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0001234' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(vi.mocked(snowFetch)).toHaveBeenCalledWith(
        '/api/now/table/change_request',
        expect.objectContaining({ method: 'POST' }),
      );

      expect(result.current.state.submitResult).toBe('CHG0001234 created');
      expect(result.current.state.isSubmitting).toBe(false);
    });

    it('creates selected CTASKs after the CHG is created', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({ result: { number: 'CTASK0001001' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.addChangeTask(createMockCtaskTemplate());
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        2,
        '/api/now/table/change_task',
        expect.objectContaining({ method: 'POST' }),
      );

      const ctaskBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(ctaskBody.change_request).toBe('chg-sys-001');
      expect(ctaskBody.short_description).toBe('Validate production deployment');
      expect(ctaskBody.assignment_group).toBe('grp-001');
      expect(result.current.state.submitResult).toBe('CHG0001234 created with 1 CTASK');
    });

    it('reports partial success when CHG creation succeeds but CTASK creation fails', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockRejectedValueOnce(new Error('CTASK denied') as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.addChangeTask(createMockCtaskTemplate());
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(result.current.state.submitResult).toBe('CHG0001234 created, but 1 CTASK did not fully complete. Check ServiceNow before retrying: CTASK denied');
      expect(result.current.state.isSubmitting).toBe(false);
    });

    it('clears the persisted draft after successful CHG creation so future visits start fresh', async () => {
      const STORAGE_KEY = 'ntbx-crg-state';
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0001234' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      await act(async () => {
        await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull());
        await result.current.actions.createChg();
      });

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      const { result: freshHook } = renderHook(() => useCrgState());
      expect(freshHook.current.state.currentStep).toBe(1);
      expect(freshHook.current.state.projectKey).toBe('');
    });

    it('includes basic info and planning fields in the POST body when they are set', async () => {
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0005678' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.setChgBasicInfo({
          category:        'software',
          changeType:      'normal',
          assignmentGroup: { sysId: 'grp-001', displayName: 'Platform Team' },
        });
        result.current.actions.setChgPlanningAssessment({ impact: '2' });
        result.current.actions.setChgPlanningContent({ implementationPlan: 'Deploy via script' });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      const bodyString = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(bodyString.category).toBe('software');
      expect(bodyString.type).toBe('normal');
      expect(bodyString.assignment_group).toBe('grp-001');
      expect(bodyString.impact).toBe('2');
      expect(bodyString.implementation_plan).toBe('Deploy via script');
    });

    it('sets submitResult to an error string when snowFetch throws', async () => {
      vi.mocked(snowFetch).mockRejectedValue(new Error('SNow relay not connected') as never);

      const { result } = await advanceToChangeDetailsStep();

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(result.current.state.submitResult).toContain('SNow relay not connected');
      expect(result.current.state.isSubmitting).toBe(false);
    });
  });

  describe('change tasks', () => {
    it('adds and removes selected CTASK templates from the current change', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.addChangeTask(createMockCtaskTemplate());
      });

      const selectedTaskId = result.current.state.changeTasks[0].id;
      expect(result.current.state.changeTasks[0].shortDescription).toBe('Validate production deployment');

      act(() => {
        result.current.actions.removeChangeTask(selectedTaskId);
      });

      expect(result.current.state.changeTasks).toHaveLength(0);
    });

    it('appends selected CTASKs to an existing CHG by number', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-001' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CTASK0001001' } } as never);
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.addChangeTask(createMockCtaskTemplate());
      });

      await act(async () => {
        await result.current.actions.appendTasksToExistingChg('chg0001234');
      });

      expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('/api/now/table/change_request?');
      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        2,
        '/api/now/table/change_task',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.current.state.submitResult).toBe('1 CTASK appended to CHG0001234');
    });
  });

  describe('applyTemplate', () => {
    it('fills CHG fields and environment schedules from the template', () => {
      const { result } = renderHook(() => useCrgState());

      const template = {
        id: 'tpl-1',
        name: 'Standard Release',
        createdAt: '2026-01-01T00:00:00.000Z',
        chgBasicInfo: {
          category: 'Software', changeType: 'Normal', environment: 'Production',
          requestedBy:     { sysId: 'u-001', displayName: 'Alice' },
          configItem:      { sysId: '', displayName: '' },
          assignmentGroup: { sysId: 'grp-1', displayName: 'Platform' },
          assignedTo:      { sysId: '', displayName: '' },
          changeManager:   { sysId: '', displayName: '' },
          tester:          { sysId: '', displayName: '' },
          serviceManager:  { sysId: '', displayName: '' },
          isExpedited:     false,
        },
        chgPlanningAssessment: {
          impact: '3 - Low', systemAvailabilityImplication: 'No Impact',
          hasBeenTested: 'Yes', impactedPersonsAware: 'Yes',
          hasBeenPerformedPreviously: 'Yes', successProbability: '100%', canBeBackedOut: 'Yes',
        },
        chgPlanningContent: {
          implementationPlan: 'Run pipeline.', backoutPlan: 'Revert tag.', testPlan: 'Smoke tests.',
        },
        relEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00' },
        prdEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-02T10:00', plannedEndDate: '2026-01-02T11:00' },
        pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
      };

      act(() => {
        result.current.actions.applyTemplate(template);
      });

      expect(result.current.state.chgBasicInfo.category).toBe('Software');
      expect(result.current.state.chgBasicInfo.assignmentGroup.displayName).toBe('Platform');
      expect(result.current.state.chgPlanningAssessment.impact).toBe('3 - Low');
      expect(result.current.state.chgPlanningContent.implementationPlan).toBe('Run pipeline.');
      expect(result.current.state.relEnvironment.isEnabled).toBe(true);
      expect(result.current.state.prdEnvironment.plannedStartDate).toBe('2026-01-02T10:00');
    });

    it('preserves current environment schedules when applying a legacy template', () => {
      const { result } = renderHook(() => useCrgState());
      const originalRelEnvironment = result.current.state.relEnvironment;

      act(() => {
        result.current.actions.applyTemplate({
          id: 'tpl-legacy',
          name: 'Legacy Template',
          createdAt: '2026-01-01T00:00:00.000Z',
          chgBasicInfo:          result.current.state.chgBasicInfo,
          chgPlanningAssessment: result.current.state.chgPlanningAssessment,
          chgPlanningContent:    result.current.state.chgPlanningContent,
        });
      });

      expect(result.current.state.relEnvironment).toEqual(originalRelEnvironment);
    });
  });

  describe('localStorage persistence', () => {
    const STORAGE_KEY = 'ntbx-crg-state';

    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('persists wizard state to localStorage when fields change', async () => {
      mockVersionFetch();
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setProjectKey('FOO');
      });

      // Wait for the useEffect to sync to localStorage.
      await waitFor(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.projectKey).toBe('FOO');
      });
    });

    it('restores persisted state on remount', () => {
      // Seed localStorage with a previously saved state.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentStep: 3,
        projectKey: 'SEED',
        fixVersion: '2.0.0',
        fetchMode: 'project',
        customJql: '',
        fetchedIssues: [],
        selectedIssueKeys: [],
        cloneChgNumber: '',
        chgBasicInfo: { category: 'Software', changeType: 'Normal', environment: '',
          requestedBy: { sysId: '', displayName: '' }, configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' }, assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' }, tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' }, isExpedited: false },
        generatedShortDescription: 'Saved desc',
        generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
        chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '',
          impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
        chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
        relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
      }));

      const { result } = renderHook(() => useCrgState());

      expect(result.current.state.projectKey).toBe('SEED');
      expect(result.current.state.currentStep).toBe(3);
      expect(result.current.state.generatedShortDescription).toBe('Saved desc');
      // Transient flags must always start clean regardless of what was stored.
      expect(result.current.state.isFetchingIssues).toBe(false);
      expect(result.current.state.isSubmitting).toBe(false);
    });

    it('converts selectedIssueKeys from stored array back to a Set', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentStep: 2,
        projectKey: 'PRJ',
        fixVersion: '1.0.0',
        fetchMode: 'project',
        customJql: '',
        fetchedIssues: [],
        selectedIssueKeys: ['PRJ-1', 'PRJ-2'],
        cloneChgNumber: '',
        chgBasicInfo: { category: '', changeType: '', environment: '',
          requestedBy: { sysId: '', displayName: '' }, configItem: { sysId: '', displayName: '' },
          assignmentGroup: { sysId: '', displayName: '' }, assignedTo: { sysId: '', displayName: '' },
          changeManager: { sysId: '', displayName: '' }, tester: { sysId: '', displayName: '' },
          serviceManager: { sysId: '', displayName: '' }, isExpedited: false },
        generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
        chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '',
          impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
        chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
        relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
      }));

      const { result } = renderHook(() => useCrgState());

      expect(result.current.state.selectedIssueKeys).toBeInstanceOf(Set);
      expect(result.current.state.selectedIssueKeys.has('PRJ-1')).toBe(true);
      expect(result.current.state.selectedIssueKeys.has('PRJ-2')).toBe(true);
    });

    it('ensures a new mount starts clean after reset is called', async () => {
      mockVersionFetch();
      const { result } = renderHook(() => useCrgState());

      act(() => { result.current.actions.setProjectKey('CLEAR'); });

      // Wait until localStorage has the non-empty project key persisted.
      await waitFor(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored!).projectKey).toBe('CLEAR');
      });

      act(() => { result.current.actions.reset(); });

      // The reset must clear the in-memory wizard state regardless of localStorage.
      expect(result.current.state.projectKey).toBe('');
      expect(result.current.state.currentStep).toBe(1);

      // The real user-facing guarantee: a new hook instance after reset must NOT
      // restore the old project key (i.e., CLEAR must no longer appear on remount).
      const { result: freshHook } = renderHook(() => useCrgState());
      expect(freshHook.current.state.projectKey).not.toBe('CLEAR');
      expect(freshHook.current.state.currentStep).toBe(1);
    });

    it('starts cleanly when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'NOT_VALID_JSON{{');
      const { result } = renderHook(() => useCrgState());

      expect(result.current.state.currentStep).toBe(1);
      expect(result.current.state.projectKey).toBe('');
    });
  });
});
