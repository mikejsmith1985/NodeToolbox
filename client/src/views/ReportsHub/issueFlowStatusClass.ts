// issueFlowStatusClass.ts — What a status MEANS, which Jira itself cannot tell us.
//
// Jira sorts every in-flight status into the single `indeterminate` category, so "In Progress" and
// "Ready for QA" are indistinguishable to it. Yet one is somebody working and the other is the issue
// sitting in a queue — and telling those apart is the entire point of a flow analysis.
//
// The classification changes what a duration MEANS. It must never change the duration itself: the
// timeline produces the numbers, this module only labels them. That separation is what makes a
// classification safely revisable — an override moves time between buckets and moves no figure.

/** What a status represents in the flow of work. */
export type StatusFlowClass =
  /** Not begun — the issue is waiting to be picked up at all. */
  | 'not-started'
  /** Somebody is working on it. */
  | 'active'
  /** It is queued: waiting for review, test, approval or a person. */
  | 'waiting'
  /** Finished. */
  | 'completed'
  /** In flight, but we cannot honestly say which of active or waiting it is. */
  | 'unclassified';

/** Jira's own status category keys, the only signal it gives us about a status. */
const CATEGORY_NOT_STARTED = 'new';
const CATEGORY_IN_FLIGHT = 'indeterminate';
const CATEGORY_COMPLETED = 'done';

/**
 * Name fragments that mark an in-flight status as a QUEUE rather than someone working.
 *
 * Matched case-insensitively against the status name, because the Jira category cannot distinguish
 * them. These are patterns, not certainties — which is exactly why the classification each status
 * received is reported to the reader, so a wrong guess is visible and correctable.
 */
const WAITING_NAME_PATTERNS = [
  'ready for',
  'waiting',
  'blocked',
  'on hold',
  'pending',
  'in review',
  'to be',
  'queue',
] as const;

/** A user's deliberate correction of how a status should be read, keyed by status id. */
export type StatusFlowOverrides = Readonly<Record<string, StatusFlowClass>>;

/** Everything needed to decide what one status means. */
export interface StatusFlowClassInput {
  statusId: string;
  statusName: string;
  /** The Jira status category key, or undefined when the instance did not report one. */
  statusCategoryKey: string | undefined;
  overridesByStatusId: StatusFlowOverrides;
}

/**
 * Decides whether a status represents work, a queue, the backlog, or the end.
 *
 * A user override always wins: the patterns below are a helpful default, not a claim to know a
 * team's workflow better than the team does.
 *
 * When the category is missing or unrecognised the answer is `unclassified`, and that time still
 * counts toward every total. Guessing would be worse than admitting ignorance here — a status
 * wrongly pushed into `waiting` moves real work into the queue bucket, and the report would then
 * confidently blame a delay that never happened.
 */
export function classifyStatusFlow(input: StatusFlowClassInput): StatusFlowClass {
  const override = input.overridesByStatusId[input.statusId];
  if (override !== undefined) return override;

  if (input.statusCategoryKey === CATEGORY_NOT_STARTED) return 'not-started';
  if (input.statusCategoryKey === CATEGORY_COMPLETED) return 'completed';
  if (input.statusCategoryKey !== CATEGORY_IN_FLIGHT) return 'unclassified';

  const normalizedName = input.statusName.toLowerCase();
  const isQueueShaped = WAITING_NAME_PATTERNS.some((pattern) => normalizedName.includes(pattern));
  return isQueueShaped ? 'waiting' : 'active';
}

/**
 * Builds the classifier the flow engine consumes, closing over the instance's category map and the
 * team's overrides.
 *
 * The engine takes a function rather than this module directly, so the arithmetic has no dependency
 * on the judgement: revising these rules cannot disturb a single duration.
 */
export function createStatusClassifier(
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  overridesByStatusId: StatusFlowOverrides,
): (statusId: string, statusName: string) => StatusFlowClass {
  return (statusId, statusName) => classifyStatusFlow({
    statusId,
    statusName,
    statusCategoryKey: statusCategoryByStatusId[statusId],
    overridesByStatusId,
  });
}
