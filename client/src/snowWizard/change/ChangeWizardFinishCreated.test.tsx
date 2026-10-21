// ChangeWizardFinishCreated.test.tsx — End to end, through the real screens: a job whose changes already exist in
// ServiceNow is finished without ever creating a change, and every write lands on the right record.
//
// A small in-memory ServiceNow answers every read and records every write, so the test proves the two ways the owner
// finishes CHG0052017 (REL) and CHG0052018 (PRD): restoring a wiped job, and "Finish changes you already created".

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../services/jiraApi.ts';
import { snowFetch } from '../../services/snowApi.ts';
import { useWizardJobStore } from '../shell/wizardJobStore.ts';
import ChangeWizard from './ChangeWizard.tsx';
import { createChangeWizardSession, useChangeWizardSessionStore } from './changeWizardSession.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/problems/changeProblems.ts', () => ({ scanIssuesForProblems: vi.fn(async () => []) }));
vi.mock('./evidenceUpload.ts', () => ({ EVIDENCE_ATTACHED: 'attached', attachAllEvidenceToChanges: vi.fn(async (_evidence: unknown, changeNumbers: string[]) => ({ results: Object.fromEntries(changeNumbers.map((changeNumber) => [changeNumber, 'attached'])), problems: [] })) }));

const JOB_ID = 'job-finish-created';

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
      return { result: { sys_id: patchMatch[2] } } as never;
    }
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
  return screen.getAllByRole('button').find((button) => button.className.includes('primaryButton') && button.closest('section')) as HTMLButtonElement;
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
async function restoreAndFinish() {
  fireEvent.click(await screen.findByRole('button', { name: 'Restore my picks from CHG0052017' }));
  await screen.findByText(/Your picks are back from CHG0052017 and CHG0052018/);

  await expectStep('What\'s in this change?');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Enrollment (ENCUC)' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Jira project'), { target: { value: 'ENCUC' } });
  await waitFor(() => expect(screen.getByRole('option', { name: '10232026' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Release'), { target: { value: '10232026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find the issues' }));
  await screen.findByText('2 of 2 issues chosen');
  await pressNext();

  await expectStep('Tell us about the change');
  expect((screen.getByLabelText('Title (needed)') as HTMLInputElement).value).toBe('Enrollment Integration Services | October release');
  await pressNext();
  await expectStep('How will it go?');
  await pressNext();
  await expectStep('Where and when?');
  await pressNext();
  await expectStep('Build the tasks');
  expect(screen.getByText(/Enrollment - AWS - PRD/)).toBeTruthy();
  await pressNext();

  await expectStep('Create in ServiceNow');
  expect(screen.getByRole('link', { name: 'CHG0052018' })).toBeTruthy();
  expect(readNextButton().textContent).not.toMatch(/Create them/);
  await pressNext();

  await expectStep('Let AI write it');
  expect(screen.getByText(/CHG0052017 and CHG0052018 are in ServiceNow but not finished/)).toBeTruthy();
  const promptText = (screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value;
  expect(promptText).toContain('PRD change CHG0052018 — tasks: CTASK0100002 (Enrollment - AWS - PRD), CTASK0100003 (Business Checkout)');
  expect(promptText).toContain('ENCUC-2334');
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: [
    'IMPLEMENTATION_PLAN: 1. SCM deploys the release (CTASK0100002).', 'TEST_PLAN: 1. Business checkout (CTASK0100003).', 'BACKOUT_PLAN: 1. If checkout fails, SCM redeploys the prior build.',
  ].join('\n') } });
  fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Fill in \d+ fields?$/ }));

  // The one AI step: part 2 (pass review) shows once the plans are written, on the same screen.
  await screen.findByRole('heading', { name: '2 · Make it pass review' });
  await expectStep('Let AI write it');
  await pressNext();
  await expectStep('Add proof');
  fireEvent.click(screen.getByRole('button', { name: 'Skip — nothing to change' }));
  await expectStep('Will it pass review?');
  await screen.findByRole('list', { name: 'Checks' });
  if (readNextButton().disabled) fireEvent.click(within(screen.getByText(/I understand these are not all done/).closest('label') as HTMLElement).getByRole('checkbox'));
  await pressNext();
  await expectStep('Production paperwork');
  await pressNext();

  await expectStep('Save to ServiceNow');
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

describe('ChangeWizard — finishing changes that already exist', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    useWizardJobStore.setState({ jobs: {} });
    useChangeWizardSessionStore.setState({ sessions: {} });
    startFakeJira();
  });
  afterEach(() => cleanup());

  it('path 1: a job wiped by v0.312.0 restores its picks and saves to CHG0052017/18 without creating anything', async () => {
    const writeLog = startFakeServiceNow();
    useWizardJobStore.setState({ jobs: { newChange: { jobId: JOB_ID, kind: 'newChange', stepId: 'aiDraft', status: 'inProgress', updatedAt: Date.now(), payloadKey: 'draft' } } });
    useChangeWizardSessionStore.setState({ sessions: { [JOB_ID]: {
      ...createChangeWizardSession('create'), currentStepId: 'aiDraft',
      reviewedStepIds: ['scope', 'details', 'planning', 'environments', 'tasks', 'createChanges'],
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG0052017' }, { environmentLabel: 'PRD', changeNumber: 'CHG0052018' }],
      outcomeNotes: ['2 CHGs created: REL CHG0052017, PRD CHG0052018'],
    } } });
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await restoreAndFinish();

    expectEveryWriteOnItsOwnRecord(writeLog);
  }, 30_000);

  it('path 2: "Finish changes you already created" from the first screen does the same, with no job open', async () => {
    const writeLog = startFakeServiceNow();
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Finish one I started/ }));
    fireEvent.click(screen.getByText('Finish changes you already created'));
    fireEvent.change(screen.getByLabelText('REL change number'), { target: { value: 'CHG0052017' } });
    fireEvent.change(screen.getByLabelText('PRD change number'), { target: { value: 'CHG0052018' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish these changes' }));

    await restoreAndFinish();

    expectEveryWriteOnItsOwnRecord(writeLog);
  }, 30_000);
});
