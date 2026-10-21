// ChangeWizardSaveCreated.test.tsx — End to end, through the real screens: a new change whose CHGs are already created
// is reopened, written by AI Assist, risk-checked with Toolbox's own Risk Check, and saved — creating nothing more, and
// every write landing on its own record.
//
// A small in-memory ServiceNow answers every read and records every write, so the test proves the path the owner
// takes after "Create in ServiceNow": REL CHG0052017 and PRD CHG0052018, each with its own CTASKs.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../services/jiraApi.ts';
import { snowFetch } from '../../services/snowApi.ts';
import { useWizardJobStore } from '../shell/wizardJobStore.ts';
import ChangeWizard from './ChangeWizard.tsx';
import { buildChangeStorageKey, createChangeWizardSession, useChangeWizardSessionStore } from './changeWizardSession.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/problems/changeProblems.ts', () => ({ scanIssuesForProblems: vi.fn(async () => []) }));
vi.mock('./evidenceUpload.ts', () => ({ EVIDENCE_ATTACHED: 'attached', attachAllEvidenceToChanges: vi.fn(async (_evidence: unknown, changeNumbers: string[]) => ({ results: Object.fromEntries(changeNumbers.map((changeNumber) => [changeNumber, 'attached'])), problems: [] })) }));

const JOB_ID = 'job-save-created';

/** A ServiceNow field as it comes back with sysparm_display_value=all. */
function both(value: string, displayValue = value) {
  return { value, display_value: displayValue };
}

/** One change as ServiceNow holds it right after the Wizard created it (before the writing). */
function buildChangeRecord(sysId: string, number: string, configItemSysId: string, configItemName: string, startUtc: string, endUtc: string, environmentValue: string) {
  return {
    sys_id: both(sysId), number: both(number), state: both('-5', 'New'),
    short_description: both('Enrollment Integration Services | October release'), description: both(''), justification: both(''), risk_impact_analysis: both(''),
    implementation_plan: both(''), backout_plan: both(''), test_plan: both(''),
    category: both('software', 'Software'), type: both('standard', 'Standard'), u_environment: both(environmentValue),
    cmdb_ci: both(configItemSysId, configItemName), assignment_group: both('grp-1', 'MA Growth IT - Enrollment Integration Delivery'),
    assigned_to: both('usr-1', 'Smith, Michael'), requested_by: both('usr-2', 'Neal, Jeremiah'),
    start_date: both(startUtc), end_date: both(endUtc),
  };
}

/** One task on a change, as both the clone read and the number read see it. */
function buildTaskRecord(sysId: string, number: string, shortDescription: string, changeSysId: string) {
  return {
    sys_id: both(sysId), number: both(number), short_description: both(shortDescription), description: both('Production deployment'),
    change_request: both(changeSysId), change_task_type: both('implementation', 'Implementation'),
    assignment_group: both('grp-2', 'USGov ST - SCM'), assigned_to: both('usr-3', 'Vazquez, Isaura Abigail'),
    planned_start_date: both(''), planned_end_date: both(''),
  };
}

const CHANGES = [
  buildChangeRecord('sys-rel', 'CHG0052017', 'ci-rel', 'DMOM Enrollment - EAM Facets Integration - AWS - Release', '2026-10-22 23:00:00', '2026-10-23 01:00:00', 'release'),
  buildChangeRecord('sys-prd', 'CHG0052018', 'ci-prd', 'DMOM Enrollment - EAM Facets Integration - AWS - Production', '2026-10-24 02:00:00', '2026-10-24 11:00:00', 'production'),
];
const TASKS: Record<string, ReturnType<typeof buildTaskRecord>[]> = {
  'sys-rel': [buildTaskRecord('task-rel-1', 'CTASK0100001', 'Enrollment - AWS - REL', 'sys-rel')],
  'sys-prd': [buildTaskRecord('task-prd-1', 'CTASK0100002', 'Enrollment - AWS - PRD', 'sys-prd'), buildTaskRecord('task-prd-2', 'CTASK0100003', 'Business Checkout', 'sys-prd')],
};

/** Every write the Wizard sends, by kind. */
interface WriteLog {
  changePosts: unknown[];
  changePatches: Array<{ sysId: string; body: Record<string, unknown> }>;
  taskPosts: unknown[];
  taskPatches: Array<{ sysId: string; body: Record<string, unknown> }>;
}

/** The in-memory ServiceNow: answers reads from CHANGES and TASKS, and records every write. */
function startFakeServiceNow(): WriteLog {
  const writeLog: WriteLog = { changePosts: [], changePatches: [], taskPosts: [], taskPatches: [] };
  vi.mocked(snowFetch).mockImplementation(async (rawPath: string, init?: RequestInit) => {
    const path = decodeURIComponent(rawPath);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const patchMatch = /\/(change_request|change_task)\/([^/?]+)/.exec(path);
    if (method === 'PATCH' && patchMatch) {
      (patchMatch[1] === 'change_request' ? writeLog.changePatches : writeLog.taskPatches).push({ sysId: patchMatch[2], body });
      const patchedTask = Object.values(TASKS).flat().find((task) => task.sys_id.value === patchMatch[2]);
      if (patchedTask && typeof body.assignment_group === 'string') patchedTask.assignment_group = both(body.assignment_group, 'Group');
      if (patchedTask && typeof body.assigned_to === 'string') patchedTask.assigned_to = both(body.assigned_to, 'Person');
      return { result: { sys_id: patchMatch[2] } } as never;
    }
    const singleTask = /\/change_task\/(task-[a-z0-9-]+)/.exec(path);
    if (singleTask) return { result: Object.values(TASKS).flat().find((task) => task.sys_id.value === singleTask[1]) } as never;
    if (method === 'POST') {
      (path.includes('change_task') ? writeLog.taskPosts : writeLog.changePosts).push(body);
      return { result: { number: 'CHG_DUPLICATE', sys_id: 'sys-duplicate' } } as never;
    }
    if (path.includes('/change_task')) {
      const byNumber = /change_request\.number=(CHG\d+)/.exec(path);
      const bySysId = /change_request=(sys-[a-z]+)/.exec(path);
      const changeSysId = byNumber ? CHANGES.find((change) => change.number.value === byNumber[1])?.sys_id.value : bySysId?.[1];
      return { result: TASKS[changeSysId ?? ''] ?? [] } as never;
    }
    const directChange = /\/change_request\/(sys-[a-z]+)/.exec(path);
    if (directChange) return { result: CHANGES.find((change) => change.sys_id.value === directChange[1]) } as never;
    const byChangeNumber = /number=(CHG\d+)/.exec(path);
    if (path.includes('/change_request') && byChangeNumber) return { result: CHANGES.filter((change) => change.number.value === byChangeNumber[1]) } as never;
    return { result: [] } as never;
  });
  return writeLog;
}

/** Jira: one project, one release, two issues — and no attachments. */
function startFakeJira() {
  vi.mocked(jiraGet).mockImplementation(async (path: string) => {
    if (path === '/rest/api/2/project') return [{ key: 'ENCUC', name: 'Enrollment' }] as never;
    if (path.includes('/versions')) return [{ id: '1', name: '10232026', released: false }] as never;
    return { issues: [
      { id: '1', key: 'ENCUC-2334', fields: { summary: 'Duplicate MBI processing', status: { name: 'Done' }, issuetype: { name: 'Defect' }, attachment: [] } },
      { id: '2', key: 'ENCUC-2082', fields: { summary: 'Force deny flag', status: { name: 'Done' }, issuetype: { name: 'Story' }, attachment: [] } },
    ] } as never;
  });
}

/** The primary button of the guided frame. */
function readNextButton(): HTMLButtonElement {
  // The frame's Next is the last primary button: steps (and Toolbox's Risk Check) have primary buttons of their own above it.
  return screen.getAllByRole('button').filter((button) => button.className.includes('primaryButton') && button.closest('section')).at(-1) as HTMLButtonElement;
}

/** Waits for a step's heading, by its title. */
async function expectStep(stepTitle: string) {
  await waitFor(() => expect(screen.getByRole("heading", { name: (headingName) => headingName.endsWith(`— ${stepTitle}`) })).toBeTruthy(), { timeout: 3000 }).catch((waitError: unknown) => { throw new Error(`${String(waitError)} — headings: ${screen.getAllByRole("heading").map((heading) => heading.textContent).join(" | ")}`); });
}

/** Presses Next once it is allowed. */
async function pressNext() {
  await waitFor(() => expect(readNextButton().disabled).toBe(false));
  fireEvent.click(readNextButton());
}

/** Restores the picks, chooses the Jira issues, and walks every step to "Save to ServiceNow", then saves. */
const PERSON = { sysId: 'usr-1', displayName: 'Smith, Michael' };
const BLANK = { sysId: '', displayName: '' };
const SCM = { sysId: 'grp-2', displayName: 'USGov ST - SCM' };
const VAZQUEZ = { sysId: 'usr-3', displayName: 'Vazquez, Isaura Abigail' };

/** One task card as the job built it: its own environment, title and people (the ones ServiceNow already holds). */
function buildCard(cardId: string, shortDescription: string, environmentKeys: Array<'REL' | 'PRD'>) {
  return {
    id: cardId, name: shortDescription, createdAt: '', shortDescription, description: 'Production deployment', changeTaskType: 'implementation',
    assignmentGroup: SCM, assignedTo: VAZQUEZ, plannedStartDate: '', plannedEndDate: '', closeNotes: '', environmentKeys,
  };
}

/** The job's draft as it stood when its changes were created: every pick made, the plans still to write. */
function buildCreatedDraft() {
  return {
    fetchedIssues: [{ id: '1', key: 'ENCUC-2334', fields: { summary: 'Duplicate MBI processing', status: { name: 'Done' }, issuetype: { name: 'Defect' } } }],
    selectedIssueKeys: ['ENCUC-2334'],
    generatedShortDescription: 'Enrollment Integration Services | October release', generatedDescription: 'Fixes ENCUC-2334', generatedJustification: 'Defects in production', generatedRiskImpact: 'Low',
    chgBasicInfo: {
      category: 'software', changeType: 'standard', environment: '', requestedBy: PERSON, configItem: { sysId: 'ci-rel', displayName: 'Release' },
      assignmentGroup: { sysId: 'grp-1', displayName: 'MA Growth IT - Enrollment Integration Delivery' }, assignedTo: PERSON,
      changeManager: BLANK, tester: BLANK, serviceManager: BLANK, isExpedited: false,
    },
    chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
    relEnvironment: { isEnabled: true, plannedStartDate: '2026-10-22T18:00', plannedEndDate: '2026-10-22T20:00', configItem: { sysId: 'ci-rel', displayName: 'Release' }, impactedPersonsAware: '', snowEnvironmentValue: 'release' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '2026-10-23T21:00', plannedEndDate: '2026-10-24T06:00', configItem: { sysId: 'ci-prd', displayName: 'Production' }, impactedPersonsAware: '', snowEnvironmentValue: 'production' },
    changeTasks: [buildCard('c1', 'Enrollment - AWS - REL', ['REL']), buildCard('c2', 'Enrollment - AWS - PRD', ['PRD']), buildCard('c3', 'Business Checkout', ['PRD'])],
  };
}

/** A new-change job reopened right after "Create in ServiceNow" made REL CHG0052017 and PRD CHG0052018. */
function openCreatedJob() {
  const createdSteps = ['scope', 'details', 'planning', 'environments', 'tasks'];
  localStorage.setItem(buildChangeStorageKey(JOB_ID), JSON.stringify(buildCreatedDraft()));
  useWizardJobStore.setState({ jobs: { newChange: { jobId: JOB_ID, kind: 'newChange', stepId: 'aiDraft', status: 'inProgress', updatedAt: Date.now(), payloadKey: 'draft' } } });
  useChangeWizardSessionStore.setState({ sessions: { [JOB_ID]: {
    ...createChangeWizardSession('create'), currentStepId: 'aiDraft', reviewedStepIds: createdSteps as never, enabledEnvironments: ['REL', 'PRD'],
    createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG0052017' }, { environmentLabel: 'PRD', changeNumber: 'CHG0052018' }],
  } } });
  render(<ChangeWizard onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /^Create a new change/ }));
}

/** AI Assist writes the plans, then the changes already exist, the Risk Check runs on the real ticket, and Save. */
async function writeCheckAndSave() {
  await expectStep('AI Assist: let AI write it');
  expect(screen.getByText(/CHG0052017 and CHG0052018 are in ServiceNow but not finished/)).toBeTruthy();
  expect((screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value).toContain('ENCUC-2334');
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: [
    'IMPLEMENTATION_PLAN: 1. SCM deploys the release (CTASK0100002).', 'TEST_PLAN: 1. Business checkout (CTASK0100003).', 'BACKOUT_PLAN: 1. If checkout fails, SCM redeploys the prior build.',
  ].join('\n') } });
  fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Fill in \d+ fields?$/ }));
  await pressNext();

  await expectStep('Create in ServiceNow');
  expect(screen.getByRole('link', { name: 'CHG0052018' })).toBeTruthy();
  expect(await screen.findByText(/CTASK0100002 Enrollment - AWS - PRD/)).toBeTruthy();
  expect(readNextButton().textContent).not.toMatch(/Yes, create/);
  await pressNext();

  await expectStep('Risk check & final checks');
  await screen.findByRole('list', { name: 'Checks' });
  expect(screen.getByRole('heading', { name: '🛡️ AI Risk Check — on the real ticket' })).toBeTruthy();
  if (readNextButton().disabled) fireEvent.click(within(screen.getByText(/I understand these are not all done/).closest('label') as HTMLElement).getByRole('checkbox'));
  await pressNext();
  await expectStep('Production paperwork');
  await pressNext();

  await expectStep('Save to ServiceNow');
  expect(screen.getByRole('heading', { name: 'Save the picks as a template (optional)' })).toBeTruthy();
  expect(readNextButton().textContent).toBe('Save to ServiceNow');
  fireEvent.click(readNextButton());
  await screen.findByText('All done. Everything below is in ServiceNow.', {}, { timeout: 5000 });
}

/** What every finished path must have written: each change to itself, each task to its own record, nothing created. */
function expectEveryWriteOnItsOwnRecord(writeLog: WriteLog) {
  expect(writeLog.changePosts).toEqual([]);
  expect(writeLog.taskPosts).toEqual([]);
  const relPatch = writeLog.changePatches.find((patch) => patch.sysId === 'sys-rel');
  const prdPatch = writeLog.changePatches.find((patch) => patch.sysId === 'sys-prd');
  expect(relPatch?.body.cmdb_ci).toBe('ci-rel');
  expect(prdPatch?.body.cmdb_ci).toBe('ci-prd');
  expect(String(prdPatch?.body.implementation_plan)).toContain('SCM deploys the release (CTASK0100002)');
  expect(prdPatch?.body.backout_plan).toBe('1. If checkout fails, SCM redeploys the prior build.');
  // Each change keeps its own window: REL's is not written onto PRD.
  expect(relPatch?.body.start_date).not.toBe(prdPatch?.body.start_date);
  const taskTitles = Object.fromEntries(writeLog.taskPatches.map((patch) => [patch.sysId, patch.body.short_description]));
  expect(taskTitles).toEqual({ 'task-rel-1': 'Enrollment - AWS - REL', 'task-prd-1': 'Enrollment - AWS - PRD', 'task-prd-2': 'Business Checkout' });
  expect(writeLog.taskPatches).toHaveLength(3);
}

describe('ChangeWizard — after "Create in ServiceNow": write, risk check and save', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    useWizardJobStore.setState({ jobs: {} });
    useChangeWizardSessionStore.setState({ sessions: {} });
    startFakeJira();
  });
  afterEach(() => cleanup());

  it('saves the finished work to CHG0052017 and CHG0052018 — each with its own values and tasks — creating nothing', async () => {
    const writeLog = startFakeServiceNow();
    openCreatedJob();

    await writeCheckAndSave();

    expectEveryWriteOnItsOwnRecord(writeLog);
  }, 30_000);
});
