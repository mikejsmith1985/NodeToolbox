// ProductionPaperworkStep.tsx — Step 10 "Production paperwork": the Director's approval email and the change plan PDF, only when needed.
//
// Framework-first: the email is Toolbox's RCP approval template and prompt (rcpApprovalEmail), the plan page is
// Toolbox's print-ready change plan (changePlanDocument) — saved through the browser's own "Save as PDF". When the
// change is not for Production, or the restricted change period rules are not in force, the step says why it is skipped.

import { useId, useMemo, useState } from 'react';

import { buildChangePlanDocumentHtml, openChangePlanForPrinting } from '../../../views/SnowHub/rcp/changePlanDocument.ts';
import { buildRcpApprovalEmailPrompt, buildRcpApprovalEmailTemplate, readRcpEmailReply, readRcpProcessOwnerName } from '../../../views/SnowHub/rcp/rcpApprovalEmail.ts';
import { readCentralTodayIso, type RcpCheckStatus } from '../../../views/SnowHub/rcp/rcpRules.ts';
import CopyButton from '../../shell/CopyButton.tsx';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import type { PaperworkNeed } from '../changeWizardSteps.ts';
import styles from '../ChangeWizard.module.css';
import { buildDraftChangePlan, evaluateDraftRcp } from '../draftChangePlan.ts';
import PromptRound from '../PromptRound.tsx';

/** Paperwork also needs to know whether it applies. */
export interface ProductionPaperworkStepProps extends ChangeStepProps {
  paperworkNeed: PaperworkNeed;
}

const RULE_STATUS_WORDS: Readonly<Record<RcpCheckStatus, string>> = { pass: 'Met', fail: 'Not met', check: 'Check once created' };
const POPUP_BLOCKED_MESSAGE = 'The new window was blocked. Allow pop-ups for ServiceNow and try again.';
const PRINT_HINT = 'In the print window choose "Save as PDF", then attach the file to the approval email.';
const GENERATED_ON_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' };

/** The finished email, ready to copy. */
function FinishedEmail({ emailText }: { emailText: string }) {
  const emailFieldId = useId();
  return (
    <div className={styles.card}>
      <label className={styles.fieldLabel} htmlFor={emailFieldId}>Your approval email</label>
      <textarea id={emailFieldId} className={styles.textArea} readOnly value={emailText} />
      <div className={styles.buttonRow}><CopyButton text={emailText} label="Copy the email" fallbackTargetId={emailFieldId} /></div>
    </div>
  );
}

/** Opens the change plan for "Save as PDF", saying plainly when the browser blocked it. */
function ChangePlanButton({ crg, session, onOpened }: Pick<ChangeStepProps, 'crg' | 'session'> & { onOpened: () => void }) {
  const [statusText, setStatusText] = useState('');
  function openPlan() {
    const generatedOnLabel = `${new Intl.DateTimeFormat('en-US', GENERATED_ON_FORMAT).format(new Date())} CT`;
    const planHtml = buildChangePlanDocumentHtml(buildDraftChangePlan(crg.state, session.modify?.changeNumber ?? ''), generatedOnLabel);
    const wasOpened = openChangePlanForPrinting(planHtml);
    setStatusText(wasOpened ? PRINT_HINT : POPUP_BLOCKED_MESSAGE);
    if (wasOpened) onOpened();
  }
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>The change plan PDF</h3>
      <div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={openPlan}>Open the change plan to save as PDF</button></div>
      {statusText ? <p className={styles.hint} role="status">{statusText}</p> : null}
    </div>
  );
}

/** Step 10: the approval email and change plan, or why they are not needed. */
export default function ProductionPaperworkStep({ crg, session, updateSession, paperworkNeed }: ProductionPaperworkStepProps) {
  const [emailText, setEmailText] = useState('');
  const evaluation = useMemo(() => evaluateDraftRcp(crg.state, readCentralTodayIso()), [crg.state]);
  if (!paperworkNeed.isNeeded || evaluation === null) {
    return <p className={styles.successText}>{`Nothing to do here. ${paperworkNeed.reason}`}</p>;
  }
  const emailContext = { ...evaluation.emailContext, changeNumber: session.modify?.changeNumber ?? '' };
  const processOwnerName = readRcpProcessOwnerName();
  const markDone = () => updateSession({ isPaperworkDone: true });
  return (
    <div>
      <p className={styles.stepIntro}>{paperworkNeed.reason} Send the Director the approval email with the change plan attached.</p>
      <ul className={styles.itemList} aria-label="Restricted change period rules">
        {evaluation.results.map((result) => <li key={result.ruleId} className={styles.hint}>{`${RULE_STATUS_WORDS[result.status]} — ${result.title}: ${result.detail}`}</li>)}
      </ul>
      <PromptRound promptText={buildRcpApprovalEmailPrompt(emailContext, processOwnerName)} copyLabel="Copy the email prompt" readButtonLabel="Read the email" onReadReply={(replyText) => {
        const readEmail = readRcpEmailReply(replyText).emailText;
        setEmailText(readEmail);
        if (readEmail !== '') markDone();
        return readEmail !== '' ? 'Your email is ready below.' : 'That reply held no email. Paste the whole reply.';
      }} />
      {emailText ? <FinishedEmail emailText={emailText} /> : null}
      <details className={styles.moreOptions}>
        <summary>Write the email yourself instead</summary>
        <FinishedEmail emailText={buildRcpApprovalEmailTemplate(emailContext, processOwnerName)} />
      </details>
      <ChangePlanButton crg={crg} session={session} onOpened={markDone} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={markDone}>I&apos;ll do this after the change is created</button>
      </div>
    </div>
  );
}
