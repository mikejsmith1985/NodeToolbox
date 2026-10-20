// AiEnhanceStep.tsx — Step 6 "Make it better with AI" (optional): review, fix, review again, round by round, until ready.
//
// Visible to everyone — the Wizard has no AI unlock (spec clarification). The prompts are Toolbox's own: the Release
// Manager review, then the gap-fix round for what it found (CreateChgTab's check → fix → check again loop). Copy and
// paste only; nothing is written until accepted, and accepted text carries no AI mark. The rounds live in the job's
// session, so a user sent to another step to fix something comes back to the same round. Next is never blocked here.

import { useMemo } from 'react';

import type { RiskCheckFinding } from '../../../views/SnowHub/chgFormula/riskCheckReview.ts';
import { buildEnhancePrompt, buildReviewFixPrompt, readEnhanceReply, readReviewFixReply, type FieldSuggestion, type SuggestionDecision } from '../aiRounds.ts';
import { applyChangeTextField } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import { readStepTitle, type ChangeWizardMode, type ChangeWizardStepId } from '../changeWizardSteps.ts';
import styles from '../ChangeWizard.module.css';
import PromptRound from '../PromptRound.tsx';
import {
  createReviewLoop, readFixRoundFindings, recordFixSuggestions, recordReviewRound, recordSuggestionDecision,
  resolveFindingStepId, startFixRound, startNextReview, type ReviewLoopSession, type ReviewRoundSummary,
} from '../reviewLoop.ts';
import SuggestionList from '../SuggestionList.tsx';

const NO_FIXES_MESSAGE = 'That reply has no rewritten text yet. If the assistant asked you something, answer it in its chat, then paste its final reply here.';

/** "1 thing", "3 things". */
function countThings(count: number): string {
  return `${count} ${count === 1 ? 'thing' : 'things'}`;
}

/** One finished round in a few words. */
function describeRound(summary: ReviewRoundSummary): string {
  return summary.isReady
    ? `Round ${summary.roundNumber}: ready for approval ✓`
    : `Round ${summary.roundNumber}: needs work — ${countThings(summary.thingsToFixCount)} to fix`;
}

/** The short "how it is going" list, once there is a round to show. */
function RoundHistory({ history }: { history: readonly ReviewRoundSummary[] }) {
  if (history.length === 0) return null;
  return (
    <ul className={styles.itemList} aria-label="Rounds so far">
      {history.map((summary) => <li key={summary.roundNumber} className={styles.hint}>{describeRound(summary)}</li>)}
    </ul>
  );
}

/** One thing the review found, with a button to the step that fixes it when no rewrite can. */
function FindingLine({ finding, mode, goToStep }: { finding: RiskCheckFinding; mode: ChangeWizardMode; goToStep: (stepId: ChangeWizardStepId) => void }) {
  const fixStepId = resolveFindingStepId(finding);
  return (
    <li className={styles.checkItem}>
      <span>{[finding.field, finding.detail].filter((part) => part !== '').join(' — ')}</span>
      {fixStepId ? (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={() => goToStep(fixStepId)}>{`Go to “${readStepTitle(fixStepId, mode)}”`}</button>
        </div>
      ) : null}
    </li>
  );
}

interface NextMovesProps {
  canWriteFixes: boolean;
  onWriteFixes: () => void;
  onReviewAgain: () => void;
}

/** The two ways on: write fixes for the gaps, or review the change again. */
function NextMoves({ canWriteFixes, onWriteFixes, onReviewAgain }: NextMovesProps) {
  return (
    <div className={styles.buttonRow}>
      {canWriteFixes ? <button type="button" className={styles.secondaryButton} onClick={onWriteFixes}>Write fixes for these gaps</button> : null}
      <button type="button" className={styles.actionButton} onClick={onReviewAgain}>Review again</button>
    </div>
  );
}

interface ReviewOutcomeProps {
  loop: ReviewLoopSession;
  mode: ChangeWizardMode;
  goToStep: (stepId: ChangeWizardStepId) => void;
  onWriteFixes: () => void;
  onReviewAgain: () => void;
}

/** What the round's review said: a clear success, or the things to fix and the way to fix them. */
function ReviewOutcome({ loop, mode, goToStep, onWriteFixes, onReviewAgain }: ReviewOutcomeProps) {
  const latestReview = loop.latestReview;
  if (!latestReview) return null;
  if (latestReview.isReady) {
    return <p className={styles.successText}>The review says this change is ready for approval. Press Next to go on.</p>;
  }
  const openFindings = latestReview.openFindings;
  return (
    <div className={styles.card}>
      <p className={styles.noticeText}>{`The review found ${countThings(openFindings.length)} to fix. Fix them, then review again.`}</p>
      <ul className={styles.itemList} aria-label="What the review found">
        {openFindings.map((finding) => <FindingLine key={`${finding.status}-${finding.field}`} finding={finding} mode={mode} goToStep={goToStep} />)}
      </ul>
      <NextMoves canWriteFixes={loop.stage === 'review' && readFixRoundFindings(openFindings).length > 0} onWriteFixes={onWriteFixes} onReviewAgain={onReviewAgain} />
    </div>
  );
}

/** The loop's moves over the job's session: read a review, read fixes, decide, move round. */
function useReviewLoopActions({ crg, session, updateSession }: Pick<ChangeStepProps, 'crg' | 'session' | 'updateSession'>) {
  const loop = session.reviewLoop ?? createReviewLoop();
  const latestReview = loop.latestReview;
  const fixFindings = useMemo(() => readFixRoundFindings(latestReview?.openFindings ?? []), [latestReview]);
  const saveLoop = (nextLoop: ReviewLoopSession) => updateSession({ reviewLoop: nextLoop });

  function readReview(replyText: string): string {
    const reply = readEnhanceReply(replyText, crg.state);
    if (reply.isUsable) updateSession({ reviewLoop: recordReviewRound(loop, reply), riskReview: { isReady: reply.isReady } });
    return reply.message;
  }

  function readFixes(replyText: string): string {
    const suggestions = readReviewFixReply(replyText, crg.state, fixFindings);
    if (suggestions.length === 0) return NO_FIXES_MESSAGE;
    saveLoop(recordFixSuggestions(loop, suggestions));
    return `${suggestions.length} fix(es) are ready. Accept or decline each one below, then review again.`;
  }

  function decide(suggestion: FieldSuggestion, decision: SuggestionDecision) {
    saveLoop(recordSuggestionDecision(loop, suggestion.fieldKey, decision));
  }

  function decideAll(suggestions: FieldSuggestion[], decision: SuggestionDecision) {
    saveLoop(suggestions.reduce((nextLoop, suggestion) => recordSuggestionDecision(nextLoop, suggestion.fieldKey, decision), loop));
  }

  return { loop, fixFindings, readReview, readFixes, decide, decideAll, writeFixes: () => saveLoop(startFixRound(loop)), reviewAgain: () => saveLoop(startNextReview(loop)) };
}

/** Step 6: an optional AI review of the whole change, repeated until it is ready. */
export default function AiEnhanceStep({ crg, session, updateSession, goToStep }: ChangeStepProps) {
  const { loop, fixFindings, readReview, readFixes, decide, decideAll, writeFixes, reviewAgain } = useReviewLoopActions({ crg, session, updateSession });
  const isFixStage = loop.stage === 'fix';
  const promptText = useMemo(
    () => (isFixStage ? buildReviewFixPrompt(crg.state, fixFindings) : buildEnhancePrompt(crg.state)),
    [isFixStage, crg.state, fixFindings],
  );

  return (
    <div>
      <p className={styles.stepIntro}>
        Optional. Ask your AI assistant to review this change the way Release Management will. Keep the suggestions you
        like, fix what it found, and review again until it says the change is ready. You can skip this step.
      </p>
      <RoundHistory history={loop.history} />
      <h3 className={styles.cardTitle}>{`Round ${loop.roundNumber}`}</h3>
      {isFixStage ? <p className={styles.hint}>This prompt asks for fixes to the gaps below. The assistant may ask you a few questions in its chat — answer them there.</p> : null}
      <PromptRound
        key={`${loop.roundNumber}-${loop.stage}`}
        promptText={promptText}
        copyLabel={isFixStage ? 'Copy the fix prompt' : 'Copy the review prompt'}
        readButtonLabel={isFixStage ? 'Read the fixes' : 'Read the reply'}
        onReadReply={isFixStage ? readFixes : readReview}
      />
      <SuggestionList suggestions={loop.suggestions} decisions={loop.decisions} onDecide={decide} onDecideAll={decideAll}
        onAccept={(suggestion) => applyChangeTextField(crg.actions, suggestion.fieldKey, suggestion.suggestedText)} />
      <ReviewOutcome loop={loop} mode={session.mode} goToStep={goToStep} onWriteFixes={writeFixes} onReviewAgain={reviewAgain} />
    </div>
  );
}
