// storyPointsField.ts — Which field this instance actually keeps story points in.
//
// Three stores had an opinion and none of them agreed. The Hygiene scan read
// `tbxSprintDashboardConfig.customStoryPointsFieldId`, whose default is the literal string
// `story_points` — not a `customfield_` id, so the scan decided nothing was configured and fell back
// to `customfield_10028` / `customfield_10016`. Meanwhile the field the operator had actually chosen,
// `customfield_10236` ("Story Points Selection"), lives in `tbxARTSettings.spFieldId` and is the one
// `featureReviewFixes` writes to.
//
// The result: forty-one issues with story points on them were reported as missing story points,
// because the check was looking at a field this instance does not use (GH #375).
//
// So the field is resolved ONCE, here, and both the read and the write go through it. A check and a
// fix that disagree about where a value lives produce the two worst outcomes available: a flag that
// cannot be cleared, and a write that reports success and changes nothing visible.

/** Where the ART advanced settings live. `spFieldId` is the field the operator picked by name. */
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/**
 * Built-in fallbacks, in preference order. Only reached when nothing is configured anywhere — an
 * instance that has chosen a field must never be judged against a field it does not use.
 */
const BUILT_IN_STORY_POINTS_FIELD_IDS = ['customfield_10028', 'customfield_10016'];

/** True for a value that names a real Jira custom field, rather than a placeholder like `story_points`. */
function isRealCustomFieldId(fieldId: string | null | undefined): boolean {
  return typeof fieldId === 'string' && fieldId.trim().startsWith('customfield_');
}

/** Reads the story-points field the ART settings screen has selected, if any. */
function readArtSettingsStoryPointsFieldId(): string | null {
  try {
    const artSettings = JSON.parse(
      window.localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}',
    ) as { spFieldId?: string };
    const configuredFieldId = artSettings.spFieldId?.trim() ?? '';
    return isRealCustomFieldId(configuredFieldId) ? configuredFieldId : null;
  } catch {
    return null;
  }
}

/**
 * Every field worth reading story points from, most authoritative first.
 *
 * The dashboard's own setting wins when it names a real field; the ART settings screen is consulted
 * next, because that is where this instance's field was actually chosen and where the write helper
 * already looks. The built-ins come last and only matter for an instance that has configured nothing.
 *
 * All of them are returned rather than just the winner: an issue carrying points in a legacy field is
 * pointed, and reporting it as missing because the newest field is empty would be the same false
 * positive in a different direction.
 */
export function resolveStoryPointsFieldIds(dashboardConfigFieldId: string | null | undefined): string[] {
  const orderedCandidates = [
    isRealCustomFieldId(dashboardConfigFieldId) ? (dashboardConfigFieldId as string).trim() : null,
    readArtSettingsStoryPointsFieldId(),
    ...BUILT_IN_STORY_POINTS_FIELD_IDS,
  ].filter((fieldId): fieldId is string => fieldId !== null && fieldId !== '');

  return [...new Set(orderedCandidates)];
}

/**
 * The single field a story-points WRITE should target.
 *
 * The first resolved candidate, so a write lands in the field the check reads first. Writing to any
 * other field in the list would clear nothing the user can see.
 */
export function resolveStoryPointsWriteFieldId(dashboardConfigFieldId: string | null | undefined): string {
  return resolveStoryPointsFieldIds(dashboardConfigFieldId)[0];
}
