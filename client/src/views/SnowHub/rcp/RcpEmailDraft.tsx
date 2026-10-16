// RcpEmailDraft.tsx — Drafts the RCP approval request email so it cannot go out with a gap in it.
//
// The email is read by the Director and the Change Process Owner; one leftover "[CONFIRM: …]" makes it look
// unread. So the draft is gated twice: before AI Assist is asked, the sender answers every question no
// ServiceNow field can answer; after the reply is pasted, every placeholder still in the email becomes a
// question with an answer box, and the email cannot be copied until none remain.

import { useState } from 'react';

import { CheckIcon, ClipboardIcon } from '../../../components/AppIcons/index.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from '../tabs/AiAssistPromptModal.tsx';
import styles from '../tabs/CreateChgTab.module.css';
import {
  buildInitialRcpEmailAnswers,
  buildRcpApprovalEmailPrompt,
  fillRcpEmailGap,
  findRcpEmailGaps,
  listRcpEmailQuestions,
  listUnansweredRcpEmailQuestions,
  readApprovalEmailReply,
  readRcpProcessOwnerName,
  writeRcpSenderDetails,
  type RcpApprovalEmailContext,
  type RcpEmailAnswers,
  type RcpEmailGap,
  type RcpEmailQuestion,
} from './rcpApprovalEmail.ts';

interface RcpEmailDraftProps {
  emailContext: RcpApprovalEmailContext;
}

const LONG_ANSWER_ROWS = 3;
const EMAIL_ROWS = 18;

/** "1 answer" or "N answers", for the still-needed count. */
function describeCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** One question with its answer box. */
function QuestionField({ question, answer, onAnswer }: { question: RcpEmailQuestion; answer: string; onAnswer: (answer: string) => void }) {
  const fieldId = `rcp-email-question-${question.id}`;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={fieldId}>{question.label}</label>
      {question.isLongAnswer ? (
        <textarea className={styles.textArea} id={fieldId} onChange={(event) => onAnswer(event.target.value)} rows={LONG_ANSWER_ROWS} value={answer} />
      ) : (
        <input className={styles.input} id={fieldId} onChange={(event) => onAnswer(event.target.value)} type="text" value={answer} />
      )}
      <span className={styles.fieldHelpText}>{question.hint}</span>
    </div>
  );
}

/** One gap left in the drafted email, with an answer box that fills it everywhere it appears. */
function GapField({ gap, onFill }: { gap: RcpEmailGap; onFill: (answer: string) => void }) {
  const [answer, setAnswer] = useState('');
  const fieldId = `rcp-email-gap-${gap.placeholderText}`;
  return (
    <li className={styles.riskFindingItem}>
      <label className={styles.riskFindingField} htmlFor={fieldId}>{gap.questionText}</label>
      <span className={styles.riskFindingDetail}>{`Shown in the email as ${gap.placeholderText}`}</span>
      <span className={styles.buttonRow}>
        <input className={styles.input} id={fieldId} onChange={(event) => setAnswer(event.target.value)} type="text" value={answer} />
        <button className={styles.secondaryButton} disabled={answer.trim() === ''} onClick={() => onFill(answer)} type="button">
          Fill in
        </button>
      </span>
    </li>
  );
}

/** The drafted email: editable, with every gap asked about, and copyable only once it has none. */
function DraftedEmail({ emailText, onEmailChange }: { emailText: string; onEmailChange: (emailText: string) => void }) {
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const gaps = findRcpEmailGaps(emailText);
  return (
    <div className={styles.environmentCard}>
      <label className={styles.panelSectionTitle} htmlFor="rcp-approval-email">RCP approval request email</label>
      <textarea
        className={styles.textArea}
        id="rcp-approval-email"
        onChange={(event) => onEmailChange(event.target.value)}
        rows={EMAIL_ROWS}
        value={emailText}
      />
      {gaps.length > 0 ? (
        <>
          <p className={styles.errorText} role="status">
            {`⚠️ ${describeCount(gaps.length, 'gap left', 'gaps left')} — answer each one before the email can be copied.`}
          </p>
          <ul className={styles.riskFindingList}>
            {gaps.map((gap) => (
              <GapField gap={gap} key={gap.placeholderText} onFill={(answer) => onEmailChange(fillRcpEmailGap(emailText, gap.placeholderText, answer))} />
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.successText}>✅ No gaps left — read it once more, then copy it.</p>
      )}
      <button className={styles.secondaryButton} disabled={gaps.length > 0} onClick={() => confirmCopy(emailText)} type="button">
        {hasCopied ? <><CheckIcon /> Copied!</> : <><ClipboardIcon /> Copy email</>}
      </button>
    </div>
  );
}

/** The questions to answer before drafting, with the button that stays off until every one is answered. */
function EmailQuestionsForm({ questions, answers, onAnswer, onContinue }: {
  questions: readonly RcpEmailQuestion[];
  answers: RcpEmailAnswers;
  onAnswer: (questionId: RcpEmailQuestion['id'], answer: string) => void;
  onContinue: () => void;
}) {
  const unansweredCount = listUnansweredRcpEmailQuestions(questions, answers).length;
  return (
    <div className={styles.environmentCard}>
      <h5 className={styles.panelSectionTitle}>Before drafting — answer what ServiceNow does not hold</h5>
      <p className={styles.panelHint}>The email uses these answers word for word; AI Assist only phrases them. Check any answer already filled in.</p>
      {questions.map((question) => (
        <QuestionField answer={answers[question.id] ?? ''} key={question.id} onAnswer={(answer) => onAnswer(question.id, answer)} question={question} />
      ))}
      {unansweredCount > 0 ? <p className={styles.panelHint}>{`${describeCount(unansweredCount, 'answer', 'answers')} still needed.`}</p> : null}
      <div className={styles.buttonRow}>
        <button className={styles.aiAssistButton} disabled={unansweredCount > 0} onClick={onContinue} type="button">
          Continue to AI Assist
        </button>
      </div>
    </div>
  );
}

/** Asks the sender what the email needs, drafts it through AI Assist, then holds it until it has no gaps. */
export function RcpEmailDraft({ emailContext }: RcpEmailDraftProps) {
  const [isAnswering, setIsAnswering] = useState(false);
  const [answers, setAnswers] = useState<RcpEmailAnswers>(() => buildInitialRcpEmailAnswers(emailContext));
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [emailText, setEmailText] = useState<string | null>(null);

  const handleContinue = () => {
    writeRcpSenderDetails({ senderName: answers.senderName ?? '', senderContact: answers.senderContact ?? '' });
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to complete the RCP approval request email from your answers, then paste the email below.',
      promptText: buildRcpApprovalEmailPrompt(emailContext, readRcpProcessOwnerName(), answers),
      applyButtonLabel: 'Use this email',
      applyReply: (replyText) => {
        const emailReply = readApprovalEmailReply(replyText);
        if (emailReply.emailText === '') {
          return { statusMessage: 'The pasted email is empty.', wasApplied: false };
        }
        setEmailText(emailReply.emailText);
        setIsAnswering(false);
        return { statusMessage: 'Email captured — check it in the RCP checklist before copying.', wasApplied: true };
      },
    });
  };

  return (
    <>
      <div className={styles.buttonRow}>
        <button className={styles.aiAssistButton} onClick={() => setIsAnswering(true)} type="button">
          ✉️ Draft the Director approval email with AI Assist
        </button>
      </div>
      {isAnswering ? (
        <EmailQuestionsForm
          answers={answers}
          onAnswer={(questionId, answer) => setAnswers((previousAnswers) => ({ ...previousAnswers, [questionId]: answer }))}
          onContinue={handleContinue}
          questions={listRcpEmailQuestions(emailContext)}
        />
      ) : null}
      {emailText !== null ? <DraftedEmail emailText={emailText} onEmailChange={setEmailText} /> : null}
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </>
  );
}
