// issueFlow.ts — Where ONE delivered issue's time went, and who was holding it at the time.
//
// The Personal Workflow report answers "how much of this person's time went where". It cannot answer
// "where did THIS issue's time go", because it collapses assignee identity to a boolean before the
// timeline is built — after that, the other holders are simply gone.
//
// This module keeps both identities and intersects the two timelines. A stage ends when the status
// changes OR when the issue changes hands, so an issue that sat in one status while passing between
// three people produces three stages — the detail the other report structurally cannot represent.
//
// ── The one design rule ──────────────────────────────────────────────────────
// Every total is SUMMED from the stages. None is computed alongside them. A stage list that
// contradicts its own totals is therefore unrepresentable rather than merely untested: the only way
// the reconciliation could fail is if a total were given a second code path, so it never gets one.

import {
  MILLISECONDS_PER_DAY,
  buildStateSegments,
  businessMillisBetween,
  parseIsoOrNull,
  resolveTimelineOriginMs,
} from './issueTimeline.ts';
import type { IssueHolder } from './issueFlowHistory.ts';
import type { StatusFlowClass } from './issueFlowStatusClass.ts';

/** Jira's status category key for finished work. */
const STATUS_CATEGORY_DONE = 'done';

/** One contiguous period during which both the status AND the holder stayed the same. */
export interface FlowStage {
  fromIso: string;
  toIso: string;
  statusId: string | null;
  statusName: string;
  holder: IssueHolder;
  flowClass: StatusFlowClass;
  workingDays: number;
}

/** One issue's complete flow: its stages, and the totals derived from them. */
export interface IssueFlow {
  issueKey: string;
  issueSummary: string;
  storyPoints: number | null;
  /** When the issue last reached a done status — the horizon for every figure below. */
  completedIso: string;
  stages: FlowStage[];
  /** Σ over all stages: creation to completion. */
  leadTimeWorkingDays: number;
  /** Σ over stages from the first started stage: how long the work itself took once begun. */
  cycleTimeWorkingDays: number;
  /** Lead minus cycle: how long it sat before anyone started. */
  preWorkWaitWorkingDays: number;
}

/** Everything needed to reconstruct one issue's flow. The clock is injected; nothing is fetched. */
export interface IssueFlowInput {
  issueKey: string;
  issueSummary: string;
  storyPoints: number | null;
  createdIso: string | null;
  initialStatusId: string | null;
  initialHolder: IssueHolder;
  statusTransitions: ReadonlyArray<{ toStatusId: string; atIso: string }>;
  /** Assignee changes WITH identity retained — the whole point of this module. */
  holderTransitions: ReadonlyArray<{ holder: IssueHolder; atIso: string }>;
  statusCategoryByStatusId: Readonly<Record<string, string>>;
  statusNamesById: Readonly<Record<string, string>>;
  statusClassifier: (statusId: string, statusName: string) => StatusFlowClass;
  todayIso: string;
}

/**
 * Builds one issue's flow, or returns null when the issue never reached a done status.
 *
 * Out-of-scope rather than zero: an unfinished issue has no lead time yet, and reporting one as 0
 * would read as instant delivery.
 */
export function buildIssueFlow(input: IssueFlowInput): IssueFlow | null {
  const completedMs = findLastCompletionMs(input);
  if (completedMs === null) return null;

  const originMs = resolveTimelineOriginMs(
    input.createdIso,
    [
      ...input.statusTransitions.map((transition) => transition.atIso),
      ...input.holderTransitions.map((transition) => transition.atIso),
    ],
    completedMs,
  );

  // Completion — not today — is the horizon, so time after the issue finished is excluded from both
  // clocks by construction rather than by filtering it out afterwards.
  const stages = buildStages(input, originMs, completedMs);

  const leadTimeWorkingDays = sumWorkingDays(stages);
  const firstStartedIndex = stages.findIndex((stage) => stage.flowClass !== 'not-started');
  const cycleTimeWorkingDays = firstStartedIndex === -1
    ? 0
    : sumWorkingDays(stages.slice(firstStartedIndex));

  return {
    issueKey: input.issueKey,
    issueSummary: input.issueSummary,
    storyPoints: input.storyPoints,
    completedIso: new Date(completedMs).toISOString(),
    stages,
    leadTimeWorkingDays,
    cycleTimeWorkingDays,
    preWorkWaitWorkingDays: leadTimeWorkingDays - cycleTimeWorkingDays,
  };
}

/**
 * Finds when the issue LAST reached a done status.
 *
 * The last entry, not the first, because an issue that was reopened and finished again really did
 * take until the second completion; dating it by the first would hide the rework.
 */
function findLastCompletionMs(input: IssueFlowInput): number | null {
  const completionTimes = input.statusTransitions
    .filter((transition) => input.statusCategoryByStatusId[transition.toStatusId] === STATUS_CATEGORY_DONE)
    .map((transition) => parseIsoOrNull(transition.atIso))
    .filter((atMs): atMs is number => atMs !== null);

  return completionTimes.length > 0 ? Math.max(...completionTimes) : null;
}

/**
 * Intersects the status timeline with the holder timeline.
 *
 * Both are reconstructed by the SHARED `buildStateSegments`, which is what makes this analysis and
 * the Personal Workflow report agree about the same issue rather than merely aim to.
 */
function buildStages(input: IssueFlowInput, originMs: number, horizonMs: number): FlowStage[] {
  const statusSegments = buildStateSegments<string | null>(
    originMs,
    input.initialStatusId,
    input.statusTransitions
      .map((transition) => ({ atMs: parseIsoOrNull(transition.atIso), value: transition.toStatusId }))
      .filter((point): point is { atMs: number; value: string } => point.atMs !== null),
    horizonMs,
  );

  const holderSegments = buildStateSegments<IssueHolder>(
    originMs,
    input.initialHolder,
    input.holderTransitions
      .map((transition) => ({ atMs: parseIsoOrNull(transition.atIso), value: transition.holder }))
      .filter((point): point is { atMs: number; value: IssueHolder } => point.atMs !== null),
    horizonMs,
  );

  const stages: FlowStage[] = [];
  for (const statusSegment of statusSegments) {
    for (const holderSegment of holderSegments) {
      const fromMs = Math.max(statusSegment.startMs, holderSegment.startMs);
      const toMs = Math.min(statusSegment.endMs, holderSegment.endMs);
      if (toMs <= fromMs) continue; // the two segments do not overlap
      stages.push(toStage(input, statusSegment.value, holderSegment.value, fromMs, toMs));
    }
  }
  return stages.sort((first, second) => Date.parse(first.fromIso) - Date.parse(second.fromIso));
}

/** Converts one overlap of a status and a holder into a reportable stage. */
function toStage(
  input: IssueFlowInput,
  statusId: string | null,
  holder: IssueHolder,
  fromMs: number,
  toMs: number,
): FlowStage {
  const statusName = statusId === null ? 'Unknown' : input.statusNamesById[statusId] ?? statusId;
  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    statusId,
    statusName,
    holder,
    flowClass: statusId === null ? 'unclassified' : input.statusClassifier(statusId, statusName),
    workingDays: businessMillisBetween(fromMs, toMs) / MILLISECONDS_PER_DAY,
  };
}

/** Adds up a run of stages. Every total in this module goes through here — there is no second path. */
function sumWorkingDays(stages: readonly FlowStage[]): number {
  return stages.reduce((total, stage) => total + stage.workingDays, 0);
}
