// storyPointsField.ts — Hygiene's view of where story points live. A thin delegation, on purpose.
//
// This module once resolved the field itself, and it resolved it WRONG: it defaulted to
// customfield_10028 while this instance keeps points in customfield_10236, so forty-one estimated
// issues were reported as unestimated and every accepted fix wrote somewhere nothing read (GH #375).
// ReportsHub had a second resolver with the right answer, which is the whole problem in one sentence
// — two modules deciding the same thing, one of them silently wrong.
//
// Both now defer to `services/jiraFieldMapping.ts`, which is the single authority: saved override,
// then discovery by name, then the hard default. What remains here is the Hygiene-shaped signature
// its callers already use, so the delegation cost no call sites.

import { resolveConfiguredFieldIds, resolveWriteFieldId } from '../../../services/jiraFieldMapping.ts';

/**
 * Every field worth reading story points from, most authoritative first.
 *
 * The argument is the Team Dashboard's own setting, which is accepted only when it names a real
 * field — its default is the placeholder `story_points`, which read as "configured" and sent the
 * whole scan to the wrong place.
 */
export function resolveStoryPointsFieldIds(dashboardConfigFieldId: string | null | undefined): string[] {
  const dashboardChoice = String(dashboardConfigFieldId ?? '').trim();
  const mappedFieldIds = resolveConfiguredFieldIds('spFieldId', window.localStorage);
  return dashboardChoice.startsWith('customfield_')
    ? [...new Set([dashboardChoice, ...mappedFieldIds])]
    : mappedFieldIds;
}

/** The single field a story-points write must target: the one a read consults first. */
export function resolveStoryPointsWriteFieldId(dashboardConfigFieldId: string | null | undefined): string {
  return resolveStoryPointsFieldIds(dashboardConfigFieldId)[0] ?? resolveWriteFieldId('spFieldId', window.localStorage);
}

/**
 * Reads a story-points field value as a number, whatever shape Jira returned it in.
 *
 * This instance keeps story points in a SELECT field, so Jira returns `{ id, value }` rather than a
 * number — and a reader that handles only numbers and strings sees every estimated issue as
 * unestimated. That is not a small miss: it is the difference between a forecast and thirty-three
 * rows saying "no estimate".
 *
 * Lives here, beside the field resolution, so there is one answer to "what does this field say"
 * rather than one per surface. Returns null for anything that is not a positive number, including
 * the "None" placeholder Jira gives for an explicitly cleared select.
 */
export function readStoryPointsValue(fieldValue: unknown): number | null {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
    return null;
  }
  if (typeof fieldValue === 'number') {
    return Number.isFinite(fieldValue) && fieldValue > 0 ? fieldValue : null;
  }
  if (typeof fieldValue === 'string') {
    const parsedNumber = Number(fieldValue);
    return Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
  }
  if (Array.isArray(fieldValue)) {
    return fieldValue.length === 0 ? null : readStoryPointsValue(fieldValue[0]);
  }
  if (typeof fieldValue === 'object') {
    // A Jira select returns { id, value }; the estimate is the value.
    return readStoryPointsValue((fieldValue as Record<string, unknown>).value);
  }
  return null;
}

/** The first of the configured fields that actually holds an estimate, or null when none does. */
export function readStoryPointsFromFields(
  fields: Record<string, unknown>,
  fieldIds: readonly string[],
): number | null {
  for (const fieldId of fieldIds) {
    const storyPoints = readStoryPointsValue(fields[fieldId]);
    if (storyPoints !== null) {
      return storyPoints;
    }
  }
  return null;
}
