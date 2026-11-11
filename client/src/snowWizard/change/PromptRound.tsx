// PromptRound.tsx — One copy-the-prompt / paste-the-reply round, laid out as numbered steps on the page.
//
// The same round trip as Toolbox's AiAssistPromptModal (copy out, paste back, the round's own handler reads it),
// drawn inline in the Wizard's style with the Wizard's confirming CopyButton. Nothing is sent anywhere by itself.

import { useId, useState, type ClipboardEvent } from 'react';

import CopyButton from '../shell/CopyButton.tsx';
import styles from './ChangeWizard.module.css';
import { describePromptParts, splitPromptIntoParts } from '../../views/SnowHub/chgFormula/promptParts.ts';

/** What a reader says about a reply, and — when the reply strayed from the asked-for form — a follow-up to send. */
export interface PromptRoundOutcome {
  message: string;
  /** A short prompt for the same AI chat asking for the form again; '' when none is needed. */
  followUpPrompt: string;
}

interface PromptRoundProps {
  promptText: string;
  copyLabel: string;
  readButtonLabel: string;
  /** Reads the pasted reply and returns what to tell the user, with a follow-up when the reply strayed. */
  onReadReply: (replyText: string) => string | PromptRoundOutcome;
}

const CLIPBOARD_BLOCKED_TEXT = 'The browser would not share the clipboard with this file. The reply box is ready — press Ctrl+V now.';
/**
 * A page opened from a file often gets no clipboard prompt at all, so the browser's answer never comes (owner: "paste
 * doesn't actually paste anything"). After this long the button stops waiting and hands over to Ctrl+V.
 */
const CLIPBOARD_WAIT_MS = 2000;
const CLIPBOARD_EMPTY_TEXT = 'The clipboard is empty. Copy the assistant’s whole reply first.';

/** The clipboard's text, or null when the browser will not share it (no permission, or not supported). */
async function readClipboardText(waitMs = CLIPBOARD_WAIT_MS): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => { timeoutId = setTimeout(() => resolve(null), waitMs); });
  try {
    return await Promise.race([navigator.clipboard.readText(), giveUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Copy the prompt, paste the assistant's reply, read it. */
export default function PromptRound({ promptText, copyLabel, readButtonLabel, onReadReply }: PromptRoundProps) {
  const promptFieldId = useId();
  const replyFieldId = useId();
  const followUpFieldId = useId();
  const [replyText, setReplyText] = useState('');
  const [statusText, setStatusText] = useState('');
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  // A prompt too long for one chat message comes as parts, each with its own copy button (GH #475).
  const promptParts = splitPromptIntoParts(promptText);

  /**
   * Hands a reply to the reader and shows its verdict. A reply that strayed brings a follow-up (GH #499); the reply box
   * is then emptied, so the follow-up's answer is read the moment it is pasted.
   */
  function readReply(pastedReply: string) {
    const outcome = onReadReply(pastedReply);
    const { message, followUpPrompt: nextFollowUp } = typeof outcome === 'string' ? { message: outcome, followUpPrompt: '' } : outcome;
    setStatusText(message);
    setFollowUpPrompt(nextFollowUp);
    if (nextFollowUp !== '') setReplyText('');
  }

  /** One click instead of select-all and paste: takes the clipboard's text and reads it straight away. */
  async function pasteAndRead() {
    const clipboardText = await readClipboardText();
    if (clipboardText === null) {
      // The cursor goes into the reply box, so the Ctrl+V the message asks for lands there and is read at once.
      document.getElementById(replyFieldId)?.focus();
      setStatusText(CLIPBOARD_BLOCKED_TEXT);
      return;
    }
    if (clipboardText.trim() === '') { setStatusText(CLIPBOARD_EMPTY_TEXT); return; }
    setReplyText(clipboardText);
    readReply(clipboardText);
  }

  /** A paste into the empty reply box is the whole reply, so it is read straight away — no second button. */
  function handleReplyPaste(pasteEvent: ClipboardEvent<HTMLTextAreaElement>) {
    if (replyText.trim() !== '') return;
    const pastedText = pasteEvent.clipboardData.getData('text');
    if (pastedText.trim() === '') return;
    pasteEvent.preventDefault();
    setReplyText(pastedText);
    readReply(pastedText);
  }

  return (
    <div className={styles.card}>
      {promptParts.length === 1 ? (
        <>
          <label className={styles.fieldLabel} htmlFor={promptFieldId}>1. Copy this and paste it into your AI assistant</label>
          <textarea id={promptFieldId} className={styles.textArea} readOnly value={promptText} />
          <div className={styles.buttonRow}><CopyButton text={promptText} label={copyLabel} fallbackTargetId={promptFieldId} /></div>
        </>
      ) : (
        <>
          <p className={styles.fieldLabel}>1. Copy each part and paste it into your AI assistant, in order</p>
          <p className={styles.hint}>{describePromptParts(promptParts.length)}</p>
          {promptParts.map((partText, partIndex) => {
            const partFieldId = `${promptFieldId}-part-${partIndex + 1}`;
            const partLabel = `Part ${partIndex + 1} of ${promptParts.length}`;
            return (
              <div key={partFieldId}>
                <label className={styles.fieldLabel} htmlFor={partFieldId}>{partLabel}</label>
                <textarea id={partFieldId} className={styles.textArea} readOnly value={partText} />
                <div className={styles.buttonRow}><CopyButton text={partText} label={`Copy part ${partIndex + 1} of ${promptParts.length}`} fallbackTargetId={partFieldId} /></div>
              </div>
            );
          })}
        </>
      )}
      <label className={styles.fieldLabel} htmlFor={replyFieldId}>2. Paste the assistant&apos;s whole reply here</label>
      <textarea id={replyFieldId} className={styles.textArea} value={replyText} onPaste={handleReplyPaste}
        onChange={(changeEvent) => setReplyText(changeEvent.target.value)} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={() => { void pasteAndRead(); }}>Paste from clipboard</button>
        <button type="button" className={styles.secondaryButton} disabled={replyText.trim() === ''} onClick={() => readReply(replyText)}>
          {readButtonLabel}
        </button>
      </div>
      {statusText ? <p className={styles.hint} role="status">{statusText}</p> : null}
      {followUpPrompt ? (
        <>
          <label className={styles.fieldLabel} htmlFor={followUpFieldId}>Follow-up for the same AI chat</label>
          <textarea id={followUpFieldId} className={styles.textArea} readOnly value={followUpPrompt} />
          <div className={styles.buttonRow}><CopyButton text={followUpPrompt} label="Copy the follow-up" fallbackTargetId={followUpFieldId} /></div>
        </>
      ) : null}
    </div>
  );
}
