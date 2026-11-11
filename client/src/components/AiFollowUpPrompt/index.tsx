// AiFollowUpPrompt — The follow-up an AI round offers when a pasted reply strayed from the asked-for form (GH #499).
//
// Google's AI Mode, the team's only assistant, answers in its own shape. Rather than a dead "could not read the reply",
// every round shows a short follow-up to paste into the SAME AI chat — it asks for the form, or only the items left out,
// so what the assistant already worked out is kept. Renders nothing when there is no follow-up to offer.

import { CheckIcon, ClipboardIcon } from '../AppIcons/index.tsx';
import { useCopyFeedback } from '../../hooks/useCopyFeedback.ts';
import { AiModePromptParts } from '../AiModePromptParts/index.tsx';
import styles from './AiFollowUpPrompt.module.css';

interface AiFollowUpPromptProps {
  /** The follow-up to copy; '' shows nothing. */
  followUpPrompt: string;
  /** Read by screen readers and tests; one per surface so two rounds on a page are told apart. */
  fieldId?: string;
}

/** The follow-up to copy into the same AI chat, with its copy button. */
export function AiFollowUpPrompt({ followUpPrompt, fieldId = 'ai-follow-up-prompt' }: AiFollowUpPromptProps) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  if (followUpPrompt === '') {
    return null;
  }
  return (
    <div className={styles.followUp}>
      <label className={styles.label} htmlFor={fieldId}>Follow-up for the same AI chat</label>
      <p className={styles.hint}>Paste this into the same AI chat, then paste its reply above.</p>
      <AiModePromptParts promptText={followUpPrompt} />
      <textarea className={styles.textArea} id={fieldId} readOnly value={followUpPrompt} />
      <button className={styles.copyButton} onClick={() => confirmCopy(followUpPrompt)} type="button">
        {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy the follow-up</>}
      </button>
    </div>
  );
}
