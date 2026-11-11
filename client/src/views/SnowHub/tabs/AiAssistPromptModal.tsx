// AiAssistPromptModal.tsx — The copy-out / paste-back modal every CHG AI Assist round uses (GH #395).
//
// Moved out of the change builder so Modify Existing CHG runs the very same round trip: copy the prompt into
// the assistant, paste its reply back, and let the round's own handler consume it. Nothing is ever sent to an
// assistant automatically.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { AiModePromptParts } from '../../../components/AiModePromptParts/index.tsx';
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
  /**
   * Consumes the pasted reply. Returns the status to show, whether the reply was used, and — when the reply strayed from
   * the asked-for form or left items out — a follow-up for the same AI chat (GH #499).
   */
  applyReply: (replyText: string) => { statusMessage: string; wasApplied: boolean; followUpPrompt?: string };
}

interface AiAssistPromptModalProps {
  session: AiAssistPromptSession;
  onClose: () => void;
}

// The reply box's id, so its label names it for screen readers and tests alike.
const REPLY_FIELD_ID = 'crg-ai-assist-reply';
const FOLLOW_UP_FIELD_ID = 'crg-ai-assist-follow-up';
// Which copy button last fired — the prompt's or the follow-up's — so only that one shows "Copied!".
const PROMPT_COPY_INDEX = 0;
const FOLLOW_UP_COPY_INDEX = -1;

/** The prompt to copy, a box for the reply, and the outcome of consuming it. */
export function AiAssistPromptModal({ session, onClose }: AiAssistPromptModalProps) {
  const [replyText, setReplyText] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const [copiedPartIndex, setCopiedPartIndex] = useState<number | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const isPromptCopied = hasCopied && copiedPartIndex === PROMPT_COPY_INDEX;
  const isFollowUpCopied = hasCopied && copiedPartIndex === FOLLOW_UP_COPY_INDEX;

  const handleApplyReply = () => {
    const applyOutcome = session.applyReply(replyText);
    setApplyStatus(applyOutcome.statusMessage);
    setFollowUpPrompt(applyOutcome.followUpPrompt ?? '');
    // A used reply is cleared so a second paste starts clean; an unusable one stays to be corrected.
    if (applyOutcome.wasApplied) {
      setReplyText('');
    }
  };

  return (
    <div className={styles.passphraseOverlay}>
      <div className={styles.promptModal}>
        <p className={styles.promptInstructions}>{session.instructions}</p>
        {/* Past AI Mode's box, the parts are the way in; the whole prompt stays below to read or copy (GH #499). */}
        <AiModePromptParts promptText={session.promptText} />
        <textarea aria-label="Prompt" className={styles.promptTextArea} readOnly value={session.promptText} />
        <div className={styles.promptActions}>
          <button
            className={styles.aiAssistButton}
            onClick={() => { setCopiedPartIndex(PROMPT_COPY_INDEX); confirmCopy(session.promptText); }}
            type="button"
          >
            {isPromptCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy to Clipboard</>}
          </button>
        </div>
        <div className={styles.promptActions}>
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
        {followUpPrompt ? (
          <>
            <label className={styles.promptInstructions} htmlFor={FOLLOW_UP_FIELD_ID}>Follow-up for the same AI chat</label>
            <textarea className={styles.promptTextArea} id={FOLLOW_UP_FIELD_ID} readOnly value={followUpPrompt} />
            <div className={styles.promptActions}>
              <button
                className={styles.aiAssistButton}
                onClick={() => { setCopiedPartIndex(FOLLOW_UP_COPY_INDEX); confirmCopy(followUpPrompt); }}
                type="button"
              >
                {isFollowUpCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy the follow-up</>}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
