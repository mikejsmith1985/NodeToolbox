// useCrgState.test.ts — Unit tests for the Change Request Generator state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { CrgTemplate, CtaskTemplate, CtaskTemplateData } from './useCrgState.ts';
import { reconcileStagedChangeTasks, useCrgState } from './useCrgState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

function createMockJiraIssue(issueKey: string, summary: string, issueTypeName = 'Story') {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: issueTypeName, iconUrl: 'story.png' },
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

  it('generates short description as Application - Team - FixVersion in project mode', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: [createMockJiraIssue('ABC-101', 'Prepare deployment notes')] } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setShortDescriptionConfig({
        application: 'Enrollment',
        team: 'Transformers',
      });
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    expect(result.current.state.generatedShortDescription).toBe('Enrollment - Transformers - 1.2.3');
  });

  it('uses change details override for short description when provided', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: [createMockJiraIssue('ABC-101', 'Prepare deployment notes')] } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setShortDescriptionConfig({
        application: 'Enrollment',
        team: 'Transformers',
        changeDetailsOverride: '6 Stories 3 Defects',
      });
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    expect(result.current.state.generatedShortDescription).toBe('Enrollment - Transformers - 6 Stories 3 Defects');
  });

  it('generates short description details from selected issue type counts in jql mode', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce({ issues: [
        createMockJiraIssue('ABC-101', 'Prepare deployment notes', 'Story'),
        createMockJiraIssue('ABC-102', 'Add fallback query', 'Story'),
        createMockJiraIssue('ABC-103', 'Fix relay error', 'Defect'),
      ] } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setFetchMode('jql');
      result.current.actions.setCustomJql('project = ABC AND status = Done');
      result.current.actions.setShortDescriptionConfig({
        application: 'Enrollment',
        team: 'Transformers',
      });
    });

    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    act(() => {
      result.current.actions.generateDocs();
    });

    expect(result.current.state.generatedShortDescription).toBe('Enrollment - Transformers - 2 Stories 1 Defect');
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

  it('generates docs with issue-type summary details in jql mode', async () => {
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

    // JQL mode details are now derived from selected issue type counts.
    expect(result.current.state.generatedShortDescription).toContain('2 Stories');
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
            u_custom_change_rule:       { value: '', display_value: 'CAB required' },
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
      expect(result.current.state.inspectedSnowFields).toContainEqual({
        fieldName: 'u_custom_change_rule',
        displayValue: 'CAB required',
        storedValue: '',
      });
      expect(result.current.state.inspectedSnowFields.some((snowField) => snowField.fieldName === 'impact')).toBe(false);
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

    it('uses alias change manager field names when cloning CHG data', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            u_change_manager: { value: 'mgr-200', display_value: 'Sharma, Raman' },
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
        sysId: 'mgr-200',
        displayName: 'Sharma, Raman',
      });
    });

    it('uses display values when custom SNow choice fields omit internal values', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            impact:                    { value: '1', display_value: '1 - High' },
            u_availability_impact:     { value: '', display_value: 'No Impact' },
            u_change_tested:           { value: '', display_value: 'Yes' },
            u_impacted_persons_aware:  { value: '', display_value: 'Yes' },
            u_performed_previously:    { value: '', display_value: 'No' },
            u_success_probability:     { value: '', display_value: '90-99%' },
            u_can_be_backed_out:       { value: '', display_value: 'Yes' },
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

      expect(result.current.state.chgPlanningAssessment).toEqual({
        impact:                        '1',
        systemAvailabilityImplication: 'No Impact',
        hasBeenTested:                 'Yes',
        impactedPersonsAware:          'Yes',
        hasBeenPerformedPreviously:    'No',
        successProbability:            '90-99%',
        canBeBackedOut:                'Yes',
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

    it('clones every change task from the source CHG and stages them for creation', async () => {
      // First call returns the CHG (now including its sys_id); the second returns the CHG's CTASKs.
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({
          result: [
            {
              sys_id:            { value: 'chg-sys-77', display_value: 'CHG0001234' },
              short_description: { value: 'Deploy v2', display_value: 'Deploy v2' },
            },
          ],
        } as never)
        .mockResolvedValueOnce({
          result: [
            {
              number:            { value: 'CTASK0000001', display_value: 'CTASK0000001' },
              short_description: { value: 'Implementation', display_value: 'Implementation' },
              description:       { value: 'Do the deploy', display_value: 'Do the deploy' },
              assignment_group:  { value: 'grp-1', display_value: 'Platform' },
              assigned_to:       { value: 'usr-1', display_value: 'Jane' },
              planned_start_date: { value: '', display_value: '' },
              planned_end_date:   { value: '', display_value: '' },
              close_notes:        { value: '', display_value: '' },
            },
            {
              // A closed task — clone-all copies it verbatim regardless of state.
              number:            { value: 'CTASK0000002', display_value: 'CTASK0000002' },
              short_description: { value: 'Closed task', display_value: 'Closed task' },
              description:       { value: '', display_value: '' },
              assignment_group:  { value: '', display_value: '' },
              assigned_to:       { value: '', display_value: '' },
              planned_start_date: { value: '', display_value: '' },
              planned_end_date:   { value: '', display_value: '' },
              close_notes:        { value: 'Already done', display_value: 'Already done' },
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

      expect(result.current.state.changeTasks).toHaveLength(2);
      expect(result.current.state.changeTasks.map((task) => task.name)).toEqual(['CTASK0000001', 'CTASK0000002']);
      expect(result.current.state.changeTasks[0].shortDescription).toBe('Implementation');
      expect(result.current.state.changeTasks[0].assignmentGroup).toEqual({ sysId: 'grp-1', displayName: 'Platform' });
      expect(result.current.state.changeTasks[1].closeNotes).toBe('Already done');
      // The CTASK query is scoped to the source CHG's sys_id.
      expect(vi.mocked(snowFetch).mock.calls[1][0]).toContain('/api/now/table/change_task?');
      expect(vi.mocked(snowFetch).mock.calls[1][0]).toContain('change_request%3Dchg-sys-77');
    });

    it('defaults reconcile-auto-CTASKs on and jumps to the review step when cloning', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({
          result: [
            {
              sys_id:            { value: 'chg-sys-88', display_value: 'CHG0007777' },
              short_description: { value: 'Hotfix', display_value: 'Hotfix' },
            },
          ],
        } as never)
        .mockResolvedValueOnce({ result: [] } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0007777');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      // Cloning means reproducing a change, so overwrite SNow's auto-created CTASKs and skip to Create.
      expect(result.current.state.reconcileAutoCtasks).toBe(true);
      expect(result.current.state.currentStep).toBe(6);
    });
  });

  describe('createChg', () => {
    beforeEach(() => {
      vi.mocked(snowFetch).mockImplementation(async (path) => {
        const requestPath = String(path);
        if (requestPath.includes('/api/now/table/change_task?')) {
          return { result: [] } as never;
        }
        if (requestPath.includes('/api/now/table/change_task/')) {
          return { result: { number: 'CTASK000AUTO' } } as never;
        }
        if (requestPath.includes('/api/now/table/change_task')) {
          return { result: { number: 'CTASK0001001' } } as never;
        }
        if (requestPath.includes('/api/now/table/change_request?')) {
          return { result: [{ sys_id: 'chg-sys-001' }] } as never;
        }
        return { result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never;
      });
    });

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
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never);

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

    it('creates one CHG per enabled environment using that environment configuration', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0002001', sys_id: 'chg-rel-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0002002', sys_id: 'chg-prd-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0002003', sys_id: 'chg-pfix-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.updateEnvironment('rel', {
          isEnabled: true,
          configItem: { sysId: 'ci-rel-001', displayName: 'REL CI' },
          impactedPersonsAware: 'rel-aware',
          plannedStartDate: '2025-02-01T08:00',
          plannedEndDate: '2025-02-01T09:00',
        });
        result.current.actions.updateEnvironment('prd', {
          isEnabled: true,
          configItem: { sysId: 'ci-prd-001', displayName: 'PRD CI' },
          impactedPersonsAware: 'prd-aware',
          plannedStartDate: '2025-02-02T08:00',
          plannedEndDate: '2025-02-02T09:00',
        });
        result.current.actions.updateEnvironment('pfix', {
          isEnabled: true,
          configItem: { sysId: 'ci-pfix-001', displayName: 'PFIX CI' },
          impactedPersonsAware: 'pfix-aware',
          plannedStartDate: '2025-02-03T08:00',
          plannedEndDate: '2025-02-03T09:00',
        });
      });

      await act(async () => {
        await result.current.actions.createChg({
          rel: 'rel-env',
          prd: 'prd-env',
          pfix: 'pfix-env',
        });
      });

      const createCalls = vi.mocked(snowFetch).mock.calls.filter(
        ([requestPath]) => requestPath === '/api/now/table/change_request',
      );

      expect(createCalls).toHaveLength(3);

      const relPayload = JSON.parse((createCalls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
      const prdPayload = JSON.parse((createCalls[1]?.[1] as RequestInit).body as string) as Record<string, unknown>;
      const pfixPayload = JSON.parse((createCalls[2]?.[1] as RequestInit).body as string) as Record<string, unknown>;

      expect(relPayload.u_environment).toBe('rel-env');
      expect(relPayload.cmdb_ci).toBe('ci-rel-001');
      expect(relPayload.u_impacted_persons_aware).toBe('rel-aware');
      expect(relPayload.planned_start_date).toBe('2025-02-01T08:00');
      expect(relPayload.planned_end_date).toBe('2025-02-01T09:00');

      expect(prdPayload.u_environment).toBe('prd-env');
      expect(prdPayload.cmdb_ci).toBe('ci-prd-001');
      expect(prdPayload.u_impacted_persons_aware).toBe('prd-aware');
      expect(prdPayload.planned_start_date).toBe('2025-02-02T08:00');
      expect(prdPayload.planned_end_date).toBe('2025-02-02T09:00');

      expect(pfixPayload.u_environment).toBe('pfix-env');
      expect(pfixPayload.cmdb_ci).toBe('ci-pfix-001');
      expect(pfixPayload.u_impacted_persons_aware).toBe('pfix-aware');
      expect(pfixPayload.planned_start_date).toBe('2025-02-03T08:00');
      expect(pfixPayload.planned_end_date).toBe('2025-02-03T09:00');
      expect(result.current.state.submitResult).toBe(
        '3 CHGs created: REL CHG0002001, PRD CHG0002002, PFIX CHG0002003',
      );
    });

    it('creates selected CTASKs after the CHG is created', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never)
        .mockResolvedValueOnce({ result: { number: 'CTASK0001001' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.addChangeTask(createMockCtaskTemplate());
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        3,
        '/api/now/table/change_task',
        expect.objectContaining({ method: 'POST' }),
      );

      const ctaskBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[2][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(ctaskBody.change_request).toBe('chg-sys-001');
      expect(ctaskBody.short_description).toBe('Validate production deployment');
      expect(ctaskBody.assignment_group).toBe('grp-001');
      expect(result.current.state.submitResult).toBe('CHG0001234 created with 1 CTASK');
    });

    it('reports partial success when CHG creation succeeds but CTASK creation fails', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never)
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

    it('patches the two auto-created ServiceNow CTASKs after CHG creation', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({
          result: [
            { sys_id: 'auto-ctask-001', number: 'CTASK0002001' },
            { sys_id: 'auto-ctask-002', number: 'CTASK0002002' },
          ],
        } as never)
        .mockResolvedValueOnce({ result: { number: 'CTASK0002001' } } as never)
        .mockResolvedValueOnce({ result: { number: 'CTASK0002002' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        3,
        '/api/now/table/change_task/auto-ctask-001',
        expect.objectContaining({ method: 'PATCH' }),
      );
      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        4,
        '/api/now/table/change_task/auto-ctask-002',
        expect.objectContaining({ method: 'PATCH' }),
      );

      const implementationPatchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[2][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      const technicalCheckoutPatchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[3][1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(implementationPatchBody.short_description).toBe('Enrollment - AWS - ENV');
      expect(technicalCheckoutPatchBody.short_description).toBe('Technical Checkout');
      expect(typeof technicalCheckoutPatchBody.description).toBe('string');
    });

    it('clears the persisted draft after successful CHG creation so future visits start fresh', async () => {
      const STORAGE_KEY = 'ntbx-crg-state';
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234', sys_id: 'chg-sys-001' } } as never)
        .mockResolvedValueOnce({ result: [] } as never);

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

    it('uses the mapped environment impacted persons aware value in the POST body', async () => {
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0005678' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.setChgPlanningAssessment({ impactedPersonsAware: 'fallback-aware' });
        result.current.actions.updateEnvironment('prd', { isEnabled: true, impactedPersonsAware: 'env-aware' });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      const bodyString = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(bodyString.u_impacted_persons_aware).toBe('env-aware');
    });

    it('includes exact custom SNow fields pinned from configuration in the POST body', async () => {
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0005678' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.pinCustomSnowField('u_custom_change_rule', 'cab_required');
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      const bodyString = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(bodyString.u_custom_change_rule).toBe('cab_required');
    });

    it('falls back to the basic config item when disabled environments still hold older mapped values', async () => {
      vi.mocked(snowFetch).mockResolvedValue({ result: { number: 'CHG0005678' } } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.setChgBasicInfo({
          configItem: { sysId: 'ci-basic-002', displayName: 'Current Basic CI' },
        });
        result.current.actions.updateEnvironment('pfix', {
          isEnabled: false,
          configItem: { sysId: 'ci-disabled-001', displayName: 'Disabled PFIX CI' },
        });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      const bodyString = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[0][1] as RequestInit).body as string,
      ) as Record<string, unknown>;

      expect(bodyString.cmdb_ci).toBe('ci-basic-002');
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

    it('resolves a display-only change manager to sys_id before create', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'mgr-700' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0007777', sys_id: 'chg-sys-777' } } as never)
        .mockResolvedValueOnce({ result: [] } as never);

      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.setChgBasicInfo({
          changeManager: { sysId: '', displayName: 'Sharma, Raman' },
        });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('/api/now/table/sys_user?');
      const createBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(createBody.change_manager).toBe('mgr-700');
    });
  });

  describe('updateExistingChg', () => {
    it('PATCHes an existing CHG with current planning values', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-123' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0001234' } } as never)
        .mockResolvedValueOnce({
          result: [{
            impact: { value: '2', display_value: '2' },
            u_change_tested: { value: 'yes', display_value: 'yes' },
          }],
        } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.updateGeneratedField('shortDescription', 'Enrollment - Transformers - fixVersion');
        result.current.actions.updateGeneratedField('description', 'Deploying release package.');
        result.current.actions.setChgPlanningAssessment({
          impact: '2',
          hasBeenTested: 'yes',
        });
        result.current.actions.setChgPlanningContent({
          implementationPlan: 'Run deployment script.',
          backoutPlan: 'Rollback package.',
          testPlan: 'Validate smoke tests.',
        });
      });

      await act(async () => {
        await result.current.actions.updateExistingChg('chg0001234');
      });

      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/api/now/table/change_request?'),
      );
      expect(vi.mocked(snowFetch)).toHaveBeenNthCalledWith(
        2,
        '/api/now/table/change_request/chg-sys-123',
        expect.objectContaining({ method: 'PATCH' }),
      );

      const patchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(patchBody.short_description).toBe('Enrollment - Transformers - fixVersion');
      expect(patchBody.impact).toBe('2');
      expect(patchBody.u_change_tested).toBe('yes');
      expect(patchBody.implementation_plan).toBe('Run deployment script.');
      expect(patchBody.backout_plan).toBe('Rollback package.');
      expect(patchBody.test_plan).toBe('Validate smoke tests.');
      expect(result.current.state.submitResult).toBe('CHG0001234 updated');
    });

    it('returns a clear error when CHG number is empty', async () => {
      const { result } = renderHook(() => useCrgState());

      await act(async () => {
        await result.current.actions.updateExistingChg('');
      });

      expect(result.current.state.submitResult).toBe('Error: Enter a CHG number before updating.');
      expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
    });

    it('writes planning alias field names unconditionally even when no fields are pinned or inspected', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-456' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0004567' } } as never)
        .mockResolvedValueOnce({
          result: [{
            u_assessment_of_success_probability: { value: 'vcon', display_value: 'Very Confident' },
          }],
        } as never);

      const { result } = renderHook(() => useCrgState());

      // No pinCustomSnowField call — pure default state with a planning value set
      act(() => {
        result.current.actions.setChgPlanningAssessment({ successProbability: 'vcon' });
      });

      await act(async () => {
        await result.current.actions.updateExistingChg('chg0004567');
      });

      const patchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      // Both canonical and instance-specific aliases must be present in the payload
      expect(patchBody.u_success_probability).toBe('vcon');
      expect(patchBody.u_assessment_of_success_probability).toBe('vcon');
    });

    it('overrides pinned alias planning fields with current UI values during CHG update', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-456' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0004567' } } as never)
        .mockResolvedValueOnce({
          result: [{
            u_implications_of_system_availability: { value: 'no_impact', display_value: 'No Impact' },
            u_availability_impact: { value: 'no_impact', display_value: 'No Impact' },
          }],
        } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.pinCustomSnowField('u_implications_of_system_availability', 'legacy-value');
        result.current.actions.setChgPlanningAssessment({
          systemAvailabilityImplication: 'no_impact',
        });
      });

      await act(async () => {
        await result.current.actions.updateExistingChg('chg0004567');
      });

      const patchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[1][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(patchBody.u_implications_of_system_availability).toBe('no_impact');
      expect(patchBody.u_availability_impact).toBe('no_impact');
    });

    it('resolves a display-only change manager to sys_id before update', async () => {
      vi.mocked(snowFetch)
        .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-456' }] } as never)
        .mockResolvedValueOnce({ result: [{ sys_id: 'mgr-333' }] } as never)
        .mockResolvedValueOnce({ result: { number: 'CHG0004567' } } as never)
        .mockResolvedValueOnce({
          result: [{
            change_manager: { value: 'mgr-333', display_value: 'Sharma, Raman' },
          }],
        } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setChgBasicInfo({
          changeManager: { sysId: '', displayName: 'Sharma, Raman' },
        });
      });

      await act(async () => {
        await result.current.actions.updateExistingChg('chg0004567');
      });

      expect(vi.mocked(snowFetch).mock.calls[1][0]).toContain('/api/now/table/sys_user?');
      const patchBody = JSON.parse(
        (vi.mocked(snowFetch).mock.calls[2][1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(patchBody.change_manager).toBe('mgr-333');
      expect(patchBody.u_change_manager).toBe('mgr-333');
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

    it('builds a CTASK template draft by cloning an existing CTASK number', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            short_description:  { value: 'Validate release', display_value: 'Validate release' },
            description:        { value: 'Run smoke tests after deployment.', display_value: 'Run smoke tests after deployment.' },
            assignment_group:   { value: 'grp-001', display_value: 'Platform Team' },
            assigned_to:        { value: 'usr-001', display_value: 'Jane Smith' },
            planned_start_date: { value: '2026-01-01 10:00:00', display_value: '2026-01-01 10:00:00' },
            planned_end_date:   { value: '2026-01-01T11:00:00', display_value: '2026-01-01T11:00:00' },
            close_notes:        { value: 'Validation complete.', display_value: 'Validation complete.' },
          },
        ],
      } as never);
      const { result } = renderHook(() => useCrgState());
      let clonedTemplateData: CtaskTemplateData | null = null;

      await act(async () => {
        clonedTemplateData = await result.current.actions.cloneCtaskTemplate('ctask0001234');
      });

      expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('/api/now/table/change_task?');
      expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain('number%3DCTASK0001234');
      expect(clonedTemplateData).toEqual({
        shortDescription: 'Validate release',
        description:      'Run smoke tests after deployment.',
        assignmentGroup:  { sysId: 'grp-001', displayName: 'Platform Team' },
        assignedTo:       { sysId: 'usr-001', displayName: 'Jane Smith' },
        plannedStartDate: '2026-01-01T10:00',
        plannedEndDate:   '2026-01-01T11:00',
        closeNotes:       'Validation complete.',
      });
    });

    it('reports a clear error when the CTASK clone source is not found', async () => {
      vi.mocked(snowFetch).mockResolvedValueOnce({ result: [] } as never);
      const { result } = renderHook(() => useCrgState());

      await expect(result.current.actions.cloneCtaskTemplate('CTASK9999999')).rejects.toThrow('CTASK9999999');
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
        relEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '', snowEnvironmentValue: '' },
        prdEnvironment:  { isEnabled: true, plannedStartDate: '2026-01-02T10:00', plannedEndDate: '2026-01-02T11:00', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '', snowEnvironmentValue: '' },
        pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '', configItem: { sysId: '', displayName: '' }, impactedPersonsAware: '', snowEnvironmentValue: '' },
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

    it('preserves configured short-description defaults when template values are blank', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setShortDescriptionConfig({
          application: 'Enrollment',
          team: 'Transformers',
          changeDetailsOverride: 'FixVersion',
        });
      });

      act(() => {
        result.current.actions.applyTemplate({
          id: 'tpl-empty-short-description',
          name: 'Legacy Blank Short Description',
          createdAt: '2026-01-01T00:00:00.000Z',
          shortDescriptionConfig: {
            application: '',
            team: '',
            changeDetailsOverride: '',
          },
          chgBasicInfo:          result.current.state.chgBasicInfo,
          chgPlanningAssessment: result.current.state.chgPlanningAssessment,
          chgPlanningContent:    result.current.state.chgPlanningContent,
        });
      });

      expect(result.current.state.shortDescriptionConfig).toEqual({
        application: 'Enrollment',
        team: 'Transformers',
        changeDetailsOverride: 'FixVersion',
      });
    });

    it('applies non-empty template short-description values without clearing existing defaults', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setShortDescriptionConfig({
          application: 'Enrollment',
          team: 'Transformers',
          changeDetailsOverride: 'FixVersion',
        });
      });

      act(() => {
        result.current.actions.applyTemplate({
          id: 'tpl-partial-short-description',
          name: 'Partial Short Description',
          createdAt: '2026-01-01T00:00:00.000Z',
          shortDescriptionConfig: {
            application: 'Claims',
            team: '',
            changeDetailsOverride: '',
          },
          chgBasicInfo:          result.current.state.chgBasicInfo,
          chgPlanningAssessment: result.current.state.chgPlanningAssessment,
          chgPlanningContent:    result.current.state.chgPlanningContent,
        });
      });

      expect(result.current.state.shortDescriptionConfig).toEqual({
        application: 'Claims',
        team: 'Transformers',
        changeDetailsOverride: 'FixVersion',
      });
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

    it('hydrates missing config items when applying an older environment template', () => {
      const { result } = renderHook(() => useCrgState());
      const olderEnvironmentTemplate = {
        id: 'tpl-older-env',
        name: 'Older Environment Template',
        createdAt: '2026-01-01T00:00:00.000Z',
        chgBasicInfo:          result.current.state.chgBasicInfo,
        chgPlanningAssessment: result.current.state.chgPlanningAssessment,
        chgPlanningContent:    result.current.state.chgPlanningContent,
        relEnvironment: {
          isEnabled: true,
          plannedStartDate: '2026-01-05T10:00',
          plannedEndDate: '2026-01-05T11:00',
        },
      } as unknown as Parameters<typeof result.current.actions.applyTemplate>[0];

      act(() => {
        result.current.actions.applyTemplate(olderEnvironmentTemplate);
      });

      expect(result.current.state.relEnvironment).toEqual({
        isEnabled: true,
        plannedStartDate: '2026-01-05T10:00',
        plannedEndDate: '2026-01-05T11:00',
        configItem: { sysId: '', displayName: '' },
        impactedPersonsAware: '',
        snowEnvironmentValue: '',
      });
    });

    it('applies custom SNow payload fields from templates and preserves them for legacy templates', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.pinCustomSnowField('u_existing_payload_rule', 'keep_me');
      });

      act(() => {
        result.current.actions.applyTemplate({
          id: 'tpl-custom-fields',
          name: 'Custom Payload Fields',
          createdAt: '2026-01-01T00:00:00.000Z',
          chgBasicInfo:          result.current.state.chgBasicInfo,
          chgPlanningAssessment: result.current.state.chgPlanningAssessment,
          chgPlanningContent:    result.current.state.chgPlanningContent,
          customSnowFields: {
            u_custom_change_rule: 'cab_required',
          },
        });
      });

      expect(result.current.state.customSnowFields).toEqual({
        u_custom_change_rule: 'cab_required',
      });

      act(() => {
        result.current.actions.applyTemplate({
          id: 'tpl-legacy-custom-fields',
          name: 'Legacy Custom Fields',
          createdAt: '2026-01-02T00:00:00.000Z',
          chgBasicInfo:          result.current.state.chgBasicInfo,
          chgPlanningAssessment: result.current.state.chgPlanningAssessment,
          chgPlanningContent:    result.current.state.chgPlanningContent,
        });
      });

      expect(result.current.state.customSnowFields).toEqual({
        u_custom_change_rule: 'cab_required',
      });
    });
  });

  describe('linked CTASK templates', () => {
    // Builds a CHG template that links the given CTASK template ids, reusing the
    // hook's current (default) assessment/content shapes so only links vary.
    function makeChgTemplateWithLinks(
      state: ReturnType<typeof useCrgState>['state'],
      ctaskTemplateIds: string[],
    ): CrgTemplate {
      return {
        id: 'tpl-linked',
        name: 'Release With CTASKs',
        createdAt: '2026-01-01T00:00:00.000Z',
        chgBasicInfo:          state.chgBasicInfo,
        chgPlanningAssessment: state.chgPlanningAssessment,
        chgPlanningContent:    state.chgPlanningContent,
        ctaskTemplateIds,
      };
    }

    it('auto-stages linked CTASK templates into the change-task queue on apply', () => {
      const { result } = renderHook(() => useCrgState());
      const ctaskA = createMockCtaskTemplate({ id: 'cta-A', name: 'Deploy' });
      const ctaskB = createMockCtaskTemplate({ id: 'cta-B', name: 'Validate' });

      act(() => {
        result.current.actions.applyTemplate(makeChgTemplateWithLinks(result.current.state, ['cta-A', 'cta-B']), [ctaskA, ctaskB]);
      });

      expect(result.current.state.changeTasks).toHaveLength(2);
      // Each staged task keeps its source link but gets a fresh runtime id.
      expect(result.current.state.changeTasks.map((task) => task.sourceTemplateId)).toEqual(['cta-A', 'cta-B']);
      expect(result.current.state.changeTasks[0].id).not.toBe('cta-A');
      expect(result.current.state.changeTasks[0].name).toBe('Deploy');
      // The link set is remembered so re-saving the CHG template round-trips the links.
      expect(result.current.state.ctaskTemplateIds).toEqual(['cta-A', 'cta-B']);
    });

    it('does not stack duplicates when the same CHG template is applied twice', () => {
      const { result } = renderHook(() => useCrgState());
      const ctaskA = createMockCtaskTemplate({ id: 'cta-A', name: 'Deploy' });

      act(() => {
        result.current.actions.applyTemplate(makeChgTemplateWithLinks(result.current.state, ['cta-A']), [ctaskA]);
      });
      act(() => {
        result.current.actions.applyTemplate(makeChgTemplateWithLinks(result.current.state, ['cta-A']), [ctaskA]);
      });

      expect(result.current.state.changeTasks).toHaveLength(1);
    });

    it('skips a linked id whose CTASK template no longer exists', () => {
      const { result } = renderHook(() => useCrgState());
      const ctaskA = createMockCtaskTemplate({ id: 'cta-A', name: 'Deploy' });

      act(() => {
        // 'cta-GONE' was deleted from the user's templates — only 'cta-A' resolves.
        result.current.actions.applyTemplate(makeChgTemplateWithLinks(result.current.state, ['cta-A', 'cta-GONE']), [ctaskA]);
      });

      expect(result.current.state.changeTasks).toHaveLength(1);
      expect(result.current.state.changeTasks[0].sourceTemplateId).toBe('cta-A');
    });

    it('setLinkedCtaskTemplateIds updates the editable link set', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setLinkedCtaskTemplateIds(['cta-X', 'cta-Y']);
      });

      expect(result.current.state.ctaskTemplateIds).toEqual(['cta-X', 'cta-Y']);
    });

    it('setReconcileAutoCtasks toggles the reconcile preference', () => {
      const { result } = renderHook(() => useCrgState());
      expect(result.current.state.reconcileAutoCtasks).toBe(false);

      act(() => {
        result.current.actions.setReconcileAutoCtasks(true);
      });

      expect(result.current.state.reconcileAutoCtasks).toBe(true);
    });

    it('applyTemplate carries the reconcile preference from the template', () => {
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.applyTemplate({
          ...makeChgTemplateWithLinks(result.current.state, []),
          reconcileAutoCtasks: true,
        });
      });

      expect(result.current.state.reconcileAutoCtasks).toBe(true);
    });
  });

  describe('reconcileStagedChangeTasks', () => {
    const noopSleep = () => Promise.resolve();

    /** Routes the mocked snowFetch by method: GET returns auto-created CTASKs, others succeed. */
    function mockSnowForAutoCtasks(autoCtasks: Array<{ sys_id: string }>) {
      vi.mocked(snowFetch).mockImplementation((async (path: string, options?: { method?: string }) => {
        const method = options?.method ?? 'GET';
        if (method === 'GET' && path.includes('change_task?')) {
          return { result: autoCtasks };
        }
        return {};
      }) as never);
    }

    function callsMatching(method: string) {
      return vi.mocked(snowFetch).mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === method);
    }

    it('updates the auto-created CTASKs in order and creates new for the remainder', async () => {
      mockSnowForAutoCtasks([{ sys_id: 'auto-1' }, { sys_id: 'auto-2' }]);
      const staged = [
        createMockCtaskTemplate({ id: 's1', name: 'First',  shortDescription: 'Update one' }),
        createMockCtaskTemplate({ id: 's2', name: 'Second', shortDescription: 'Update two' }),
        createMockCtaskTemplate({ id: 's3', name: 'Third',  shortDescription: 'Create three' }),
      ];

      const processed = await reconcileStagedChangeTasks('chg-sys-1', staged, noopSleep);

      expect(processed).toBe(3);
      // Two PATCHes (to the auto-created sys_ids) and one POST (the remainder).
      const patchCalls = callsMatching('PATCH');
      const postCalls = callsMatching('POST');
      expect(patchCalls).toHaveLength(2);
      expect(patchCalls[0][0]).toContain('change_task/auto-1');
      expect(patchCalls[1][0]).toContain('change_task/auto-2');
      expect(postCalls).toHaveLength(1);
      expect(postCalls[0][0]).toBe('/api/now/table/change_task');
    });

    it('creates all staged CTASKs as new when nothing was auto-created', async () => {
      mockSnowForAutoCtasks([]);
      const staged = [
        createMockCtaskTemplate({ id: 's1', name: 'Only' }),
        createMockCtaskTemplate({ id: 's2', name: 'Second' }),
      ];

      const processed = await reconcileStagedChangeTasks('chg-sys-2', staged, noopSleep);

      expect(processed).toBe(2);
      expect(callsMatching('PATCH')).toHaveLength(0);
      expect(callsMatching('POST')).toHaveLength(2);
    });

    it('does nothing and issues no writes when there are no staged CTASKs', async () => {
      mockSnowForAutoCtasks([{ sys_id: 'auto-1' }]);

      const processed = await reconcileStagedChangeTasks('chg-sys-3', [], noopSleep);

      expect(processed).toBe(0);
      expect(callsMatching('PATCH')).toHaveLength(0);
      expect(callsMatching('POST')).toHaveLength(0);
    });
  });

  describe('localStorage persistence', () => {
    const STORAGE_KEY = 'ntbx-crg-state';
    const SHORT_DESCRIPTION_CONFIG_KEY = 'ntbx-crg-short-description-config';

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
      expect(result.current.state.relEnvironment.configItem).toEqual({ sysId: '', displayName: '' });
      expect(result.current.state.prdEnvironment.configItem).toEqual({ sysId: '', displayName: '' });
      expect(result.current.state.pfixEnvironment.configItem).toEqual({ sysId: '', displayName: '' });
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
      expect(result.current.state.relEnvironment.configItem).toEqual({ sysId: '', displayName: '' });
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

    it('persists short description defaults independently and keeps them after reset/remount', async () => {
      mockVersionFetch();
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setShortDescriptionConfig({
          application: 'Enrollment',
          team: 'Transformers',
          changeDetailsOverride: 'FixVersion',
        });
      });

      await waitFor(() => {
        const storedConfig = localStorage.getItem(SHORT_DESCRIPTION_CONFIG_KEY);
        expect(storedConfig).not.toBeNull();
        expect(JSON.parse(storedConfig!)).toEqual({
          application: 'Enrollment',
          team: 'Transformers',
          changeDetailsOverride: 'FixVersion',
        });
      });

      act(() => {
        result.current.actions.reset();
      });

      expect(result.current.state.shortDescriptionConfig).toEqual({
        application: 'Enrollment',
        team: 'Transformers',
        changeDetailsOverride: 'FixVersion',
      });

      const { result: freshHook } = renderHook(() => useCrgState());
      expect(freshHook.current.state.shortDescriptionConfig).toEqual({
        application: 'Enrollment',
        team: 'Transformers',
        changeDetailsOverride: 'FixVersion',
      });
    });
  });
});
