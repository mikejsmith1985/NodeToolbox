// RcpChecklist.tsx — Shows whether a Production change meets the RCP rules, and drafts the Director's approval email.
//
// Leads with how many of the five rules are met, then each rule with its verdict and the reason, so the owner
// sees at a glance what still stands between the change and approval. When AI Assist is unlocked it also drafts
// the short approval email the Director must reply to — the one rule Toolbox cannot satisfy on its own.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import {
  buildRcpApprovalEmailPrompt,
  RCP_MAX_EMAIL_WORDS,
  readApprovalEmailReply,
  type RcpApprovalEmailContext,
} from './rcpApprovalEmail.ts';
import type { RcpCheckResult, RcpCheckStatus } from './rcpRules.ts';

interface RcpChecklistProps {
  results: readonly RcpCheckResult[];
  /** The facts the approval email is written from; null hides the draft. */
  emailContext: RcpApprovalEmailContext | null;
}

const STATUS_ICONS: Readonly<Record<RcpCheckStatus, string>> = { pass: '✅', fail: '❌', check: '⚠️' };

/** The drafted email, with its copy button and a warning when it runs long. */
function DraftedEmail({ emailText, wordCount }: { emailText: string; wordCount: number }) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  return (
    <div className={styles.environmentCard}>
      <h5 className={styles.panelSectionTitle}>Director approval email</h5>
      <p className={styles.riskCheckText}>{emailText}</p>
      {wordCount > RCP_MAX_EMAIL_WORDS ? (
        <p className={styles.errorText}>{`${wordCount} words — trim it to ${RCP_MAX_EMAIL_WORDS} or fewer before sending.`}</p>
      ) : null}
      <button className={styles.secondaryButton} onClick={() => confirmCopy(emailText)} type="button">
        {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy email</>}
      </button>
    </div>
  );
}

/** The RCP checklist for one Production change. */
export function RcpChecklist({ results, emailContext }: RcpChecklistProps) {
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [draftedEmail, setDraftedEmail] = useState<{ emailText: string; wordCount: number } | null>(null);
  const metCount = results.filter((result) => result.status === 'pass').length;

  const handleDraftEmail = (context: RcpApprovalEmailContext) => setPromptSession({
    instructions: 'Copy this prompt into AI Assist to draft the Director approval email, then paste the email below.',
    promptText: buildRcpApprovalEmailPrompt(context),
    applyButtonLabel: 'Use this email',
    applyReply: (replyText) => {
      const emailReply = readApprovalEmailReply(replyText);
      if (emailReply.emailText === '') {
        return { statusMessage: 'The pasted email is empty.', wasApplied: false };
      }
      setDraftedEmail(emailReply);
      return { statusMessage: `Email captured (${emailReply.wordCount} words) — it is shown in the RCP checklist.`, wasApplied: true };
    },
  });

  return (
    <div className={styles.riskCheckResult}>
      <p className={styles.riskCheckHeading}>{`🗓️ ${metCount} of ${results.length} RCP rules met`}</p>
      <ul className={styles.riskFindingList}>
        {results.map((result) => (
          <li className={styles.riskFindingItem} key={result.ruleId}>
            <strong className={styles.riskFindingField}>{`${STATUS_ICONS[result.status]} ${result.title}`}</strong>
            <span className={styles.riskFindingDetail}>{result.detail}</span>
          </li>
        ))}
      </ul>
      {isAiAssistUnlocked && emailContext !== null ? (
        <div className={styles.buttonRow}>
          <button className={styles.aiAssistButton} onClick={() => handleDraftEmail(emailContext)} type="button">
            ✉️ Draft the Director approval email with AI Assist
          </button>
        </div>
      ) : null}
      {draftedEmail !== null ? <DraftedEmail emailText={draftedEmail.emailText} wordCount={draftedEmail.wordCount} /> : null}
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </div>
  );
}
