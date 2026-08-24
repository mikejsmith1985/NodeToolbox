// VersionMovementPanel.test.tsx — Finding a version by half its name, and tracing what left it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchVersions, mockLoadMovement } = vi.hoisted(() => ({
  mockFetchVersions: vi.fn(),
  mockLoadMovement: vi.fn(),
}));

vi.mock('../../ArtView/piPlan/piPlanReleaseSchedule.ts', () => ({
  fetchPiWindowFixVersions: mockFetchVersions,
}));
// Only the FETCH is mocked. `readVersionSnapshotAt` is pure arithmetic over data already in hand,
// so the snapshot tests below exercise the real reconstruction rather than a stub of it.
vi.mock('./versionMovementFetch.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./versionMovementFetch.ts')>()),
  loadVersionMovement: mockLoadMovement,
}));

import { VersionMovementPanel } from './VersionMovementPanel.tsx';
import type { VersionMovementOutcome } from './versionMovementFetch.ts';

const VERSIONS = [
  { name: '08/27/2026', releaseDate: '2026-08-27', released: false, archived: false },
  { name: '08/27/2026 B (scope pushed from july)', releaseDate: '2026-08-27', released: false, archived: false },
  { name: '07/16/2026', releaseDate: '2026-07-16', released: true, archived: false },
];

function outcomeWith(overrides: Partial<VersionMovementOutcome['movement']> = {},
  outcomeOverrides: Partial<VersionMovementOutcome> = {}): VersionMovementOutcome {
  return {
    movement: {
      versionName: '08/27/2026',
      stillIn: [],
      departed: [],
      arrived: [],
      ...overrides,
    },
    everInIssues: [],
    isHistoryUnavailable: false,
    historyErrorMessage: null,
    ...outcomeOverrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchVersions.mockResolvedValue(VERSIONS);
  mockLoadMovement.mockResolvedValue(outcomeWith());
});

/**
 * Renders the panel and opens it, which is what every test below is actually about.
 *
 * It ships collapsed on purpose: the Releases tab is for the radar, and an open version list both
 * costs a Jira request on arrival and puts the same version names on screen twice.
 */
async function renderOpenPanel() {
  const { container } = render(<VersionMovementPanel projectKey="ENCUC" />);
  const disclosure = container.querySelector('details') as HTMLDetailsElement;
  disclosure.open = true;
  fireEvent(disclosure, new Event('toggle'));
  return disclosure;
}

describe('VersionMovementPanel — finding the version', () => {
  it('lists released versions too, because the one being hunted for is usually old', async () => {
    await renderOpenPanel();

    expect(await screen.findByText('07/16/2026')).toBeInTheDocument();
  });

  it('finds a renamed version from any part of its name', async () => {
    // The whole problem: "08/27/2026 B (scope pushed from july)" cannot be typed from memory.
    await renderOpenPanel();
    await screen.findByText('08/27/2026');

    fireEvent.change(screen.getByLabelText('Filter versions'), { target: { value: 'july' } });

    expect(screen.getByText('08/27/2026 B (scope pushed from july)')).toBeInTheDocument();
    expect(screen.queryByText('07/16/2026')).toBeNull();
  });

  it('says nothing matched rather than showing an empty table', async () => {
    await renderOpenPanel();
    await screen.findByText('08/27/2026');

    fireEvent.change(screen.getByLabelText('Filter versions'), { target: { value: 'nonsense' } });

    expect(screen.getByText(/No version name contains that/i)).toBeInTheDocument();
  });
});

describe('VersionMovementPanel — tracing what left', () => {
  it('names each departure and the version it went to', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWith({
      stillIn: [{ key: 'ENC-1', summary: 'Stayed', statusName: 'Working', assigneeDisplayName: null, fixVersionNames: [] }],
      departed: [{
        key: 'ENC-2',
        summary: 'Pushed out',
        statusName: 'To Do',
        assigneeDisplayName: 'Smith, Michael (CTR)',
        movedToVersionNames: ['08/27/2026 B (scope pushed from july)'], departure: null,
      }],
    }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    // Appears twice by design: once in the grouped summary, once in the per-issue table.
    expect((await screen.findAllByText('ENC-2')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('08/27/2026 B (scope pushed from july)').length).toBeGreaterThan(0);
  });

  it('groups the departures, so twelve going to one place is said once', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWith({
      departed: ['ENC-2', 'ENC-3'].map((key) => ({
        key,
        summary: key,
        statusName: null,
        assigneeDisplayName: null,
        movedToVersionNames: ['08/27/2026 B (scope pushed from july)'], departure: null,
      })),
    }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    await screen.findByText('Went to');
    expect(screen.getByText('ENC-2, ENC-3')).toBeInTheDocument();
  });

  it('reports the departure count as UNKNOWN when Jira refused the history', async () => {
    // An empty list meaning "we could not look" reads identically to "nothing moved", and those
    // are opposite answers.
    mockLoadMovement.mockResolvedValue(outcomeWith({}, {
      isHistoryUnavailable: true,
      historyErrorMessage: "Field 'fixVersion' does not support the 'WAS' operator",
    }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByText(/would not answer the history query/i)).toBeInTheDocument();
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
  });

  it('says plainly when nothing has left', async () => {
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByText(/Nothing has left this version/i)).toBeInTheDocument();
  });

  it('surfaces a failed trace instead of showing an empty result', async () => {
    mockLoadMovement.mockRejectedValue(new Error('Jira is down'));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Jira is down');
  });

  it('asks Jira for nothing until a version is chosen', async () => {
    await renderOpenPanel();
    await screen.findByText('08/27/2026');

    await waitFor(() => expect(mockLoadMovement).not.toHaveBeenCalled());
  });
});

describe('VersionMovementPanel — closed until asked', () => {
  it('reads nothing from Jira until somebody opens it', () => {
    // The Releases tab is for the radar. A lookup nobody opened should cost nothing.
    render(<VersionMovementPanel projectKey="ENCUC" />);

    expect(mockFetchVersions).not.toHaveBeenCalled();
  });

  it('says what it is, so it is findable while closed', () => {
    render(<VersionMovementPanel projectKey="ENCUC" />);

    expect(screen.getByText(/where did this release/i)).toBeInTheDocument();
  });
});

describe('VersionMovementPanel — what the release looked like at a moment', () => {
  const REMOVED_AT = '2026-08-24T12:00:00.000+0000';

  function outcomeWithHistory() {
    return outcomeWith({}, {
      everInIssues: [
        { key: 'ENC-1', summary: 'Stayed', statusName: null, assigneeDisplayName: null, fixVersionNames: ['08/27/2026'], changeHistories: [] },
        {
          key: 'ENC-2',
          summary: 'Taken off',
          statusName: null,
          assigneeDisplayName: null,
          fixVersionNames: [],
          changeHistories: [{
            created: REMOVED_AT,
            author: { displayName: 'Kumar, Sidhant' },
            items: [{ field: 'Fix Version', fromString: '08/27/2026', toString: null }],
          }],
        },
      ],
    });
  }

  it('rebuilds the release as it stood, including what has since been taken off', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWithHistory());
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);
    const asOfInput = await screen.findByLabelText('Release contents as of');

    fireEvent.change(asOfInput, { target: { value: '2026-08-21T13:00' } });

    expect(screen.getByText('ENC-1, ENC-2')).toBeInTheDocument();
  });

  it('names what was removed between then and now', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWithHistory());
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    fireEvent.change(await screen.findByLabelText('Release contents as of'), { target: { value: '2026-08-21T13:00' } });

    expect(screen.getByText('REMOVED SINCE')).toBeInTheDocument();
    expect(screen.getByText('ENC-2')).toBeInTheDocument();
  });

  it('shows nothing until a moment is chosen, rather than guessing one', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWithHistory());
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    await screen.findByLabelText('Release contents as of');
    expect(screen.queryByText('IN IT THEN')).toBeNull();
  });

  it('refuses to reconstruct anything when the history is unavailable', async () => {
    // Without the changelog every figure here would be the present wearing a past date.
    mockLoadMovement.mockResolvedValue(outcomeWith({}, { isHistoryUnavailable: true, historyErrorMessage: 'nope' }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByText(/cannot be reconstructed/i)).toBeInTheDocument();
  });
});

describe('VersionMovementPanel — who took the version off', () => {
  it('names the person and the moment, which is usually the whole answer', async () => {
    // A release losing a dozen issues is rarely a dozen decisions.
    mockLoadMovement.mockResolvedValue(outcomeWith({
      departed: [{
        key: 'ENC-2',
        summary: 'Taken off',
        statusName: 'To Do',
        assigneeDisplayName: null,
        movedToVersionNames: [],
        departure: { atIso: '2026-08-24T12:00:00.000+0000', byDisplayName: 'Kumar, Sidhant' },
      }],
    }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByText(/Kumar, Sidhant · 2026-08-24 12:00/)).toBeInTheDocument();
  });

  it('says the history does not say, rather than inventing a name', async () => {
    mockLoadMovement.mockResolvedValue(outcomeWith({
      departed: [{
        key: 'ENC-2',
        summary: 'Taken off',
        statusName: null,
        assigneeDisplayName: null,
        movedToVersionNames: [],
        departure: null,
      }],
    }));
    await renderOpenPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Trace this version' }))[0]);

    expect(await screen.findByText('history does not say')).toBeInTheDocument();
  });
});
