// FeatureSplitterTab.test.tsx — Proves the Splitter works end to end with the AI gate LOCKED, and that
// nothing reaches Jira until a human commits a diff they have read (quickstart Scenarios B and D,
// SC-005, SC-006, FR-014, INV-J1).

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockJiraGet,
  mockCreateIssue,
  mockCreateIssueLink,
  mockGetIssueTypeFields,
  mockShowToast,
} = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockCreateIssue: vi.fn(),
  mockCreateIssueLink: vi.fn(),
  mockGetIssueTypeFields: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  createIssue: mockCreateIssue,
  createIssueLink: mockCreateIssueLink,
  getIssueTypeFields: mockGetIssueTypeFields,
}));

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

import FeatureSplitterTab from './FeatureSplitterTab';

const SOURCE_FEATURE = {
  key: 'ABC-1',
  fields: {
    project: { key: 'ABC' },
    issuetype: { id: '10001', name: 'Feature' },
    summary: 'Claims platform',
    description: 'Everything about claims.',
    customfield_10200: 'Given a claim…',
  },
};

/** Routes each Jira read to the right canned answer. */
function stubJiraReads(): void {
  mockJiraGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/rest/api/2/field')) {
      return [{ id: 'customfield_10200', name: 'Acceptance Criteria' }];
    }
    if (path.startsWith('/rest/api/2/issueLinkType')) {
      return { issueLinkTypes: [{ name: 'relates to' }, { name: 'blocks' }] };
    }
    if (path.includes('/rest/api/2/issue/ABC-1')) {
      return SOURCE_FEATURE;
    }
    throw new Error(`Unexpected read: ${path}`);
  });
}

/** Every call that would WRITE to Jira. The whole feature turns on these staying at zero. */
function countJiraWrites(): number {
  return mockCreateIssue.mock.calls.length + mockCreateIssueLink.mock.calls.length;
}

async function loadFeature(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
  await userEvent.click(screen.getByRole('button', { name: /load feature/i }));
  await waitFor(() => expect(screen.getByText(/ABC-1 · Feature/)).toBeInTheDocument());
}

async function addIncrement(summary: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /add increment/i }));
  const summaryInputs = screen.getAllByLabelText('Summary');
  await userEvent.type(summaryInputs[summaryInputs.length - 1], summary);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  stubJiraReads();
  mockGetIssueTypeFields.mockResolvedValue({
    values: [
      { fieldId: 'summary', name: 'Summary', required: true },
      { fieldId: 'customfield_10200', name: 'Acceptance Criteria', required: false },
    ],
  });
  mockCreateIssue.mockResolvedValue({ id: '2', key: 'ABC-2', self: '' });
  mockCreateIssueLink.mockResolvedValue(undefined);
});

describe('FeatureSplitterTab — coaching is always there (SC-005, SC-013)', () => {
  it('shows the split coaching with no AI unlocked and no Feature loaded', () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    expect(screen.getByText('How to break this down')).toBeInTheDocument();
    expect(screen.getByText('Happy path first')).toBeInTheDocument();
  });

  it('shows what a good increment looks like', () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    expect(screen.getByText('A good increment')).toBeInTheDocument();
  });

  it('renders no AI control anywhere, because the gate is locked', () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    expect(screen.queryByText(/AI/)).toBeNull();
  });
});

describe('FeatureSplitterTab — loading the original', () => {
  it('shows the original\'s content to copy from', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await loadFeature();

    expect(screen.getByText('Claims platform')).toBeInTheDocument();
    expect(screen.getByText('Everything about claims.')).toBeInTheDocument();
    expect(screen.getByText('Given a claim…')).toBeInTheDocument();
  });

  it('says the increments will be the original\'s own type and the original is left alone', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await loadFeature();

    expect(screen.getByText(/never changed or closed by a split/i)).toBeInTheDocument();
  });

  it('defaults the target project to the original\'s', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await loadFeature();

    expect(screen.getByLabelText(/create in project/i)).toHaveValue('ABC');
  });

  it('offers only the link types this Jira defines (FR-037)', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await loadFeature();

    const linkTypePicker = screen.getByLabelText(/link back as/i);
    expect(within(linkTypePicker).getByRole('option', { name: 'relates to' })).toBeInTheDocument();
    expect(within(linkTypePicker).getByRole('option', { name: 'blocks' })).toBeInTheDocument();
  });

  it('reports a load failure with Jira\'s reason, keeping the tab usable', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.includes('/rest/api/2/issue/ABC-1')) {
        throw new Error('Issue does not exist.');
      }
      return path.startsWith('/rest/api/2/field') ? [] : { issueLinkTypes: [] };
    });
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));

    expect(await screen.findByText(/Issue does not exist/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load feature/i })).toBeEnabled();
  });

  it('calls an empty read a connection problem, not an empty Feature (A11)', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.includes('/rest/api/2/issue/ABC-1')) {
        return { key: 'ABC-1', fields: {} };
      }
      return path.startsWith('/rest/api/2/field') ? [] : { issueLinkTypes: [] };
    });
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));

    expect(await screen.findByText(/VPN|connection/i)).toBeInTheDocument();
  });
});

describe('FeatureSplitterTab — the review step (FR-013)', () => {
  it('itemises every create and every link before anything is written', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('Submit a claim with one document');

    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));

    expect(screen.getByText(/nothing has been written yet/i)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Issues to create')).getByText(/Submit a claim/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Links to create')).getByText(/ABC-1/)).toBeInTheDocument();
  });

  it('has still written NOTHING to Jira at the review step (SC-006, INV-J1)', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('Submit a claim with one document');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));

    expect(countJiraWrites()).toBe(0);
  });

  it('lets the PO go back and keep editing', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('One');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));

    await userEvent.click(screen.getByRole('button', { name: /back to editing/i }));

    expect(screen.getByRole('button', { name: /add increment/i })).toBeInTheDocument();
    expect(countJiraWrites()).toBe(0);
  });

  it('blocks the commit when an increment has no summary, naming the problem', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await userEvent.click(screen.getByRole('button', { name: /add increment/i }));

    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));

    expect(within(screen.getByLabelText('Blockers')).getByText(/give this increment a summary/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create 0 feature/i })).toBeDisabled();
  });
});

describe('FeatureSplitterTab — commit (FR-015, SC-016)', () => {
  it('writes only when the PO commits, and creates the original\'s own type', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('Submit a claim with one document');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));

    expect(countJiraWrites()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /create 1 feature/i }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalledTimes(1));
    expect(mockCreateIssue).toHaveBeenCalledWith({
      fields: expect.objectContaining({
        project: { key: 'ABC' },
        issuetype: { id: '10001' },
        summary: 'Submit a claim with one document',
      }),
    });
  });

  it('links the new Feature back to the original and NEVER touches the original itself', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('Submit a claim with one document');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));
    await userEvent.click(screen.getByRole('button', { name: /create 1 feature/i }));

    await waitFor(() => expect(mockCreateIssueLink).toHaveBeenCalledTimes(1));
    expect(mockCreateIssueLink).toHaveBeenCalledWith({
      type: { name: 'relates to' },
      inwardIssue: { key: 'ABC-2' },
      outwardIssue: { key: 'ABC-1' },
    });
    // A split creates and links. Any other write would be a change to the original.
    expect(countJiraWrites()).toBe(2);
  });

  it('reports the created key back to the PO', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('One');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));
    await userEvent.click(screen.getByRole('button', { name: /create 1 feature/i }));

    expect(await within(await screen.findByLabelText('Commit results')).findByText(/Created ABC-2/)).toBeInTheDocument();
  });

  it('keeps the draft and explains when a commit only partly worked (SC-011)', async () => {
    mockCreateIssue.mockRejectedValue(new Error('Field \'Business Value\' is required.'));
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('One');
    await userEvent.click(screen.getByRole('button', { name: /review 1 increment/i }));
    await userEvent.click(screen.getByRole('button', { name: /create 1 feature/i }));

    expect(await screen.findByText(/Business Value.*required/)).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/could not be committed/i), 'error');
  });
});

describe('FeatureSplitterTab — drafts (FR-042, FR-047, FR-048)', () => {
  it('restores an in-progress split when the PO returns to the same Feature', async () => {
    const { unmount } = render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('Submit a claim with one document');
    unmount();

    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();

    await waitFor(() =>
      expect(screen.getByDisplayValue('Submit a claim with one document')).toBeInTheDocument(),
    );
    expect(countJiraWrites()).toBe(0);
  });

  it('lets the PO throw a draft away', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await loadFeature();
    await addIncrement('One');

    await userEvent.click(screen.getByRole('button', { name: /discard draft/i }));

    expect(screen.queryByDisplayValue('One')).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith('Split draft discarded.', 'success');
  });

  it('warns up front when the browser will not keep drafts, rather than losing them silently', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    expect(screen.getByText(/your work will be lost if you reload/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
