// releaseAlignment.ts — Flags Epics and children that disagree about which release they are in (GH #395).
//
// fixVersions belong to one Jira project, so an Epic in DENP and its child in ENCUC carry two different
// version records that share a name. "The same release" therefore means the same version NAME — compared
// ignoring case and surrounding spaces.

import type { EpicGroup, ReleaseMisalignment } from './releaseGather.ts';

/** True when any of an issue's fixVersion names is the release's. */
export function isInRelease(fixVersionNames: readonly string[], versionName: string): boolean {
  const releaseName = versionName.trim().toLowerCase();
  return fixVersionNames.some((fixVersionName) => fixVersionName.trim().toLowerCase() === releaseName);
}

/** "1 of its children is" / "3 of its children are", so the flag reads as a sentence. */
function describeChildCount(childCount: number): string {
  return childCount === 1 ? '1 of its children is' : `${childCount} of its children are`;
}

/** The Epic-level flag, when the Epic itself is not in the release its children are in. */
function findEpicMisalignment(group: EpicGroup, versionName: string): ReleaseMisalignment | null {
  if (!group.epic || group.items.length === 0 || isInRelease(group.epic.fixVersionNames, versionName)) {
    return null;
  }
  const epicKey = group.epic.key;
  if (group.epic.fixVersionNames.length === 0) {
    return {
      kind: 'epic-has-no-version',
      issueKey: epicKey,
      message: `${epicKey} has no fixVersion, but ${describeChildCount(group.items.length)} in this release.`,
    };
  }
  return {
    kind: 'epic-in-other-version',
    issueKey: epicKey,
    message: `${epicKey} is planned for ${group.epic.fixVersionNames.join(', ')}, not this release.`,
  };
}

/**
 * Every disagreement in one Epic's group: the Epic not in the release its children are in, and each team child
 * of an Epic in this release that sits in another release or none. The "No Epic" group and an Epic that could
 * not be read have nothing to compare.
 */
export function computeMisalignments(group: EpicGroup, versionName: string): ReleaseMisalignment[] {
  if (!group.epic) {
    return [];
  }
  const epicMisalignment = findEpicMisalignment(group, versionName);
  const outsideMisalignments: ReleaseMisalignment[] = group.outsideItems.map((outsideItem) => ({
    kind: 'child-outside-release',
    issueKey: outsideItem.key,
    message: outsideItem.fixVersionNames.length === 0
      ? `${outsideItem.key} has no fixVersion, not this release.`
      : `${outsideItem.key} is in ${outsideItem.fixVersionNames.join(', ')}, not this release.`,
  }));
  return [...(epicMisalignment ? [epicMisalignment] : []), ...outsideMisalignments];
}
