// AiAssistPromptModal.tsx — The copy-out / paste-back modal every CHG AI Assist round uses (GH #395).
//
// Moved out of the change builder so Modify Existing CHG runs the very same round trip: copy the prompt into
// the assistant, paste its reply back, and let the round's own handler consume it. Nothing is ever sent to an
// assistant automatically.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import styles from './CreateChgTab.module.css';

/**
 * One copy-out / paste-back round trip. Each AI Assist affordance (Enhance, Draft, Risk check, Fix, Check again)
 * opens a session carrying its own instructions, prompt text and reply handling, so one modal serves them all.
 */
export interface AiAssistPromptSession {
  /** Sentence shown above the prompt telling the user what this round trip produces. */
  instructions: string;
  /** The prompt text the user copies into their assistant. */
  promptText: string;
  /** Label for the button that consumes the pasted reply. */
  applyButtonLabel: string;
  /** Consumes the pasted reply. Returns the status to show and whether the reply was used. */
  applyReply: (replyText: string) => { statusMessage: string; wasApplied: boolean };
}

interface AiAssistPromptModalProps {
  session: AiAssistPromptSession;
  onClose: () => void;
}

// The reply box's id, so its label names it for screen readers and tests alike.
const REPLY_FIELD_ID = 'crg-ai-assist-reply';

/** The prompt to copy, a box for the reply, and the outcome of consuming it. */
export function AiAssistPromptModal({ session, onClose }: AiAssistPromptModalProps) {
  const [replyText, setReplyText] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const { hasCopied, confirmCopy } = useCopyFeedback();

  const handleApplyReply = () => {
    const applyOutcome = session.applyReply(replyText);
    setApplyStatus(applyOutcome.statusMessage);
    // A used reply is cleared so a second paste starts clean; an unusable one stays to be corrected.
    if (applyOutcome.wasApplied) {
      setReplyText('');
    }
  };

  return (
    <div className={styles.passphraseOverlay}>
      <div className={styles.promptModal}>
        <p className={styles.promptInstructions}>{session.instructions}</p>
        <textarea className={styles.promptTextArea} readOnly value={session.promptText} />
        <div className={styles.promptActions}>
          <button className={styles.aiAssistButton} onClick={() => confirmCopy(session.promptText)} type="button">
            {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy to Clipboard</>}
          </button>
          <button className={styles.linkButton} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <label className={styles.promptInstructions} htmlFor={REPLY_FIELD_ID}>
          Paste the assistant&apos;s reply here
        </label>
        <textarea
          className={styles.promptTextArea}
          id={REPLY_FIELD_ID}
          onChange={(changeEvent) => setReplyText(changeEvent.target.value)}
          value={replyText}
        />
        <div className={styles.promptActions}>
          <button
            className={styles.aiAssistButton}
            disabled={replyText.trim() === ''}
            onClick={handleApplyReply}
            type="button"
          >
            <CheckIcon /> {session.applyButtonLabel}
          </button>
        </div>
        {applyStatus !== null ? <p className={styles.promptInstructions} role="status">{applyStatus}</p> : null}
      </div>
    </div>
  );
}
