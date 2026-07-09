// internalTestingBottleneck.ts — Pure, deterministic compute for the Internal Testing Bottleneck panel.
//
// It answers one question with hard evidence: how badly is the team's internal-testing stage a queue?
// Every issue passed in is already sitting in one of the team's internal-testing statuses (the tab's JQL
// guarantees that). For each, it measures how long the issue has been WAITING in its CURRENT uninterrupted
// run of testing statuses — from the moment it entered that run — then rolls the waits up by status and by
// who holds the issue, so a single tester holding most of the backlog becomes visible at a glance.
//
// The module takes no clock — the caller injects `todayIso` — so identical input always yields identical
// output and the engine is trivially unit-testable. Aging is CALENDAR days (wall-clock wait), not business
// days: a ticket sitting untouched over a weekend has still been waiting.

// ── Domain constants ─────────────────────────────────────────────────────────

/** Milliseconds in one calendar day, used to convert an epoch difference into a whole-and-fractional day count. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** Label used in the by-assignee rollup when an issue has no assignee, so the column never reads blank. */
const UNASSIGNED_LABEL = 'Unassigned';

// ── Public types ─────────────────────────────────────────────────────────────

/** One status change from an issue's changelog: the status name it moved TO and when. */
export interface BottleneckStatusTransition {
  toStatusName: string;
  atIso: string;
}

/**
 * One issue currently in an internal-testing status, carrying the reconstructed inputs the engine needs:
 * its current status and assignee, when it was created, and how its status evolved over time.
 */
export interface BottleneckIssueInput {
  key: string;
  summary: string;
  currentStatusName: string;
  assigneeDisplayName: string | null;
  createdIso: string | null; // when the issue was created — the fallback anchor when no testing entry is found
  statusTransitions: BottleneckStatusTransition[]; // status changes, any order
}

/** Everything the panel needs to compute the bottleneck, including the injected anchor day. */
export interface InternalTestingBottleneckInput {
  issues: readonly BottleneckIssueInput[];
  internalTestingStatusNames: readonly string[]; // the team's internal-testing status names, any casing
  todayIso: string; // injected anchor (YYYY-MM-DD or full ISO)
}

/** Per-issue detail row: how long this issue has been waiting in its current testing run. */
export interface BottleneckIssueMetric {
  key: string;
  summary: string;
  currentStatusName: string;
  assigneeDisplayName: string | null;
  waitingDays: number; // calendar days since the issue entered its current internal-testing run
}

/** The full bottleneck result: backlog size, wait statistics, and the by-status / by-assignee rollups. */
export interface InternalTestingBottleneckResult {
  backlogCount: number; // how many issues are currently stuck in internal testing
  averageWaitingDays: number | null; // null when the backlog is empty
  medianWaitingDays: number | null; // null when the backlog is empty
  oldestWaitingDays: number | null; // the longest single wait; null when the backlog is empty
  countByStatus: Record<string, number>; // how many issues sit in each internal-testing status
  countByAssignee: Record<string, number>; // how many issues each person holds (the bottleneck punchline)
  issues: BottleneckIssueMetric[]; // one row per issue, longest wait first (ties broken by key)
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Computes the internal-testing backlog and how long each issue has been waiting.
 *
 * Every issue is assumed already in a testing status. For each it finds the phase-entry moment, derives a
 * calendar-day wait, then aggregates the backlog count, wait statistics, and the by-status / by-assignee
 * rollups. It never reads the clock — `input.todayIso` anchors the wait — so it is a pure function.
 */
export function computeInternalTestingBottleneck(
  input: InternalTestingBottleneckInput,
): InternalTestingBottleneckResult {
  const todayMs = Date.parse(input.todayIso);
  const normalizedTestingNames = buildNormalizedNameSet(input.internalTestingStatusNames);

  const issues = input.issues
    .map((issue) => buildIssueMetric(issue, normalizedTestingNames, todayMs))
    .sort(compareByWaitingThenKey);

  const waitingDays = issues.map((issue) => issue.waitingDays);
  return {
    backlogCount: issues.length,
    averageWaitingDays: computeMean(waitingDays),
    medianWaitingDays: computeMedian(waitingDays),
    oldestWaitingDays: waitingDays.length === 0 ? null : Math.max(...waitingDays),
    countByStatus: countBy(issues, (issue) => issue.currentStatusName),
    countByAssignee: countBy(issues, (issue) => issue.assigneeDisplayName ?? UNASSIGNED_LABEL),
    issues,
  };
}

// ── Per-issue evaluation ─────────────────────────────────────────────────────

/** Turns one raw issue into a metric row, computing its calendar-day wait from the phase-entry moment. */
function buildIssueMetric(
  issue: BottleneckIssueInput,
  normalizedTestingNames: ReadonlySet<string>,
  todayMs: number,
): BottleneckIssueMetric {
  const phaseEntryMs = resolvePhaseEntryMs(issue, normalizedTestingNames);
  return {
    key: issue.key,
    summary: issue.summary,
    currentStatusName: issue.currentStatusName,
    assigneeDisplayName: issue.assigneeDisplayName,
    waitingDays: computeWaitingDays(phaseEntryMs, todayMs),
  };
}

/**
 * Finds when the issue entered its CURRENT uninterrupted run of internal-testing statuses.
 *
 * It sorts the parseable transitions ascending and looks for the LAST transition that moved INTO a testing
 * status from a status that was NOT a testing status — that is the start of the current run. A move between
 * two testing sub-statuses (e.g. Ready for Testing → Testing) is inside the run, so it does not reset the
 * wait. When no such "entry from outside" exists (no transitions, or the issue was created already in a
 * testing status), it falls back to the creation time; and to null when even that is unknown.
 */
function resolvePhaseEntryMs(
  issue: BottleneckIssueInput,
  normalizedTestingNames: ReadonlySet<string>,
): number | null {
  const sortedTransitions = issue.statusTransitions
    .map((transition) => ({ atMs: parseIsoOrNull(transition.atIso), toStatusName: transition.toStatusName }))
    .filter((transition): transition is { atMs: number; toStatusName: string } => transition.atMs !== null)
    .sort((first, second) => first.atMs - second.atMs);

  let phaseEntryMs: number | null = null;
  for (let index = 0; index < sortedTransitions.length; index += 1) {
    const isEnteringTesting = normalizedTestingNames.has(normalizeName(sortedTransitions[index].toStatusName));
    // The immediately-preceding status is the previous transition's target; the first transition has none.
    const precedingName = index > 0 ? sortedTransitions[index - 1].toStatusName : null;
    const cameFromOutside = precedingName !== null && !normalizedTestingNames.has(normalizeName(precedingName));
    if (isEnteringTesting && cameFromOutside) {
      phaseEntryMs = sortedTransitions[index].atMs; // keep walking so the LAST such entry wins
    }
  }
  return phaseEntryMs ?? parseIsoOrNull(issue.createdIso);
}

/** Calendar days between the phase-entry moment and today, floored at zero; zero when the entry is unknown. */
function computeWaitingDays(phaseEntryMs: number | null, todayMs: number): number {
  if (phaseEntryMs === null) return 0;
  return Math.max(0, (todayMs - phaseEntryMs) / MILLISECONDS_PER_DAY);
}

// ── Name matching ────────────────────────────────────────────────────────────

/** Normalizes a status name for tolerant comparison: trimmed and lowercased. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Builds a set of normalized status names, so membership tests are case- and whitespace-insensitive. */
function buildNormalizedNameSet(names: readonly string[]): ReadonlySet<string> {
  const normalizedNames = new Set<string>();
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized !== '') normalizedNames.add(normalized);
  }
  return normalizedNames;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/** Orders rows by waitingDays descending (longest wait first), then by key ascending as a stable tie-break. */
function compareByWaitingThenKey(first: BottleneckIssueMetric, second: BottleneckIssueMetric): number {
  if (first.waitingDays !== second.waitingDays) return second.waitingDays - first.waitingDays;
  return first.key < second.key ? -1 : first.key > second.key ? 1 : 0;
}

/** Counts rows by a derived key, so the by-status and by-assignee rollups share one implementation. */
function countBy(
  rows: readonly BottleneckIssueMetric[],
  keyOf: (row: BottleneckIssueMetric) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyOf(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Returns the arithmetic mean of the values, or null for an empty list. */
function computeMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((runningTotal, value) => runningTotal + value, 0);
  return total / values.length;
}

/**
 * Returns the median of the values, or null for an empty list: the middle value for an odd count, or the
 * mean of the two middle values for an even count. Sorts a copy so the caller's ordering is untouched.
 */
function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sortedValues.length / 2);
  const hasOddCount = sortedValues.length % 2 === 1;
  if (hasOddCount) return sortedValues[middleIndex];
  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/** Parses an ISO date string to epoch milliseconds, returning null for null or unparseable input. */
function parseIsoOrNull(isoString: string | null): number | null {
  if (isoString === null) return null;
  const parsedMs = Date.parse(isoString);
  return Number.isNaN(parsedMs) ? null : parsedMs;
}
