// useAiAssistExchange.ts — Client side of the automated AI Assist prompt exchange.
//
// Replaces the manual copy-paste: dispatches a generated prompt to the server
// (POST /api/ai-assist/dispatch), then polls for AI Assist's deterministic response
// (GET /api/ai-assist/result) until it is parked, and returns the raw text. The caller
// feeds that text into the surface's existing response parser.

import { useCallback, useState } from 'react';

// Default poll cadence and ceiling — ~3 minutes total at 3s intervals. AI Assist can
// take a while to generate a full response, and Confluence needs a moment to index
// the brand-new parking page before it's findable, so the window is generous. A
// successful run still returns as soon as the page is found (within one interval).
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_ATTEMPTS = 60;

export interface AiAssistExchangeResult {
  ok: boolean;
  /** Raw deterministic response text from AI Assist (present when ok). */
  response?: string;
  message: string;
}

export interface AiAssistExchangeOptions {
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
  return `ai-assist-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, milliseconds); });
}

/**
 * Provides the dispatch-and-poll AI Assist exchange action.
 *
 * @param options - Poll cadence / ceiling and a correlation-id override (tests).
 * @returns { isRunning, runAiAssistExchange }
 */
export function useAiAssistExchange(options: AiAssistExchangeOptions = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const generateCorrelationId = options.generateCorrelationId ?? defaultCorrelationId;

  const [isRunning, setIsRunning] = useState(false);

  const runAiAssistExchange = useCallback(async (prompt: string): Promise<AiAssistExchangeResult> => {
    setIsRunning(true);
    try {
      const correlationId = generateCorrelationId();

      const dispatchResponse = await fetch('/api/ai-assist/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correlationId, prompt }),
      });
      const dispatchBody = (await dispatchResponse.json()) as { ok?: boolean; message?: string };
      if (!dispatchBody.ok) {
        return { ok: false, message: dispatchBody.message ?? 'AI Assist dispatch failed.' };
      }

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await delay(pollIntervalMs);
        const resultResponse = await fetch(`/api/ai-assist/result?correlationId=${encodeURIComponent(correlationId)}`);
        const resultBody = (await resultResponse.json()) as { ok?: boolean; ready?: boolean; response?: string; message?: string };

        if (resultBody.ok && resultBody.ready) {
          return { ok: true, response: resultBody.response ?? '', message: 'AI Assist result received.' };
        }
        if (!resultBody.ok) {
          return { ok: false, message: resultBody.message ?? 'Failed to read AI Assist result.' };
        }
      }

      return { ok: false, message: 'Timed out waiting for AI Assist to respond.' };
    } catch (networkError) {
      return { ok: false, message: networkError instanceof Error ? networkError.message : 'Network error.' };
    } finally {
      setIsRunning(false);
    }
  }, [pollIntervalMs, maxAttempts, generateCorrelationId]);

  return { isRunning, runAiAssistExchange };
}
