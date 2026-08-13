// useSharePointAutoPull.ts — RETIRED scheduler, kept only for its schedule rule.
//
// This used to run the SharePoint pull on a 60-second tick inside the Toolbox tab, because the server
// could only sweep a LOCAL drop folder — the SharePoint pull rides the browser relay, and the server
// had no way to drive it. That made the schedule depend on a browser tab staying open, and on the
// relay being recognised on the exact minute a boundary fell.
//
// The server drives the relay itself now (`runSharePointIntakeNow`), so the schedule lives with every
// other schedule and runs whether or not this tab is open. Only the SharePoint tab has to be there.
//
// `computeAutoPullSlot` survives because it is a clean statement of the cadence rule and is still
// worth its tests, but NOTHING calls it in anger. Two schedulers for one job would double every pull,
// race for the server's mutex, and split one sweep's Activity Log row in half.

import { useEffect, useRef } from 'react';

import { fetchRelayStatus } from '../services/relayBridgeApi.ts';
import { pullSharePointEmails } from '../services/githubEmailSharePointPull.ts';

/** The intake-config fields the schedule rule reads (a subset of the server's config response). */
interface AutoPullConfig {
  isEnabled: boolean;
  dropFolder: string;
  sharePointFolderUrl: string;
  /** Clear each ingested email from the library, so the folder does not grow without bound. */
  shouldClearSharePointAfterIngest: boolean;
  scheduleTime: string;
  intervalMin: number;
}

/** Parses an "HH:MM" clock string into minutes since midnight (a bad value yields 0). */
function minutesSinceMidnight(clockText: string): number {
  const [hoursPart, minutesPart] = String(clockText || '').split(':').map((part) => Number(part));
  if (Number.isNaN(hoursPart) || Number.isNaN(minutesPart)) {
    return 0;
  }
  return hoursPart * 60 + minutesPart;
}

/** Formats a Date as the local "YYYY-MM-DD HH:MM" slot id (the once-per-boundary guard key). */
function formatSlot(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * The pure schedule rule: returns the slot id to fire for, or null when nothing is due. Mirrors the
 * server scheduler's clock-aligned interval semantics (fire on wall-clock boundaries of intervalMin,
 * at or after the daily start time, each slot at most once) — but ONLY for a SharePoint-only setup;
 * with a local drop folder configured, the server scheduler owns the schedule.
 */
export function computeAutoPullSlot(input: AutoPullConfig & { now: Date; lastFiredSlot: string | null }): string | null {
  const isSharePointOnly = input.dropFolder.trim() === '' && input.sharePointFolderUrl.trim() !== '';
  if (!input.isEnabled || !isSharePointOnly || !(Number(input.intervalMin) > 0)) {
    return null;
  }
  const nowMinutes = input.now.getHours() * 60 + input.now.getMinutes();
  const isOnBoundary = nowMinutes % Number(input.intervalMin) === 0;
  const hasReachedStartTime = nowMinutes >= minutesSinceMidnight(input.scheduleTime);
  if (!isOnBoundary || !hasReachedStartTime) {
    return null;
  }
  const slot = formatSlot(input.now);
  return slot === input.lastFiredSlot ? null : slot;
}

/** Reads the intake config; null on any failure so a flaky server never breaks the tick. */
async function fetchIntakeConfig(): Promise<AutoPullConfig | null> {
  try {
    const response = await fetch('/api/github-email-intake/config');
    if (!response.ok) {
      return null;
    }
    const body = await response.json() as Partial<AutoPullConfig>;
    return {
      isEnabled: body.isEnabled === true,
      dropFolder: typeof body.dropFolder === 'string' ? body.dropFolder : '',
      sharePointFolderUrl: typeof body.sharePointFolderUrl === 'string' ? body.sharePointFolderUrl : '',
      shouldClearSharePointAfterIngest: body.shouldClearSharePointAfterIngest === true,
      scheduleTime: typeof body.scheduleTime === 'string' ? body.scheduleTime : '07:00',
      intervalMin: Number(body.intervalMin) || 0,
    };
  } catch {
    return null;
  }
}

/** Mounts the 60-second schedule tick for the SharePoint auto-pull. Use once, app-wide. */
export function useSharePointAutoPull(): void {
  const lastFiredSlotRef = useRef<string | null>(null);
  const isPullingRef = useRef(false);

  useEffect(() => {
    async function runScheduleTick(): Promise<void> {
      if (isPullingRef.current) {
        return; // A long pull spanning slots must never overlap itself.
      }
      try {
        const config = await fetchIntakeConfig();
        if (config === null) {
          return;
        }
        const dueSlot = computeAutoPullSlot({ ...config, now: new Date(), lastFiredSlot: lastFiredSlotRef.current });
        if (dueSlot === null) {
          return;
        }
        // Relay offline ⇒ skip WITHOUT claiming the slot — but the next tick is off-boundary, so
        // the slot passes naturally and the next boundary simply tries again.
        const relayStatus = await fetchRelayStatus('sharepoint');
        if (!relayStatus.isConnected) {
          return;
        }
        lastFiredSlotRef.current = dueSlot;
        isPullingRef.current = true;
        await pullSharePointEmails(
          config.sharePointFolderUrl, undefined, config.shouldClearSharePointAfterIngest,
        );
      } catch {
        // Silent by design: the Activity Log and the intake panel are the reporting surfaces.
      } finally {
        isPullingRef.current = false;
      }
    }

    // Deliberately NOT started. The server owns this schedule now, and a second ticker would double
    // every pull, race the server's run mutex, and split one sweep across two Activity Log rows.
    void runScheduleTick;
  }, []);
}

/**
 * App-mounted gate, now a no-op.
 *
 * Kept mounted rather than deleted so the retirement is visible at the mount site: somebody looking
 * for "where does the SharePoint schedule run" finds this and is told, instead of finding nothing and
 * assuming it was lost.
 */
export function SharePointAutoPullGate(): null {
  return null;
}
