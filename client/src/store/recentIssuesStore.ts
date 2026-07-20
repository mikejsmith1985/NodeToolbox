// recentIssuesStore.ts — Client-only list of recently viewed issues for the Quick Issue Lookup popup.
//
// A small convenience list (the last few issues opened via F2) so re-opening a ticket is one keystroke
// away. It is client-only and never synced to the server (spec: "ephemeral, not synced"). Mirrors the
// app's existing recents precedent (settingsStore.recentViews): dedupe + cap, hand-rolled localStorage
// mirror (no zustand persist middleware anywhere in this app).

import { create } from 'zustand';

const STORAGE_KEY = 'tbxRecentIssueKeys';
const MAX_RECENT_ISSUE_COUNT = 5;

/** One recently viewed issue, cached with its summary so the list renders without a fetch. */
export interface RecentIssue {
  key: string;
  summary: string;
}

/**
 * Prepends `entry` to the recents list, de-duplicating by key (a re-viewed key moves to the top and
 * refreshes its summary) and capping the list length. Pure, so it is exhaustively unit-tested.
 */
export function buildRecentIssues(existing: RecentIssue[], entry: RecentIssue): RecentIssue[] {
  const withoutDuplicate = existing.filter((recentIssue) => recentIssue.key !== entry.key);
  return [entry, ...withoutDuplicate].slice(0, MAX_RECENT_ISSUE_COUNT);
}

/** Reads and validates the persisted recents, tolerating missing or malformed storage. */
export function readStoredRecentIssues(): RecentIssue[] {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.filter(
      (item): item is RecentIssue =>
        typeof item === 'object' && item !== null
        && typeof (item as RecentIssue).key === 'string'
        && typeof (item as RecentIssue).summary === 'string',
    );
  } catch {
    return [];
  }
}

/** Mirrors the recents to localStorage, silently tolerating storage failures (private mode, quota). */
function writeStoredRecentIssues(entries: RecentIssue[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Persistence is best-effort; the in-memory list still works this session.
  }
}

/** Recents state: the ordered list plus the action that records a newly viewed issue. */
interface RecentIssuesState {
  entries: RecentIssue[];
  recordRecent: (entry: RecentIssue) => void;
}

export const useRecentIssuesStore = create<RecentIssuesState>((setState, getState) => ({
  entries: readStoredRecentIssues(),
  recordRecent: (entry) => {
    const nextEntries = buildRecentIssues(getState().entries, entry);
    writeStoredRecentIssues(nextEntries);
    setState({ entries: nextEntries });
  },
}));
