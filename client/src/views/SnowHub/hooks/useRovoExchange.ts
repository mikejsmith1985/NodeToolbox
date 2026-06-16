// useRovoExchange.ts — Client side of the automated Rovo prompt exchange.
//
// Replaces the manual copy-paste: dispatches a generated prompt to the server
// (POST /api/rovo/dispatch), then polls for Rovo's deterministic response
// (GET /api/rovo/result) until it is parked, and returns the raw text. The caller
// feeds that text into the surface's existing response parser.

import { useCallback, useState } from 'react';

// Default poll cadence and ceiling — ~3 minutes total at 3s intervals. Rovo can
// take a while to generate a full response, and Confluence needs a moment to index
// the brand-new parking page before it's findable, so the window is generous. A
// successful run still returns as soon as the page is found (within one interval).
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_ATTEMPTS = 60;

export interface RovoExchangeResult {
  ok: boolean;
  /** Raw deterministic response text from Rovo (present when ok). */
  response?: string;
  message: string;
}

export interface RovoExchangeOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
  /** Overridable for tests. */
  generateCorrelationId?: () => string;
}

/** Generates a unique correlation id, preferring the Web Crypto UUID. */
function defaultCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rovo-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, milliseconds); });
}

/**
 * Provides the dispatch-and-poll Rovo exchange action.
 *
 * @param options - Poll cadence / ceiling and a correlation-id override (tests).
 * @returns { isRunning, runRovoExchange }
 */
export function useRovoExchange(options: RovoExchangeOptions = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const generateCorrelationId = options.generateCorrelationId ?? defaultCorrelationId;

  const [isRunning, setIsRunning] = useState(false);

  const runRovoExchange = useCallback(async (prompt: string): Promise<RovoExchangeResult> => {
    setIsRunning(true);
    try {
      const correlationId = generateCorrelationId();

      const dispatchResponse = await fetch('/api/rovo/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correlationId, prompt }),
      });
      const dispatchBody = (await dispatchResponse.json()) as { ok?: boolean; message?: string };
      if (!dispatchBody.ok) {
        return { ok: false, message: dispatchBody.message ?? 'Rovo dispatch failed.' };
      }

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await delay(pollIntervalMs);
        const resultResponse = await fetch(`/api/rovo/result?correlationId=${encodeURIComponent(correlationId)}`);
        const resultBody = (await resultResponse.json()) as { ok?: boolean; ready?: boolean; response?: string; message?: string };

        if (resultBody.ok && resultBody.ready) {
          return { ok: true, response: resultBody.response ?? '', message: 'Rovo result received.' };
        }
        if (!resultBody.ok) {
          return { ok: false, message: resultBody.message ?? 'Failed to read Rovo result.' };
        }
      }

      return { ok: false, message: 'Timed out waiting for Rovo to respond.' };
    } catch (networkError) {
      return { ok: false, message: networkError instanceof Error ? networkError.message : 'Network error.' };
    } finally {
      setIsRunning(false);
    }
  }, [pollIntervalMs, maxAttempts, generateCorrelationId]);

  return { isRunning, runRovoExchange };
}
