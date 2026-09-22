// intakeReviewRows.ts — Works out what the Epic Intake review table shows for each item: which bucket it falls in
// (Create, Existing, Needs a look, Not created), whether it needs the PO's eye, the row order, and the DENP Epic
// choices. Pure, so the table and the summary read the same outcome for every item (spec 037, GH #387 feedback).

import {
  readSettledValue,
  type DuplicateVerdict,
  type EpicIntake,
  type IntakeItem,
  type SummaryAction,
  type SummaryRow,
} from '../epicIntakeModel.ts';
import { isEnrollmentOwned, isItemCreatableAfterReview, listOpenDecisions, type OpenDecisionSlot } from '../intakeChecklist.ts';
import { buildSummaryRows } from '../intakeSummary.ts';

// ── Constants ──

/** Besides the top pick, how many other open Epics the DENP Epic choice lists — enough to choose, few enough to read. */
export const MAX_ALTERNATIVE_CANDIDATES = 4;

/** The DENP Epic choice that means "none of these covers it — create a new Epic". */
export const CREATE_NEW_EPIC_VALUE = 'createNew';

/** The DENP Epic choice that means "this should not be acted on". */
export const SKIP_NOT_ACTIONABLE_VALUE = 'notActionable';

/** The four buckets every work row falls in, in the order the count line reads them. */
export const REVIEW_BUCKETS = ['create', 'existing', 'needsLook', 'notCreated'] as const;
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];

/** The words for each bucket on the count line. */
export const REVIEW_BUCKET_LABELS: Record<ReviewBucket, string> = {
  create: 'Create',
  existing: 'Existing',
  needsLook: 'Needs a look',
  notCreated: 'Not created',
};

/** Rows that need nothing from the PO are listed in this order, after every row that does. */
const BUCKET_SORT_ORDER: readonly ReviewBucket[] = ['needsLook', 'create', 'existing', 'notCreated'];

/** A summary outcome that is already final decides the bucket on its own. */
const FINAL_ACTION_BUCKETS: Partial<Record<SummaryAction, ReviewBucket>> = {
  existing: 'existing',
  created: 'create',
  skippedFulfillment: 'notCreated',
  notActionable: 'notCreated',
  declined: 'notCreated',
  failed: 'needsLook',
};

/** Open slots that are real choices for the PO. The draft is confirmed by Create itself, so it is not one. */
const PO_CHOICE_SLOTS = new Set<OpenDecisionSlot>(['kind', 'owner', 'duplicate', 'label']);

// ── Rows ──

/** One row of the review table: the item, its summary outcome, its bucket, and why it deserves a look. */
export interface ReviewRow {
  item: IntakeItem;
  summaryRow: SummaryRow;
  bucket: ReviewBucket;
  /** True when a choice on this row is waiting for the PO — nobody else will make it. */
  isAwaitingPoChoice: boolean;
  /** True when the row is listed first: a PO choice, a review flag, a failed search or a failed create. */
  needsAttention: boolean;
}

/** The items whose choices are waiting for the PO right now, read from the engine once for the whole table. */
function readItemIdsAwaitingPo(intake: EpicIntake, isAiUnlocked: boolean): Set<string> {
  const awaiting = listOpenDecisions(intake, isAiUnlocked)
    .filter((openDecision) => openDecision.turn === 'po' && PO_CHOICE_SLOTS.has(openDecision.slot));
  return new Set(awaiting.map((openDecision) => openDecision.itemId).filter((itemId): itemId is string => itemId !== null));
}

/** The bucket for one item: a final summary outcome decides it; otherwise it is Create only if Create would make it. */
function readBucket(item: IntakeItem, summaryRow: SummaryRow, isAiUnlocked: boolean): ReviewBucket {
  const finalBucket = FINAL_ACTION_BUCKETS[summaryRow.action];
  if (finalBucket !== undefined) {
    return finalBucket;
  }
  return isItemCreatableAfterReview(item, isAiUnlocked) ? 'create' : 'needsLook';
}

function buildReviewRow(item: IntakeItem, summaryRow: SummaryRow, isAiUnlocked: boolean, awaitingIds: Set<string>): ReviewRow {
  const isAwaitingPoChoice = awaitingIds.has(item.id);
  const needsAttention = isAwaitingPoChoice || item.reviewFlag !== null || item.searchStatus === 'failed' || item.creation.state === 'failed';
  return { item, summaryRow, bucket: readBucket(item, summaryRow, isAiUnlocked), isAwaitingPoChoice, needsAttention };
}

function readSortRank(row: ReviewRow): number {
  return row.needsAttention ? 0 : 1 + BUCKET_SORT_ORDER.indexOf(row.bucket);
}

/** Rows needing the PO's eye first, then Needs a look, Create, Existing and Not created — source order within each. */
export function sortReviewRows(rows: readonly ReviewRow[]): ReviewRow[] {
  return [...rows].sort((left, right) => readSortRank(left) - readSortRank(right));
}

/**
 * Builds the review table's rows from the same summary rows the Summary table shows, so the two never disagree.
 * Work rows are sorted for review; the "Also in the notes" rows keep their source order.
 */
export function buildReviewRows(
  intake: EpicIntake,
  isAiUnlocked: boolean,
  jiraBaseUrl: string,
): { workRows: ReviewRow[]; otherRows: ReviewRow[] } {
  const { workRows, otherRows } = buildSummaryRows(intake, jiraBaseUrl);
  const awaitingIds = readItemIdsAwaitingPo(intake, isAiUnlocked);
  const itemsById = new Map(intake.items.map((item) => [item.id, item]));
  const toReviewRow = (summaryRow: SummaryRow): ReviewRow =>
    buildReviewRow(itemsById.get(summaryRow.itemId) as IntakeItem, summaryRow, isAiUnlocked, awaitingIds);
  return { workRows: sortReviewRows(workRows.map(toReviewRow)), otherRows: otherRows.map(toReviewRow) };
}

/** How many rows fall in each bucket. */
export function countReviewBuckets(rows: readonly ReviewRow[]): Record<ReviewBucket, number> {
  const counts: Record<ReviewBucket, number> = { create: 0, existing: 0, needsLook: 0, notCreated: 0 };
  for (const row of rows) {
    counts[row.bucket] += 1;
  }
  return counts;
}

/** The count line, e.g. "Create 3 · Existing 2 · Needs a look 1 · Not created 4". */
export function formatReviewCounts(counts: Record<ReviewBucket, number>): string {
  return REVIEW_BUCKETS.map((bucket) => `${REVIEW_BUCKET_LABELS[bucket]} ${counts[bucket]}`).join(' · ');
}

// ── Which cells apply ──

/** True for work Enrollment has a part in — the rows that are checked against DENP. */
export function isEnrollmentWork(item: IntakeItem): boolean {
  return readSettledValue(item.decisions.kind) === 'work' && isEnrollmentOwned(readSettledValue(item.decisions.owner));
}

/** True for Enrollment work that needs a new Epic and has not been created yet — the rows with a label and a draft. */
export function isNewEpicRow(item: IntakeItem): boolean {
  return isEnrollmentWork(item)
    && readSettledValue(item.decisions.duplicate)?.verdict === 'createNew'
    && item.creation.state !== 'created';
}

// ── DENP Epic choice ──

/** One option of a closed choice. */
export interface ChoiceOption {
  value: string;
  label: string;
}

/** The Epic already chosen for the item, or the one put forward for it — listed first. */
export function readTopPickKey(item: IntakeItem): string | null {
  const { duplicate } = item.decisions;
  if (duplicate.state === 'settled') {
    return duplicate.value.verdict === 'existing' ? duplicate.value.key : null;
  }
  if (duplicate.state === 'open' && duplicate.aiProposal?.verdict === 'existing') {
    return duplicate.aiProposal.key;
  }
  return null;
}

function describeCandidateKey(item: IntakeItem, key: string): string {
  const candidate = item.candidates.find((found) => found.key === key);
  return candidate === undefined ? key : `${candidate.key} — ${candidate.summary} [${candidate.statusName}]`;
}

/**
 * The DENP Epic choices for an item: the top pick, up to four other open Epics that were found, any key the notes
 * named that cannot be used as-is ("Use KEY anyway"), then "Create a new Epic" and "Skip — not actionable".
 */
export function buildEpicChoiceOptions(item: IntakeItem): ChoiceOption[] {
  const topPickKey = readTopPickKey(item);
  const alternativeKeys = item.candidates
    .map((candidate) => candidate.key)
    .filter((key) => key !== topPickKey)
    .slice(0, MAX_ALTERNATIVE_CANDIDATES);
  const listedKeys = new Set([topPickKey, ...alternativeKeys]);
  const unusableKeys = item.namedKeys
    .filter((namedKey) => namedKey.lookup.status === 'unusable' && !listedKeys.has(namedKey.key))
    .map((namedKey) => ({ value: namedKey.key, label: `Use ${namedKey.key} anyway` }));
  const keyOptions = [...(topPickKey === null ? [] : [topPickKey]), ...alternativeKeys]
    .map((key) => ({ value: key, label: describeCandidateKey(item, key) }));
  return [
    ...keyOptions,
    ...unusableKeys,
    { value: CREATE_NEW_EPIC_VALUE, label: 'Create a new Epic' },
    { value: SKIP_NOT_ACTIONABLE_VALUE, label: 'Skip — not actionable' },
  ];
}

/** The option the DENP Epic choice shows as selected, or '' while the match is still open. */
export function readEpicChoiceValue(item: IntakeItem): string {
  const verdict = readSettledValue(item.decisions.duplicate);
  if (verdict === null) {
    return '';
  }
  return verdict.verdict === 'existing' ? verdict.key : verdict.verdict;
}

/** Turns a chosen option back into the verdict it stands for. */
export function toDuplicateVerdict(value: string): DuplicateVerdict {
  if (value === CREATE_NEW_EPIC_VALUE) {
    return { verdict: 'createNew' };
  }
  return value === SKIP_NOT_ACTIONABLE_VALUE ? { verdict: 'notActionable' } : { verdict: 'existing', key: value };
}
