// issueTimeline.ts — The shared reconstruction of what happened to a Jira issue, and when.
//
// Two reports reconstruct issue history: the person-centric Personal Workflow report ("how much of
// MY time went where") and the issue-centric Flow Analysis ("where did THIS issue's time go, and
// who held it"). They must agree about the same issue — if a person's hands-on time differed
// between them, both numbers would become untrustworthy and nothing would reveal which was wrong.
//
// So there is one reconstruction, here, and both consume it. Agreement is a property of the shape
// rather than something to remember.
//
// The span builder is deliberately GENERIC. The person-centric report drives it with a boolean
// (was-this-mine); the flow analysis drives it with an assignee identity. Same logic, different
// value type — which is why the second analysis needed no second engine.
//
// Everything here is pure: no clock is read (`todayMs` is always injected) and nothing is fetched,
// so every boundary case is exercisable in a unit test.

/** Milliseconds in one calendar day — the shared conversion for every duration. */
export const MILLISECONDS_PER_DAY = 86_400_000;

/** getUTCDay() index for Monday — the first working day counted toward hands-on time. */
const FIRST_WORKDAY_INDEX = 1;

/** getUTCDay() index for Friday — the last working day counted toward hands-on time. */
const LAST_WORKDAY_INDEX = 5;

/** A contiguous span over which a reconstructed timeline holds one constant value. */
export interface StateSegment<TValue> {
  startMs: number;
  endMs: number;
  value: TValue;
}

/** Parses an ISO timestamp, returning null for absent or unparseable values. */
export function parseIsoOrNull(isoString: string | null): number | null {
  if (isoString === null) return null;
  const parsedMs = Date.parse(isoString);
  return Number.isNaN(parsedMs) ? null : parsedMs;
}

/** True when the instant falls on a Monday–Friday. No holiday calendar is applied. */
function isWorkday(instantMs: number): boolean {
  const dayOfWeek = new Date(instantMs).getUTCDay();
  return dayOfWeek >= FIRST_WORKDAY_INDEX && dayOfWeek <= LAST_WORKDAY_INDEX;
}

/**
 * Milliseconds of Monday–Friday time between two instants.
 *
 * Walks day by day rather than estimating, so a span that starts mid-afternoon on a Friday credits
 * only the remainder of that Friday and nothing for the weekend.
 */
export function businessMillisBetween(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;

  let businessMillis = 0;
  let cursorMs = startMs;
  while (cursorMs < endMs) {
    const nextUtcMidnightMs = Math.floor(cursorMs / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY
      + MILLISECONDS_PER_DAY;
    const segmentEndMs = Math.min(nextUtcMidnightMs, endMs);
    if (isWorkday(cursorMs)) {
      businessMillis += segmentEndMs - cursorMs;
    }
    cursorMs = segmentEndMs;
  }
  return businessMillis;
}

/**
 * Reconstructs a timeline from an initial value plus dated changes.
 *
 * Generic in the value it tracks: a boolean for "was this assigned to me", an assignee identity for
 * "who held it", a status id for "what state was it in". One implementation serves all three, which
 * is what keeps the two reports agreeing about the same issue.
 *
 * A change dated before the origin is clamped to it rather than dropped — Jira changelogs do
 * occasionally carry timestamps earlier than the issue's own creation, and discarding those would
 * silently lose the transition.
 */
export function buildStateSegments<TValue>(
  originMs: number,
  initialValue: TValue,
  changePoints: Array<{ atMs: number; value: TValue }>,
  todayMs: number,
): StateSegment<TValue>[] {
  const points = [
    { atMs: originMs, value: initialValue },
    ...changePoints.map((point) => ({ atMs: Math.max(point.atMs, originMs), value: point.value })),
  ].sort((first, second) => first.atMs - second.atMs);

  const segments: StateSegment<TValue>[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const startMs = points[index].atMs;
    const rawEndMs = index + 1 < points.length ? points[index + 1].atMs : todayMs;
    const endMs = Math.min(rawEndMs, todayMs);
    if (endMs > startMs) {
      segments.push({ startMs, endMs, value: points[index].value });
    }
  }
  return segments;
}

/**
 * The anchor both timelines start from: the issue's creation, falling back to its earliest
 * transition, and finally to today when nothing dates it at all.
 *
 * Changing this precedence would move every figure in both reports, so it is deliberately the one
 * rule the extraction preserved unchanged.
 */
export function resolveTimelineOriginMs(
  createdIso: string | null,
  transitionIsos: readonly string[],
  todayMs: number,
): number {
  const createdMs = parseIsoOrNull(createdIso);
  if (createdMs !== null) return createdMs;

  const transitionTimes = transitionIsos
    .map(parseIsoOrNull)
    .filter((atMs): atMs is number => atMs !== null);
  return transitionTimes.length > 0 ? Math.min(...transitionTimes) : todayMs;
}
