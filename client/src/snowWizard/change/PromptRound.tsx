// PromptRound.tsx — One copy-the-prompt / paste-the-reply round, laid out as numbered steps on the page.
//
// The same round trip as Toolbox's AiAssistPromptModal (copy out, paste back, the round's own handler reads it),
// drawn inline in the Wizard's style with the Wizard's confirming CopyButton. Nothing is sent anywhere by itself.

import { useId, useState } from 'react';

import CopyButton from '../shell/CopyButton.tsx';
import styles from './ChangeWizard.module.css';

interface PromptRoundProps {
  promptText: string;
  copyLabel: string;
  readButtonLabel: string;
  /** Reads the pasted reply and returns what to tell the user. */
  onReadReply: (replyText: string) => string;
}

const CLIPBOARD_BLOCKED_TEXT = 'The browser would not share the clipboard. Click in the box and press Ctrl+V instead.';
const CLIPBOARD_EMPTY_TEXT = 'The clipboard is empty. Copy the assistant’s whole reply first.';

/** The clipboard's text, or null when the browser will not share it (no permission, or not supported). */
async function readClipboardText(): Promise<string | null> {
  try {
    return navigator.clipboard?.readText ? await navigator.clipboard.readText() : null;
  } catch {
    return null;
  }
}

/** Copy the prompt, paste the assistant's reply, read it. */
export default function PromptRound({ promptText, copyLabel, readButtonLabel, onReadReply }: PromptRoundProps) {
  const promptFieldId = useId();
  const replyFieldId = useId();
  const [replyText, setReplyText] = useState('');
  const [statusText, setStatusText] = useState('');

  /** One click instead of select-all and paste: takes the clipboard's text and reads it straight away. */
  async function pasteAndRead() {
    const clipboardText = await readClipboardText();
    if (clipboardText === null) { setStatusText(CLIPBOARD_BLOCKED_TEXT); return; }
    if (clipboardText.trim() === '') { setStatusText(CLIPBOARD_EMPTY_TEXT); return; }
    setReplyText(clipboardText);
    setStatusText(onReadReply(clipboardText));
  }

  return (
    <div className={styles.card}>
      <label className={styles.fieldLabel} htmlFor={promptFieldId}>1. Copy this and paste it into your AI assistant</label>
      <textarea id={promptFieldId} className={styles.textArea} readOnly value={promptText} />
      <div className={styles.buttonRow}><CopyButton text={promptText} label={copyLabel} fallbackTargetId={promptFieldId} /></div>
      <label className={styles.fieldLabel} htmlFor={replyFieldId}>2. Paste the assistant&apos;s whole reply here</label>
      <textarea id={replyFieldId} className={styles.textArea} value={replyText} onChange={(changeEvent) => setReplyText(changeEvent.target.value)} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={() => { void pasteAndRead(); }}>Paste from clipboard</button>
        <button type="button" className={styles.secondaryButton} disabled={replyText.trim() === ''} onClick={() => setStatusText(onReadReply(replyText))}>
          {readButtonLabel}
        </button>
      </div>
      {statusText ? <p className={styles.hint} role="status">{statusText}</p> : null}
    </div>
  );
}
