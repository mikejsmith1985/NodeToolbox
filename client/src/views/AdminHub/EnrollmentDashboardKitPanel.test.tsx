// EnrollmentDashboardKitPanel.test.tsx — Proves the #511 kit panel discovers, previews read-only, then writes on Apply.
//
// The panel writes saved filters to production Jira, so the key assertions are restraint (discover and dry run
// never write), pick-don't-type (each PO comes from a dropdown pre-selected by name), and correctness of the
// Apply writes (create with favourite, share with both team projects, skip a filter whose JQL Jira rejected).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnrollmentDashboardKitPanel } from './EnrollmentDashboardKitPanel.tsx';

const jiraGetMock = vi.fn();
const jiraPutMock = vi.fn();
const jiraPostMock = vi.fn();
const searchUsersMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  jiraPut: (...args: unknown[]) => jiraPutMock(...args),
  jiraPost: (...args: unknown[]) => jiraPostMock(...args),
  searchUsers: (...args: unknown[]) => searchUsersMock(...args),
}));

const PO_FIELD_ID = 'field_77';

/** Routes jiraGet paths to canned instance data; the Stuck filter's JQL is made to fail validation. */
function routeGet(path: string): Promise<unknown> {
  if (path === '/rest/api/2/field') return Promise.resolve([{ id: PO_FIELD_ID, name: 'Product Owner' }]);
  if (path === '/rest/api/2/project/ENCUC') return Promise.resolve({ id: '100' });
  if (path === '/rest/api/2/project/ENFCT') return Promise.resolve({ id: '200' });
  if (path.endsWith('/statuses')) {
    return Promise.resolve([{ name: 'Story', statuses: [{ name: 'Done', statusCategory: { key: 'done' } }] }]);
  }
  if (path === '/rest/api/2/filter/favourite') return Promise.resolve([]);
  if (path.includes('/permission')) return Promise.resolve([]);
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
  jiraPostMock.mockImplementation((path: string) => Promise.resolve(path === '/rest/api/2/filter' ? { id: '9' } : {}));
  searchUsersMock.mockImplementation((query: string) => Promise.resolve(query === 'Phatate'
    ? [{ accountId: 'a1', name: 'U581996', displayName: 'Phatate, Smita' }]
    : [{ accountId: 'a2', name: 'U586310', displayName: 'Watkins, Jen' }]));
});

/** Runs Discover and Dry run, the two read-only steps. */
async function discoverAndPreview() {
  render(<EnrollmentDashboardKitPanel />);
  await userEvent.click(screen.getByRole('button', { name: /discover/i }));
  await waitFor(() => expect(screen.getByText(/Discovery complete/i)).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /dry run/i }));
  await waitFor(() => expect(screen.getByText(/Dry run complete/i)).toBeInTheDocument());
}

describe('EnrollmentDashboardKitPanel', () => {
  it('pre-selects each team\'s Product Owner from Jira\'s own user list', async () => {
    render(<EnrollmentDashboardKitPanel />);
    await userEvent.click(screen.getByRole('button', { name: /discover/i }));
    await waitFor(() => expect(screen.getByText(/Discovery complete/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/CUC Product Owner/i)).toHaveValue('U581996');
    expect(screen.getByLabelText(/Transformers Product Owner/i)).toHaveValue('U586310');
  });

  it('previews every filter with a live issue count and writes nothing', async () => {
    await discoverAndPreview();
    expect(screen.getByText('Enrollment Kit — All Work')).toBeInTheDocument();
    expect(screen.getAllByText('create').length).toBeGreaterThan(0);
    expect(screen.getByText(/bad JQL/)).toBeInTheDocument();
    expect(screen.getAllByText(/Smart filter "Team"/).length).toBe(2);
    expect(jiraPostMock).not.toHaveBeenCalled();
    expect(jiraPutMock).not.toHaveBeenCalled();
  });

  it('on Apply creates favourite filters, shares them with both projects, and skips rejected JQL', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await discoverAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /apply to jira/i }));
    await waitFor(() => expect(screen.getByText(/Apply finished/i)).toBeInTheDocument());

    const createCalls = jiraPostMock.mock.calls.filter(([path]) => path === '/rest/api/2/filter');
    expect(createCalls[0][1]).toMatchObject({ name: 'Enrollment Kit — All Work', favourite: true });
    expect(createCalls.some(([, body]) => String(body.name).endsWith('Stuck 10 Days'))).toBe(false);
    const shareCalls = jiraPostMock.mock.calls.filter(([path]) => String(path).endsWith('/permission'));
    expect(shareCalls.slice(0, 2).map(([, body]) => body)).toEqual([
      { type: 'project', projectId: '100' },
      { type: 'project', projectId: '200' },
    ]);
    expect(screen.getByText(/Stuck 10 Days: skipped/)).toBeInTheDocument();
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
