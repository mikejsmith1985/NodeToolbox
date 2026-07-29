// piReviewStartDates.ts — Rule-based Target Start suggestions for PI Review Features.
//
// The PI Review AI Assist reviews each Feature's RANK (its position on the page — top is highest
// priority) together with its point estimate to suggest when work should START within the PI. The
// suggestion is DETERMINISTIC — a rule, never a language-model guess: assuming one person delivering
// one point per working day, Features are scheduled in priority order from the PI's first working
// day, each starting when the previous one finishes. A Feature that would finish after the PI ends is
// flagged so the Product Owner sees the over-commitment rather than a false "it fits".
//
// Dates are engine-derived here for the same reason the PI Delivery Planner derives them: date
// arithmetic is exactly what a language model gets wrong, and two surfaces showing one schedule must
// agree by construction. The model still does what it is good at (sizing and notes) elsewhere.

import { addWorkingDays, rollToWorkingDay } from '../piPlan/piPlanDates.ts'
import type { WorkingCalendar } from '../piPlan/piPlanTypes.ts'

/**
 * Weekend days skipped when counting effort (Sunday = 0, Saturday = 6); no holiday calendar is
 * applied here. This encodes the Product Owner's stated rule: one point is one working day for one
 * person, so a Feature's span never runs across a weekend.
 */
const DEFAULT_WORKING_CALENDAR: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] }

/** The PI's working window, as ISO 'YYYY-MM-DD' dates. */
export interface PiWorkingWindow {
  startIso: string
  endIso: string
}

/** One Feature to schedule, in rank order (index 0 = highest priority, top of the page). */
export interface RankedFeature {
  issueKey: string
  /** The Feature's point estimate, or null when it has none and so cannot be scheduled. */
  points: number | null
}

/** The rule-derived Target Start suggestion for one Feature. */
export interface SuggestedStart {
  issueKey: string
  /** The points used to size the span (0 when the Feature has no estimate). */
  points: number
  /** Suggested Target Start (ISO), or null when the Feature has no estimate to schedule. */
  startIso: string | null
  /** The working day the span would finish on (ISO), or null when unscheduled. */
  endIso: string | null
  /** False when the Feature has no estimate, OR when its span would finish after the PI ends. */
  fitsInPi: boolean
}

/** Reads a numeric point estimate from a possibly-empty cell; a blank or non-positive value is null. */
export function readPointEstimate(rawEstimate: string): number | null {
  const parsedPoints = Number(rawEstimate.trim())
  return Number.isFinite(parsedPoints) && parsedPoints > 0 ? parsedPoints : null
}

/**
 * Suggests a Target Start per Feature from rank + points, scheduled sequentially within the PI window.
 *
 * Features are taken in the given order (highest priority first). A one-person, one-point-per-working-
 * day cursor walks forward from the PI's first working day: each estimated Feature starts on the
 * cursor and runs `points` working days, then the cursor advances to the next working day for the
 * Feature below it. A Feature whose span would end after the PI's last day is returned with
 * fitsInPi=false so the caller can warn instead of implying it fits. An un-estimated Feature cannot be
 * scheduled, so it consumes no time and is returned unscheduled (start/end null).
 *
 * @param rankedFeatures - Features in page/priority order (top of the list first).
 * @param piWindow - The PI's first and last calendar day; the first is rolled to a working day.
 * @param calendar - Which days count as working days; defaults to a Mon–Fri, no-holiday calendar.
 */
export function suggestPiReviewStartDates(
  rankedFeatures: readonly RankedFeature[],
  piWindow: PiWorkingWindow,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): SuggestedStart[] {
  const piEndIso = piWindow.endIso.slice(0, 10)
  let cursorIso = rollToWorkingDay(piWindow.startIso, calendar)

  return rankedFeatures.map((feature) => {
    // Un-estimated Features cannot be scheduled — they take no time and leave the cursor untouched.
    if (feature.points === null || feature.points <= 0) {
      return { issueKey: feature.issueKey, points: 0, startIso: null, endIso: null, fitsInPi: false }
    }
    const startIso = cursorIso
    // A span of N working days that includes its own start day finishes N-1 working days later.
    const endIso = addWorkingDays(startIso, feature.points - 1, calendar)
    const fitsInPi = endIso <= piEndIso
    // The next Feature starts on the first working day after this one finishes.
    cursorIso = addWorkingDays(endIso, 1, calendar)
    return { issueKey: feature.issueKey, points: feature.points, startIso, endIso, fitsInPi }
  })
}
