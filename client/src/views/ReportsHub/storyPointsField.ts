// storyPointsField.ts — Shared story-points reading for the Reports Hub (Personal Flow + Aging).
//
// Story points on this instance live in an ART-configurable custom field that is a dropdown/select, so
// Jira returns it as an object ({ value: "3" }) rather than a bare number. Both the Personal Flow report
// and the Aging triage need the SAME instance-correct reading, so it lives here once instead of being
// re-implemented (and drifting) per report.

// The team's known story-points custom field, used when the ART settings do not override it. It is a
// dropdown/select on this instance, hence the object-unwrapping reader below.
export const DEFAULT_STORY_POINTS_FIELD_ID = 'customfield_10236';

// localStorage key the Team Dashboard / ART settings write the configured story-points field id under.
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/**
 * Reads a numeric value from a Jira field however Jira shaped it: a finite number is taken as-is, a
 * non-empty numeric string is parsed, and a select/dropdown OBJECT (e.g. `{ value: "3" }`) is unwrapped by
 * recursing into its `.value`. Everything else — null, blank, non-numeric — reads as no value. This is what
 * lets a dropdown story-points field yield its number instead of being discarded as an unrecognised object.
 */
export function readNumericFieldValue(fieldValue: unknown): number | null {
  if (typeof fieldValue === 'number') {
    return Number.isFinite(fieldValue) ? fieldValue : null;
  }
  if (typeof fieldValue === 'string') {
    const parsed = Number(fieldValue);
    return Number.isFinite(parsed) && fieldValue.trim() !== '' ? parsed : null;
  }
  if (fieldValue !== null && typeof fieldValue === 'object') {
    return readNumericFieldValue((fieldValue as { value?: unknown }).value);
  }
  return null;
}

/**
 * Reads the configured story-points field id the Team Dashboard / ART settings persisted, falling back to
 * the team's known default when nothing is set or the stored JSON cannot be parsed. Read at RUN time so a
 * settings change is picked up on the next report without reloading the app.
 */
export function readConfiguredStoryPointsFieldId(): string {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as { spFieldId?: string };
    return storedSettings.spFieldId?.trim() || DEFAULT_STORY_POINTS_FIELD_ID;
  } catch {
    return DEFAULT_STORY_POINTS_FIELD_ID;
  }
}

/** Reads the story-points value from the single configured field, unwrapping a dropdown object, or null. */
export function readStoryPoints(fields: Record<string, unknown>, storyPointsFieldId: string): number | null {
  return readNumericFieldValue(fields[storyPointsFieldId]);
}
