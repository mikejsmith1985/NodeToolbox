// backlogGrooming.ts — Deterministic backlog-grooming buckets for the Backlog Remediation queue.
//
// The Remediation tab already fetches a team's NOT-Done backlog and offers per-item decisions plus an
// optional AI verdict. This module adds the missing lens: a RULE-BASED classification of each open item
// into a grooming bucket, so a Product Owner can see at a glance what is probably cancellable, what looks
// already-done-but-not-closed, and what is merely stale — without relying on the AI. It is pure (no I/O)
// and works from the triage signals alone, sharpening when the freshly-fetched Jira issue is also present
// (its statusCategory and resolution refine "never started" and "already done").
//
// The buckets are advisory and sit ALONGSIDE the existing verdicts/decisions — they never write anything.

import type { JiraIssue } from '../../../types/jira.ts';
import { DONE_CATEGORY_STATUS_NAMES } from '../../../utils/workflowDelivery.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';

// ── Buckets ────────────────────────────────────────────────────────────────────

/**
 * The grooming buckets, in the order they are shown (most-actionable first):
 *   • ghost-done    — looks finished but its status category is not Done (a done-named status or a set
 *                     resolution). "Already done, just not closed out" — close it in Jira.
 *   • likely-cancel — long-idle dead weight with no sign of value (unowned / undefined / low-priority /
 *                     parent feature already Done). A prime cancellation candidate.
 *   • never-started — an old To-Do item that never moved: still worth doing, or drop it.
 *   • just-stale    — idle past the stale threshold but with a sign of value (owner / high priority /
 *                     active parent). Needs a human look, not an automatic cancel.
 *   • active        — recently touched; leave it alone.
 */
export type GroomingBucket = 'ghost-done' | 'likely-cancel' | 'never-started' | 'just-stale' | 'active';

/** Display order for the bucket sections. */
export const GROOMING_BUCKET_ORDER: readonly GroomingBucket[] = [
  'ghost-done', 'likely-cancel', 'never-started', 'just-stale', 'active',
];

/** The human-facing label and one-line explanation for each bucket. */
export interface GroomingBucketMeta {
  label: string;
  blurb: string;
}

export const GROOMING_BUCKET_META: Record<GroomingBucket, GroomingBucketMeta> = {
  'ghost-done': { label: 'Already done, not closed', blurb: 'Looks finished (done-named status or a resolution set) but never moved to a Done status — close it out.' },
  'likely-cancel': { label: 'Likely cancel', blurb: 'Long-idle with no sign of value — unowned, undefined, low priority, or its parent feature is already Done.' },
  'never-started': { label: 'Never started', blurb: 'An old To-Do item that never moved — decide whether it is still worth doing or should be dropped.' },
  'just-stale': { label: 'Just stale', blurb: 'Idle for a while but has a sign of value (an owner, high priority, or an active parent) — worth a look.' },
  'active': { label: 'Active', blurb: 'Recently touched — no grooming needed right now.' },
};

// ── Thresholds (named, no magic numbers) ─────────────────────────────────────────

/** Fallback stale threshold (calendar days of inactivity) when the caller passes none. Mirrors the app default. */
const DEFAULT_STALE_THRESHOLD_DAYS = 5;
/** Inactivity (days) that marks an item as "long idle" — heavy weight toward cancellation. */
const LONG_IDLE_DAYS = 60;
/** Age (days since creation) beyond which an unmoved To-Do item counts as "never started". */
const NEVER_STARTED_AGE_DAYS = 90;

/** Jira priority names treated as low importance (a cancel-leaning signal). */
const LOW_PRIORITY_NAMES = ['low', 'lowest', 'trivial', 'minor', 'none'];
/** Jira priority names treated as high importance (a keep-leaning signal). */
const HIGH_PRIORITY_NAMES = ['high', 'highest', 'critical', 'blocker'];
/** The statusCategory key Jira uses for un-started ("To Do") work. */
const STATUS_CATEGORY_TODO = 'new';

// ── Signal readers (pure) ────────────────────────────────────────────────────────

/** True when a status NAME is one Jira workflows use for done work (reused from the delivery vocabulary). */
function isDoneNamedStatus(statusName: string): boolean {
  return DONE_CATEGORY_STATUS_NAMES.includes(statusName.trim().toLowerCase());
}

/** The most telling inactivity measure: prefer "days since any update", fall back to time-in-status, then age. */
function idleDays(signals: AgingTriageIssue): number {
  return signals.daysSinceUpdate ?? signals.daysInStatus ?? signals.ageDays;
}

/** True when the item's own priority is low/absent. */
function isLowPriority(signals: AgingTriageIssue): boolean {
  return signals.priority === null || LOW_PRIORITY_NAMES.includes(signals.priority.trim().toLowerCase());
}

/** True when the item carries a clearly-high priority — a reason to keep rather than cancel. */
function isHighPriority(signals: AgingTriageIssue): boolean {
  return signals.priority !== null && HIGH_PRIORITY_NAMES.includes(signals.priority.trim().toLowerCase());
}

/** True when the item has neither a description nor acceptance criteria — abandoned scaffolding. */
function isUndefined(signals: AgingTriageIssue): boolean {
  return !signals.hasDescription && !signals.hasAcceptanceCriteria;
}

/** True when the item's parent feature is already in a done-named status — a strong cancel signal. */
function isParentDone(signals: AgingTriageIssue): boolean {
  return signals.featureStatus !== null && isDoneNamedStatus(signals.featureStatus);
}

/** Reads a set resolution off the freshly-fetched issue (a resolution while not Done ⇒ ghost-done). */
function hasResolution(rawIssue: JiraIssue | undefined): boolean {
  if (rawIssue === undefined) {
    return false;
  }
  const resolution = (rawIssue.fields as Record<string, unknown>).resolution as { name?: string } | null | undefined;
  const resolutionName = resolution?.name?.trim().toLowerCase() ?? '';
  return resolutionName !== '' && resolutionName !== 'unresolved';
}

/** True when the freshly-fetched issue is in the To-Do status category (unknown ⇒ false — cannot claim it). */
function isTodoCategory(rawIssue: JiraIssue | undefined): boolean {
  return rawIssue?.fields?.status?.statusCategory?.key === STATUS_CATEGORY_TODO;
}

// ── Classification ───────────────────────────────────────────────────────────────

/**
 * Classifies one open backlog item into a grooming bucket, first-match-wins in the documented order. Uses
 * the triage signals throughout; the freshly-fetched `rawIssue` (when present) refines two buckets — a set
 * resolution strengthens "already done", and the To-Do status category enables "never started". Absent a raw
 * issue the classifier still returns a sound bucket from the signals alone, so a resumed queue is never blank.
 *
 * @param signals - The item's enriched aging/triage signals.
 * @param rawIssue - The freshly-fetched Jira issue for this item, when hydrated; refines the result.
 * @param staleDaysThreshold - Inactivity (days) that counts as stale; defaults to the app-wide 5.
 */
export function classifyGroomingBucket(
  signals: AgingTriageIssue,
  rawIssue?: JiraIssue,
  staleDaysThreshold: number = DEFAULT_STALE_THRESHOLD_DAYS,
): GroomingBucket {
  const inactivity = idleDays(signals);
  const isStale = inactivity >= staleDaysThreshold;
  const isLongIdle = inactivity >= LONG_IDLE_DAYS;
  const parentDone = isParentDone(signals);

  // 1) Already done but not closed — the item itself looks finished.
  if (isDoneNamedStatus(signals.status) || hasResolution(rawIssue)) {
    return 'ghost-done';
  }

  // 2) Likely cancel — a Done parent (with any inactivity), or long-idle work carrying a cancel-leaning signal.
  const hasCancelSignal = signals.assignee === null || isUndefined(signals) || isLowPriority(signals);
  if ((parentDone && isStale) || (isLongIdle && hasCancelSignal)) {
    return 'likely-cancel';
  }

  // 3) Never started — an old, still-idle To-Do item that carries some value (else it matched cancel above).
  if (isTodoCategory(rawIssue) && signals.ageDays >= NEVER_STARTED_AGE_DAYS && isStale) {
    return 'never-started';
  }

  // 4) Just stale — idle past the threshold but with a sign of value; a human should look before cancelling.
  if (isStale && (signals.assignee !== null || isHighPriority(signals) || (signals.featureStatus !== null && !parentDone))) {
    return 'just-stale';
  }

  // 5) Anything still idle with no value sign is stale; otherwise it was recently touched.
  return isStale ? 'just-stale' : 'active';
}

// ── Grouping ─────────────────────────────────────────────────────────────────────

/** One bucket's rendered group: the bucket id, its label/blurb, and the entries that fell into it. */
export interface GroomingGroup<Entry> {
  bucket: GroomingBucket;
  meta: GroomingBucketMeta;
  entries: Entry[];
}

/**
 * Groups arbitrary entries into grooming buckets using the supplied classifier, returned in the fixed display
 * order with empty buckets omitted. Generic over the entry type so the panel can group its queue items while
 * the classification stays a pure, separately-tested function.
 */
export function groupByGroomingBucket<Entry>(
  entries: readonly Entry[],
  classify: (entry: Entry) => GroomingBucket,
): GroomingGroup<Entry>[] {
  const entriesByBucket = new Map<GroomingBucket, Entry[]>();
  for (const entry of entries) {
    const bucket = classify(entry);
    const existing = entriesByBucket.get(bucket);
    if (existing === undefined) {
      entriesByBucket.set(bucket, [entry]);
    } else {
      existing.push(entry);
    }
  }
  return GROOMING_BUCKET_ORDER
    .filter((bucket) => entriesByBucket.has(bucket))
    .map((bucket) => ({ bucket, meta: GROOMING_BUCKET_META[bucket], entries: entriesByBucket.get(bucket) as Entry[] }));
}
