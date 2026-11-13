// SlQeContainerFixPanel.test.tsx — Proves the #508 panel reads only on a dry run and previews the right action.
//
// The panel writes to production Jira in bulk, so the key assertion is restraint: a dry run performs
// no writes at all, and the previewed action matches the dev story's live status.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SlQeContainerFixPanel } from './SlQeContainerFixPanel.tsx';

const jiraGetMock = vi.fn();
const jiraPutMock = vi.fn();
const jiraPostMock = vi.fn();
const jiraDeleteMock = vi.fn();
const createIssueLinkMock = vi.fn();
const searchUsersMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  jiraPut: (...args: unknown[]) => jiraPutMock(...args),
  jiraPost: (...args: unknown[]) => jiraPostMock(...args),
  jiraDelete: (...args: unknown[]) => jiraDeleteMock(...args),
  createIssueLink: (...args: unknown[]) => createIssueLinkMock(...args),
  searchUsers: (...args: unknown[]) => searchUsersMock(...args),
}));

const AC_FIELD_ID = 'customfield_10200';

/** Routes a jiraGet URL to canned data: link types, field catalogue, and per-issue status. */
function routeGet(path: string, devStatus: string): unknown {
  if (path.includes('/issueLinkType')) {
    return { issueLinkTypes: [{ name: 'Container', inward: 'is contained by', outward: 'contains' }] };
  }
  if (path.includes('/field')) {
    return [{ id: AC_FIELD_ID, name: 'Acceptance Criteria' }];
  }
  if (path.includes('/issue/ENFCT-1214')) return { fields: { status: { name: devStatus } } };
  if (path.includes('/issue/ENFCT-2032')) {
    return { fields: { summary: '[SL] test', status: { name: 'To Do' }, issuelinks: [], labels: [] } };
  }
  return { fields: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  searchUsersMock.mockResolvedValue([{ accountId: 'a1', displayName: 'Belew, Dennis (CTR)', name: 'dbelew' }]);
});

describe('SlQeContainerFixPanel', () => {
  it('previews a flip-clone and writes nothing on a dry run', async () => {
    jiraGetMock.mockImplementation((path: string) => Promise.resolve(routeGet(path, 'To Do')));
    render(<SlQeContainerFixPanel />);

    await userEvent.type(screen.getByPlaceholderText(/ENFCT-2032/i), 'ENFCT-2032');
    await userEvent.click(screen.getByRole('button', { name: /dry run/i }));

    await waitFor(() => expect(screen.getByText(/Dry run complete/i)).toBeInTheDocument());
    // The action cell shows flip-clone.
    expect(screen.getByText('flip-clone')).toBeInTheDocument();
    // Discovered assignee is surfaced (also named in the help text, so allow multiple).
    expect(screen.getAllByText(/Belew, Dennis/i).length).toBeGreaterThan(0);
    // No writes of any kind happened.
    expect(jiraPutMock).not.toHaveBeenCalled();
    expect(jiraPostMock).not.toHaveBeenCalled();
    expect(jiraDeleteMock).not.toHaveBeenCalled();
    expect(createIssueLinkMock).not.toHaveBeenCalled();
  });

  it('previews a cancel when the dev story is already Accepted', async () => {
    jiraGetMock.mockImplementation((path: string) => Promise.resolve(routeGet(path, 'Accepted')));
    render(<SlQeContainerFixPanel />);

    await userEvent.type(screen.getByPlaceholderText(/ENFCT-2032/i), 'ENFCT-2032');
    await userEvent.click(screen.getByRole('button', { name: /dry run/i }));

    await waitFor(() => expect(screen.getByText(/Dry run complete/i)).toBeInTheDocument());
    expect(screen.getByText('cancel')).toBeInTheDocument();
    expect(jiraPutMock).not.toHaveBeenCalled();
  });
});
