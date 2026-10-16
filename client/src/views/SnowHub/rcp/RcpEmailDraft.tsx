// RcpEmailDraft.tsx — Drafts the RCP approval request email and its attached change plan, with AI Assist doing the work.
//
// The sender should have no real work: AI Assist gets everything known about the change and works out every
// section of the email itself — and writes the change plan the email says is attached. When something truly
// cannot be worked out, AI Assist asks in its own chat, with its best guess, so a "yes" answers it. Only the
// finished email and attachment are pasted back here. While either has a gap (or the attachment is missing),
// nothing can be copied or saved; one click builds the follow-up prompt that has AI Assist close the gaps.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import { buildAttachmentDocumentHtml, openChangePlanForPrinting } from './changePlanDocument.ts';
import {
  buildRcpApprovalEmailPrompt,
  buildRcpAttachmentTitle,
  buildRcpEmailGapPrompt,
  findRcpDraftGaps,
  isRcpEmailQuestionReply,
  readRcpEmailReply,
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

/** What AI Assist sent back: the email, and the change plan it says is attached. */
interface RcpDraft {
  emailText: string;
  attachmentText: string;
}

const EMAIL_ROWS = 18;
const ATTACHMENT_ROWS = 14;
const QUESTION_PASTED_MESSAGE = 'That is AI Assist\'s question — answer it in the AI chat, then paste its finished email and attachment here.';
const PRINT_HINT = 'In the print dialog choose "Save as PDF", then attach the file to the email.';
const POPUP_BLOCKED_MESSAGE = 'The pop-up was blocked — allow pop-ups for Toolbox and try again.';
const GENERATED_ON_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'America/Chicago' };
// The change number as the email names it, for the attachment's title when the change had none yet.
const CHANGE_NUMBER_PATTERN = /\bCHG\d+\b/;

/** The pasted reply handled the same way for the first draft and every follow-up. */
function readPastedDraft(replyText: string, onDraft: (draft: RcpDraft) => void): { statusMessage: string; wasApplied: boolean } {
  if (isRcpEmailQuestionReply(replyText)) {
    return { statusMessage: QUESTION_PASTED_MESSAGE, wasApplied: false };
  }
  const draft = readRcpEmailReply(replyText);
  if (draft.emailText === '') {
    return { statusMessage: 'The pasted email is empty.', wasApplied: false };
  }
  onDraft(draft);
  const gapCount = findRcpDraftGaps(draft.emailText, draft.attachmentText).length;
  return gapCount === 0
    ? { statusMessage: 'Email and attachment captured with no gaps — close this to read them, save the PDF and copy the email.', wasApplied: true }
    : { statusMessage: `Captured, but ${gapCount} gap${gapCount === 1 ? '' : 's'} remain — close this and ask AI Assist to finish it.`, wasApplied: true };
}

/** The attachment's title: the change's own number, else the one the email names. */
function readAttachmentTitle(changeNumber: string, emailText: string): string {
  return buildRcpAttachmentTitle(changeNumber || (CHANGE_NUMBER_PATTERN.exec(emailText)?.[0] ?? ''));
}

/** Opens the attachment for printing, and says what to do next or why it did not open. */
function saveAttachmentAsPdf(attachmentTitle: string, attachmentText: string): string {
  const generatedOnLabel = `${new Intl.DateTimeFormat('en-US', GENERATED_ON_FORMAT).format(new Date())}`;
  return openChangePlanForPrinting(buildAttachmentDocumentHtml(attachmentTitle, attachmentText, generatedOnLabel)) ? PRINT_HINT : POPUP_BLOCKED_MESSAGE;
}

/** The email and its attachment: editable, and copyable / savable only once neither has a gap. */
function DraftedEmail({ draft, attachmentTitle, onDraftChange, onAskToFinish }: {
  draft: RcpDraft;
  attachmentTitle: string;
  onDraftChange: (draft: RcpDraft) => void;
  onAskToFinish: () => void;
}) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const [printMessage, setPrintMessage] = useState('');
  const gaps = findRcpDraftGaps(draft.emailText, draft.attachmentText);
  const isReady = gaps.length === 0;
  return (
    <div className={styles.environmentCard}>
      <label className={styles.panelSectionTitle} htmlFor="rcp-approval-email">RCP approval request email</label>
      <textarea className={styles.textArea} id="rcp-approval-email" onChange={(event) => onDraftChange({ ...draft, emailText: event.target.value })} rows={EMAIL_ROWS} value={draft.emailText} />
      <label className={styles.panelSectionTitle} htmlFor="rcp-approval-attachment">{`Attachment — ${attachmentTitle}.pdf`}</label>
      <textarea className={styles.textArea} id="rcp-approval-attachment" onChange={(event) => onDraftChange({ ...draft, attachmentText: event.target.value })} rows={ATTACHMENT_ROWS} value={draft.attachmentText} />
      {isReady ? (
        <p className={styles.successText}>✅ No gaps — read both once, save the attachment as a PDF, then copy the email.</p>
      ) : (
        <p className={styles.errorText} role="status">
          {`⚠️ Not ready — still shows ${gaps.map((gap) => gap.placeholderText).join(', ')}. AI Assist will work these out or ask you.`}
        </p>
      )}
      <div className={styles.buttonRow}>
        {isReady ? null : <button className={styles.aiAssistButton} onClick={onAskToFinish} type="button">✉️ Ask AI Assist to finish it</button>}
        <button className={styles.secondaryButton} disabled={!isReady} onClick={() => setPrintMessage(saveAttachmentAsPdf(attachmentTitle, draft.attachmentText))} type="button">
          🖨️ Save attachment as PDF
        </button>
        <button className={styles.secondaryButton} disabled={!isReady} onClick={() => confirmCopy(draft.emailText)} type="button">
          {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy email</>}
        </button>
      </div>
      {printMessage ? <p className={styles.panelHint}>{printMessage}</p> : null}
    </div>
  );
}

/** Drafts the email and its attachment through AI Assist from everything known about the change. */
export function RcpEmailDraft({ emailContext, loadFullEmailContext }: RcpEmailDraftProps) {
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [draft, setDraft] = useState<RcpDraft | null>(null);
  const [isReading, setIsReading] = useState(false);

  // A finished email teaches Toolbox the sender's sign-off, so the next email need not ask for it.
  const acceptDraft = (pastedDraft: RcpDraft) => {
    setDraft(pastedDraft);
    const senderDetails = readRcpSenderFromEmail(pastedDraft.emailText);
    if (senderDetails !== null && findRcpDraftGaps(pastedDraft.emailText, pastedDraft.attachmentText).length === 0) writeRcpSenderDetails(senderDetails);
  };

  const openPrompt = (instructions: string, promptText: string) => setPromptSession({
    instructions, promptText, applyButtonLabel: 'Use this email', applyReply: (replyText) => readPastedDraft(replyText, acceptDraft),
  });

  const handleDraft = async () => {
    setIsReading(true);
    const fullContext = loadFullEmailContext ? await loadFullEmailContext().catch(() => emailContext) : emailContext;
    setIsReading(false);
    openPrompt(
      'Copy this into AI Assist. It writes the email and the change plan it attaches from everything known about the change, asking you in its chat only what it cannot work out — then paste its finished reply below.',
      buildRcpApprovalEmailPrompt({ ...readRcpSenderDetails(), ...fullContext }, readRcpProcessOwnerName()),
    );
  };

  const handleAskToFinish = () => {
    if (draft === null) return;
    openPrompt(
      'Copy this into the same AI Assist chat — it closes the remaining gaps — then paste the finished reply below.',
      buildRcpEmailGapPrompt(draft.emailText, draft.attachmentText, findRcpDraftGaps(draft.emailText, draft.attachmentText)),
    );
  };

  return (
    <>
      <div className={styles.buttonRow}>
        <button className={styles.aiAssistButton} disabled={isReading} onClick={() => void handleDraft()} type="button">
          {isReading ? 'Reading the change…' : '✉️ Draft the Director approval email with AI Assist'}
        </button>
      </div>
      {draft !== null ? (
        <DraftedEmail
          attachmentTitle={readAttachmentTitle(emailContext.changeNumber, draft.emailText)}
          draft={draft}
          onAskToFinish={handleAskToFinish}
          onDraftChange={setDraft}
        />
      ) : null}
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </>
  );
}
