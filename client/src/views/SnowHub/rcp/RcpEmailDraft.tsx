// RcpEmailDraft.tsx — Drafts the RCP approval request email with AI Assist, confirms its window, and offers its PDF.
//
// The sender should have no real work: AI Assist gets everything known about the change and works out every
// section of the email itself. When something truly cannot be worked out, AI Assist asks in its own chat, with
// its best guess, so a "yes" answers it. The window is always asked about — the approval names it — and comes
// back where Toolbox can read it: a window that differs from the change is written to the change first, so the
// change, the email and the Change Record PDF (ServiceNow's own export, the attachment the template names) agree.
// While the email has a gap or the window disagrees, nothing can be copied or downloaded.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import {
  buildRcpApprovalEmailPrompt,
  buildRcpEmailGapPrompt,
  doesRcpWindowMatchChange,
  findRcpDraftGaps,
  isRcpEmailQuestionReply,
  readRcpConfirmedWindow,
  readRcpEmailReply,
  readRcpProcessOwnerName,
  readRcpSenderDetails,
  readRcpSenderFromEmail,
  writeRcpSenderDetails,
  type RcpApprovalEmailContext,
  type RcpConfirmedWindow,
} from './rcpApprovalEmail.ts';
import { describeCentralWindow } from './rcpRules.ts';

interface RcpEmailDraftProps {
  emailContext: RcpApprovalEmailContext;
  /** Reads more about the change (its plan text and tasks) for AI Assist; the draft still runs if it fails. */
  loadFullEmailContext?: () => Promise<RcpApprovalEmailContext>;
  /** Writes the confirmed window to the change (or the change being built); absent, a differing window is only flagged. */
  onApplyWindow?: (confirmedWindow: RcpConfirmedWindow) => Promise<void> | void;
  /** ServiceNow's PDF export of the change; absent while the change does not exist yet. */
  changeRecordPdfUrl?: string | null;
}

/** What AI Assist sent back: the window confirmed with the sender, and the email. */
interface RcpDraft {
  windowText: string;
  emailText: string;
}

const EMAIL_ROWS = 18;
const QUESTION_PASTED_MESSAGE = 'That is AI Assist\'s question — answer it in the AI chat, then paste its finished window and email here.';
const NO_CHANGE_YET_HINT = 'The Change Record PDF can be downloaded from Modify CHG once the change is created.';

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
  const gapCount = findRcpDraftGaps(draft.emailText, draft.windowText).length;
  return gapCount === 0
    ? { statusMessage: 'Window and email captured with no gaps — close this to check the window, then copy the email.', wasApplied: true }
    : { statusMessage: `Captured, but ${gapCount} gap${gapCount === 1 ? '' : 's'} remain — close this and ask AI Assist to finish it.`, wasApplied: true };
}

/** The confirmed window, and — when the change holds a different one — the button that updates the change. */
function WindowConfirmation({ confirmedWindow, emailContext, onApplyWindow }: {
  confirmedWindow: RcpConfirmedWindow;
  emailContext: RcpApprovalEmailContext;
  onApplyWindow?: RcpEmailDraftProps['onApplyWindow'];
}) {
  const [isSaving, setIsSaving] = useState(false);
  const confirmedText = describeCentralWindow(confirmedWindow.plannedStartUtc, confirmedWindow.plannedEndUtc);
  if (doesRcpWindowMatchChange(confirmedWindow, emailContext.plannedStartUtc, emailContext.plannedEndUtc)) {
    return <p className={styles.successText}>{`📅 Window confirmed: ${confirmedText} — the change holds the same window.`}</p>;
  }
  const applyWindow = async () => {
    setIsSaving(true);
    try {
      await onApplyWindow?.(confirmedWindow);
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <>
      <p className={styles.errorText} role="status">
        {`📅 Window confirmed: ${confirmedText}. The change still says ${emailContext.windowText || 'no window'} — update it so the change, the email and its PDF agree.`}
      </p>
      {onApplyWindow ? (
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} disabled={isSaving} onClick={() => void applyWindow()} type="button">
            {isSaving ? 'Updating the change…' : '📅 Update the change to this window'}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** The email, its window and its PDF: copyable and downloadable only once nothing is missing and the window agrees. */
function DraftedEmail({ draft, emailContext, onApplyWindow, changeRecordPdfUrl, onDraftChange, onAskToFinish }: {
  draft: RcpDraft;
  emailContext: RcpApprovalEmailContext;
  onApplyWindow?: RcpEmailDraftProps['onApplyWindow'];
  changeRecordPdfUrl?: string | null;
  onDraftChange: (draft: RcpDraft) => void;
  onAskToFinish: () => void;
}) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const gaps = findRcpDraftGaps(draft.emailText, draft.windowText);
  const confirmedWindow = readRcpConfirmedWindow(draft.windowText);
  const doesWindowAgree = confirmedWindow !== null
    && doesRcpWindowMatchChange(confirmedWindow, emailContext.plannedStartUtc, emailContext.plannedEndUtc);
  const isReady = gaps.length === 0 && doesWindowAgree;
  return (
    <div className={styles.environmentCard}>
      <label className={styles.panelSectionTitle} htmlFor="rcp-approval-email">RCP approval request email</label>
      <textarea className={styles.textArea} id="rcp-approval-email" onChange={(event) => onDraftChange({ ...draft, emailText: event.target.value })} rows={EMAIL_ROWS} value={draft.emailText} />
      {confirmedWindow !== null ? <WindowConfirmation confirmedWindow={confirmedWindow} emailContext={emailContext} onApplyWindow={onApplyWindow} /> : null}
      {gaps.length === 0 ? null : (
        <p className={styles.errorText} role="status">
          {`⚠️ Not ready — still shows ${gaps.map((gap) => gap.placeholderText).join(', ')}. AI Assist will work these out or ask you.`}
        </p>
      )}
      {isReady ? <p className={styles.successText}>✅ Ready — read it once, download the Change Record PDF, attach it, then copy the email.</p> : null}
      <div className={styles.buttonRow}>
        {gaps.length === 0 ? null : <button className={styles.aiAssistButton} onClick={onAskToFinish} type="button">✉️ Ask AI Assist to finish it</button>}
        {isReady && changeRecordPdfUrl ? (
          <a className={styles.secondaryButton} href={changeRecordPdfUrl} rel="noreferrer" target="_blank">📄 Download the Change Record PDF</a>
        ) : null}
        <button className={styles.secondaryButton} disabled={!isReady} onClick={() => confirmCopy(draft.emailText)} type="button">
          {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy email</>}
        </button>
      </div>
      {changeRecordPdfUrl ? null : <p className={styles.panelHint}>{NO_CHANGE_YET_HINT}</p>}
    </div>
  );
}

/** Drafts the email through AI Assist from everything known about the change, with its window confirmed. */
export function RcpEmailDraft({ emailContext, loadFullEmailContext, onApplyWindow, changeRecordPdfUrl }: RcpEmailDraftProps) {
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [draft, setDraft] = useState<RcpDraft | null>(null);
  const [isReading, setIsReading] = useState(false);

  // A finished email teaches Toolbox the sender's sign-off, so the next email need not ask for it.
  const acceptDraft = (pastedDraft: RcpDraft) => {
    setDraft(pastedDraft);
    const senderDetails = readRcpSenderFromEmail(pastedDraft.emailText);
    if (senderDetails !== null && findRcpDraftGaps(pastedDraft.emailText, pastedDraft.windowText).length === 0) writeRcpSenderDetails(senderDetails);
  };

  const openPrompt = (instructions: string, promptText: string) => setPromptSession({
    instructions, promptText, applyButtonLabel: 'Use this email', applyReply: (replyText) => readPastedDraft(replyText, acceptDraft),
  });

  const handleDraft = async () => {
    setIsReading(true);
    const fullContext = loadFullEmailContext ? await loadFullEmailContext().catch(() => emailContext) : emailContext;
    setIsReading(false);
    openPrompt(
      'Copy this into AI Assist. It confirms the window with you, works out the rest of the email from everything known about the change, and asks you in its chat only what it cannot work out — then paste its finished reply below.',
      buildRcpApprovalEmailPrompt({ ...readRcpSenderDetails(), ...fullContext }, readRcpProcessOwnerName()),
    );
  };

  const handleAskToFinish = () => {
    if (draft === null) return;
    openPrompt(
      'Copy this into the same AI Assist chat — it closes the remaining gaps — then paste the finished reply below.',
      buildRcpEmailGapPrompt(draft.emailText, draft.windowText, findRcpDraftGaps(draft.emailText, draft.windowText)),
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
          changeRecordPdfUrl={changeRecordPdfUrl}
          draft={draft}
          emailContext={emailContext}
          onApplyWindow={onApplyWindow}
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
