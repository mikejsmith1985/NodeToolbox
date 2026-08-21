// projectVersions.ts — Giving the forecast a version's real metadata, not just its name.
//
// The Forecast tab asks Jira for the project's fix versions, so it knows each one's release-date
// field and whether it has shipped. The Roll-Up Board and the Today dashboard do not: they read the
// versions off the ISSUES, which carry a name and nothing else.
//
// That gap has a visible cost. The engine deliberately excuses work still open against a SHIPPED
// version -- its date is history, not a commitment -- but it can only do that if it is told the
// version shipped. Told only a name, it treats last year's release as a live deadline and reports
// every carryover issue as catastrophically late against a date nobody is working to.
//
// So this pairs the names the work actually references with the project's own record of them.

import type { RawJiraVersion } from '../../ArtView/piPlan/piPlanReleaseSchedule.ts';
import type { FixVersionLike } from './forecastTypes.ts';

/**
 * Pairs each referenced version name with what the project knows about it.
 *
 * A name the project list cannot explain is KEPT, with no field date and not released. Dropping it
 * would take away the work's only deadline and silently reclassify it as having none, which reads
 * as calm. The name itself still carries a date by the team's convention, and the release-date
 * resolver reads that.
 */
export function mergeProjectVersionMetadata(
  referencedVersionNames: readonly string[],
  projectVersions: readonly RawJiraVersion[],
): FixVersionLike[] {
  const byName = new Map<string, RawJiraVersion>();
  projectVersions.forEach((version) => {
    const name = (version.name ?? '').trim();
    if (name !== '') {
      byName.set(name, version);
    }
  });

  return referencedVersionNames.map((referencedName) => {
    const trimmedName = referencedName.trim();
    const known = byName.get(trimmedName);
    return {
      name: trimmedName,
      releaseDate: known?.releaseDate ?? null,
      released: known?.released === true,
    };
  });
}
