// PoAiPanel.tsx — The optional, gated AI accelerator shown on both authoring tabs.
//
// The gate is read from the shared store directly and returns null when locked, so a PO who has never
// unlocked AI Assist sees no trace of it — no disabled button, no hint, nothing (SC-005).
//
// The panel is a copy-out / paste-back round trip. Toolbox never calls an AI service. Ingesting a reply
// writes NOTHING to Jira: proposals land in the tab's own draft, unaccepted, and Jira is reached only by
// the Commit button the PO already uses (FR-021, INV-J1).
//
// Google's AI Mode (the team's only assistant) answers in its own shape, so a reply can come back unreadable or with
// items left out. A round then hands back a follow-up for the SAME chat — asking only for the form, or only for what is
// missing — and the panel shows it with a copy button instead of a dead end (GH #499). Nothing is ever guessed.

import { useState } from 'react';

import { AiFollowUpPrompt } from '../../../components/AiFollowUpPrompt/index.tsx';
import { useAiAssistStore } from '../../../store/aiAssistStore';
import styles from './PoAiPanel.module.css';

/** What reading one reply produced: how many proposals landed, what was wrong, and any follow-up to send. */
export interface PoAiIngestOutcome {
  acceptedCount: number;
  errors: string[];
  /** A follow-up for the same AI chat when the reply was unreadable or left items out; '' or absent when none. */
  followUpPrompt?: string;
}

/** Characters that cannot appear in an element id — the panel title is turned into one. */
const NON_ID_CHARACTER_PATTERN = /[^a-z0-9]+/g;

/** A stable element id for this panel's follow-up box, so two panels on one page are told apart. */
function buildFollowUpFieldId(title: string): string {
  return `po-ai-follow-up-${title.toLowerCase().replace(NON_ID_CHARACTER_PATTERN, '-').replace(/^-|-$/g, '')}`;
}

interface PoAiPanelProps {
  /** What this panel is for, e.g. "Propose a split". */
  title: string;
  /** Builds the prompt on demand, so a long draft is only assembled when the PO asks. */
  buildPrompt: () => string;
  /** Ingests the reply. Returns what to tell the PO; the caller applies the proposals to its draft. */
  onIngest: (responseText: string) => PoAiIngestOutcome;
  /** Explains what will happen when a proposal is accepted. */
  helpText: string;
}

/** The gated prompt-out / paste-back panel. Renders nothing at all for a locked session. */
export default function PoAiPanel({ title, buildPrompt, onIngest, helpText }: PoAiPanelProps) {
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);

  const [promptText, setPromptText] = useState('');
  const [responseText, setResponseText] = useState('');
  const [ingestErrors, setIngestErrors] = useState<string[]>([]);
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [hasCopiedPrompt, setHasCopiedPrompt] = useState(false);

  // Hooks run first, then the gate: a locked session renders nothing at all.
  if (!isAiAssistUnlocked) {
    return null;
  }

  function handleGeneratePrompt(): void {
    setPromptText(buildPrompt());
    setHasCopiedPrompt(false);
    // A fresh prompt starts a fresh chat, so a follow-up meant for the old one no longer applies.
    setFollowUpPrompt('');
  }

  async function handleCopyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(promptText);
      setHasCopiedPrompt(true);
    } catch {
      // Clipboard access can be denied; the prompt is on screen and selectable either way.
      setHasCopiedPrompt(false);
    }
  }

  function handleIngest(): void {
    const { acceptedCount, errors, followUpPrompt: nextFollowUpPrompt = '' } = onIngest(responseText);
    setIngestErrors(errors);
    setFollowUpPrompt(nextFollowUpPrompt);
    setIngestSummary(
      acceptedCount > 0
        ? `${acceptedCount} proposal(s) added below — nothing is in Jira yet. Review each one, edit anything you like, then accept the ones you agree with.`
        : null,
    );
    if (acceptedCount > 0) {
      setResponseText('');
    }
  }

  return (
    <section className={styles.aiPanel} aria-label={title}>
      <h3 className={styles.aiTitle}>⚡ {title}</h3>
      <p className={styles.aiHelp}>{helpText}</p>

      <button className={styles.secondaryButton} type="button" onClick={handleGeneratePrompt}>
        Build the prompt
      </button>

      {promptText !== '' ? (
        <>
          {/* Read-only and on screen: the PO sees exactly what would be sent before sending it. */}
          <label className={styles.fieldLabel} htmlFor="po-ai-prompt">
            Prompt — read it, then copy it into your assistant
          </label>
          <textarea className={styles.promptArea} id="po-ai-prompt" readOnly value={promptText} />
          <button className={styles.secondaryButton} type="button" onClick={handleCopyPrompt}>
            {hasCopiedPrompt ? '✓ Copied' : '📋 Copy prompt'}
          </button>

          <label className={styles.fieldLabel} htmlFor="po-ai-response">
            Paste the assistant&apos;s reply here
          </label>
          <textarea
            className={styles.responseArea}
            id="po-ai-response"
            value={responseText}
            onChange={(changeEvent) => setResponseText(changeEvent.target.value)}
          />
          <button
            className={styles.primaryButton}
            type="button"
            disabled={responseText.trim() === ''}
            onClick={handleIngest}
          >
            Read the reply
          </button>
        </>
      ) : null}

      {ingestSummary ? <p className={styles.aiSummary}>{ingestSummary}</p> : null}

      {ingestErrors.length > 0 ? (
        <ul className={styles.aiErrorList} aria-label="Problems with the reply">
          {ingestErrors.map((ingestError) => (
            <li key={ingestError}>{ingestError}</li>
          ))}
        </ul>
      ) : null}

      <AiFollowUpPrompt followUpPrompt={followUpPrompt} fieldId={buildFollowUpFieldId(title)} />
    </section>
  );
}
