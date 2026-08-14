// issueFlagWrite.ts — Raising and clearing Jira's impediment flag from the board.
//
// The board has read this flag since it shipped and never written it. Writing it is a small thing
// with one real trap: the field's SHAPE is not knowable from having read it. Reading only needs
// truthiness, so the app's own type calls it `boolean | string | null` — a guess that is fine for a
// test and useless for a write. On this instance it is a select whose value is an option object, and
// writing an option field blind is exactly what produced "Could not find valid 'id' or 'value' in the
// Parent Option object" when the sub-status writer was first built.
//
// So nothing here is assumed. The field is found in the issue's own editmeta, and the value written
// is the one editmeta says is allowed. If the flag is not on that issue's edit screen, this says so
// instead of sending a request that Jira will refuse.

import { jiraPut } from '../../../services/jiraApi.ts';
import {
  saveFeatureReviewOptionField,
  type FeatureReviewEditMetaField,
} from '../featureReviewFixes.ts';

/** The field id Jira uses for the impediment flag on most instances — a fallback, never an assumption. */
const CONVENTIONAL_FLAG_FIELD_ID = 'customfield_10021';

/** How Jira names the field, normalised. Matched on because a field id differs between instances. */
const FLAG_FIELD_NAME_PATTERN = /^(flagged|impediment|flag)$/i;

export type IssueEditMeta = Record<string, FeatureReviewEditMetaField | undefined>;

/**
 * Finds the impediment flag among the fields this issue can actually be edited with.
 *
 * By NAME first and by the conventional id second. A field id is instance-specific — the same
 * lesson the checklist field taught, where three different ids held the same thing — while "Flagged"
 * is what Jira calls it in the UI on every instance we have seen.
 *
 * Returns null when the flag is not on this issue's edit screen, which is a real answer: some issue
 * types genuinely do not carry it, and the board must not offer an action Jira will refuse.
 */
export function findFlagFieldId(editMeta: IssueEditMeta): string | null {
  for (const [fieldId, editMetaField] of Object.entries(editMeta ?? {})) {
    if (FLAG_FIELD_NAME_PATTERN.test((editMetaField?.name ?? '').trim())) return fieldId;
  }
  return (editMeta ?? {})[CONVENTIONAL_FLAG_FIELD_ID] ? CONVENTIONAL_FLAG_FIELD_ID : null;
}

/**
 * The value that means "flagged" on this instance, taken from what editmeta permits.
 *
 * Usually "Impediment", but it is read rather than hard-coded: a renamed option would otherwise make
 * every flag write fail with a message about an option object, which explains nothing to anybody.
 */
export function readFlagOptionName(editMetaField: FeatureReviewEditMetaField | undefined): string | null {
  const [firstAllowedValue] = editMetaField?.allowedValues ?? [];
  if (!firstAllowedValue) return null;

  const optionName = (firstAllowedValue as { value?: string; name?: string }).value
    ?? (firstAllowedValue as { value?: string; name?: string }).name
    ?? '';
  return optionName.trim() === '' ? null : optionName;
}

/** Why the flag cannot be written for this issue, or null when it can. */
export function describeFlagUnavailable(editMeta: IssueEditMeta): string | null {
  const flagFieldId = findFlagFieldId(editMeta);
  if (flagFieldId === null) {
    return 'This issue type has no flag field on its edit screen, so the flag cannot be set from here.';
  }
  if (readFlagOptionName(editMeta[flagFieldId]) === null) {
    return 'Jira did not offer a value for the flag field, so there is nothing to write.';
  }
  return null;
}

/**
 * Raises or clears the flag.
 *
 * Setting delegates to the shared option writer, which already builds the option payload from
 * editmeta and wraps it in an array where the field's schema says to. Clearing is a plain null: an
 * empty array is accepted by some instances and refused by others, whereas null is how Jira itself
 * clears a field, so it is the one that behaves the same everywhere.
 */
export async function setIssueFlag(
  issueKey: string,
  shouldBeFlagged: boolean,
  editMeta: IssueEditMeta,
): Promise<void> {
  const unavailableReason = describeFlagUnavailable(editMeta);
  if (unavailableReason !== null) throw new Error(unavailableReason);

  const flagFieldId = findFlagFieldId(editMeta) as string;
  if (!shouldBeFlagged) {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: { [flagFieldId]: null },
    });
    return;
  }

  await saveFeatureReviewOptionField(
    issueKey,
    flagFieldId,
    readFlagOptionName(editMeta[flagFieldId]) as string,
    editMeta[flagFieldId],
  );
}
