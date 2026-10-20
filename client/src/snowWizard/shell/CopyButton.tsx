// CopyButton.tsx — The Wizard's one copy button: it always confirms ("Copied ✓") or says how to finish by hand
// ("Press Ctrl+C", with the text selected) — the owner's probe finding was a copy that gave no feedback at all.

import { useEffect, useRef, useState } from 'react';

import styles from './WizardShell.module.css';

/** How long "Copied ✓" stays before the button returns to its label. */
export const COPIED_CONFIRMATION_MS = 2000;

const COPIED_TEXT = 'Copied ✓';
const MANUAL_COPY_TEXT = 'Press Ctrl+C';

interface CopyButtonProps {
  text: string;
  label: string;
  /** The field holding the same text, selected for the user when the browser blocks copying. */
  fallbackTargetId?: string;
}

function selectFallbackText(fallbackTargetId: string | undefined): void {
  if (!fallbackTargetId) return;
  const targetField = document.getElementById(fallbackTargetId);
  if (targetField instanceof HTMLTextAreaElement || targetField instanceof HTMLInputElement) {
    targetField.focus();
    targetField.select();
  }
}

/** A button that copies `text` and shows the user whether it worked. */
export default function CopyButton({ text, label, fallbackTargetId }: CopyButtonProps) {
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  async function handleCopy() {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setFeedbackText(COPIED_TEXT);
      resetTimerRef.current = setTimeout(() => setFeedbackText(null), COPIED_CONFIRMATION_MS);
    } catch {
      selectFallbackText(fallbackTargetId);
      setFeedbackText(MANUAL_COPY_TEXT);
    }
  }

  return (
    <button type="button" className={styles.secondaryButton} onClick={() => { void handleCopy(); }} aria-live="polite">
      {feedbackText ?? label}
    </button>
  );
}
