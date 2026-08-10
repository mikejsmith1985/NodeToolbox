// SubtaskPromotionPanel.test.tsx — Proves the panel cannot create or delete anything by accident.
//
// The panel drives three irreversible Jira operations, so what is asserted here is mostly restraint:
// nothing is created before Promote is pressed, the delete button does not exist until a Story is
// genuinely created AND linked, and a link failure is reported rather than hidden behind a tick.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubtaskPromotionPanel } from './SubtaskPromotionPanel.tsx';

const jiraGetMock = vi.fn();
const jiraPostMock = vi.fn();
const jiraDeleteMock = vi.fn();
const createIssueMock = vi.fn();
const createIssueLinkMock = vi.fn();
const getProjectIssueTypesMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  jiraPost: (...args: unknown[]) => jiraPostMock(...args),
  jiraDelete: (...args: unknown[]) => jiraDeleteMock(...args),
  createIssue: (...args: unknown[]) => createIssueMock(...args),
  createIssueLink: (...args: unknown[]) => createIssueLinkMock(...args),
  getProjectIssueTypes: (...args: unknown[]) => getProjectIssueTypesMock(...args),
}));

const SUBTASK = {
  key: 'ENCUC-201',
  fields: {
    summary: 'Wire up the retry handler',
    status: { name: 'In Progress' },
    parent: { key: 'ENCUC-100' },
    assignee: { name: 'jsmith', displayName: 'Smith, Mike (CTR)' },
  },
};

const CONTAINER_LINK_TYPES = {
  issueLinkTypes: [{ id: '1', name: 'Container', inward: 'is contained within', outward: 'contains' }],
};

/** Points every read at a single promotable sub-task on an instance that has the containment link. */
function stubHappyPathReads(): void {
  jiraGetMock.mockImplementation(async (path: string) => {
    if (path.includes('/search')) return { issues: [SUBTASK], total: 1 };
    if (path.includes('/issueLinkType')) return CONTAINER_LINK_TYPES;
    if (path.includes('/transitions')) return { transitions: [{ id: '11', to: { name: 'In Progress' } }] };
    return {};
  });
  getProjectIssueTypesMock.mockResolvedValue({
    values: [{ id: '10001', name: 'Story', subtask: false }, { id: '10003', name: 'Sub-task', subtask: true }],
  });
}

/** Loads the preview, which every promotion test needs first. */
async function renderAndPreview(): Promise<void> {
  render(<SubtaskPromotionPanel />);
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(screen.getByText(/1 sub-tasks matched/)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  stubHappyPathReads();
  createIssueMock.mockResolvedValue({ id: '1', key: 'ENCUC-500', self: '' });
  createIssueLinkMock.mockResolvedValue(undefined);
});

describe('preview — look before anything is written', () => {
  it('creates nothing while previewing', async () => {
    await renderAndPreview();

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(createIssueLinkMock).not.toHaveBeenCalled();
    expect(jiraDeleteMock).not.toHaveBeenCalled();
  });

  it('states the sentence each new Story will read, so the direction is visible up front', async () => {
    await renderAndPreview();
    expect(screen.getByText(/is contained within/)).toBeTruthy();
  });

  it('offers only non-sub-task issue types as the target', async () => {
    await renderAndPreview();

    expect(screen.getByRole('option', { name: 'Story' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Sub-task' })).toBeNull();
  });

  it('shows the sub-task with its status, assignee and parent', async () => {
    await renderAndPreview();

    expect(screen.getByText('ENCUC-201')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText('Smith, Mike (CTR)')).toBeTruthy();
    expect(screen.getByText('ENCUC-100')).toBeTruthy();
  });

  it('refuses to promote when the instance has no containment link type', async () => {
    jiraGetMock.mockImplementation(async (path: string) => {
      if (path.includes('/search')) return { issues: [SUBTASK], total: 1 };
      if (path.includes('/issueLinkType')) return { issueLinkTypes: [] };
      return {};
    });
    await renderAndPreview();

    expect(screen.getByText(/no “contained within” link type/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Promote/ }).hasAttribute('disabled')).toBe(true);
  });

  it('says when the result set was capped, rather than quietly promoting a subset', async () => {
    jiraGetMock.mockImplementation(async (path: string) => {
      if (path.includes('/search')) return { issues: [SUBTASK], total: 900 };
      if (path.includes('/issueLinkType')) return CONTAINER_LINK_TYPES;
      return {};
    });
    await renderAndPreview();

    expect(screen.getByText(/only the first 200 are shown/)).toBeTruthy();
  });
});

describe('promote — create, then link', () => {
  it('creates the Story and links it with the Story on the inward side', async () => {
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Promote 1 sub-tasks/ }));
    await waitFor(() => expect(createIssueLinkMock).toHaveBeenCalled());

    expect(createIssueLinkMock).toHaveBeenCalledWith({
      type: { name: 'Container' },
      inwardIssue: { key: 'ENCUC-500' },
      outwardIssue: { key: 'ENCUC-100' },
    });
  });

  it('moves the new Story onto the sub-task\'s status when a transition allows it', async () => {
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Promote 1 sub-tasks/ }));
    await waitFor(() => expect(jiraPostMock).toHaveBeenCalled());

    expect(jiraPostMock).toHaveBeenCalledWith(
      '/rest/api/2/issue/ENCUC-500/transitions', { transition: { id: '11' } },
    );
  });

  it('reports a link failure against the Story that really was created', async () => {
    createIssueLinkMock.mockRejectedValue(new Error('link type not permitted'));
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Promote 1 sub-tasks/ }));

    await waitFor(() => expect(screen.getByText(/link type not permitted/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Delete the/ })).toBeNull();
  });
});

describe('retire — the destructive step is fenced off', () => {
  it('offers no delete button until a promotion has actually run', async () => {
    await renderAndPreview();
    expect(screen.queryByRole('button', { name: /Delete the/ })).toBeNull();
  });

  it('deletes only after an explicit second press, and only the linked originals', async () => {
    await renderAndPreview();
    await userEvent.click(screen.getByRole('button', { name: /Promote 1 sub-tasks/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Delete the 1 original/ })).toBeTruthy());

    expect(jiraDeleteMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Delete the 1 original/ }));
    await waitFor(() => expect(jiraDeleteMock).toHaveBeenCalledWith('/rest/api/2/issue/ENCUC-201'));
  });
});
