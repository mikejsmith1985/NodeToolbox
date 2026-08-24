// ClearedTodaySection.test.tsx — The sweep for "something cleared a batch of fix versions today".

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadRemovals } = vi.hoisted(() => ({ mockLoadRemovals: vi.fn() }));

vi.mock('./versionMovementFetch.ts', () => ({ loadFixVersionRemovalsSince: mockLoadRemovals }));

import { ClearedTodaySection } from './ClearedTodaySection.tsx';
import type { FixVersionRemoval } from './recentVersionChanges.ts';

function removal(overrides: Partial<FixVersionRemoval> = {}): FixVersionRemoval {
  return {
    issueKey: 'ENC-2',
    summary: 'Address Validation Failure',
    statusName: 'To Do',
    assigneeDisplayName: 'Smith, Michael (CTR)',
    removedVersionNames: ['08/27/2026'],
    currentVersionNames: [],
    atIso: '2026-08-24T12:00:00.000Z',
    byDisplayName: 'Kumar, Sidhant',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRemovals.mockResolvedValue([]);
});

describe('ClearedTodaySection', () => {
  it('reads nothing until a window is chosen', () => {
    render(<ClearedTodaySection projectKey="ENCUC" />);

    expect(mockLoadRemovals).not.toHaveBeenCalled();
  });

  it('sweeps from midnight this morning when Today is chosen', async () => {
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    await screen.findByText(/No fix version was taken off/i);
    const since = mockLoadRemovals.mock.calls[0][1] as Date;
    expect(since.getHours()).toBe(0);
    expect(since.getMinutes()).toBe(0);
  });

  it('names who cleared them and how many, before listing the issues', async () => {
    // The answer is almost never "twelve issues each lost their release". It is "one person cleared
    // twelve while doing something else".
    mockLoadRemovals.mockResolvedValue([
      removal({ issueKey: 'ENC-2' }),
      removal({ issueKey: 'ENC-3' }),
      removal({ issueKey: 'ENC-4', byDisplayName: 'Someone, Else' }),
    ]);
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(await screen.findByText('ENC-2, ENC-3')).toBeInTheDocument();
    expect(screen.getAllByText('Kumar, Sidhant').length).toBeGreaterThan(0);
  });

  it('distinguishes moved to another release from left on none at all', async () => {
    mockLoadRemovals.mockResolvedValue([
      removal({ issueKey: 'ENC-2', currentVersionNames: [] }),
      removal({ issueKey: 'ENC-3', currentVersionNames: ['09/10/2026'] }),
    ]);
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(await screen.findByText('no fix version at all')).toBeInTheDocument();
    expect(screen.getByText('09/10/2026')).toBeInTheDocument();
  });

  it('says the window found nothing rather than showing an empty table', async () => {
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    expect(await screen.findByText(/No fix version was taken off/i)).toBeInTheDocument();
  });

  it('surfaces a failed sweep instead of an empty result', async () => {
    mockLoadRemovals.mockRejectedValue(new Error('Jira is down'));
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Jira is down');
  });

  it('names an unattributed change rather than dropping it', async () => {
    mockLoadRemovals.mockResolvedValue([removal({ byDisplayName: null })]);
    render(<ClearedTodaySection projectKey="ENCUC" />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect((await screen.findAllByText('unattributed')).length).toBeGreaterThan(0);
  });
});
