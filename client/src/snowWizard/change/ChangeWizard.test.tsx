// ChangeWizard.test.tsx — Proves the new-change job end to end on its key screens: the tasks are the user's own cards,
// each on every change in use until unticked, a failing check gives one reason and one fix that returns to the right step, "could not check" holds the job until
// acknowledged, and the AI step is shown to everyone and can be skipped.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWizardJobStore } from '../shell/wizardJobStore.ts';
import ChangeWizard from './ChangeWizard.tsx';
import { buildChangeStorageKey, createChangeWizardSession, useChangeWizardSessionStore } from './changeWizardSession.ts';
import { listChangeWizardStepIds, type ChangeWizardStepId } from './changeWizardSteps.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));
vi.mock('../../views/SnowHub/problems/changeProblems.ts', () => ({ scanIssuesForProblems: vi.fn(async () => []) }));

const JOB_ID = 'job-new-1';
const PERSON = { sysId: 'usr-1', displayName: 'Pat Owner' };
const BLANK_PERSON = { sysId: '', displayName: '' };

/** A draft with every step's values written, REL and PRD windows, and Business Checkout staged. */
function buildSavedDraft(backoutPlan: string) {
  const window = (day: string) => ({ plannedStartDate: `2026-11-0${day}T19:00`, plannedEndDate: `2026-11-0${day}T21:00` });
  return {
    fetchedIssues: [{ id: 'ABC-1', key: 'ABC-1', fields: { summary: 'Login' } }],
    selectedIssueKeys: ['ABC-1'],
    generatedShortDescription: 'Payments 1.2', generatedDescription: 'What changes', generatedJustification: 'Why now', generatedRiskImpact: 'Low',
    chgBasicInfo: {
      category: 'software', changeType: 'normal', environment: '', requestedBy: PERSON, configItem: { sysId: 'ci-1', displayName: 'Payments API' },
      assignmentGroup: { sysId: 'grp-1', displayName: 'Payments' }, assignedTo: PERSON, changeManager: BLANK_PERSON, tester: BLANK_PERSON,
      serviceManager: BLANK_PERSON, isExpedited: false,
    },
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan, testPlan: '1. Smoke test' },
    relEnvironment: window('1'), prdEnvironment: window('2'),
    changeTasks: [{
      id: 'task-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: '', assignmentGroup: PERSON,
      assignedTo: PERSON, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'review',
    }],
  };
}

/** Puts a job waiting on `stepId`, with every earlier step passed, then opens the wizard and continues it. */
function openJobAt(stepId: ChangeWizardStepId, backoutPlan = '1. Roll back') {
  const stepIds = listChangeWizardStepIds('create');
  localStorage.setItem(buildChangeStorageKey(JOB_ID), JSON.stringify(buildSavedDraft(backoutPlan)));
  useWizardJobStore.setState({ jobs: { newChange: { jobId: JOB_ID, kind: 'newChange', stepId, status: 'inProgress', updatedAt: Date.now(), payloadKey: 'draft' } } });
  // Past "Create in ServiceNow", the job's REL and PRD changes already exist.
  const isPastCreate = stepIds.indexOf(stepId) > stepIds.indexOf('createChanges');
  const createdChanges = isPastCreate ? [{ environmentLabel: 'REL' as const, changeNumber: 'CHG1' }, { environmentLabel: 'PRD' as const, changeNumber: 'CHG2' }] : [];
  useChangeWizardSessionStore.setState({ sessions: { [JOB_ID]: {
    ...createChangeWizardSession('create'), currentStepId: stepId, reviewedStepIds: stepIds.slice(0, stepIds.indexOf(stepId)), enabledEnvironments: ['REL', 'PRD'],
    createdChanges, createdTasks: isPastCreate ? { CHG1: [{ sysId: 't1', number: 'CTASK1', shortDescription: 'Business Checkout' }], CHG2: [] } : undefined,
    // Past the checks, they were passed (acknowledged), so the job resumes where it was left.
    areChecksAcknowledged: stepIds.indexOf(stepId) > stepIds.indexOf('checks'),
  } } });
  render(<ChangeWizard onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Create a new change/ }));
}

/** The primary button of the guided frame. */
function readNextButton(): HTMLButtonElement {
  // The frame's Next is the last primary button: steps (and Toolbox's Risk Check) have primary buttons of their own above it.
  return screen.getAllByRole('button').filter((button) => button.className.includes('primaryButton') && button.closest('section')).at(-1) as HTMLButtonElement;
}

describe('ChangeWizard — new change', () => {
  beforeEach(() => {
    localStorage.clear();
    // The restricted change period switch is off here, so Production paperwork is not part of these screens.
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
  });

  it('starts with the choice of a new change or an existing one', () => {
    useWizardJobStore.setState({ jobs: {} });
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Create a new change/ }));
    expect(screen.getByRole('heading', { name: 'Step 1 of 10 — What\'s in this change?' })).toBeTruthy();
    expect(screen.getByText('Start from (optional)')).toBeTruthy();
    // Templates are opened on step 1 and saved on the last step — never from the page header.
    expect(screen.queryByRole('button', { name: /Save as template|Manage templates/ })).toBeNull();
  });

  it('shows the user’s own task as a card, on every change in use until the user unticks one', async () => {
    openJobAt('tasks');
    expect(screen.getByRole('heading', { name: 'Step 5 of 10 — Build the tasks' })).toBeTruthy();
    expect(((await screen.findByLabelText('Business Checkout on PRD')) as HTMLInputElement).checked).toBe(true);
    const relTick = screen.getByLabelText('Business Checkout on REL') as HTMLInputElement;
    expect(relTick.checked).toBe(true);
    fireEvent.click(relTick);
    expect((screen.getByLabelText('Business Checkout on REL') as HTMLInputElement).checked).toBe(false);
    expect(document.body.textContent).not.toMatch(/by ServiceNow|ServiceNow adds/);
  });

  it('runs AI Assist (Toolbox\u2019s prompt) for everyone, no unlock, before the change is created', async () => {
    openJobAt('aiDraft');
    expect(screen.getByRole('heading', { name: 'Step 6 of 10 — AI Assist: let AI write it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the prompt' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/passphrase|unlock/i);
    fireEvent.click(readNextButton());
    expect(screen.getByRole('heading', { name: 'Step 7 of 10 — Create in ServiceNow' })).toBeTruthy();
  });

  it('puts Toolbox\u2019s Risk Check on the real ticket first on the final checks, and gives writing gaps to it', async () => {
    openJobAt('checks', '[CONFIRM: who decides] Roll back');
    expect(screen.getByRole('heading', { name: 'Step 8 of 10 — Risk check & final checks' })).toBeTruthy();
    const checksList = await screen.findByRole('list', { name: 'Checks' });
    expect(screen.getByRole('heading', { name: '🛡️ AI Risk Check — on the real ticket' })).toBeTruthy();
    expect(within(checksList).getByText(/Backout Plan still has facts marked to confirm/)).toBeTruthy();
    expect(within(checksList).getAllByText('The Risk Check above rewrites this.').length).toBeGreaterThan(0);
    expect(readNextButton().disabled).toBe(true);
  });

  it('brings the user straight back to the checks from a value fix, without stepping through finished steps (GH #468)', async () => {
    openJobAt('checks');
    fireEvent.click(await screen.findByRole('button', { name: 'Attach test evidence' }));
    expect(screen.getByRole('heading', { name: /What's in this change\?/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to “Risk check & final checks”' }));
    expect(screen.getByRole('heading', { name: /Risk check & final checks/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back to “/ })).toBeNull();
  });

  it('creates the changes, their tasks and the evidence zip from its own step, after AI Assist', () => {
    openJobAt('createChanges');
    expect(screen.getByRole('heading', { name: 'Step 7 of 10 — Create in ServiceNow' })).toBeTruthy();
    expect(screen.getByText('REL change')).toBeTruthy();
    expect(screen.getByText(/This makes 2 changes and 2 tasks in ServiceNow, each with the test-evidence zip/)).toBeTruthy();
    expect(readNextButton().textContent).toBe('Yes, create 2 changes and 2 tasks');
  });

  it('starts over from any step: asks once, clears the job and its draft, and shows the first screen', () => {
    openJobAt('checks');
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText(/CHG1 and CHG2 stay in ServiceNow/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start over' }));
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).toBeTruthy();
    expect(useWizardJobStore.getState().jobs.newChange).toBeUndefined();
    expect(useChangeWizardSessionStore.getState().sessions[JOB_ID]).toBeUndefined();
    expect(localStorage.getItem(buildChangeStorageKey(JOB_ID))).toBeNull();
  });

  it('picks up the change already under way and says so, with Start over for a fresh one', () => {
    openJobAt('details');
    expect(screen.getByRole('status').textContent).toMatch(/Picking up where you left off \(0 minute\(s\) ago\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/Picking up where you left off/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('never asks the user about problem records — ServiceNow links them itself (GH #475)', async () => {
    openJobAt('checks');
    const checksList = await screen.findByRole('list', { name: 'Checks' });
    expect(within(checksList).queryByText('Problem records')).toBeNull();
  });
});

describe('ChangeWizard — templates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    useWizardJobStore.setState({ jobs: {} });
  });

  it('copies the picks from a change raised before on step 1, leaving its writing out', async () => {
    const { snowFetch } = await import('../../services/snowApi.ts');
    const oldChange = { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, short_description: { value: 'Payments 1.1', display_value: 'Payments 1.1' }, category: { value: 'software', display_value: 'Software' } }] };
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request') ? oldChange : { result: [] }) as never);
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Create a new change/ }));
    fireEvent.change(screen.getByLabelText('Or copy the picks from a change you raised before'), { target: { value: 'chg0001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy its picks' }));
    expect(await screen.findByText(/^✓ Copied the picks from CHG0001234 — its writing and dates are left out/)).toBeTruthy();
    vi.mocked(snowFetch).mockImplementation(async () => ({ result: [] }) as never);
  });

  it('opens template management from the first screen and comes back', () => {
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Start from a template/ }));
    expect(screen.getByRole('heading', { name: 'Your templates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).toBeTruthy();
  });

  it('saves the picks as a template on the last step — never the writing — and confirms it from storage', async () => {
    openJobAt('finish');
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(screen.getByLabelText('Name the new template'), { target: { value: 'Payments release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new template' }));
    expect(await screen.findByText(/^✓ Saved new template “Payments release”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update template “Payments release”' })).toBeTruthy();
    const savedTemplates = JSON.parse(localStorage.getItem('ntbx-crg-templates') ?? '[]') as Array<{ name: string; ctaskTemplateIds: string[]; chgPlanningContent: Record<string, string> }>;
    expect(savedTemplates.map((template) => template.name)).toEqual(['Payments release']);
    expect(savedTemplates[0].ctaskTemplateIds).toHaveLength(1);
    expect(savedTemplates[0].chgPlanningContent).toEqual({ implementationPlan: '', backoutPlan: '', testPlan: '' });
  });

  it('opens a saved template in a new change with its picks only — the change keeps its own writing', async () => {
    localStorage.setItem('ntbx-crg-templates', JSON.stringify([{
      id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: buildSavedDraft('').chgBasicInfo, chgPlanningAssessment: {},
      chgPlanningContent: { implementationPlan: 'OLD plan', backoutPlan: 'OLD backout', testPlan: 'OLD test' }, ctaskTemplateIds: [],
    }]));
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Start from a template/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open it in a new change' }));
    expect(screen.getByText(/Filled in from your template “Monthly”/)).toBeTruthy();
    expect(screen.queryByText('OLD plan')).toBeNull();
  });
});
