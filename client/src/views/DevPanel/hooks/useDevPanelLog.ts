// useDevPanelLog.ts — Captures decoupled Jira API telemetry for the standalone Dev Panel view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_EVENT_NAME = 'toolbox:api';
const MAX_LOG_ENTRIES = 500;
const HTTP_ERROR_MIN_STATUS = 400;
const AVERAGE_ROUNDING_OFFSET = 0;

/** Represents one Jira API activity row recorded by the Dev Panel. */
export interface DevPanelEntry {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | string;
  url: string;
  status: number | null;
  durationMs: number;
  errorMessage: string | null;
}

/** Provides Dev Panel log state and controls without importing the Jira API service. */
export interface UseDevPanelLog {
  entries: DevPanelEntry[];
  isPaused: boolean;
  setPaused: (isPaused: boolean) => void;
  clear: () => void;
  totalCalls: number;
  errorCount: number;
  averageDurationMs: number;
}

interface DevPanelApiEventDetail {
  method?: string;
  url?: string;
  status?: number | null;
  durationMs?: number;
  errorMessage?: string | null;
}

/** Listens for toolbox API telemetry and exposes capped, derived log state for React views. */
export function useDevPanelLog(): UseDevPanelLog {
  const [entries, setEntries] = useState<DevPanelEntry[]>([]);
  const [isPaused, setPausedState] = useState(false);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const handleApiEvent = (event: Event) => {
      if (isPausedRef.current) return;
      const nextEntry = createDevPanelEntry(event);
      setEntries((currentEntries) => appendCappedEntry(currentEntries, nextEntry));
    };

    window.addEventListener(API_EVENT_NAME, handleApiEvent);
    return () => window.removeEventListener(API_EVENT_NAME, handleApiEvent);
  }, []);

  const clear = useCallback(() => setEntries([]), []);
  const setPaused = useCallback((nextIsPaused: boolean) => setPausedState(nextIsPaused), []);
  const stats = useMemo(() => calculateLogStats(entries), [entries]);

  return { entries, isPaused, setPaused, clear, ...stats };
}

function appendCappedEntry(currentEntries: DevPanelEntry[], nextEntry: DevPanelEntry): DevPanelEntry[] {
  const entriesWithNext = [...currentEntries, nextEntry];
  if (entriesWithNext.length <= MAX_LOG_ENTRIES) return entriesWithNext;

  // The Dev Panel must stay lightweight during busy debugging sessions, so it keeps the newest activity only.
  return entriesWithNext.slice(entriesWithNext.length - MAX_LOG_ENTRIES);
}

function calculateLogStats(entries: DevPanelEntry[]) {
  const totalCalls = entries.length;
  const errorCount = entries.filter((entry) => isErrorEntry(entry)).length;
  const totalDurationMs = entries.reduce((durationTotal, entry) => durationTotal + entry.durationMs, AVERAGE_ROUNDING_OFFSET);
  const averageDurationMs = totalCalls > 0 ? Math.round(totalDurationMs / totalCalls) : 0;

  return { totalCalls, errorCount, averageDurationMs };
}

function createDevPanelEntry(event: Event): DevPanelEntry {
  const eventDetail = readApiEventDetail(event);

  return {
    id: createEntryId(),
    timestamp: new Date().toISOString(),
    method: eventDetail.method ?? 'GET',
    url: readUrlPath(eventDetail.url ?? ''),
    status: eventDetail.status ?? null,
    durationMs: eventDetail.durationMs ?? 0,
    errorMessage: eventDetail.errorMessage ?? null,
  };
}

function readApiEventDetail(event: Event): DevPanelApiEventDetail {
  if (event instanceof CustomEvent && isObjectRecord(event.detail)) return event.detail as DevPanelApiEventDetail;
  return {};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorEntry(entry: DevPanelEntry): boolean {
  return entry.status === null || entry.status >= HTTP_ERROR_MIN_STATUS || entry.errorMessage !== null;
}

function createEntryId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readUrlPath(url: string): string {
  if (!url.startsWith('http')) return url;

  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
