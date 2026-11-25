// EnrollmentDashboardKitPanel.test.tsx — Proves the #511 kit panel is read-only and builds on the owner's own filter.
//
// The dashboard runs on ONE saved filter the owner already wrote ("All of Enrollment Query"). The panel must
// pre-select it from the favourites (pick, don't type), count every Rich Filters clause INSIDE it so the number
// matches what the gadget will show, flag a clause Jira rejects, and never write anything to Jira.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnrollmentDashboardKitPanel } from './EnrollmentDashboardKitPanel.tsx';

const jiraGetMock = vi.fn();
const searchUsersMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  searchUsers: (...args: unknown[]) => searchUsersMock(...args),
}));

const PO_FIELD_ID = 'field_77';
const BASE_JQL = 'project in (ENCUC, ENFCT) ORDER BY Rank';

/** Routes jiraGet paths to canned instance data; the Stuck clause is made to fail validation. */
function routeGet(path: string): Promise<unknown> {
  if (path === '/rest/api/2/field') return Promise.resolve([{ id: PO_FIELD_ID, name: 'Product Owner' }, { id: 'field_88', name: 'Story Points' }]);
  if (path.endsWith('/statuses')) {
    return Promise.resolve([{ name: 'Story', statuses: [
      { name: 'Done', statusCategory: { key: 'done' } }, { name: 'Ready to Work', statusCategory: { key: 'new' } },
    ] }]);
  }
  if (path === '/rest/api/2/filter/favourite') {
    return Promise.resolve([
      { id: '1', name: 'Someone else', jql: 'project = X' },
      { id: '266430', name: 'All of Enrollment Query', jql: BASE_JQL },
    ]);
  }
  if (path.startsWith('/rest/api/2/search') && decodeURIComponent(path).includes('NOT status CHANGED')) {
    return Promise.reject(new Error('Jira GET /rest/api/2/search failed: 400 — bad JQL'));
  }
  if (path.startsWith('/rest/api/2/search')) return Promise.resolve({ total: 12 });
  return Promise.resolve({});
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  jiraGetMock.mockImplementation(routeGet);
  searchUsersMock.mockImplementation((query: string) => Promise.resolve(query === 'Phatate'
    ? [{ accountId: 'a1', name: 'U581996', displayName: 'Phatate, Smita' }]
    : [{ accountId: 'a2', name: 'U586310', displayName: 'Watkins, Jen' }]));
});

async function discover() {
  render(<EnrollmentDashboardKitPanel />);
  await userEvent.click(screen.getByRole('button', { name: /discover/i }));
  await waitFor(() => expect(screen.getByText(/Discovery complete/i)).toBeInTheDocument());
}

describe('EnrollmentDashboardKitPanel', () => {
  it('pre-selects the existing base filter and each team\'s Product Owner from Jira\'s own lists', async () => {
    await discover();
    expect(screen.getByLabelText(/Base filter/i)).toHaveValue('266430');
    expect(screen.getByLabelText(/CUC Product Owner/i)).toHaveValue('U581996');
    expect(screen.getByLabelText(/Transformers Product Owner/i)).toHaveValue('U586310');
  });

  it('counts every clause inside the base filter, flags a rejected one, and never writes', async () => {
    await discover();
    await userEvent.click(screen.getByRole('button', { name: /check clauses/i }));
    await waitFor(() => expect(screen.getByText(/Check complete/i)).toBeInTheDocument());

    const searchedJql = jiraGetMock.mock.calls
      .map(([path]) => String(path))
      .filter((path) => path.startsWith('/rest/api/2/search'))
      .map((path) => decodeURIComponent(path.split('jql=')[1]));
    expect(searchedJql[0]).toBe('project in (ENCUC, ENFCT)');
    expect(searchedJql.slice(1).every((jql) => jql.startsWith('(project in (ENCUC, ENFCT)) AND ('))).toBe(true);
    expect(screen.getAllByText(/Smart filter "Team"/).length).toBe(2);
    expect(screen.getByText(/bad JQL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('lays out the dashboard as a story and judges the Ready to Work supply from team work only', async () => {
    await discover();
    await userEvent.click(screen.getByRole('button', { name: /check clauses/i }));
    await waitFor(() => expect(screen.getByText(/Check complete/i)).toBeInTheDocument());

    expect(screen.getByText('6 · Is there enough Ready to Work?')).toBeInTheDocument();
    // Every count is 12: 12 done in 30 days is 2.8 a week, so 12 ready is 4.3 weeks.
    expect(screen.getByText(/4\.3 weeks of Ready to Work/)).toBeInTheDocument();
    const supplyJql = jiraGetMock.mock.calls
      .map(([path]) => decodeURIComponent(String(path).split('jql=')[1] ?? ''))
      .filter((jql) => jql.includes('status = "Ready to Work"') && jql.includes('issuetype != Epic'));
    expect(supplyJql.length).toBeGreaterThan(0);
  });

  it('says how to fix a 401 — click the relay bookmark in a signed-in Jira tab — instead of a bare code', async () => {
    // After a Jira migration the stored token is stale and every call is refused; the fix is the relay, not a code.
    jiraGetMock.mockRejectedValue(new Error('Jira GET /rest/api/2/field failed: 401'));
    render(<EnrollmentDashboardKitPanel />);
    await userEvent.click(screen.getByRole('button', { name: /discover/i }));
    await waitFor(() => expect(screen.getByText(/Discovery failed/i)).toBeInTheDocument());
    expect(screen.getByText(/Toolbox Relay bookmark in a signed-in Jira tab/i)).toBeInTheDocument();
  });
});
