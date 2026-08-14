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

import { jiraPost, jiraPut } from '../../../services/jiraApi.ts';
import type { FeatureReviewEditMetaField } from '../featureReviewFixes.ts';

/** The field id Jira uses for the impediment flag on most instances. */
const CONVENTIONAL_FLAG_FIELD_ID = 'customfield_10021';

/** The option value Jira ships for it, used only when editmeta does not name one. */
const CONVENTIONAL_FLAG_VALUE = 'Impediment';

/** How Jira names the field, normalised. Matched on because a field id differs between instances. */
const FLAG_FIELD_NAME_PATTERN = /^(flagged|impediment|flag)$/i;

export type IssueEditMeta = Record<string, FeatureReviewEditMetaField | undefined>;

/**
 * Finds the flag in this instance's FIELD CATALOGUE, which is the only place that knows its real id.
 *
 * `customfield_10021` is Jira's id on a default install and was hard-coded here. On this instance it
 * is something else, which failed in both directions at once and made the feature look like two
 * separate bugs: the read asked for a field that does not exist, so no card ever showed as flagged;
 * and the write to the same id came back
 *
 *   400 — Field 'customfield_10021' cannot be set. It is not on the appropriate screen, or unknown.
 *
 * The "or unknown" was the answer all along. Reads are not screen-gated, so a read returning nothing
 * meant the id was wrong rather than the screen being wrong.
 *
 * This is the third field to teach the same lesson, after the sub-status and the checklist: on this
 * Jira a field id is never knowable in advance, and only its NAME is stable.
 */
export function findFlagFieldInCatalog(
  fieldCatalog: readonly { id?: string; name?: string }[],
): string | null {
  const flagField = (fieldCatalog ?? []).find((field) =>
    FLAG_FIELD_NAME_PATTERN.test(String(field.name ?? '').trim()));
  return flagField?.id ? String(flagField.id) : null;
}

/** Reads the flag off an issue, given whichever field this instance keeps it in. */
export function readIsFlagSet(
  issueFields: Record<string, unknown> | undefined,
  flagFieldId: string,
): boolean {
  if (flagFieldId === '') return false;
  const rawValue = (issueFields ?? {})[flagFieldId];
  // An EMPTY array is how Jira reports "not flagged" for a multi-option field, and an empty array is
  // truthy — so length is what decides, never the value itself.
  if (Array.isArray(rawValue)) return rawValue.length > 0;
  return Boolean(rawValue);
}

/**
 * Which field carries the flag.
 *
 * By NAME first, because a field id is instance-specific — the same lesson the checklist field
 * taught, where three ids held the same thing. Falls back to the conventional id and never returns
 * nothing: an absence from editmeta means the field is off the edit screen, which says nothing about
 * whether it can be written.
 */
export function findFlagFieldId(editMeta: IssueEditMeta, discoveredFieldId = ''): string {
  for (const [fieldId, editMetaField] of Object.entries(editMeta ?? {})) {
    if (FLAG_FIELD_NAME_PATTERN.test((editMetaField?.name ?? '').trim())) return fieldId;
  }
  // The id discovered from this instance's field catalogue beats the default, which is wrong here.
  return discoveredFieldId !== '' ? discoveredFieldId : CONVENTIONAL_FLAG_FIELD_ID;
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
export function resolveFlagWrite(
  editMeta: IssueEditMeta,
  shouldBeFlagged: boolean,
  discoveredFieldId = '',
): FlagWrite {
  const fieldId = findFlagFieldId(editMeta, discoveredFieldId);
  if (!shouldBeFlagged) return { fieldId, value: null };

  const editMetaField = (editMeta ?? {})[fieldId];
  const flagOption = buildFlagOption(editMetaField);
  const isSingleOption = editMetaField?.schema?.type !== undefined && editMetaField.schema.type !== 'array';

  return { fieldId, value: isSingleOption ? flagOption : [flagOption] };
}

/**
 * Jira's OWN flag endpoint — the one its board's flag button uses.
 *
 * Needed because the ordinary issue update validates every field against the issue's EDIT SCREEN, and
 * Flagged is very commonly not on it. With the right field id finally in hand, that is exactly what
 * this instance said:
 *
 *   400 — Field 'customfield_11200' cannot be set. It is not on the appropriate screen, or unknown.
 *
 * The id was right by then — the card was reading the flag correctly — so only the screen was left.
 * This endpoint is how Jira flags an issue without one, which is why the button in Jira works on
 * issues whose edit screen has no such field.
 *
 * It takes a POST. Sent as a PUT it answers 405 Method Not Allowed — which was at least a useful
 * answer, because 405 says the path is real and only the verb was wrong.
 */
const AGILE_FLAG_PATH = '/rest/greenhopper/1.0/xboard/issue/flag/flag.json';

/** The request Jira's own board sends, kept as a pure value so a test can state it exactly. */
export function buildAgileFlagRequest(issueKey: string, shouldBeFlagged: boolean): {
  path: string;
  body: { issueKeys: string[]; flag: boolean };
} {
  return { path: AGILE_FLAG_PATH, body: { issueKeys: [issueKey], flag: shouldBeFlagged } };
}

/**
 * Raises or clears the flag, letting Jira decide whether it can be done.
 *
 * The ordinary field update is tried first because it is the sanctioned API and it works wherever the
 * field IS on the edit screen. Where it is not, Jira's own board endpoint is used — the same one its
 * flag button uses, and the reason that button works where a field update does not.
 *
 * A failure of BOTH reports both, because "the field is not on the screen" and whatever the board
 * endpoint said are different facts and either could be the one worth acting on.
 */
export async function setIssueFlag(
  issueKey: string,
  shouldBeFlagged: boolean,
  editMeta: IssueEditMeta,
  discoveredFieldId = '',
): Promise<void> {
  const flagWrite = resolveFlagWrite(editMeta, shouldBeFlagged, discoveredFieldId);

  try {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: { [flagWrite.fieldId]: flagWrite.value },
    });
    return;
  } catch (fieldUpdateError: unknown) {
    const agileRequest = buildAgileFlagRequest(issueKey, shouldBeFlagged);
    try {
      await jiraPost(agileRequest.path, agileRequest.body);
    } catch (agileError: unknown) {
      throw new Error(
        `${String(agileError)} — and updating the field directly also failed: ${String(fieldUpdateError)}`,
      );
    }
  }
}
