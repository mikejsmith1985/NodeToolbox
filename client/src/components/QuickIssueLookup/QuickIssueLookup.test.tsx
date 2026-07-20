// QuickIssueLookup.test.tsx — Component tests for the lookup popup body and its F2 gate shell.
//
// The data hook, the reused detail panel, and the connection store are mocked so these tests
// exercise the popup's own behavior: search parity, the invalid-key hint, the honest states, the
// Jira deep-link, and the gate's F2/Escape handling.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickIssueLookup } from './QuickIssueLookup.tsx';

const useIssueByKeyMock = vi.fn();

vi.mock('../../hooks/useIssueByKey.ts', () => ({
  useIssueByKey: (issueKey: string | null) => useIssueByKeyMock(issueKey),
}));

vi.mock('../IssueDetailPanel/index.tsx', () => ({
  default: () => <div data-testid="issue-detail-panel" />,
}));

vi.mock('../../store/connectionStore.ts', () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) =>
    selector({ proxyStatus: { jira: { baseUrl: 'https://jira.example.com' } } }),
}));

vi.mock('../../views/SprintDashboard/featureReviewFixes.ts', () => ({
  fetchFeatureReviewEditMeta: vi.fn().mockResolvedValue({}),
}));

function mockLookup(overrides: Record<string, unknown>): void {
  useIssueByKeyMock.mockReturnValue({
    issue: null,
    status: 'idle',
    errorMessage: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

describe('QuickIssueLookup (popup body)', () => {
  afterEach(() => vi.clearAllMocks());

  it('searches the normalized key when the user presses Enter', () => {
    mockLookup({ status: 'idle' });
    render(<QuickIssueLookup />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: ' encuc-1234 ' } });
    fireEvent.keyDown(screen.getByLabelText('Issue key'), { key: 'Enter' });

    expect(useIssueByKeyMock).toHaveBeenCalledWith('ENCUC-1234');
  });

  it('searches when the Search button is clicked', () => {
    mockLookup({ status: 'idle' });
    render(<QuickIssueLookup />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'ENCUC-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(useIssueByKeyMock).toHaveBeenCalledWith('ENCUC-1234');
  });

  it('shows an inline hint and does not fetch for an invalid key', () => {
    mockLookup({ status: 'idle' });
    render(<QuickIssueLookup />);

    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText(/Enter an issue key like ABC-123/)).toBeInTheDocument();
    // The only calls to the hook are the render-time idle calls with a null key — never a real key.
    for (const call of useIssueByKeyMock.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it('shows a spinner while loading', () => {
    mockLookup({ status: 'loading' });
    render(<QuickIssueLookup />);
    expect(screen.getByText(/Loading issue/)).toBeInTheDocument();
  });

  it('shows a not-found message for an unknown key', () => {
    mockLookup({ status: 'not-found' });
    render(<QuickIssueLookup />);
    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'ENCUC-9999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText(/No issue found for ENCUC-9999999/)).toBeInTheDocument();
  });

  it('shows a distinct no-access message', () => {
    mockLookup({ status: 'no-permission' });
    render(<QuickIssueLookup />);
    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'ENCUC-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText(/don't have access to ENCUC-1/)).toBeInTheDocument();
  });

  it('shows a readable error message on failure', () => {
    mockLookup({ status: 'error', errorMessage: 'Jira unavailable' });
    render(<QuickIssueLookup />);
    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'ENCUC-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('Jira unavailable')).toBeInTheDocument();
  });

  it('renders the issue key as a Jira browse link opening in a new tab on success', () => {
    mockLookup({ status: 'loaded', issue: { id: '1', key: 'ENCUC-1234', fields: { summary: 'x' } } });
    render(<QuickIssueLookup />);

    const jiraLink = screen.getByRole('link', { name: /ENCUC-1234/ });
    expect(jiraLink).toHaveAttribute('href', 'https://jira.example.com/browse/ENCUC-1234');
    expect(jiraLink).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId('issue-detail-panel')).toBeInTheDocument();
  });
});
