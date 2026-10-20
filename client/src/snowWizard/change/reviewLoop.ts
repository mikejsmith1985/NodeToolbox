// reviewLoop.ts — The "Make it better with AI" review loop: review, fix, review again, round by round, until ready (pure).
//
// Framework-first: this is Toolbox's own risk-check loop (CreateChgTab: check → fix the gaps → check again, GH #395)
// with its own prompts and parsers. Only the loop's memory is new, kept here as plain data so the job's session can
// hold it and a user who leaves the step to fix something comes back to the same round.

import { resolveGapTextFields } from '../../views/SnowHub/chgFormula/gapFocus.ts';
import type { RiskCheckFinding } from '../../views/SnowHub/chgFormula/riskCheckReview.ts';
import type { ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import type { FieldSuggestion, SuggestionDecision } from './aiRounds.ts';
import type { ChangeWizardStepId } from './changeWizardSteps.ts';

/** Which prompt a round is showing: the review itself, or a rewrite of the gaps that review found. */
export type ReviewLoopStage = 'review' | 'fix';

/** One finished review, for the short "how it is going" list. */
export interface ReviewRoundSummary {
  roundNumber: number;
  isReady: boolean;
  thingsToFixCount: number;
}

/** What one review said, kept for the fix round and the "go to step" buttons. */
export interface LatestReview {
  isReady: boolean;
  /** Every finding still unsettled: gaps, failed questions, facts only the owner has, record fields to set. */
  openFindings: RiskCheckFinding[];
}

/** Everything the loop remembers within one job. */
export interface ReviewLoopSession {
  roundNumber: number;
  stage: ReviewLoopStage;
  /** The review read in this round; null until its reply is pasted. */
  latestReview: LatestReview | null;
  /** The rewrites on offer now, from the review or from the fix round. */
  suggestions: FieldSuggestion[];
  decisions: Partial<Record<ChgTextFieldKey, SuggestionDecision>>;
  history: ReviewRoundSummary[];
}

/** A pasted review, as the loop needs it. */
export interface ReviewRoundResult extends LatestReview {
  suggestions: FieldSuggestion[];
}

const FIRST_ROUND_NUMBER = 1;

// Statuses the fix round can close: a text gap, a failed quality-gate question, or a fact the assistant can ask for.
const FIX_ROUND_STATUSES: ReadonlySet<RiskCheckFinding['status']> = new Set(['GAP', 'NO', 'INFO']);

// Where a finding no rewrite can close is fixed, by words in its name — checked in this order, details otherwise.
const STEP_KEYWORDS: ReadonlyArray<{ stepId: ChangeWizardStepId; keywords: readonly string[] }> = [
  { stepId: 'evidence', keywords: ['evidence', 'attach'] },
  { stepId: 'tasks', keywords: ['task'] },
  { stepId: 'scope', keywords: ['problem', 'prb', 'incident', 'jira', 'story', 'stories'] },
  { stepId: 'environments', keywords: ['planned', 'start', 'window', 'date', 'schedule', 'environment', 'outage'] },
];
const DEFAULT_FIX_STEP_ID: ChangeWizardStepId = 'details';

/** A loop that has not started: round 1, waiting for the first review. */
export function createReviewLoop(): ReviewLoopSession {
  return { roundNumber: FIRST_ROUND_NUMBER, stage: 'review', latestReview: null, suggestions: [], decisions: {}, history: [] };
}

/** How many things a review left to fix. */
export function countThingsToFix(openFindings: readonly RiskCheckFinding[]): number {
  return openFindings.length;
}

/**
 * The loop with a pasted review recorded. A review pasted onto a round that already has one starts the NEXT round, so
 * the count always moves on however the user gets back to this step (owner bug: it sat on "Round 1").
 */
export function recordReviewRound(loop: ReviewLoopSession, result: ReviewRoundResult): ReviewLoopSession {
  const roundLoop = loop.latestReview ? startNextReview(loop) : loop;
  const summary: ReviewRoundSummary = { roundNumber: roundLoop.roundNumber, isReady: result.isReady, thingsToFixCount: countThingsToFix(result.openFindings) };
  return {
    ...roundLoop,
    stage: 'review',
    latestReview: { isReady: result.isReady, openFindings: result.openFindings },
    suggestions: result.suggestions,
    decisions: {},
    history: [...roundLoop.history.filter((entry) => entry.roundNumber !== roundLoop.roundNumber), summary],
  };
}

/** The loop switched to rewriting the gaps the last review found. */
export function startFixRound(loop: ReviewLoopSession): ReviewLoopSession {
  return { ...loop, stage: 'fix' };
}

/** The fix round's rewrites, each still to be accepted or declined. */
export function recordFixSuggestions(loop: ReviewLoopSession, suggestions: FieldSuggestion[]): ReviewLoopSession {
  return { ...loop, suggestions, decisions: {} };
}

/** The next round, waiting for a fresh review of the change as it now reads. */
export function startNextReview(loop: ReviewLoopSession): ReviewLoopSession {
  return { ...loop, roundNumber: loop.roundNumber + 1, stage: 'review', latestReview: null, suggestions: [], decisions: {} };
}

/** The loop with one Accept or Decline remembered. */
export function recordSuggestionDecision(loop: ReviewLoopSession, fieldKey: ChgTextFieldKey, decision: SuggestionDecision): ReviewLoopSession {
  return { ...loop, decisions: { ...loop.decisions, [fieldKey]: decision } };
}

/** The findings the fix round hands back: text gaps, failed questions and facts to ask for — never record fields. */
export function readFixRoundFindings(openFindings: readonly RiskCheckFinding[]): RiskCheckFinding[] {
  return openFindings.filter((finding) => FIX_ROUND_STATUSES.has(finding.status));
}

/** The step a record field is set on, from the words in its name. */
function resolveRecordStepId(fieldName: string): ChangeWizardStepId {
  const lowerName = fieldName.toLowerCase();
  return STEP_KEYWORDS.find(({ keywords }) => keywords.some((keyword) => lowerName.includes(keyword)))?.stepId ?? DEFAULT_FIX_STEP_ID;
}

/**
 * The wizard step that fixes a finding a rewrite cannot close (a record field, or a gap that lives in no text
 * field), or null when the fix round handles it.
 */
export function resolveFindingStepId(finding: RiskCheckFinding): ChangeWizardStepId | null {
  if (finding.status === 'RECORD') return resolveRecordStepId(finding.field);
  if (finding.status === 'INFO') return null;
  return resolveGapTextFields([finding]).length > 0 ? null : resolveRecordStepId(finding.field);
}
