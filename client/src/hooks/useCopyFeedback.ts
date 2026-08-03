// useCopyFeedback.ts — Shared "✓ Copied!" confirmation state for copy-to-clipboard buttons.
//
// Several surfaces hand-rolled an isCopied flag + setTimeout while others gave no feedback at
// all, leaving the user unsure whether a click did anything. This hook owns that round trip:
// write the text, raise a flag the button label can render, and clear it after a short window.
// The default writer is the existing clipboard helper with its non-secure-context fallback
// (Article VII — reuse, not a second clipboard path).

import { useCallback, useEffect, useRef, useState } from 'react';

import { copyToClipboard } from '../views/FeatureCanvas/ai/clipboard.ts';

/** How long the "✓ Copied!" confirmation stays on the button before reverting. */
const COPY_CONFIRMATION_VISIBLE_MS = 2000;

export interface UseCopyFeedbackResult {
  /** True while the short-lived confirmation should show (render "✓ Copied!"). */
  hasCopied: boolean;
  /** Writes the text to the clipboard and raises the confirmation flag. */
  confirmCopy: (text: string) => void;
}

/**
 * Provides copy-button feedback: call `confirmCopy(text)` from the click handler and render
 * the label from `hasCopied`. Repeated clicks restart the confirmation window.
 *
 * @param writeText - Clipboard writer, injectable for tests. Defaults to the shared helper.
 */
export function useCopyFeedback(
  writeText: (text: string) => void = copyToClipboard,
): UseCopyFeedbackResult {
  const [hasCopied, setHasCopied] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);

  // Clear a pending revert when the owning component unmounts (e.g. the modal closes).
  useEffect(() => () => {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
  }, []);

  const confirmCopy = useCallback((text: string) => {
    writeText(text);
    setHasCopied(true);
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = window.setTimeout(() => setHasCopied(false), COPY_CONFIRMATION_VISIBLE_MS);
  }, [writeText]);

  return { hasCopied, confirmCopy };
}
