// useCrgState.test.ts — Unit tests for the Change Request Generator state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { CrgTemplate, CtaskTemplate, CtaskTemplateData } from './useCrgState.ts';
import { formatSnowDateTimeForApi, listEnvironmentDateOrderErrors, NO_ENABLED_ENVIRONMENT_MESSAGE, reconcileStagedChangeTasks, useCrgState } from './useCrgState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

/** The UTC string ServiceNow should receive for a wall clock typed in this machine's timezone. */
function expectedUtcFor(localInput: string): string {
  return new Date(localInput).toISOString().slice(0, 19).replace('T', ' ');
}

/** The wall clock a form should SHOW for a UTC value ServiceNow returned. */
function expectedLocalInputFor(utcValue: string): string {
  const instant = new Date(`${utcValue.replace(' ', 'T').slice(0, 19)}Z`);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`
    + `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

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

// ── listEnvironmentDateOrderErrors — end-before-start guard (GH #282) ──
//
// ServiceNow rejects a change whose planned end precedes its start with an unhelpful 403,
// so the wizard must catch the ordering problem before anything is submitted.

describe('listEnvironmentDateOrderErrors', () => {
  const cleanEnvironment = {
    isEnabled: false,
    plannedStartDate: '',
    plannedEndDate: '',
    configItem: { sysId: '', displayName: '' },
    impactedPersonsAware: '',
    snowEnvironmentValue: '',
  };

  function buildEnvironmentSet(overrides: Record<string, object> = {}) {
    return {
      relEnvironment: { ...cleanEnvironment },
      prdEnvironment: { ...cleanEnvironment },
      pfixEnvironment: { ...cleanEnvironment },
      ...overrides,
    };
  }

  it('flags an enabled environment whose planned end is before its start', () => {
    const errors = listEnvironmentDateOrderErrors(buildEnvironmentSet({
      relEnvironment: { ...cleanEnvironment, isEnabled: true, plannedStartDate: '2026-08-10T10:00', plannedEndDate: '2026-08-09T10:00' },
    }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('REL');
    expect(errors[0]).toMatch(/end date.*before/i);
  });

  it('flags an end date equal to the start date', () => {
    const errors = listEnvironmentDateOrderErrors(buildEnvironmentSet({
      prdEnvironment: { ...cleanEnvironment, isEnabled: true, plannedStartDate: '2026-08-10T10:00', plannedEndDate: '2026-08-10T10:00' },
    }));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('PRD');
  });

  it('ignores disabled environments and environments with a blank date', () => {
    const errors = listEnvironmentDateOrderErrors(buildEnvironmentSet({
      // Disabled with inverted dates — not submitted, so not flagged.
      relEnvironment: { ...cleanEnvironment, isEnabled: false, plannedStartDate: '2026-08-10T10:00', plannedEndDate: '2026-08-09T10:00' },
      // Enabled but end date not yet entered — date presence is ServiceNow's own concern.
      prdEnvironment: { ...cleanEnvironment, isEnabled: true, plannedStartDate: '2026-08-10T10:00', plannedEndDate: '' },
    }));

    expect(errors).toEqual([]);
  });

  it('lists every offending environment', () => {
    const errors = listEnvironmentDateOrderErrors(buildEnvironmentSet({
      relEnvironment: { ...cleanEnvironment, isEnabled: true, plannedStartDate: '2026-08-10T10:00', plannedEndDate: '2026-08-09T10:00' },
      pfixEnvironment: { ...cleanEnvironment, isEnabled: true, plannedStartDate: '2026-08-12T10:00', plannedEndDate: '2026-08-11T10:00' },
    }));

    expect(errors).toHaveLength(2);
  });
});

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

  // ── addIssues — additive fetch that never discards what's already loaded ──

  it('addIssues appends new results, selects them, and keeps existing issues and selections intact', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never)
      .mockResolvedValueOnce({ issues: [createMockJiraIssue('XYZ-201', 'Story outside the release fixVersion')] } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });
    await act(async () => {
      await result.current.actions.fetchIssues();
    });

    // Deselect one loaded issue to prove the add does not disturb existing selection state.
    act(() => {
      result.current.actions.toggleIssueSelection('ABC-102');
      result.current.actions.setFetchMode('jql');
      result.current.actions.setCustomJql('key = XYZ-201');
    });
    await act(async () => {
      await result.current.actions.addIssues();
    });

    expect(result.current.state.fetchedIssues.map((issue) => issue.key)).toEqual(['ABC-101', 'ABC-102', 'XYZ-201']);
    expect(result.current.state.selectedIssueKeys.has('XYZ-201')).toBe(true);
    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(true);
    expect(result.current.state.selectedIssueKeys.has('ABC-102')).toBe(false);
    expect(result.current.state.currentStep).toBe(2);
    expect(result.current.state.fetchNotice).toContain('Added 1 issue(s)');
  });

  it('addIssues never duplicates an already-loaded issue and says so when nothing is new', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });
    await act(async () => {
      await result.current.actions.fetchIssues();
    });
    await act(async () => {
      await result.current.actions.addIssues();
    });

    expect(result.current.state.fetchedIssues.map((issue) => issue.key)).toEqual(['ABC-101', 'ABC-102']);
    expect(result.current.state.fetchNotice).toContain('No new issues');
  });

  it('fetchIssues still replaces the loaded set and clears the add notice', async () => {
    vi.mocked(jiraGet)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never)
      .mockResolvedValueOnce({ issues: MOCK_JIRA_ISSUES } as never)
      .mockResolvedValueOnce({ issues: [createMockJiraIssue('XYZ-201', 'A fresh replace')] } as never);
    const { result } = renderHook(() => useCrgState());

    act(() => {
      result.current.actions.setProjectKey('abc');
      result.current.actions.setFixVersion('1.2.3');
    });
    await act(async () => {
      await result.current.actions.fetchIssues();
    });
    await act(async () => {
      await result.current.actions.addIssues(); // leaves a "No new issues" notice behind
    });
    await act(async () => {
      await result.current.actions.fetchIssues(); // plain fetch = full replace, notice gone
    });

    expect(result.current.state.fetchedIssues.map((issue) => issue.key)).toEqual(['XYZ-201']);
    expect(result.current.state.selectedIssueKeys.has('ABC-101')).toBe(false);
    expect(result.current.state.fetchNotice).toBeNull();
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
    it('maps a REL change to the REL environment even when its label mentions production', async () => {
      // Real REL environments are routinely labeled "Pre-Production Release" / "Pre-Prod" —
      // the old inference saw "prod" first and wrongly enabled the PRD card (user report).
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            short_description: { value: 'Deploy v2', display_value: 'Deploy v2' },
            u_environment:     { value: 'preprod_release', display_value: 'Pre-Production Release' },
            start_date:        { value: '2026-08-10 10:00:00', display_value: '2026-08-10 10:00:00' },
            end_date:          { value: '2026-08-10 12:00:00', display_value: '2026-08-10 12:00:00' },
          },
        ],
      } as never);
      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0009999');
      });
      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.relEnvironment.isEnabled).toBe(true);
      expect(result.current.state.prdEnvironment.isEnabled).toBe(false);
      expect(result.current.state.pfixEnvironment.isEnabled).toBe(false);
    });

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

    it('clones planning values stored under the instance-specific alias field names', async () => {
      // This instance stores the planning assessment under the long u_ alias columns, not the
      // short fallback names the clone used to read. The submit side writes every alias, so the
      // value can live in either column — the clone must try them all or the values silently drop.
      vi.mocked(snowFetch).mockResolvedValueOnce({
        result: [
          {
            u_impact:                                                { value: '1', display_value: '1 - High' },
            u_implications_of_system_availability:                   { value: 'No', display_value: 'No' },
            u_has_this_change_been_tested:                           { value: 'Yes', display_value: 'Yes' },
            u_are_impacted_persons_aware_prepared_for_test_checkout: { value: 'Yes', display_value: 'Yes' },
            u_has_change_been_performed_previously:                  { value: 'No', display_value: 'No' },
            u_assessment_of_success_probability:                     { value: '90-99%', display_value: '90-99%' },
            u_can_change_be_backed_out:                              { value: 'Yes', display_value: 'Yes' },
            implementation_plan:                                     { value: 'Run the deploy script', display_value: 'Run the deploy script' },
            backout_plan:                                            { value: 'Roll back the release', display_value: 'Roll back the release' },
            test_plan:                                               { value: 'Smoke test prod', display_value: 'Smoke test prod' },
          },
        ],
      } as never);

      const { result } = renderHook(() => useCrgState());

      act(() => {
        result.current.actions.setCloneChgNumber('CHG0004321');
      });

      await act(async () => {
        await result.current.actions.cloneFromChg();
      });

      expect(result.current.state.chgPlanningAssessment).toEqual({
        impact:                        '1',
        systemAvailabilityImplication: 'No',
        hasBeenTested:                 'Yes',
        impactedPersonsAware:          'Yes',
        hasBeenPerformedPreviously:    'No',
        successProbability:            '90-99%',
        canBeBackedOut:                'Yes',
      });
      expect(result.current.state.chgPlanningContent).toEqual({
        implementationPlan: 'Run the deploy script',
        backoutPlan:        'Roll back the release',
        testPlan:           'Smoke test prod',
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
        // Environments are required before a CHG can be created (GH fix). Enable REL by default so the
        // createChg tests below exercise the create path; tests that need specific environments enable
        // them explicitly (which overrides this).
        hookResult.result.current.actions.updateEnvironment('rel', { isEnabled: true });
      });

      return hookResult;
    }

    it('requires an enabled environment: creates no CHG and reports environments are required', async () => {
      const { result } = await advanceToChangeDetailsStep();

      // Disable the environment the helper enabled → now zero environments are enabled.
      act(() => {
        result.current.actions.updateEnvironment('rel', { isEnabled: false });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      // No change_request was POSTed, and the user is told environments are required.
      expect(vi.mocked(snowFetch)).not.toHaveBeenCalledWith(
        '/api/now/table/change_request',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.current.state.submitResult).toBe(NO_ENABLED_ENVIRONMENT_MESSAGE);
      expect(result.current.state.isSubmitting).toBe(false);
    });

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

    it('blocks CHG creation when an enabled environment ends before it starts (GH #282)', async () => {
      const { result } = await advanceToChangeDetailsStep();

      act(() => {
        result.current.actions.updateEnvironment('rel', {
          isEnabled: true,
          plannedStartDate: '2026-08-10T10:00',
          plannedEndDate: '2026-08-09T10:00',
        });
      });

      await act(async () => {
        await result.current.actions.createChg();
      });

      // Nothing must reach ServiceNow — it would answer with an unhelpful 403.
      expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
      expect(result.current.state.submitResult).toMatch(/end date.*before/i);
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
      // change_request stores the requested window as start_date/end_date, not planned_*, in
      // ServiceNow's canonical "YYYY-MM-DD HH:MM:SS" format and in UTC — the operator's wall clock
      // converted, not copied (GH #375). Asserted against the instant so this holds in any timezone.
      expect(relPayload.start_date).toBe(expectedUtcFor('2025-02-01T08:00'));
      expect(relPayload.end_date).toBe(expectedUtcFor('2025-02-01T09:00'));

      expect(prdPayload.u_environment).toBe('prd-env');
      expect(prdPayload.cmdb_ci).toBe('ci-prd-001');
      expect(prdPayload.u_impacted_persons_aware).toBe('prd-aware');
      expect(prdPayload.start_date).toBe(expectedUtcFor('2025-02-02T08:00'));
      expect(prdPayload.end_date).toBe(expectedUtcFor('2025-02-02T09:00'));

      expect(pfixPayload.u_environment).toBe('pfix-env');
      expect(pfixPayload.cmdb_ci).toBe('ci-pfix-001');
      expect(pfixPayload.u_impacted_persons_aware).toBe('pfix-aware');
      expect(pfixPayload.start_date).toBe(expectedUtcFor('2025-02-03T08:00'));
      expect(pfixPayload.end_date).toBe(expectedUtcFor('2025-02-03T09:00'));
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

      // Environments are required now, so the helper enables REL; the auto-CTASK name carries that label.
      expect(implementationPatchBody.short_description).toBe('Enrollment - AWS - REL');
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
        // Only PRD enabled (the helper's REL is turned off) so the single CHG is PRD's.
        result.current.actions.updateEnvironment('rel', { isEnabled: false });
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
        // The fixture's value is what ServiceNow stores: UTC. The form shows the operator's own
        // clock, so these are the same instant rendered locally (GH #375).
        plannedStartDate: expectedLocalInputFor('2026-01-01T10:00:00'),
        plannedEndDate:   expectedLocalInputFor('2026-01-01T11:00:00'),
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

    // A previously ticked environment used to survive every reload, so the last environment a
    // user happened to enable looked like a permanent default they could not clear. Which
    // environments a change targets is a per-change decision — it must always start unticked.
    it('starts every environment unticked even when a previous session left one enabled', () => {
      mockVersionFetch();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentStep: 5,
        projectKey: 'SEED',
        fixVersion: '2.0.0',
        fetchMode: 'project',
        customJql: '',
        fetchedIssues: [],
        selectedIssueKeys: [],
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
        relEnvironment:  { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        prdEnvironment:  { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
        pfixEnvironment: { isEnabled: true, plannedStartDate: '2026-01-03T10:00', plannedEndDate: '2026-01-03T11:00' },
      }));

      const { result } = renderHook(() => useCrgState());

      expect(result.current.state.relEnvironment.isEnabled).toBe(false);
      expect(result.current.state.prdEnvironment.isEnabled).toBe(false);
      expect(result.current.state.pfixEnvironment.isEnabled).toBe(false);
      // Everything else the user typed is still restored — only the tick is cleared.
      expect(result.current.state.pfixEnvironment.plannedStartDate).toBe('2026-01-03T10:00');
      expect(result.current.state.pfixEnvironment.plannedEndDate).toBe('2026-01-03T11:00');
      expect(result.current.state.currentStep).toBe(5);
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

// ── Rebuild draft isolation (feature 033) ──
//
// A rebuild builds a whole change from the blank template and writes it to an existing CHG
// number. It shares every step with the Create wizard, so without a separate storage key it
// would both inherit the operator's in-progress Create draft (so it would not open blank) and
// overwrite it on its first render (destroying unsaved work nobody agreed to discard).

describe('useCrgState — rebuild draft isolation', () => {
  const WIZARD_STORAGE_KEY = 'ntbx-crg-state';
  const REBUILD_STORAGE_KEY = 'ntbx-crg-rebuild-state:CHG0001234';
  const OTHER_REBUILD_STORAGE_KEY = 'ntbx-crg-rebuild-state:CHG0009999';

  function seedWizardDraft(): void {
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
      currentStep: 3,
      projectKey: 'WIZARD',
      fixVersion: '9.9.9',
      fetchMode: 'project',
      customJql: '',
      fetchedIssues: [],
      selectedIssueKeys: [],
      cloneChgNumber: '',
      generatedShortDescription: 'Wizard draft short description',
      generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
      relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
      prdEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
      pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    }));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(jiraGet).mockResolvedValue([] as never);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not hydrate the Create wizard draft into a rebuild', () => {
    seedWizardDraft();

    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));

    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.generatedShortDescription).toBe('');
    expect(result.current.state.currentStep).toBe(1);
  });

  it('does not write to the Create wizard key from a rebuild', async () => {
    seedWizardDraft();
    const wizardDraftBefore = localStorage.getItem(WIZARD_STORAGE_KEY);

    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));
    act(() => { result.current.actions.setProjectKey('REBUILD'); });

    await waitFor(() => {
      expect(localStorage.getItem(REBUILD_STORAGE_KEY)).not.toBeNull();
    });
    expect(localStorage.getItem(WIZARD_STORAGE_KEY)).toBe(wizardDraftBefore);
  });

  // The SNow relay navigates the tab away and back, which is the whole reason drafts persist.
  it('restores a rebuild draft on remount under the same key', async () => {
    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));
    act(() => { result.current.actions.setProjectKey('RESUME'); });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(REBUILD_STORAGE_KEY)!).projectKey).toBe('RESUME');
    });

    const { result: remounted } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));
    expect(remounted.current.state.projectKey).toBe('RESUME');
  });

  // FR-033 is true by construction: a draft for one change is unreachable from another.
  it('does not show one change’s rebuild draft under a different change number', async () => {
    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));
    act(() => { result.current.actions.setProjectKey('BOUND'); });

    await waitFor(() => {
      expect(localStorage.getItem(REBUILD_STORAGE_KEY)).not.toBeNull();
    });

    const { result: otherChange } = renderHook(() => useCrgState({ storageKey: OTHER_REBUILD_STORAGE_KEY }));
    expect(otherChange.current.state.projectKey).toBe('');
  });

  it('keeps environment ticks cleared on a rebuild remount', async () => {
    localStorage.setItem(REBUILD_STORAGE_KEY, JSON.stringify({
      currentStep: 5,
      projectKey: 'TICKS',
      fixVersion: '', fetchMode: 'project', customJql: '',
      fetchedIssues: [], selectedIssueKeys: [], cloneChgNumber: '',
      generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
      relEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
      prdEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
      pfixEnvironment: { isEnabled: true, plannedStartDate: '', plannedEndDate: '' },
    }));

    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));

    expect(result.current.state.relEnvironment.isEnabled).toBe(false);
    expect(result.current.state.prdEnvironment.isEnabled).toBe(false);
    expect(result.current.state.pfixEnvironment.isEnabled).toBe(false);
  });

  // FR-006: a rebuild starts blank, but the reusable defaults a NEW change would start from
  // still apply — they live in their own slot, not in the draft the rebuild replaced.
  it('still applies the saved short description defaults a new change would use', () => {
    localStorage.setItem('ntbx-crg-short-description-config', JSON.stringify({
      application: 'Enrollment',
      team: 'Transformers',
      changeDetailsOverride: '',
    }));

    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));

    expect(result.current.state.shortDescriptionConfig.application).toBe('Enrollment');
    expect(result.current.state.shortDescriptionConfig.team).toBe('Transformers');
    expect(result.current.state.generatedShortDescription).toBe('');
  });

  it('clears only the rebuild key on reset, leaving the wizard draft intact', async () => {
    seedWizardDraft();
    const wizardDraftBefore = localStorage.getItem(WIZARD_STORAGE_KEY);

    const { result } = renderHook(() => useCrgState({ storageKey: REBUILD_STORAGE_KEY }));
    act(() => { result.current.actions.setProjectKey('DISCARD'); });
    await waitFor(() => {
      expect(localStorage.getItem(REBUILD_STORAGE_KEY)).not.toBeNull();
    });

    act(() => { result.current.actions.reset(); });

    // Reset clears the rebuild's own work. (Like the wizard's reset, defaults may be re-persisted
    // by the next effect run — what matters is that the discarded work is gone.)
    const rebuildDraftAfterReset = localStorage.getItem(REBUILD_STORAGE_KEY);
    expect(rebuildDraftAfterReset === null || JSON.parse(rebuildDraftAfterReset).projectKey === '').toBe(true);
    expect(result.current.state.projectKey).toBe('');
    // The Create wizard's draft is somebody else's work and must not be touched.
    expect(localStorage.getItem(WIZARD_STORAGE_KEY)).toBe(wizardDraftBefore);
  });
});

// ── Rebuild environment guard (feature 033) ──
//
// createChg creates one CHG per enabled environment. A rebuild has exactly one change number,
// and updateExistingChg silently keeps only the first target — so enabling REL + PRD used to
// write REL and discard PRD without a word. A rebuild must refuse instead.

describe('useCrgState — rebuild environment guard', () => {
  const REBUILD_TARGET = 'CHG0001234';

  function enableEnvironment(
    hookResult: ReturnType<typeof renderHook<ReturnType<typeof useCrgState>, unknown>>['result'],
    environmentKey: 'rel' | 'prd' | 'pfix',
  ): void {
    act(() => {
      hookResult.current.actions.updateEnvironment(environmentKey, {
        isEnabled: true,
        plannedStartDate: '2026-01-01T10:00',
        plannedEndDate: '2026-01-01T11:00',
      });
    });
  }

  function readSnowRequestUrls(): string[] {
    return vi.mocked(snowFetch).mock.calls.map((snowFetchCall) => String(snowFetchCall[0]));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(jiraGet).mockResolvedValue([] as never);
    vi.mocked(snowFetch).mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('refuses a rebuild with no enabled environment and issues no request', async () => {
    const { result } = renderHook(() => useCrgState());

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET, { isRebuild: true });
    });

    expect(result.current.state.submitResult).toBe(NO_ENABLED_ENVIRONMENT_MESSAGE);
    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
  });

  it('refuses a rebuild with two enabled environments and names them', async () => {
    const { result } = renderHook(() => useCrgState());
    enableEnvironment(result, 'rel');
    enableEnvironment(result, 'prd');

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET, { isRebuild: true });
    });

    expect(result.current.state.submitResult).toContain('REL');
    expect(result.current.state.submitResult).toContain('PRD');
    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
  });

  it('permits a rebuild with exactly one enabled environment', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-1234' }] } as never)
      .mockResolvedValueOnce({ result: {} } as never)
      .mockResolvedValueOnce({ result: [{}] } as never);

    const { result } = renderHook(() => useCrgState());
    enableEnvironment(result, 'rel');

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET, { isRebuild: true });
    });

    expect(result.current.state.submitResult).not.toBe(NO_ENABLED_ENVIRONMENT_MESSAGE);
    expect(readSnowRequestUrls().some((url) => url.includes('change_request/chg-sys-1234'))).toBe(true);
  });

  // SC-003: a rebuild must never produce a second change number for the same work.
  it('never POSTs to the change_request collection during a rebuild', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-1234' }] } as never)
      .mockResolvedValueOnce({ result: {} } as never)
      .mockResolvedValueOnce({ result: [{}] } as never);

    const { result } = renderHook(() => useCrgState());
    enableEnvironment(result, 'prd');

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET, { isRebuild: true });
    });

    const postedRequests = vi.mocked(snowFetch).mock.calls.filter((snowFetchCall) => (
      (snowFetchCall[1] as RequestInit | undefined)?.method === 'POST'
    ));
    expect(postedRequests).toHaveLength(0);
  });

  it('preserves the rebuild draft when the update fails so the operator can retry', async () => {
    const rebuildStorageKey = 'ntbx-crg-rebuild-state:CHG0001234';
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow relay unavailable'));

    const { result } = renderHook(() => useCrgState({ storageKey: rebuildStorageKey }));
    act(() => { result.current.actions.setProjectKey('RETRY'); });
    enableEnvironment(result, 'rel');
    await waitFor(() => {
      expect(localStorage.getItem(rebuildStorageKey)).not.toBeNull();
    });

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET, { isRebuild: true });
    });

    expect(result.current.state.submitResult).toContain('Error');
    expect(JSON.parse(localStorage.getItem(rebuildStorageKey)!).projectKey).toBe('RETRY');
  });

  it('leaves the existing manual update path unguarded', async () => {
    // The Create tab's "Update Existing CHG" button predates the rebuild and must keep working
    // with no environment enabled — the guard applies only when isRebuild is set.
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: [{ sys_id: 'chg-sys-1234' }] } as never)
      .mockResolvedValueOnce({ result: {} } as never)
      .mockResolvedValueOnce({ result: [{}] } as never);

    const { result } = renderHook(() => useCrgState());

    await act(async () => {
      await result.current.actions.updateExistingChg(REBUILD_TARGET);
    });

    expect(result.current.state.submitResult).not.toBe(NO_ENABLED_ENVIRONMENT_MESSAGE);
    expect(vi.mocked(snowFetch)).toHaveBeenCalled();
  });
});

describe('formatSnowDateTimeForApi', () => {
  it('converts datetime-local input into ServiceNow canonical format with seconds', () => {
    expect(formatSnowDateTimeForApi('2026-07-02T14:00')).toBe(expectedUtcFor('2026-07-02T14:00'));
    expect(formatSnowDateTimeForApi('2026-07-02T14:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('REGRESSION: converts the operator wall clock to UTC rather than sending it as typed', () => {
    // GH #375: a change scheduled for 1pm appeared in ServiceNow at 9am. The value was never wrong,
    // only never converted — ServiceNow reads a bare datetime as UTC and then renders it in the
    // user's profile timezone, so sending the local clock verbatim shifts it by the offset.
    //
    // Asserted against the instant rather than a fixed string, so this holds wherever it is run.
    const sentValue = formatSnowDateTimeForApi('2026-07-02T13:00');
    const sentInstantMs = new Date(sentValue.replace(' ', 'T') + 'Z').getTime();

    expect(sentInstantMs).toBe(new Date('2026-07-02T13:00').getTime());
  });

  it('accepts an already space-separated value and converts it too', () => {
    // Same instant, whichever separator it arrived with — the separator says nothing about the zone.
    expect(formatSnowDateTimeForApi('2026-07-02 14:00:30')).toBe(expectedUtcFor('2026-07-02T14:00:30'));
  });

  it('keeps the seconds it was given rather than rounding the window', () => {
    const sentValue = formatSnowDateTimeForApi('2026-07-02 14:00:30');
    expect(sentValue.endsWith(':30')).toBe(true);
  });

  it('survives the round trip, which is what keeps a re-saved change from drifting', () => {
    // The two halves have to move the same amount in opposite directions. Fixing only the write
    // would make loading an existing change and saving it straight back shift its window by the
    // timezone offset every single time — a change that walks four hours earlier on each edit.
    const typedWallClock = '2026-07-02T13:00';
    const sentToServiceNow = formatSnowDateTimeForApi(typedWallClock);
    const shownWhenLoadedBack = expectedLocalInputFor(sentToServiceNow);

    expect(shownWhenLoadedBack).toBe(typedWallClock);
  });

  it('returns an empty string for empty or whitespace input', () => {
    expect(formatSnowDateTimeForApi('')).toBe('');
    expect(formatSnowDateTimeForApi('   ')).toBe('');
  });

  it('passes unrecognized values through untouched rather than fabricating a date', () => {
    expect(formatSnowDateTimeForApi('not-a-date')).toBe('not-a-date');
  });
});
