// ReviewWizard.tsx — The "Review a change" job: a reviewer types a change number, sees the same checks used when a
// change is made (read-only, never a fix), and gets an editable plain-English note for the change's creator.

import { useEffect, useState } from 'react';

import GuidedFlowShell, { type GuidedFlowStep, type GuidedFlowStepState } from '../../components/GuidedFlow/GuidedFlowShell.tsx';
import type { ReadinessItem, ReadinessItemState } from '../../views/SnowHub/guided/changeReadiness.ts';
import { buildChangeLink } from '../change/createOutcome.ts';
import CopyButton from '../shell/CopyButton.tsx';
import type { WizardJobProps } from '../shell/wizardJobProps.ts';
import { loadSnowUrl } from '../shell/wizardSettings.ts';
import shellStyles from '../shell/WizardShell.module.css';
import { runChangeReview, type ChangeReviewResult } from './changeReview.ts';
import { buildCoachingMailto, buildCoachingNote, renderCoachingNoteText } from './coachingNote.ts';
import { installReadOnlySnowTransport } from './readOnlyTransport.ts';
import styles from './ReviewWizard.module.css';

// ── Steps and words ──

type ReviewStepId = 'number' | 'checks' | 'note';

const REVIEW_STEPS: ReadonlyArray<{ id: ReviewStepId; title: string }> = [
  { id: 'number', title: 'Which change?' },
  { id: 'checks', title: 'The checks' },
  { id: 'note', title: 'Note for the creator' },
];

/** Words shown beside every verdict colour, so no verdict depends on colour alone. */
const VERDICT_TEXT: Record<ReadinessItemState, string> = {
  done: 'Done',
  needsAction: 'Needs action',
  notApplicable: 'Does not apply',
  couldNotCheck: 'Could not check',
};

const NOTE_FIELD_ID = 'review-coaching-note';
const NUMBER_FIELD_ID = 'review-change-number';
const READ_ONLY_NOTICE = 'This is a review only — nothing is changed in ServiceNow.';

/** Where each step sits relative to the current one. */
function buildShellSteps(currentStepId: ReviewStepId): GuidedFlowStep[] {
  const currentIndex = REVIEW_STEPS.findIndex((step) => step.id === currentStepId);
  return REVIEW_STEPS.map((step, index) => {
    const stepState: GuidedFlowStepState = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
    return { ...step, state: stepState };
  });
}

/** "1 check needs action", "2 checks need action", or the all-clear. */
function describeVerdicts(items: readonly ReadinessItem[]): string {
  const needsActionCount = items.filter((item) => item.state === 'needsAction').length;
  const notCheckedCount = items.filter((item) => item.state === 'couldNotCheck').length;
  const needsText = needsActionCount === 0 ? 'No check needs action.'
    : `${needsActionCount} ${needsActionCount === 1 ? 'check needs' : 'checks need'} action.`;
  if (notCheckedCount > 0) return `${needsText} ${notCheckedCount} could not be checked.`;
  return needsActionCount === 0 ? 'Every check passed — this change is ready for approval.' : needsText;
}

// ── State ──

/** A finished look-up: the review, or the plain-English reason there is none. */
type ReviewLookup = { review: ChangeReviewResult; problemText: null } | { review: null; problemText: string };

/** Runs one review behind the read-only guard, turning "not found" and failures into words for the reviewer. */
async function lookUpReview(changeNumber: string): Promise<ReviewLookup> {
  installReadOnlySnowTransport(); // Re-guards a connection the Wizard replaced after a reconnect.
  try {
    const reviewResult = await runChangeReview(changeNumber);
    return reviewResult.isChangeFound
      ? { review: reviewResult, problemText: null }
      : { review: null, problemText: `We couldn't find ${changeNumber} in ServiceNow. Check the number and try again.` };
  } catch {
    return { review: null, problemText: `We couldn't check ${changeNumber} just now. Make sure ServiceNow is connected, then try again.` };
  }
}

/** Everything the job remembers, and the moves between steps. */
function useReviewJob() {
  const [stepId, setStepId] = useState<ReviewStepId>('number');
  const [changeNumberText, setChangeNumberText] = useState('');
  const [review, setReview] = useState<ChangeReviewResult | null>(null);
  const [noteText, setNoteText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [problemText, setProblemText] = useState<string | null>(null);

  // The guard lasts as long as the job is open; its cleanup puts the original connection back on exit.
  useEffect(() => installReadOnlySnowTransport(), []);

  async function findChange() {
    const changeNumber = changeNumberText.trim();
    if (changeNumber === '' || isLoading) return;
    setIsLoading(true);
    setProblemText(null);
    const lookup = await lookUpReview(changeNumber);
    setIsLoading(false);
    setProblemText(lookup.problemText);
    if (!lookup.review) return;
    setReview(lookup.review);
    setNoteText(renderCoachingNoteText(buildCoachingNote(lookup.review.items, lookup.review.coachingChange)));
    setStepId('checks');
  }

  function startOver() {
    setReview(null);
    setNoteText('');
    setChangeNumberText('');
    setProblemText(null);
    setStepId('number');
  }

  return { stepId, setStepId, changeNumberText, setChangeNumberText, review, noteText, setNoteText, isLoading, problemText, findChange, startOver };
}

type ReviewJob = ReturnType<typeof useReviewJob>;

// ── Step bodies ──

/** Step 1: the change number. */
function NumberStep({ job }: { job: ReviewJob }) {
  return (
    <div className={shellStyles.card}>
      <p className={shellStyles.hint}>{READ_ONLY_NOTICE}</p>
      <label className={shellStyles.fieldLabel} htmlFor={NUMBER_FIELD_ID}>Change number</label>
      <input
        id={NUMBER_FIELD_ID}
        className={shellStyles.inputField}
        value={job.changeNumberText}
        placeholder="For example CHG0012345"
        autoComplete="off"
        onChange={(event) => job.setChangeNumberText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void job.findChange(); }}
      />
      {job.isLoading && <p className={shellStyles.hint} role="status">Checking the change…</p>}
      {job.problemText && <p className={styles.problem} role="alert">{job.problemText}</p>}
    </div>
  );
}

/** Step 2: every check, its verdict in words, and why — never a fix. */
function ChecksStep({ review }: { review: ChangeReviewResult }) {
  const summaryText = review.coachingChange.shortDescription.trim();
  return (
    <div className={shellStyles.card}>
      <h3 className={shellStyles.cardTitle}><a href={buildChangeLink(loadSnowUrl(), review.changeNumber)} target="_blank" rel="noreferrer">{review.changeNumber}</a>{summaryText ? ` — ${summaryText}` : ''}</h3>
      <p className={styles.summaryLine}>{describeVerdicts(review.items)}</p>
      <p className={shellStyles.hint}>{READ_ONLY_NOTICE}</p>
      <ul className={styles.checkList} aria-label="Checks">
        {review.items.map((item) => (
          <li key={item.id} className={styles.checkRow}>
            <span className={styles.verdict} data-state={item.state}>{VERDICT_TEXT[item.state]}</span>
            <span className={styles.checkText}>
              <span className={styles.checkLabel}>{item.label}</span>
              <span className={styles.checkReason}>{item.reason}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step 3: the editable note, with Copy and Open as email. */
function NoteStep({ job, review }: { job: ReviewJob; review: ChangeReviewResult }) {
  const creatorName = review.coachingChange.creatorName.trim() || 'the change\'s creator';
  const mailtoUrl = buildCoachingMailto(review.changeNumber, job.noteText, review.requesterEmail);
  return (
    <div className={shellStyles.card}>
      <p className={shellStyles.hint}>Change anything you like, then copy it or open it as an email. You send it — nothing is posted to ServiceNow.</p>
      <label className={shellStyles.fieldLabel} htmlFor={NOTE_FIELD_ID}>{`Note for ${creatorName}`}</label>
      <textarea
        id={NOTE_FIELD_ID}
        className={`${shellStyles.inputField} ${styles.noteField}`}
        value={job.noteText}
        onChange={(event) => job.setNoteText(event.target.value)}
      />
      <div className={shellStyles.actions}>
        <CopyButton text={job.noteText} label="Copy the note" fallbackTargetId={NOTE_FIELD_ID} />
        <a className={`${shellStyles.secondaryButton} ${styles.emailLink}`} href={mailtoUrl}>Open as email</a>
      </div>
      {!review.requesterEmail && <p className={shellStyles.hint}>We couldn't find the creator's email, so add it in your email app.</p>}
    </div>
  );
}

// ── Job ──

/** The navigation each step offers. */
function readStepNavigation(job: ReviewJob) {
  if (job.stepId === 'number') {
    return {
      canGoNext: job.changeNumberText.trim() !== '' && !job.isLoading,
      nextBlockedReason: job.isLoading ? 'Checking the change…' : 'Type a change number first',
      nextLabel: job.isLoading ? 'Checking…' : 'Find this change',
      onNext: () => { void job.findChange(); },
      onBack: () => undefined,
    };
  }
  if (job.stepId === 'checks') {
    return { canGoNext: true, nextLabel: 'Write the note', onNext: () => job.setStepId('note'), onBack: () => job.setStepId('number') };
  }
  return { canGoNext: true, nextLabel: 'Review another change', onNext: job.startOver, onBack: () => job.setStepId('checks') };
}

/** The "Review a change" job. */
export default function ReviewWizard({ onExit }: WizardJobProps) {
  const job = useReviewJob();
  const stepNavigation = readStepNavigation(job);
  const backHomeButton = <button type="button" className={shellStyles.secondaryButton} onClick={onExit}>Back to home</button>;
  return (
    <section aria-label="Review a change">
      <GuidedFlowShell steps={buildShellSteps(job.stepId)} currentStepId={job.stepId} advancedAction={backHomeButton} {...stepNavigation}>
        {job.stepId === 'number' && <NumberStep job={job} />}
        {job.stepId === 'checks' && job.review && <ChecksStep review={job.review} />}
        {job.stepId === 'note' && job.review && <NoteStep job={job} review={job.review} />}
      </GuidedFlowShell>
    </section>
  );
}
