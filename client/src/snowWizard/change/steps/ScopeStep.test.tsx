// ScopeStep.test.tsx — Proves Scope finds a project by key, lists a release's issues, lets one be dropped or added by key, and says when a release is empty.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../../../services/jiraApi.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import ScopeStep from './ScopeStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

/** A Jira issue with only what the step shows. */
function buildIssue(issueKey: string, summary: string) {
  return { id: issueKey, key: issueKey, fields: { summary, status: { name: 'Done' }, issuetype: { name: 'Story' } } };
}

/** Answers each Jira read the step makes; `releaseIssues` is what the release search returns. */
function mockJira(releaseIssues: unknown[]) {
  vi.mocked(jiraGet).mockImplementation(async (path: string) => {
    if (path === '/rest/api/2/project') return [{ key: 'ABC', name: 'Payments' }] as never;
    if (path.includes('/versions')) return [{ id: '1', name: 'Release 12', released: false }] as never;
    if (path.includes(encodeURIComponent('key = ABC-9'))) return { issues: [buildIssue('ABC-9', 'Late fix')] } as never;
    return { issues: releaseIssues } as never;
  });
}

function Harness() {
  const crg = useCrgState({ storageKey: 'snowWizard:change:scope-test' });
  const [session] = useState(createChangeWizardSession('create'));
  return <ScopeStep crg={crg} session={session} updateSession={vi.fn()} goToStep={vi.fn()} />;
}

/** Picks the project and release, then searches. */
async function findReleaseIssues() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'ABC — Payments' })).toBeTruthy());
  // Found by typing its key, the way people know a project.
  fireEvent.change(screen.getByLabelText('Find a project by key or name'), { target: { value: 'abc' } });
  expect((screen.getByLabelText('Jira project') as HTMLSelectElement).value).toBe('ABC');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Release 12' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Release'), { target: { value: 'Release 12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find the issues' }));
}

describe('ScopeStep', () => {
  beforeEach(() => localStorage.clear());

  it('lists the release\'s issues, lets one be dropped, and adds another by key', async () => {
    mockJira([buildIssue('ABC-1', 'Login'), buildIssue('ABC-2', 'Logout'), buildIssue('ABC-3', 'Reset')]);
    render(<Harness />);
    await findReleaseIssues();
    await waitFor(() => expect(screen.getByText('3 of 3 issues chosen')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('ABC-2 — Logout'));
    expect(screen.getByText('2 of 3 issues chosen')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Add one more issue by its key'), { target: { value: 'abc-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('3 of 4 issues chosen')).toBeTruthy());
    expect(screen.getByLabelText('ABC-9 — Late fix')).toBeTruthy();
    // The user's own release search is put back after the one-issue add.
    await waitFor(() => expect(screen.getByRole('button', { name: 'By release' }).className).toMatch(/Selected/));
  });

  it('says so when the release holds no issues', async () => {
    mockJira([]);
    render(<Harness />);
    await findReleaseIssues();
    await waitFor(() => expect(screen.getByText(/That found no issues/)).toBeTruthy());
  });

  it('refuses something that is not an issue key', async () => {
    mockJira([]);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Add one more issue by its key'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/does not look like a Jira key/)).toBeTruthy();
  });
});
