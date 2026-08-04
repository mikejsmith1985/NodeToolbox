// useSharePointAutoPull.test.ts — The client-side scheduler for the SharePoint email pull: the
// server cannot reach SharePoint (the relay rides the browser session), so the Toolbox CLIENT
// honors the configured start-time/interval while it is open and the relay is connected (GH #282).

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPullSharePointEmails, mockFetchRelayStatus } = vi.hoisted(() => ({
  mockPullSharePointEmails: vi.fn(),
  mockFetchRelayStatus: vi.fn(),
}));
vi.mock('../services/githubEmailSharePointPull.ts', () => ({
  pullSharePointEmails: mockPullSharePointEmails,
}));
vi.mock('../services/relayBridgeApi.ts', () => ({
  fetchRelayStatus: mockFetchRelayStatus,
}));

import { computeAutoPullSlot, useSharePointAutoPull } from './useSharePointAutoPull.ts';

/** A SharePoint-only intake config with the user's real schedule: start 07:00, every 30 minutes. */
function sharePointOnlyConfig(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: true,
    dropFolder: '',
    sharePointFolderUrl: '/sites/Team/GitHubEmails',
    scheduleTime: '07:00',
    intervalMin: 30,
    ...overrides,
  };
}

describe('computeAutoPullSlot (pure schedule rule)', () => {
  const baseInput = { ...sharePointOnlyConfig(), lastFiredSlot: null as string | null };

  it('fires on a clock boundary at or after the start time, once per slot', () => {
    const onBoundary = new Date('2026-08-04T15:30:12');
    const slot = computeAutoPullSlot({ ...baseInput, now: onBoundary });
    expect(slot).toBe('2026-08-04 15:30');
    // The same slot never fires twice (the 60s tick passes each boundary once already fired).
    expect(computeAutoPullSlot({ ...baseInput, now: onBoundary, lastFiredSlot: '2026-08-04 15:30' })).toBeNull();
  });

  it('does not fire off-boundary, before the start time, or when the schedule is off', () => {
    expect(computeAutoPullSlot({ ...baseInput, now: new Date('2026-08-04T15:41:00') })).toBeNull();      // off boundary
    expect(computeAutoPullSlot({ ...baseInput, now: new Date('2026-08-04T06:30:00') })).toBeNull();      // before 07:00
    expect(computeAutoPullSlot({ ...baseInput, isEnabled: false, now: new Date('2026-08-04T15:30:00') })).toBeNull();
    expect(computeAutoPullSlot({ ...baseInput, intervalMin: 0, now: new Date('2026-08-04T15:30:00') })).toBeNull();
  });

  it('only applies to a SharePoint-only setup (a local drop folder keeps the SERVER scheduler in charge)', () => {
    const now = new Date('2026-08-04T15:30:00');
    expect(computeAutoPullSlot({ ...baseInput, dropFolder: 'C:\\gh', now })).toBeNull();
    expect(computeAutoPullSlot({ ...baseInput, sharePointFolderUrl: '', now })).toBeNull();
  });
});

describe('useSharePointAutoPull (the 60s tick)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T15:29:30'));
    mockPullSharePointEmails.mockReset();
    mockPullSharePointEmails.mockResolvedValue({ listedCount: 0, newCount: 0, postedCount: 0, skippedCount: 0, errorCount: 0, batchCount: 1, unsupportedCount: 0 });
    mockFetchRelayStatus.mockReset();
    mockFetchRelayStatus.mockResolvedValue({ system: 'sharepoint', isConnected: true, lastPingAt: null, version: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sharePointOnlyConfig()), { status: 200 })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pulls once when a tick lands in a due slot, and not again for the same slot', async () => {
    renderHook(() => useSharePointAutoPull());

    // 15:30:30 — the 30-minute boundary slot is due.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPullSharePointEmails).toHaveBeenCalledTimes(1);
    expect(mockPullSharePointEmails.mock.calls[0][0]).toBe('/sites/Team/GitHubEmails');

    // 15:31:30 — same half-hour, off boundary: no second pull.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPullSharePointEmails).toHaveBeenCalledTimes(1);
  });

  it('skips silently when the relay is not connected — the slot simply passes', async () => {
    mockFetchRelayStatus.mockResolvedValue({ system: 'sharepoint', isConnected: false, lastPingAt: null, version: null });
    renderHook(() => useSharePointAutoPull());

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPullSharePointEmails).not.toHaveBeenCalled();
  });
});
