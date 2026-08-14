// issueFlagWrite.ts — Raising and clearing Jira's impediment flag from the board.
//
// The first version of this refused before sending anything when the flag was not on the issue's
// edit screen, on the reasoning that the board should never offer an action Jira will reject. On a
// real instance that guard rejected everything: Jira's Flagged field is very commonly left OFF the
// edit screen while remaining perfectly writable — its own board flag button writes it regardless.
// So the guard was not protecting anybody from a refusal, it WAS the refusal.
//
// The rule now is: editmeta is used where it helps and never as permission. It tells us the field's
// id and the exact option value where it happens to know them; where it does not, the conventional
// shape is sent and JIRA is allowed to be the authority on whether that works. A real refusal from
// Jira is far more useful than a guess of ours, because it says what is actually wrong.

import { jiraPut } from '../../../services/jiraApi.ts';
import type { FeatureReviewEditMetaField } from '../featureReviewFixes.ts';

/** The field id Jira uses for the impediment flag on most instances. */
const CONVENTIONAL_FLAG_FIELD_ID = 'customfield_10021';

/** The option value Jira ships for it, used only when editmeta does not name one. */
const CONVENTIONAL_FLAG_VALUE = 'Impediment';

/** How Jira names the field, normalised. Matched on because a field id differs between instances. */
const FLAG_FIELD_NAME_PATTERN = /^(flagged|impediment|flag)$/i;

export type IssueEditMeta = Record<string, FeatureReviewEditMetaField | undefined>;

/**
 * Which field carries the flag.
 *
 * By NAME first, because a field id is instance-specific — the same lesson the checklist field
 * taught, where three ids held the same thing. Falls back to the conventional id and never returns
 * nothing: an absence from editmeta means the field is off the edit screen, which says nothing about
 * whether it can be written.
 */
export function findFlagFieldId(editMeta: IssueEditMeta): string {
  for (const [fieldId, editMetaField] of Object.entries(editMeta ?? {})) {
    if (FLAG_FIELD_NAME_PATTERN.test((editMetaField?.name ?? '').trim())) return fieldId;
  }
  return CONVENTIONAL_FLAG_FIELD_ID;
}

/** The single option to write, preferring an id over a value the way Jira's own writers do. */
function buildFlagOption(editMetaField: FeatureReviewEditMetaField | undefined): { id: string } | { value: string } {
  const [firstAllowedValue] = editMetaField?.allowedValues ?? [];
  const allowedValue = firstAllowedValue as { id?: string; value?: string; name?: string } | undefined;

  if (allowedValue?.id) return { id: String(allowedValue.id) };
  const optionName = (allowedValue?.value ?? allowedValue?.name ?? '').trim();
  return { value: optionName === '' ? CONVENTIONAL_FLAG_VALUE : optionName };
}

/** What the board will send to Jira for this flag change, worked out before anything is sent. */
export interface FlagWrite {
  fieldId: string;
  /** null clears the flag — how Jira itself empties a field, and accepted everywhere. */
  value: unknown;
}

/**
 * Works out the write without performing it.
 *
 * The flag is an ARRAY of options unless editmeta positively says otherwise. That is the shape Jira
 * ships and the one that works when editmeta cannot tell us anything, which — for this field — is the
 * common case rather than the exception.
 */
export function resolveFlagWrite(editMeta: IssueEditMeta, shouldBeFlagged: boolean): FlagWrite {
  const fieldId = findFlagFieldId(editMeta);
  if (!shouldBeFlagged) return { fieldId, value: null };

  const editMetaField = (editMeta ?? {})[fieldId];
  const flagOption = buildFlagOption(editMetaField);
  const isSingleOption = editMetaField?.schema?.type !== undefined && editMetaField.schema.type !== 'array';

  return { fieldId, value: isSingleOption ? flagOption : [flagOption] };
}

/** Raises or clears the flag, letting Jira decide whether it can be done. */
export async function setIssueFlag(
  issueKey: string,
  shouldBeFlagged: boolean,
  editMeta: IssueEditMeta,
): Promise<void> {
  const flagWrite = resolveFlagWrite(editMeta, shouldBeFlagged);

  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: { [flagWrite.fieldId]: flagWrite.value },
  });
}
