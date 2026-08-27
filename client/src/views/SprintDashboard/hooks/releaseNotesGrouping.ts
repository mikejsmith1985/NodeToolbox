// releaseNotesGrouping.ts — Arranging release notes under the Feature each item delivers.
//
// A release read as a flat list of twenty Jira keys is a list of twenty unrelated-looking changes. The
// people it is sent to — a release manager, a CAB, a stakeholder — do not think in stories; they think
// in the handful of Features the release actually moves forward, and they want to know which of those
// landed.
//
// The grouping is done HERE, from what Jira says, and NOT asked of the assistant. That is the whole
// design decision. Toolbox already resolved each issue's Feature from its own link fields; if the
// assistant were asked to group as well, its answer could quietly disagree — an item filed under the
// wrong Feature, or a Feature invented outright — and a release note that misattributes work is worse
// than one that never grouped at all. The assistant is asked for one thing it is genuinely better at:
// a sentence saying what each Feature amounts to in this release.
//
// Pure: no fetch, no storage, no clock.

import type { ReleaseAiAssistTableRow } from './releaseAiAssistNotes.ts';

/** What an item with no Feature behind it is filed under, matching the Roll-Up Board's own wording. */
export const NO_FEATURE_GROUP_LABEL = 'No Feature';

/** One Feature's worth of a release. */
export interface ReleaseNotesGroup {
  /** The Feature's Jira key, or null for the items nothing could be attributed to. */
  featureKey: string | null;
  /** The Feature's own summary from Jira. Empty when the Feature could not be read. */
  featureSummary: string;
  /** The assistant's sentence on what this Feature amounts to in this release. Empty when none. */
  narrative: string;
  rows: ReleaseAiAssistTableRow[];
}

/** The heading a group is shown under: its key and summary, or the No Feature label. */
export function describeGroupHeading(group: ReleaseNotesGroup): string {
  if (group.featureKey === null) {
    return NO_FEATURE_GROUP_LABEL;
  }
  return group.featureSummary === '' ? group.featureKey : `${group.featureKey} — ${group.featureSummary}`;
}

/**
 * Groups the release rows under the Feature each one delivers.
 *
 * Groups appear in the order their first item appeared, so the arrangement follows the release's own
 * ordering rather than an alphabetical one nobody chose. The unattributed items come LAST and are
 * always shown: a release note that silently dropped the work it could not file would be a release
 * note that lies about what shipped.
 */
export function groupReleaseRowsByFeature(
  rows: readonly ReleaseAiAssistTableRow[],
  featureKeyByIssueKey: ReadonlyMap<string, string | null>,
  featureSummaryByKey: ReadonlyMap<string, string>,
  narrativeByFeatureKey: ReadonlyMap<string, string> = new Map(),
): ReleaseNotesGroup[] {
  const groupsByKey = new Map<string, ReleaseNotesGroup>();
  const unattributedRows: ReleaseAiAssistTableRow[] = [];

  rows.forEach((row) => {
    const featureKey = featureKeyByIssueKey.get(row.issueKey) ?? null;
    if (featureKey === null) {
      unattributedRows.push(row);
      return;
    }

    const existingGroup = groupsByKey.get(featureKey);
    if (existingGroup === undefined) {
      groupsByKey.set(featureKey, {
        featureKey,
        featureSummary: featureSummaryByKey.get(featureKey) ?? '',
        narrative: narrativeByFeatureKey.get(featureKey) ?? '',
        rows: [row],
      });
      return;
    }
    existingGroup.rows.push(row);
  });

  const groups = [...groupsByKey.values()];
  if (unattributedRows.length > 0) {
    groups.push({ featureKey: null, featureSummary: '', narrative: '', rows: unattributedRows });
  }
  return groups;
}

/**
 * True when the whole release turned out to sit under one Feature, or under none at all.
 *
 * Worth asking before rendering headings: a release of six stories that all belong to one Feature gains
 * nothing from a heading repeated once, and a release nothing could be attributed to would show a
 * single "No Feature" heading over the entire table, which says less than no heading at all.
 */
export function isGroupingWorthShowing(groups: readonly ReleaseNotesGroup[]): boolean {
  return groups.length > 1;
}
