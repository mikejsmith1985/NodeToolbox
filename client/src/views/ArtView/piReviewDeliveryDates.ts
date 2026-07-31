// piReviewDeliveryDates.ts — Pure derivation of the PI Review delivery-milestone columns (GH #262):
// Dev Start, Dev Test, INT/PVS, and Prod Deploy. This module holds NO I/O so it can be bundled into
// the server-side scheduler engine (piReviewEngine.cjs) and consumed by the browser tab identically —
// both homes fetch raw Jira data their own way and hand it here, so the two can never disagree on
// what a milestone date IS.

import { featureLinkCandidateFieldIds, extractFeatureKeyFromIssueFields } from '../../utils/featureLink.ts';
import type { FeatureLinkFields } from '../../utils/featureLink.ts';

/** The status whose first entry marks development starting on a Feature, unless the team overrides it. */
export const DEFAULT_DEV_START_STATUS_NAME = 'Implementing';

/** Printed in Dev Test when every [SL] sub-task was cancelled — shift-left testing was waived, not missed. */
export const DEV_TEST_EXEMPT_VALUE = 'EXEMPT';

/** Summary prefix of the shift-left test sub-task the delivery framework creates under each story. */
const SL_SUBTASK_SUMMARY_PATTERN = /^\[SL\]/i;
/** Summary prefix of the INT deploy sub-task under each story. */
const INT_SUBTASK_SUMMARY_PATTERN = /^\[INT\]/i;
/** Matches "Cancelled"/"Canceled" status names — cancelled work is done-category in Jira but is not a delivery. */
const CANCELLED_STATUS_PATTERN = /cancell?ed/i;
/** Length of the YYYY-MM-DD prefix of a Jira ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** The four milestone values for one Feature row; dates are YYYY-MM-DD, Dev Test may also be EXEMPT. */
export interface PiReviewDeliveryDates {
  devStart: string | null;
  devTest: string | null;
  intPvs: string | null;
  prodDeploy: string | null;
}

/** One changelog entry as Jira returns it — deliberately loose, Jira omits fields freely. */
interface RawChangelogHistory {
  created?: string;
  items?: Array<Record<string, unknown>>;
}

/** The raw Jira issue shape this module reads (features, stories, and sub-tasks all fit it). */
export interface RawDeliveryIssue {
  key?: string;
  fields?: ({
    summary?: string;
    created?: string;
    status?: { name?: string } | null;
    resolutiondate?: string | null;
    parent?: { key?: string } | null;
    fixVersions?: Array<{ name?: string; releaseDate?: string }>;
    subtasks?: Array<{ key?: string; fields?: { summary?: string } }>;
  } & Record<string, unknown>) | null;
  changelog?: { histories?: RawChangelogHistory[] } | null;
}

/** A status catalog entry from GET /rest/api/2/status — only the name and category key are read. */
export interface RawStatusCatalogEntry {
  name?: string;
  statusCategory?: { key?: string };
}

/** Lowercased status name → Jira category key ('new' | 'indeterminate' | 'done'). */
export type StatusCategoryByName = Record<string, string>;

/** Builds the status-name → category lookup from the Jira status catalog, skipping malformed entries. */
export function buildStatusCategoryMap(rawStatuses: RawStatusCatalogEntry[]): StatusCategoryByName {
  const statusCategoryByName: StatusCategoryByName = {};
  // Guard against a non-array payload (proxy error bodies, unexpected shapes) instead of throwing.
  for (const rawStatus of Array.isArray(rawStatuses) ? rawStatuses : []) {
    const statusName = rawStatus?.name?.trim().toLowerCase() ?? '';
    const categoryKey = rawStatus?.statusCategory?.key?.trim() ?? '';
    if (statusName !== '' && categoryKey !== '') {
      statusCategoryByName[statusName] = categoryKey;
    }
  }
  return statusCategoryByName;
}

/** Converts a custom field id ("customfield_10108") into its JQL reference ("cf[10108]"); null when not custom. */
function toJqlCustomFieldReference(fieldId: string): string | null {
  const matchedFieldNumber = fieldId.match(/^customfield_(\d+)$/);
  return matchedFieldNumber ? `cf[${matchedFieldNumber[1]}]` : null;
}

/**
 * Builds the JQL that finds the child stories of the given Features via every feature-link candidate
 * field (configured field, default Feature Link, Epic Link fallback) — OR-joined, because different
 * issues in the same instance may carry the link in different fields. Empty when there are no keys.
 */
export function buildPiReviewChildStoryJql(featureKeys: string[], featureLinkFieldId: string): string {
  if (featureKeys.length === 0) {
    return '';
  }
  const keyList = featureKeys.join(',');
  const clauses = featureLinkCandidateFieldIds(featureLinkFieldId)
    .map(toJqlCustomFieldReference)
    .filter((jqlReference): jqlReference is string => jqlReference !== null)
    .map((jqlReference) => `${jqlReference} in (${keyList})`);
  return clauses.join(' OR ');
}

/** Collects the keys of the [SL] and [INT] sub-task stubs found on the fetched child stories. */
export function collectDeliverySubtaskKeys(storyIssues: RawDeliveryIssue[]): string[] {
  const subtaskKeys: string[] = [];
  for (const storyIssue of storyIssues) {
    for (const subtaskStub of storyIssue.fields?.subtasks ?? []) {
      const subtaskSummary = subtaskStub.fields?.summary ?? '';
      const isDeliverySubtask = SL_SUBTASK_SUMMARY_PATTERN.test(subtaskSummary)
        || INT_SUBTASK_SUMMARY_PATTERN.test(subtaskSummary);
      if (isDeliverySubtask && subtaskStub.key) {
        subtaskKeys.push(subtaskStub.key);
      }
    }
  }
  return subtaskKeys;
}

/** Trims a Jira ISO timestamp down to its YYYY-MM-DD date; null when the value is missing or malformed. */
function toIsoDate(rawTimestamp: string | null | undefined): string | null {
  const trimmedTimestamp = (rawTimestamp ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmedTimestamp) ? trimmedTimestamp.slice(0, ISO_DATE_LENGTH) : null;
}

/** True when a status name means the work was cancelled rather than delivered. */
function isCancelledStatusName(statusName: string): boolean {
  return CANCELLED_STATUS_PATTERN.test(statusName);
}

/**
 * Walks an issue's changelog and returns the earliest instant a status transition satisfied the
 * predicate (called with the destination status name). Histories are compared by their created
 * timestamp, so out-of-order changelog pages still yield the true earliest entry.
 */
function readEarliestStatusTransition(
  issue: RawDeliveryIssue,
  isMatchingDestination: (toStatusName: string) => boolean,
): string | null {
  let earliestTimestamp: string | null = null;
  for (const history of issue.changelog?.histories ?? []) {
    const historyTimestamp = (history.created ?? '').trim();
    if (historyTimestamp === '') {
      continue;
    }
    const hasMatchingStatusItem = (history.items ?? []).some((item) => {
      // Jira really names the destination-status field "toString" — the local unknown sidesteps the
      // clash with Object.prototype.toString's method type.
      const destinationStatusName: unknown = item.toString;
      return item.field === 'status'
        && typeof destinationStatusName === 'string'
        && isMatchingDestination(destinationStatusName);
    });
    if (hasMatchingStatusItem && (earliestTimestamp === null || historyTimestamp < earliestTimestamp)) {
      earliestTimestamp = historyTimestamp;
    }
  }
  return toIsoDate(earliestTimestamp);
}

/**
 * Dev Start: the first time the Feature entered the dev-start status ("Implementing" by default).
 * A Feature created directly in that status has no transition to find, so when it currently sits
 * there with a silent changelog the created date is the honest start.
 */
function deriveDevStartDate(featureIssue: RawDeliveryIssue, devStartStatusName: string): string | null {
  const normalizedDevStartName = devStartStatusName.trim().toLowerCase();
  const transitionDate = readEarliestStatusTransition(
    featureIssue,
    (toStatusName) => toStatusName.trim().toLowerCase() === normalizedDevStartName,
  );
  if (transitionDate !== null) {
    return transitionDate;
  }
  const currentStatusName = featureIssue.fields?.status?.name?.trim().toLowerCase() ?? '';
  return currentStatusName === normalizedDevStartName ? toIsoDate(featureIssue.fields?.created) : null;
}

/**
 * Dev Test: the earliest [SL] sub-task entering an In Progress-category status. A real start always
 * wins; EXEMPT applies only when [SL] sub-tasks exist, none ever started, and every one now sits in a
 * cancelled status (shift-left was waived for the whole Feature). Anything else is honestly blank.
 */
function deriveDevTestValue(
  slSubtasks: RawDeliveryIssue[],
  statusCategoryByName: StatusCategoryByName,
): string | null {
  let earliestStartDate: string | null = null;
  for (const slSubtask of slSubtasks) {
    const startDate = readEarliestStatusTransition(
      slSubtask,
      (toStatusName) => statusCategoryByName[toStatusName.trim().toLowerCase()] === 'indeterminate',
    );
    if (startDate !== null && (earliestStartDate === null || startDate < earliestStartDate)) {
      earliestStartDate = startDate;
    }
  }
  if (earliestStartDate !== null) {
    return earliestStartDate;
  }

  const isEveryCancelled = slSubtasks.length > 0
    && slSubtasks.every((slSubtask) => isCancelledStatusName(slSubtask.fields?.status?.name ?? ''));
  return isEveryCancelled ? DEV_TEST_EXEMPT_VALUE : null;
}

/**
 * INT/PVS: the earliest [INT] deploy sub-task entering a Done-category status. Cancelled destinations
 * are excluded even though Jira files them under the done category — a cancelled deploy never happened.
 * When the changelog is silent but the sub-task sits done (and not cancelled), the resolution date is
 * the fallback evidence.
 */
function deriveIntPvsDate(
  intSubtasks: RawDeliveryIssue[],
  statusCategoryByName: StatusCategoryByName,
): string | null {
  let earliestDeployDate: string | null = null;
  for (const intSubtask of intSubtasks) {
    const transitionDate = readEarliestStatusTransition(
      intSubtask,
      (toStatusName) => statusCategoryByName[toStatusName.trim().toLowerCase()] === 'done'
        && !isCancelledStatusName(toStatusName),
    );
    const currentStatusName = intSubtask.fields?.status?.name ?? '';
    const isCurrentlyDone = statusCategoryByName[currentStatusName.trim().toLowerCase()] === 'done'
      && !isCancelledStatusName(currentStatusName);
    const deployDate = transitionDate ?? (isCurrentlyDone ? toIsoDate(intSubtask.fields?.resolutiondate) : null);
    if (deployDate !== null && (earliestDeployDate === null || deployDate < earliestDeployDate)) {
      earliestDeployDate = deployDate;
    }
  }
  return earliestDeployDate;
}

/** Prod Deploy: the earliest dated fixVersion on the Feature — the planned/actual production release day. */
function deriveProdDeployDate(featureIssue: RawDeliveryIssue): string | null {
  let earliestReleaseDate: string | null = null;
  for (const fixVersion of featureIssue.fields?.fixVersions ?? []) {
    const releaseDate = toIsoDate(fixVersion.releaseDate);
    if (releaseDate !== null && (earliestReleaseDate === null || releaseDate < earliestReleaseDate)) {
      earliestReleaseDate = releaseDate;
    }
  }
  return earliestReleaseDate;
}

/** Derives the four delivery milestones for one Feature from its own issue and its [SL]/[INT] sub-tasks. */
export function derivePiReviewDeliveryDates(input: {
  featureIssue: RawDeliveryIssue;
  subtaskIssues: RawDeliveryIssue[];
  statusCategoryByName: StatusCategoryByName;
  devStartStatusName: string;
}): PiReviewDeliveryDates {
  const slSubtasks = input.subtaskIssues.filter((subtask) => SL_SUBTASK_SUMMARY_PATTERN.test(subtask.fields?.summary ?? ''));
  const intSubtasks = input.subtaskIssues.filter((subtask) => INT_SUBTASK_SUMMARY_PATTERN.test(subtask.fields?.summary ?? ''));
  return {
    devStart: deriveDevStartDate(input.featureIssue, input.devStartStatusName),
    devTest: deriveDevTestValue(slSubtasks, input.statusCategoryByName),
    intPvs: deriveIntPvsDate(intSubtasks, input.statusCategoryByName),
    prodDeploy: deriveProdDeployDate(input.featureIssue),
  };
}

/**
 * Derives delivery milestones for every fetched Feature by chaining sub-task → parent story → Feature
 * through the feature-link field. Every Feature in the map gets an entry — a Feature with no children
 * yields all-null milestones, so a reconcile can clear cells that no longer have evidence behind them.
 */
export function derivePiReviewDeliveryDatesByFeature(input: {
  featureIssuesByKey: Record<string, RawDeliveryIssue>;
  storyIssues: RawDeliveryIssue[];
  subtaskIssues: RawDeliveryIssue[];
  featureLinkFieldId: string;
  statusCategoryByName: StatusCategoryByName;
  devStartStatusName: string;
}): Record<string, PiReviewDeliveryDates> {
  const featureKeyByStoryKey: Record<string, string> = {};
  for (const storyIssue of input.storyIssues) {
    const linkedFeatureKey = extractFeatureKeyFromIssueFields(
      (storyIssue.fields ?? {}) as FeatureLinkFields,
      input.featureLinkFieldId,
    );
    if (storyIssue.key && linkedFeatureKey) {
      featureKeyByStoryKey[storyIssue.key] = linkedFeatureKey.toUpperCase();
    }
  }

  const subtasksByFeatureKey: Record<string, RawDeliveryIssue[]> = {};
  for (const subtaskIssue of input.subtaskIssues) {
    const parentStoryKey = subtaskIssue.fields?.parent?.key ?? '';
    const featureKey = featureKeyByStoryKey[parentStoryKey];
    if (featureKey) {
      (subtasksByFeatureKey[featureKey] ??= []).push(subtaskIssue);
    }
  }

  const deliveryDatesByFeatureKey: Record<string, PiReviewDeliveryDates> = {};
  for (const [featureKey, featureIssue] of Object.entries(input.featureIssuesByKey)) {
    deliveryDatesByFeatureKey[featureKey.toUpperCase()] = derivePiReviewDeliveryDates({
      featureIssue,
      subtaskIssues: subtasksByFeatureKey[featureKey.toUpperCase()] ?? [],
      statusCategoryByName: input.statusCategoryByName,
      devStartStatusName: input.devStartStatusName,
    });
  }
  return deliveryDatesByFeatureKey;
}
