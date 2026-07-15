// ReportAiPanel.tsx — Shared, passphrase-gated copy-prompt → paste-reply shell for report AI accelerators.
//
// Both the Aging triage and the Personal Flow coaching features share the same round-trip mechanics: show
// a read-only prompt to copy into an external assistant, take the pasted JSON reply, and hand it to the
// caller to parse. This component owns ONLY that mechanic and the Ctrl+Alt+Z unlock gate — it renders
// nothing when AI Assist is locked. Each caller supplies the prompt, an ingest handler, and its own
// results UI as children. Nothing here calls an AI service or writes to Jira.
//
// A caller may additionally supply onRunAuto to offer the automatic dispatch path beside the manual
// copy/paste one — auto is a shortcut past the paste box, never a second pipeline, so both paths hand
// the same text to the same handler. Callers whose results CAN reach Jira (the PI Review panel, whose
// accepted estimates arm the existing write-back) must override `hint`: the default advisory wording
// would otherwise state the opposite.

import { useState } from 'react';

import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
import styles from './ReportsHubView.module.css';

/** Props for the gated report AI panel: the prompt to copy, how to ingest a reply, and the results slot. */
export interface ReportAiPanelProps {
  /** Panel heading, e.g. "AI cleanup triage" — prefixed with a ⚡ and marked optional/advisory. */
  title: string;
  /** The fully-assembled prompt the operator copies into an external assistant. */
  prompt: string;
  /** Label for the ingest button, e.g. "Ingest verdicts". */
  ingestLabel: string;
  /** Called with the pasted reply text when the operator ingests; the caller parses and stores it. */
  onIngest: (responseText: string) => void;
  /** A parse/validation error to surface, or null when the last ingest was clean. */
  error: string | null;
  /**
   * Replaces the header's advisory wording. Supply this whenever the caller's results can reach an
   * external system — the default claims the panel writes nothing to Jira, which must never be shown
   * by a caller for which it is untrue.
   */
  hint?: string;
  /**
   * Runs the prompt through the AI Assist automation instead of copy/paste. Omit to keep the shell
   * manual-only, as the Aging triage and Personal Flow consumers do.
   */
  onRunAuto?: () => void;
  /** True while an automatic run is in flight; disables the auto button. */
  isRunning?: boolean;
  /** The caller's results UI (verdict rows, coaching narrative), rendered under the ingest controls. */
  children?: React.ReactNode;
}

/** The wording used when a caller does not override it — true for every advisory, read-only consumer. */
const DEFAULT_ADVISORY_HINT = 'optional · advisory only, writes nothing to Jira';

/** Renders the gated copy/paste AI shell, or nothing when AI Assist is locked. */
export function ReportAiPanel({
  title,
  prompt,
  ingestLabel,
  onIngest,
  error,
  hint = DEFAULT_ADVISORY_HINT,
  onRunAuto,
  isRunning = false,
  children,
}: ReportAiPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [responseText, setResponseText] = useState('');

  // Invisible and inert unless the operator has unlocked AI Assist with Ctrl+Alt+Z.
  if (!isUnlocked) {
    return null;
  }

  return (
    <section className={styles.aiPanel}>
      <div className={styles.aiPanelHeader}>
        ⚡ {title}
        <span className={styles.aiPanelHint}>{hint}</span>
      </div>
      <textarea readOnly value={prompt} rows={5} className={styles.aiTextarea} aria-label={`${title} prompt`} />
      <div className={styles.aiPanelActions}>
        <button type="button" className={styles.actionButton} onClick={() => copyToClipboard(prompt)}>📋 Copy prompt</button>
        {onRunAuto !== undefined && (
          <button type="button" className={styles.actionButton} onClick={onRunAuto} disabled={isRunning}>
            {isRunning ? 'Running…' : '⚡ Run via AI Assist (auto)'}
          </button>
        )}
      </div>
      <textarea
        value={responseText}
        onChange={(event) => setResponseText(event.target.value)}
        placeholder="Paste the assistant's JSON reply here"
        rows={5}
        className={styles.aiTextarea}
        aria-label={`${title} reply`}
      />
      <div className={styles.aiPanelActions}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.primaryButton}`}
          onClick={() => onIngest(responseText)}
          disabled={responseText.trim() === ''}
        >
          {ingestLabel}
        </button>
      </div>
      {error !== null && <p role="alert" className={styles.warningText}>{error}</p>}
      {children}
    </section>
  );
}
