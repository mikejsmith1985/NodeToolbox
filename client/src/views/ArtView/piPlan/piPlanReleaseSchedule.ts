// piPlanReleaseSchedule.ts — Builds the production release calendar for a PI from Jira fixVersions
// (spec 028, FR-007/FR-037). The READ + pure build half lives here (Foundational, so the date engine
// has PROD/Due dates from the MVP onward); the monthly-suggestion half is added in User Story 5.
// Framework-First: saveFeatureReviewFixVersion already *sets* a version — only reading the window and
// suggesting a cadence is new.

import { jiraGet } from '../../../services/jiraApi.ts';
import { rollToWorkingDay } from './piPlanDates.ts';
import type { ReleaseSchedule, WorkingCalendar } from './piPlanTypes.ts';

/** Releases may fall shortly after the PI end (production can follow the PI DoD), so the window trails. */
const RELEASE_WINDOW_TRAILING_DAYS = 60;
/** Production releases are kept roughly monthly — a suggested release is never closer than this (R4). */
const MIN_RELEASE_GAP_DAYS = 28;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The minimal shape of a Jira version we consume; extra fields on the payload are ignored. */
export interface RawJiraVersion {
  name: string;
  releaseDate?: string;
  archived?: boolean;
  /** Jira's own marker that this version has shipped. Optional so older callers are unaffected. */
  released?: boolean;
}

/** Returns the ISO date `days` after `iso` (used to extend the window past the PI end). */
function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MILLISECONDS_PER_DAY);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Builds the production release calendar: keeps non-archived versions with a release date inside the PI
 * window (extended by a trailing margin so a late Story can still land on a real release), sorted by date.
 */
export function buildReleaseSchedule(
  versions: RawJiraVersion[],
  windowStartIso: string,
  windowEndIso: string,
): ReleaseSchedule {
  const upperBoundIso = addCalendarDays(windowEndIso, RELEASE_WINDOW_TRAILING_DAYS);
  const entries = versions
    .filter((version) => !version.archived && typeof version.releaseDate === 'string')
    .map((version) => ({ name: version.name, releaseDateIso: version.releaseDate!.slice(0, 10), isSuggested: false }))
    .filter((entry) => entry.releaseDateIso >= windowStartIso && entry.releaseDateIso <= upperBoundIso)
    .sort((left, right) => left.releaseDateIso.localeCompare(right.releaseDateIso));
  return { entries };
}

/**
 * Ensures every needed production date has a release on/after it, adding deterministic monthly `isSuggested`
 * releases where the existing calendar has a gap (research R4). A suggested release lands on the first
 * working day that is both ≥ the needed date and ≥ 28 days after the previous release; the first anchor is
 * the last existing release, or the PI start when there are none. Suggested releases require acceptance.
 */
export function suggestMonthlyReleases(
  schedule: ReleaseSchedule,
  neededReleaseDates: string[],
  piStartIso: string,
  calendar: WorkingCalendar,
): ReleaseSchedule {
  const entries = [...schedule.entries].sort((left, right) => left.releaseDateIso.localeCompare(right.releaseDateIso));
  const existingCount = entries.length;
  let previousReleaseIso = existingCount > 0 ? entries[existingCount - 1].releaseDateIso : piStartIso;
  let suggestionIndex = 0;

  [...neededReleaseDates].sort().forEach((neededIso) => {
    const hasCoveringRelease = entries.some((entry) => entry.releaseDateIso >= neededIso);
    if (hasCoveringRelease) {
      return;
    }
    const earliestByCadence = addCalendarDays(previousReleaseIso, MIN_RELEASE_GAP_DAYS);
    const suggestedIso = rollToWorkingDay(neededIso > earliestByCadence ? neededIso : earliestByCadence, calendar);
    suggestionIndex += 1;
    entries.push({ name: `Suggested Release ${suggestionIndex}`, releaseDateIso: suggestedIso, isSuggested: true });
    entries.sort((left, right) => left.releaseDateIso.localeCompare(right.releaseDateIso));
    previousReleaseIso = suggestedIso;
  });

  return { entries };
}

/** Reads the project's fixVersions through the Jira proxy. Read-only; the caller windows them. */
export async function fetchPiWindowFixVersions(projectKey: string): Promise<RawJiraVersion[]> {
  return jiraGet<RawJiraVersion[]>(`/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`);
}
