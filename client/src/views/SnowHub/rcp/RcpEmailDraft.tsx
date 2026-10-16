// RcpEmailDraft.tsx — Drafts the RCP approval request email with AI Assist doing the work, and holds any gap.
//
// The sender should have no real work: AI Assist gets everything known about the change and works out every
// section itself. When something truly cannot be worked out, AI Assist asks in its own chat — with its best
// guess, so a "yes" answers it — and only the finished email is pasted back here. An email that still has a
// placeholder cannot be copied; one click builds the follow-up prompt that has AI Assist close the gaps.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import {
  buildRcpApprovalEmailPrompt,
  buildRcpEmailGapPrompt,
  findRcpEmailGaps,
  isRcpEmailQuestionReply,
  readApprovalEmailReply,
  readRcpProcessOwnerName,
  readRcpSenderDetails,
  readRcpSenderFromEmail,
  writeRcpSenderDetails,
  type RcpApprovalEmailContext,
} from './rcpApprovalEmail.ts';

interface RcpEmailDraftProps {
  emailContext: RcpApprovalEmailContext;
  /** Reads more about the change (its plan text and tasks) for AI Assist; the draft still runs if it fails. */
  loadFullEmailContext?: () => Promise<RcpApprovalEmailContext>;
}

const EMAIL_ROWS = 18;
const QUESTION_PASTED_MESSAGE = 'That is AI Assist\'s question — answer it in the AI chat, then paste its finished email here.';

/** The pasted reply handled the same way for the first draft and every follow-up. */
function readPastedEmail(replyText: string, onEmail: (emailText: string) => void): { statusMessage: string; wasApplied: boolean } {
  if (isRcpEmailQuestionReply(replyText)) {
    return { statusMessage: QUESTION_PASTED_MESSAGE, wasApplied: false };
  }
  const emailReply = readApprovalEmailReply(replyText);
  if (emailReply.emailText === '') {
    return { statusMessage: 'The pasted email is empty.', wasApplied: false };
  }
  onEmail(emailReply.emailText);
  const gapCount = findRcpEmailGaps(emailReply.emailText).length;
  return gapCount === 0
    ? { statusMessage: 'Email captured with no gaps — close this to read and copy it.', wasApplied: true }
    : { statusMessage: `Email captured, but it still has ${gapCount} gap${gapCount === 1 ? '' : 's'} — close this and ask AI Assist to finish it.`, wasApplied: true };
}

/** The pasted email: editable, and copyable only once it has no gaps. */
function DraftedEmail({ emailText, onEmailChange, onAskToFinish }: {
  emailText: string;
  onEmailChange: (emailText: string) => void;
  onAskToFinish: () => void;
}) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const gaps = findRcpEmailGaps(emailText);
  return (
    <div className={styles.environmentCard}>
      <label className={styles.panelSectionTitle} htmlFor="rcp-approval-email">RCP approval request email</label>
      <textarea className={styles.textArea} id="rcp-approval-email" onChange={(event) => onEmailChange(event.target.value)} rows={EMAIL_ROWS} value={emailText} />
      {gaps.length > 0 ? (
        <p className={styles.errorText} role="status">
          {`⚠️ Not ready — still shows ${gaps.map((gap) => gap.placeholderText).join(', ')}. AI Assist will work these out or ask you.`}
        </p>
      ) : (
        <p className={styles.successText}>✅ No gaps — read it once, then copy it.</p>
      )}
      <div className={styles.buttonRow}>
        {gaps.length > 0 ? (
          <button className={styles.aiAssistButton} onClick={onAskToFinish} type="button">✉️ Ask AI Assist to finish it</button>
        ) : null}
        <button className={styles.secondaryButton} disabled={gaps.length > 0} onClick={() => confirmCopy(emailText)} type="button">
          {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy email</>}
        </button>
      </div>
    </div>
  );
}

/** Drafts the email through AI Assist from everything known about the change. */
export function RcpEmailDraft({ emailContext, loadFullEmailContext }: RcpEmailDraftProps) {
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [emailText, setEmailText] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);

  // A finished email teaches Toolbox the sender's sign-off, so the next email need not ask for it.
  const acceptEmail = (pastedEmail: string) => {
    setEmailText(pastedEmail);
    const senderDetails = readRcpSenderFromEmail(pastedEmail);
    if (senderDetails !== null && findRcpEmailGaps(pastedEmail).length === 0) writeRcpSenderDetails(senderDetails);
  };

  const openPrompt = (instructions: string, promptText: string) => setPromptSession({
    instructions, promptText, applyButtonLabel: 'Use this email', applyReply: (replyText) => readPastedEmail(replyText, acceptEmail),
  });

  const handleDraft = async () => {
    setIsReading(true);
    const fullContext = loadFullEmailContext ? await loadFullEmailContext().catch(() => emailContext) : emailContext;
    setIsReading(false);
    openPrompt(
      'Copy this into AI Assist. It works out the email from everything known about the change and asks you in its chat only what it cannot — then paste its finished email below.',
      buildRcpApprovalEmailPrompt({ ...readRcpSenderDetails(), ...fullContext }, readRcpProcessOwnerName()),
    );
  };

  const handleAskToFinish = () => {
    if (emailText === null) return;
    openPrompt('Copy this into the same AI Assist chat — it closes the remaining gaps — then paste the finished email below.', buildRcpEmailGapPrompt(emailText, findRcpEmailGaps(emailText)));
  };

  return (
    <>
      <div className={styles.buttonRow}>
        <button className={styles.aiAssistButton} disabled={isReading} onClick={() => void handleDraft()} type="button">
          {isReading ? 'Reading the change…' : '✉️ Draft the Director approval email with AI Assist'}
        </button>
      </div>
      {emailText !== null ? <DraftedEmail emailText={emailText} onAskToFinish={handleAskToFinish} onEmailChange={setEmailText} /> : null}
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </>
  );
}
