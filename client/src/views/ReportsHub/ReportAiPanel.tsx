// ReportAiPanel.tsx — Shared, passphrase-gated copy-prompt → paste-reply shell for report AI accelerators.
//
// Both the Aging triage and the Personal Flow coaching features share the same round-trip mechanics: show
// a read-only prompt to copy into an external assistant, take the pasted JSON reply, and hand it to the
// caller to parse. This component owns ONLY that mechanic and the Ctrl+Alt+Z unlock gate — it renders
// nothing when AI Assist is locked. Each caller supplies the prompt, an ingest handler, and its own
// results UI as children. Nothing here calls an AI service or writes to Jira.
//
// Callers whose results CAN reach Jira (the PI Review panel, whose accepted estimates arm the
// existing write-back) must override `hint`: the default advisory wording would otherwise state
// the opposite.
//
// Google's AI Mode — the team's only assistant (GH #499) — often answers in its own shape. A caller whose reply was
// unreadable or left items out passes `followUpPrompt`, and the panel shows it for the operator to paste into the SAME
// AI chat, so the assistant's work is kept rather than redone.

import { useState } from 'react';

import { AiFollowUpPrompt } from '../../components/AiFollowUpPrompt/index.tsx';
import { AiModePromptParts } from '../../components/AiModePromptParts/index.tsx';
import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { useCopyFeedback } from '../../hooks/useCopyFeedback.ts';
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
   * A follow-up for the same AI chat, shown under the error when the last reply was unreadable or incomplete. Omitted
   * or '' shows nothing, so callers that never pass it render exactly as before.
   */
  followUpPrompt?: string;
  /** The follow-up box's id — one per surface so two panels on a page are told apart. */
  followUpFieldId?: string;
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
  followUpPrompt = '',
  followUpFieldId,
  children,
}: ReportAiPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [responseText, setResponseText] = useState('');
  const { hasCopied: hasCopiedPrompt, confirmCopy: confirmPromptCopy } = useCopyFeedback();

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
      {/* AI Mode drops whatever is pasted past 2,048 characters, so a long prompt is also offered as a file (GH #499). */}
      <AiModePromptParts promptText={prompt} />
      <textarea readOnly value={prompt} rows={5} className={styles.aiTextarea} aria-label={`${title} prompt`} />
      <div className={styles.aiPanelActions}>
        <button type="button" className={styles.actionButton} onClick={() => confirmPromptCopy(prompt)}>
          {hasCopiedPrompt ? '✓ Copied!' : '📋 Copy prompt'}
        </button>
      </div>
      <textarea
        value={responseText}
        onChange={(event) => setResponseText(event.target.value)}
        placeholder="Paste the assistant's JSON reply or filled-in table here"
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
      <AiFollowUpPrompt followUpPrompt={followUpPrompt} fieldId={followUpFieldId} />
      {children}
    </section>
  );
}
