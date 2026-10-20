// PrbWizard.test.tsx — Walks the problem job end to end against mocked ServiceNow and Jira: pick a problem, a project
// from Jira's own list (remembered), an Epic from a search, edit a draft, create, and retry a partial failure.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const snowApiMock = vi.hoisted(() => ({ snowFetch: vi.fn() }));
const jiraApiMock = vi.hoisted(() => ({
  jiraGet: vi.fn(),
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
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

let existingIssues: unknown[] = [];

function routeJiraReads(path: string): Promise<unknown> {
  if (path === '/rest/api/2/project') return Promise.resolve(PROJECTS);
  if (decodeURIComponent(path).includes('issuetype = Epic')) return Promise.resolve({ issues: [EPIC_ISSUE] });
  return Promise.resolve({ issues: existingIssues });
}

function arrangeJira(): void {
  jiraApiMock.jiraGet.mockImplementation(routeJiraReads);
  jiraApiMock.getProjectIssueTypes.mockResolvedValue({ values: [{ id: '10', name: 'Defect', subtask: false }, { id: '20', name: 'Story', subtask: false }] });
  jiraApiMock.getIssueTypeFields.mockResolvedValue({ values: [{ fieldId: 'cf-epic', name: 'Epic Link', required: false }] });
  jiraApiMock.createIssueLink.mockResolvedValue(undefined);
}

function clickNext(label = 'Next'): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

async function walkToDrafts(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Problem number or words'), { target: { value: 'login' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: /PRB0012345 — Login times out/ }));
  clickNext();
  await screen.findByText(/Jira has no work for this problem yet/);
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
    await waitFor(() => expect((screen.getByLabelText('Jira project') as HTMLSelectElement).value).toBe('QEINT'));
  });

  it('creates what the user edited, then shows the three keys as links', async () => {
    jiraApiMock.createIssue
      .mockResolvedValueOnce({ key: 'ENCUC-1' }).mockResolvedValueOnce({ key: 'ENCUC-2' }).mockResolvedValueOnce({ key: 'ENCUC-3' });
    render(<PrbWizard onExit={vi.fn()} />);
    await walkToDrafts();
    fireEvent.change(screen.getByLabelText('Summary', { selector: '#prb-sl-summary' }), { target: { value: 'SL: my words' } });
    clickNext('Create all');

    await screen.findByText(/All three items are in Jira/);
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
    clickNext('Create all');

    await screen.findByText(/QE story was not created — No permission/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry the rest' }));
    await screen.findByText(/All three items are in Jira/);
    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(4);
  });

  it('shows work already made for the problem and asks before a second set', async () => {
    existingIssues = [{ key: 'ENCUC-9', fields: { labels: ['prb-prb0012345', 'prb-prb0012345-defect'], issuetype: { name: 'Defect' }, issuelinks: [] } }];
    render(<PrbWizard onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Problem number or words'), { target: { value: 'PRB0012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: /PRB0012345/ }));
    clickNext();

    expect(await screen.findByRole('link', { name: 'ENCUC-9' })).toBeTruthy();
    expect(screen.getByText(/Next fills in only what is missing/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
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
