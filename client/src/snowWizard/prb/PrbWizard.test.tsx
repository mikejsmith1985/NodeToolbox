// PrbWizard.test.tsx — Walks the problem job end to end against mocked ServiceNow and Jira: pick a problem, a project
// from Jira's own list (remembered), an Epic from a search, edit a draft, create, and retry a partial failure — and
// use issues already in Jira, making only what is missing.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snowApiMock = vi.hoisted(() => ({ snowFetch: vi.fn() }));
const jiraApiMock = vi.hoisted(() => ({
  jiraGet: vi.fn(),
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
  jiraPut: vi.fn(),
}));
vi.mock('../../services/snowApi.ts', () => snowApiMock);
vi.mock('../../services/jiraApi.ts', () => jiraApiMock);

import PrbWizard from './PrbWizard.tsx';
import { PRB_PROJECT_STORAGE_KEY } from './prbLookups.ts';

const PROBLEM_RECORD = {
  sys_id: { value: 's1' },
  number: { display_value: 'PRB0012345' },
  short_description: { display_value: 'Login times out' },
  description: { display_value: 'Users wait then fail.' },
  state: { display_value: 'Assess' },
};
const PROJECTS = [{ id: '1', key: 'ENCUC', name: 'Enrollment' }, { id: '2', key: 'QEINT', name: 'QE Integration' }];
const EPIC_ISSUE = { key: 'DENP-5', fields: { summary: 'Login rework', status: { name: 'In Progress' } } };

const HAND_MADE_STORY = { key: 'ENCUC-50', fields: { summary: 'Login SL work', issuetype: { name: 'Story' }, status: { name: 'Open' }, labels: [], issuelinks: [] } };

let existingIssues: unknown[] = [];

function routeJiraReads(path: string): Promise<unknown> {
  if (path === '/rest/api/2/project') return Promise.resolve(PROJECTS);
  const decodedPath = decodeURIComponent(path);
  if (decodedPath.includes('issuetype = Epic')) return Promise.resolve({ issues: [EPIC_ISSUE] });
  if (decodedPath.includes('labels = ')) return Promise.resolve({ issues: existingIssues });
  return Promise.resolve({ issues: [HAND_MADE_STORY] });
}

function arrangeJira(): void {
  jiraApiMock.jiraGet.mockImplementation(routeJiraReads);
  jiraApiMock.getProjectIssueTypes.mockResolvedValue({ values: [{ id: '10', name: 'Defect', subtask: false }, { id: '20', name: 'Story', subtask: false }] });
  jiraApiMock.getIssueTypeFields.mockResolvedValue({ values: [{ fieldId: 'cf-epic', name: 'Epic Link', required: false }] });
  jiraApiMock.createIssueLink.mockResolvedValue(undefined);
  jiraApiMock.jiraPut.mockResolvedValue(undefined);
}

function clickNext(label = 'Next'): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

async function walkToChoose(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Problem number or words'), { target: { value: 'login' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: /PRB0012345 — Login times out/ }));
  clickNext();
  await screen.findByText(/Jira (has no|already has) work for this problem/);
  clickNext();
  await screen.findByRole('group', { name: 'Defect' });
}

async function walkToDrafts(): Promise<void> {
  await walkToChoose();
  clickNext();
  const projectSelect = await screen.findByLabelText('Jira project') as HTMLSelectElement;
  await waitFor(() => expect(projectSelect.disabled).toBe(false));
  fireEvent.change(projectSelect, { target: { value: 'ENCUC' } });
  fireEvent.change(screen.getByLabelText('Search for the Epic (words or its key)'), { target: { value: 'login' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: /DENP-5 — Login rework/ }));
  clickNext();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  existingIssues = [];
  snowApiMock.snowFetch.mockResolvedValue({ result: [PROBLEM_RECORD] });
  arrangeJira();
});

describe('PrbWizard', () => {
  it('holds Next until a problem is chosen, with the reason shown', () => {
    render(<PrbWizard onExit={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Choose a problem from the list')).toBeTruthy();
  });

  it('offers projects only from Jira\'s own list and remembers the choice', async () => {
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToDrafts();
    expect(localStorage.getItem(PRB_PROJECT_STORAGE_KEY)).toBe('ENCUC');
  });

  it('pre-selects the remembered project', async () => {
    localStorage.setItem(PRB_PROJECT_STORAGE_KEY, 'QEINT');
    render(<PrbWizard onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Problem number or words'), { target: { value: 'PRB0012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /PRB0012345/ }));
    clickNext();
    await screen.findByText(/Jira has no work/);
    clickNext();
    clickNext();
    await waitFor(() => expect((screen.getByLabelText('Jira project') as HTMLSelectElement).value).toBe('QEINT'));
  });

  it('creates what the user edited, then shows the three keys as links', async () => {
    jiraApiMock.createIssue
      .mockResolvedValueOnce({ key: 'ENCUC-1' }).mockResolvedValueOnce({ key: 'ENCUC-2' }).mockResolvedValueOnce({ key: 'ENCUC-3' });
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToDrafts();
    fireEvent.change(screen.getByLabelText('Summary', { selector: '#prb-sl-summary' }), { target: { value: 'SL: my words' } });
    clickNext('Create');

    await screen.findByText(/Everything you chose is in Jira, and the stories are linked to the Defect/);
    expect(jiraApiMock.createIssue.mock.calls[1][0].fields.summary).toBe('SL: my words');
    expect(jiraApiMock.createIssue.mock.calls[0][0].fields['cf-epic']).toBe('DENP-5');
    expect(screen.getByRole('link', { name: 'ENCUC-1' }).getAttribute('href')).toMatch(/\/browse\/ENCUC-1$/);
    expect(screen.getByRole('link', { name: 'ENCUC-3' })).toBeTruthy();
  });

  it('shows what failed and retries only the rest', async () => {
    jiraApiMock.createIssue
      .mockResolvedValueOnce({ key: 'ENCUC-1' }).mockResolvedValueOnce({ key: 'ENCUC-2' }).mockRejectedValueOnce(new Error('No permission'))
      .mockResolvedValueOnce({ key: 'ENCUC-3' });
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToDrafts();
    clickNext('Create');

    await screen.findByText(/QE story was not created — No permission/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry the rest' }));
    await screen.findByText(/Everything you chose is in Jira/);
    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(4);
  });

  it('uses the Defect already made for the problem and makes only the stories, linked to it', async () => {
    existingIssues = [{ key: 'ENCUC-9', fields: { summary: 'x', labels: ['prb-prb0012345', 'prb-prb0012345-defect'], issuetype: { name: 'Defect' }, issuelinks: [] } }];
    jiraApiMock.createIssue.mockResolvedValueOnce({ key: 'ENCUC-10' }).mockResolvedValueOnce({ key: 'ENCUC-11' });
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToChoose();

    expect((screen.getAllByRole('radio', { name: 'Use one already in Jira' })[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('link', { name: 'ENCUC-9' })).toBeTruthy();
    clickNext();
    const projectSelect = await screen.findByLabelText('Jira project') as HTMLSelectElement;
    await waitFor(() => expect(projectSelect.disabled).toBe(false));
    fireEvent.change(projectSelect, { target: { value: 'ENCUC' } });
    fireEvent.change(screen.getByLabelText('Search for the Epic (words or its key)'), { target: { value: 'login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /DENP-5 — Login rework/ }));
    clickNext();
    expect(screen.queryByLabelText('Summary', { selector: '#prb-defect-summary' })).toBeNull();
    clickNext('Create');

    await screen.findByText(/Everything you chose is in Jira/);
    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(2);
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'ENCUC-10' }, outwardIssue: { key: 'ENCUC-9' } });
  });

  it('uses a story made by hand and leaves the other out — labelling and linking without making anything', async () => {
    existingIssues = [{ key: 'ENCUC-9', fields: { summary: 'x', labels: ['prb-prb0012345', 'prb-prb0012345-defect'], issuetype: { name: 'Defect' }, issuelinks: [] } }];
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToChoose();
    fireEvent.click(screen.getAllByRole('radio', { name: 'Use one already in Jira' })[1]);
    fireEvent.change(screen.getByLabelText('Find the SL story in Jira (words or its key)'), { target: { value: 'ENCUC-50' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[1]);
    fireEvent.click(await screen.findByRole('button', { name: /ENCUC-50 — Login SL work/ }));
    fireEvent.click(screen.getAllByRole('radio', { name: "Don't make one" })[2]);
    clickNext('Create');

    await screen.findByText(/Everything you chose is in Jira/);
    expect(jiraApiMock.createIssue).not.toHaveBeenCalled();
    expect(jiraApiMock.jiraPut).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-50', { update: { labels: [{ add: 'prb-prb0012345' }, { add: 'prb-prb0012345-sl' }] } });
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'ENCUC-50' }, outwardIssue: { key: 'ENCUC-9' } });
    expect(screen.queryByText(/QE story/)).toBeNull();
  });

  it('goes back to home from any step', () => {
    const onExit = vi.fn();
    render(<PrbWizard onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('never shows internal field names', async () => {
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToDrafts();
    expect(document.body.textContent ?? '').not.toMatch(/\bu_\w+|cmdb_ci|customfield_|sys_id/);
  });
});
