// ConfluenceDocLinksPanel.test.tsx — Setting it up, seeing what it would do, and only then doing it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScan, mockWriteLink, mockCreateSlStory } = vi.hoisted(() => ({
  mockScan: vi.fn(),
  mockWriteLink: vi.fn(),
  mockCreateSlStory: vi.fn(),
}));

vi.mock('./docLinkRunner.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./docLinkRunner.ts')>()),
  scanForDocLinks: mockScan,
  writeDocLink: mockWriteLink,
  createSlStoryFromDevStory: mockCreateSlStory,
}));
vi.mock('../../../store/connectionStore.ts', () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) =>
    selector({ proxyStatus: { jira: { baseUrl: 'https://jira' } } }),
}));

import { ConfluenceDocLinksPanel } from './ConfluenceDocLinksPanel.tsx';

/** One planned row, defaulting to the happy path so each test varies only what it cares about. */
function planRow(overrides: Record<string, unknown> = {}) {
  return {
    pageId: '1',
    pageTitle: 'DENP-475: COB/MSP Test cases',
    pageUrl: 'https://confluence/1',
    titleIssueKey: 'DENP-475',
    route: {
      targetIssueKey: 'ENCUC-2358',
      outcome: 'routed-to-sl-story',
      cloneSourceIssueKey: null,
      reason: 'DENP-475 → its SL story ENCUC-2358',
    },
    isActionable: true,
    changedAtIso: '2026-08-25T12:00:00.000Z',
    recencyKind: 'updated',
    ...overrides,
  };
}

function planWith(rows: ReturnType<typeof planRow>[]) {
  return {
    plan: {
      rows,
      linkableCount: rows.filter((row) => row.isActionable).length,
      needsDecisionCount: rows.filter((row) => !row.isActionable && row.route.outcome !== 'no-key-in-title').length,
      untaggedCount: rows.filter((row) => row.route.outcome === 'no-key-in-title').length,
      isTruncated: false,
      outsideWindowCount: 0,
    },
    failureReason: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockScan.mockResolvedValue(planWith([planRow()]));
  mockWriteLink.mockResolvedValue(undefined);
});

describe('ConfluenceDocLinksPanel', () => {
  it('writes nothing until a scan is asked for', () => {
    render(<ConfluenceDocLinksPanel />);

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockWriteLink).not.toHaveBeenCalled();
  });

  it('keeps the settings between visits, so setup is done once', async () => {
    const { unmount } = render(<ConfluenceDocLinksPanel />);
    fireEvent.change(screen.getByLabelText(/Confluence space key/), { target: { value: 'MAVertical' } });
    await waitFor(() => expect(window.localStorage.getItem('tbxConfluenceDocLinks')).toContain('MAVertical'));
    unmount();

    render(<ConfluenceDocLinksPanel />);

    expect((screen.getByLabelText(/Confluence space key/) as HTMLInputElement).value).toBe('MAVertical');
  });

  it('shows what it WOULD do, and does not do it', async () => {
    render(<ConfluenceDocLinksPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));

    expect(await screen.findByText(/1 would be linked/)).toBeInTheDocument();
    expect(mockWriteLink).not.toHaveBeenCalled();
  });

  it('writes the links only when the button that says so is pressed', async () => {
    render(<ConfluenceDocLinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));
    await screen.findByText(/1 would be linked/);

    fireEvent.click(screen.getByRole('button', { name: /Link 1 page/ }));

    await waitFor(() => expect(mockWriteLink).toHaveBeenCalledWith(
      'ENCUC-2358',
      'DENP-475: COB/MSP Test cases',
      'https://confluence/1',
      '1',
    ));
  });

  it('reports a partial failure rather than claiming every link landed', async () => {
    mockWriteLink.mockRejectedValue(new Error('403'));
    render(<ConfluenceDocLinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));
    await screen.findByText(/1 would be linked/);

    fireEvent.click(screen.getByRole('button', { name: /Link 1 page/ }));

    expect(await screen.findByText(/Linked 0 of 1.*403/)).toBeInTheDocument();
  });

  it('offers no Link button when the plan would write nothing', async () => {
    mockScan.mockResolvedValue(planWith([planRow({
      isActionable: false,
      route: { targetIssueKey: null, outcome: 'no-key-in-title', cloneSourceIssueKey: null, reason: 'x' },
    })]));
    render(<ConfluenceDocLinksPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));

    await screen.findByText(/1 name no issue/);
    expect(screen.queryByRole('button', { name: /Link \d+ page/ })).toBeNull();
  });

  it('surfaces a missing root page instead of an empty result', async () => {
    // An empty crawl and a renamed page look identical, and mean opposite things.
    mockScan.mockResolvedValue({ plan: null, failureReason: 'No page titled "x" in space MAVertical.' });
    render(<ConfluenceDocLinksPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No page titled');
  });

  it('offers Create SL story on a row that has no test story, one row at a time', async () => {
    // A scheduled bulk create is the thing that frightens people; creating stays deliberate.
    mockScan.mockResolvedValue(planWith([planRow({
      isActionable: false,
      route: {
        targetIssueKey: null,
        outcome: 'no-sl-story',
        cloneSourceIssueKey: 'ENCUC-2213',
        reason: 'DENP-475 has no SL story',
      },
    })]));
    mockCreateSlStory.mockResolvedValue({ slStoryKey: 'ENCUC-2358', linkError: null });
    render(<ConfluenceDocLinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Create SL story from ENCUC-2213/ }));

    expect(await screen.findByText(/Created ENCUC-2358/)).toBeInTheDocument();
  });

  it('says when a created story could not be linked, rather than reporting plain success', async () => {
    mockScan.mockResolvedValue(planWith([planRow({
      isActionable: false,
      route: {
        targetIssueKey: null,
        outcome: 'no-sl-story',
        cloneSourceIssueKey: 'ENCUC-2213',
        reason: 'x',
      },
    })]));
    mockCreateSlStory.mockResolvedValue({ slStoryKey: 'ENCUC-2358', linkError: 'No such link type' });
    render(<ConfluenceDocLinksPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Scan/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Create SL story/ }));

    expect(await screen.findByText(/containment link failed: No such link type/)).toBeInTheDocument();
  });
});
