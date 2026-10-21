// ChangeWizard.test.tsx — Proves the new-change job end to end on its key screens: the tasks are the user's own cards,
// each on every change in use until unticked, a failing check gives one reason and one fix that returns to the right step, "could not check" holds the job until
// acknowledged, and the AI step is shown to everyone and can be skipped.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanIssuesForProblems } from '../../views/SnowHub/problems/changeProblems.ts';
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
  } } });
  render(<ChangeWizard onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

/** The primary button of the guided frame. */
function readNextButton(): HTMLButtonElement {
  return screen.getAllByRole('button').find((button) => button.className.includes('primaryButton') && button.closest('section')) as HTMLButtonElement;
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
    fireEvent.click(screen.getByRole('button', { name: /New change/ }));
    expect(screen.getByRole('heading', { name: 'Step 1 of 12 — What\'s in this change?' })).toBeTruthy();
  });

  it('shows the user’s own task as a card, on every change in use until the user unticks one', async () => {
    openJobAt('tasks');
    expect(screen.getByRole('heading', { name: 'Step 5 of 12 — Build the tasks' })).toBeTruthy();
    expect(((await screen.findByLabelText('Business Checkout on PRD')) as HTMLInputElement).checked).toBe(true);
    const relTick = screen.getByLabelText('Business Checkout on REL') as HTMLInputElement;
    expect(relTick.checked).toBe(true);
    fireEvent.click(relTick);
    expect((screen.getByLabelText('Business Checkout on REL') as HTMLInputElement).checked).toBe(false);
    expect(document.body.textContent).not.toMatch(/by ServiceNow|ServiceNow adds/);
  });

  it('shows the AI step to everyone, with no unlock, and lets it be skipped', async () => {
    openJobAt('aiEnhance');
    expect(await screen.findByRole('button', { name: 'Copy the prompt' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/passphrase|unlock/i);
    fireEvent.click(screen.getByRole('button', { name: 'Skip — nothing to change' }));
    expect(screen.getByRole('heading', { name: 'Step 9 of 12 — Add proof' })).toBeTruthy();
  });

  it('fixes a flagged plan with "Fix all with AI" on the checks step itself, and the check clears (GH #468)', async () => {
    openJobAt('checks', '[CONFIRM: who decides] Roll back');
    await screen.findByRole('heading', { name: '✨ Fix all with AI' });
    expect(within(screen.getByRole('list', { name: 'Checks' })).getByText(/Backout Plan still has facts marked to confirm/)).toBeTruthy();
    expect(readNextButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'BACKOUT_PLAN: 1. If login fails, the change owner redeploys v1.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Checks' })).queryByText(/Backout Plan still has facts marked to confirm/)).toBeNull());
    expect(screen.getByRole('heading', { name: /Will it pass review\?/ })).toBeTruthy();
  });

  it('brings the user straight back to the checks from a value fix, without stepping through finished steps (GH #468)', async () => {
    openJobAt('checks');
    fireEvent.click(await screen.findByRole('button', { name: 'Attach test evidence' }));
    expect(screen.getByRole('heading', { name: /Add proof/ })).toBeTruthy();
    const backButton = screen.getByRole('button', { name: 'Back to “Will it pass review?”' });
    fireEvent.click(backButton);
    expect(screen.getByRole('heading', { name: /Will it pass review\?/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back to “/ })).toBeNull();
  });

  it('creates the changes in ServiceNow before any writing, from its own step', () => {
    openJobAt('createChanges');
    expect(screen.getByRole('heading', { name: 'Step 6 of 12 — Create in ServiceNow' })).toBeTruthy();
    expect(screen.getByText('REL change')).toBeTruthy();
    expect(readNextButton().textContent).toBe('Create them in ServiceNow');
  });

  it('offers to restore the picks of a job wiped when its changes were created (v0.312.0)', () => {
    useWizardJobStore.setState({ jobs: { newChange: { jobId: JOB_ID, kind: 'newChange', stepId: 'aiDraft', status: 'inProgress', updatedAt: Date.now(), payloadKey: 'draft' } } });
    useChangeWizardSessionStore.setState({ sessions: { [JOB_ID]: {
      ...createChangeWizardSession('create'), currentStepId: 'aiDraft', enabledEnvironments: ['REL', 'PRD'],
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG0052017' }, { environmentLabel: 'PRD', changeNumber: 'CHG0052018' }],
    } } });
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert').textContent).toContain('CHG0052017 and CHG0052018 were created');
    expect(screen.getByRole('button', { name: 'Restore my picks from CHG0052017' })).toBeTruthy();
  });

  it('copies an old change into the new change already open, instead of a dead button', async () => {
    const { snowFetch } = await import('../../services/snowApi.ts');
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request')
      ? { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, short_description: { value: 'Payments 1.1', display_value: 'Payments 1.1' } }] }
      : { result: [] }) as never);
    openJobAt('details');
    fireEvent.click(screen.getByRole('button', { name: 'Save and leave' }));
    cleanup();
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'CHG0052017' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy it into my open change' }));
    await waitFor(() => expect((screen.getByLabelText('Title (needed)') as HTMLInputElement).value).toBe('Payments 1.1'));
    vi.mocked(snowFetch).mockImplementation(async () => ({ result: [] }) as never);
  });

  it('gives the AI the real change and task numbers once the changes exist', () => {
    openJobAt('aiDraft');
    const promptText = (screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value;
    expect(promptText).toContain('REL change CHG1 — tasks: CTASK1 (Business Checkout)');
    expect(promptText).toContain('never invent a number');
  });

  it('holds the job on "could not check" until the user acknowledges it', async () => {
    vi.mocked(scanIssuesForProblems).mockRejectedValueOnce(new Error('HTTP 403'));
    openJobAt('checks');
    await screen.findByText('Not checked: Could not read the problem records named in the chosen issues.');
    expect(readNextButton().disabled).toBe(true);
    expect(screen.getByText(/The last step stays locked/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(readNextButton().disabled).toBe(false));
  });
});

describe('ChangeWizard — templates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    useWizardJobStore.setState({ jobs: {} });
  });

  it('copies a change raised before into a new change, then recommends saving it as a template', async () => {
    const { snowFetch } = await import('../../services/snowApi.ts');
    const oldChange = { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, short_description: { value: 'Payments 1.1', display_value: 'Payments 1.1' } }] };
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request') ? oldChange : { result: [] }) as never);
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'chg0001234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start from an existing change' }));
    expect(screen.getByRole('heading', { name: 'Step 1 of 12 — What\'s in this change?' })).toBeTruthy();
    expect(await screen.findByText(/Copied CHG0001234 into a new change/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save as template' })).toBeNull();
    vi.mocked(snowFetch).mockImplementation(async () => ({ result: [] }) as never);
  });

  it('manages templates from inside a job, replacing one with the change in hand, and returns to the same step', () => {
    localStorage.setItem('ntbx-crg-templates', JSON.stringify([{ id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: {}, chgPlanningAssessment: {}, chgPlanningContent: {}, ctaskTemplateIds: [] }]));
    openJobAt('details');
    fireEvent.click(screen.getByRole('button', { name: 'Manage templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with this change' }));
    expect(screen.getByText('“Monthly” now holds this change ✓')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Step 2 of 12 — Tell us about the change' })).toBeTruthy();
  });

  it('opens template management from the first screen and comes back', () => {
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage templates' }));
    expect(screen.getByRole('heading', { name: 'Your templates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Make or change a change' })).toBeTruthy();
  });

  it('offers "Save as template" from the details step on, and saves the change in hand', () => {
    openJobAt('details');
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(screen.getByLabelText('Name this template'), { target: { value: 'Payments release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
    const savedTemplates = JSON.parse(localStorage.getItem('ntbx-crg-templates') ?? '[]') as Array<{ name: string; ctaskTemplateIds: string[] }>;
    expect(savedTemplates.map((template) => template.name)).toEqual(['Payments release']);
    expect(savedTemplates[0].ctaskTemplateIds).toHaveLength(1);
  });

  it('starts a new change from a saved template', () => {
    openJobAt('details');
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    fireEvent.change(screen.getByLabelText('Name this template'), { target: { value: 'Payments release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    cleanup();
    useWizardJobStore.setState({ jobs: {} });
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Your saved templates'), { target: { value: (JSON.parse(localStorage.getItem('ntbx-crg-templates') ?? '[]') as Array<{ id: string }>)[0].id } });
    fireEvent.click(screen.getByRole('button', { name: 'Start from a template' }));
    expect(screen.getByText(/Filled in from your template “Payments release”/)).toBeTruthy();
  });
});
