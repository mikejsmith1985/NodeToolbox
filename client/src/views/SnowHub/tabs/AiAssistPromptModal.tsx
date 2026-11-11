// AiAssistPromptModal.tsx — The copy-out / paste-back modal every CHG AI Assist round uses (GH #395).
//
// Moved out of the change builder so Modify Existing CHG runs the very same round trip: copy the prompt into
// the assistant, paste its reply back, and let the round's own handler consume it. Nothing is ever sent to an
// assistant automatically.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { describePromptParts, splitPromptIntoParts } from '../chgFormula/promptParts.ts';
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
// The follow-up's place in the copied-button tracking, apart from every prompt part's index.
const FOLLOW_UP_COPY_INDEX = -1;

/** The prompt to copy, a box for the reply, and the outcome of consuming it. */
export function AiAssistPromptModal({ session, onClose }: AiAssistPromptModalProps) {
  const [replyText, setReplyText] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const [copiedPartIndex, setCopiedPartIndex] = useState<number | null>(null);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  // A prompt too long for one chat message comes as parts, each copied on its own (GH #475).
  const promptParts = splitPromptIntoParts(session.promptText);
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
        {promptParts.length > 1 ? <p className={styles.promptInstructions}>{describePromptParts(promptParts.length)}</p> : null}
        {promptParts.map((partText, partIndex) => {
          const isPartCopied = hasCopied && copiedPartIndex === partIndex;
          const copyLabel = promptParts.length === 1 ? 'Copy to Clipboard' : `Copy part ${partIndex + 1} of ${promptParts.length}`;
          return (
            <div key={partIndex}>
              <textarea
                aria-label={promptParts.length === 1 ? 'Prompt' : `Prompt part ${partIndex + 1} of ${promptParts.length}`}
                className={styles.promptTextArea}
                readOnly
                value={partText}
              />
              <div className={styles.promptActions}>
                <button
                  className={styles.aiAssistButton}
                  onClick={() => { setCopiedPartIndex(partIndex); confirmCopy(partText); }}
                  type="button"
                >
                  {isPartCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> {copyLabel}</>}
                </button>
              </div>
            </div>
          );
        })}
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
