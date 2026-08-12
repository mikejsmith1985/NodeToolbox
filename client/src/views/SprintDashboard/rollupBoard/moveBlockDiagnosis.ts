// moveBlockDiagnosis.ts — Turning a refused card move into something a person can act on.
//
// When Jira will not accept a move, what comes back is written for whoever wrote the workflow:
// `Error: 400 {"errors":{"customfield_10002":"Story Points is required."}}`. Shown as-is on a card,
// that tells the user their drag failed and nothing else — not which field, not that they could fix
// it in two seconds, not where.
//
// So the raw refusal is read here and turned into three things: a headline naming the issue and where
// it was going, an explanation in the user's own vocabulary, and — where the field can be answered
// without leaving the board — the fields themselves, so "Story Points is required" arrives with a
// story-points dropdown attached rather than an instruction to go and find one.
//
// Two refusals cannot be fixed on the spot and say so plainly instead of pretending: a workflow with
// no such transition (the status simply cannot be reached from where the card is), and a field whose
// input shape the board cannot honestly render.

import type {
  FeatureReviewEditMetaField,
  TransitionRequiredField,
} from '../featureReviewFixes.ts';

/** Why a move was refused, in the board's own terms. */
export type MoveBlockKind =
  /** Jira's transition screen declared fields up front — the clean case. */
  | 'screen-fields-required'
  /** Jira accepted the request then rejected it, naming fields in prose. */
  | 'fields-required-after-attempt'
  /** The workflow has no path from where this card is to where it was dropped. */
  | 'no-such-transition'
  /** Something else went wrong; the raw text is all there is. */
  | 'unknown';

export interface MoveBlockDiagnosis {
  kind: MoveBlockKind;
  /** One line naming the issue and the move that was attempted. */
  headline: string;
  /** What actually stopped it, in plain words. */
  explanation: string;
  /** What the user can do, most useful first. */
  whatToDo: string[];
  /** The field names Jira asked for, whether or not the board can render them. */
  requiredFieldNames: string[];
}

/**
 * The field names inside a Jira rejection.
 *
 * Jira states this several ways depending on the endpoint and version, so all the common shapes are
 * read rather than the one seen most recently: the errors map (`"customfield_10002":"Story Points is
 * required."`), the prose list ("The following fields are required: A, B"), and the bare sentence
 * ("Story Points is required").
 */
export function parseRequiredFieldNames(errorText: string): string[] {
  const rawText = String(errorText ?? '');
  const fieldNames = new Set<string>();

  // "The following fields are required: Story Points, Fix Version" — take the list after the colon.
  const listMatch = /following fields? (?:are|is) required:?\s*([^"}\]\n]+)/i.exec(rawText);
  if (listMatch) {
    for (const namePart of listMatch[1].split(/,| and /)) {
      const fieldName = namePart.trim().replace(/[.;]+$/, '');
      if (fieldName !== '') fieldNames.add(fieldName);
    }
  }

  // '"customfield_10002":"Story Points is required."' and plain "Story Points is required".
  for (const sentenceMatch of rawText.matchAll(/([A-Za-z][A-Za-z0-9 _/&'-]{1,60}?)\s+is required/gi)) {
    const fieldName = sentenceMatch[1].trim().replace(/^["':,]+/, '').trim();
    // A capture that swallowed the leading JSON key is not a field name the user would recognise.
    if (fieldName !== '' && !/^customfield_\d+$/i.test(fieldName)) fieldNames.add(fieldName);
  }

  return [...fieldNames];
}

/**
 * Finds the editable fields behind the names Jira used.
 *
 * Jira names fields in prose but writes them by id, so the issue's own edit metadata is the bridge —
 * and using the issue's metadata rather than a fixed list is what makes this work on an instance whose
 * story-points field is not the standard one.
 */
export function matchEditMetaFieldsByName(
  editMeta: Record<string, FeatureReviewEditMetaField | undefined> | null,
  fieldNames: readonly string[],
): TransitionRequiredField[] {
  if (editMeta === null) return [];

  const wantedNames = new Set(fieldNames.map((fieldName) => fieldName.trim().toLowerCase()));
  const matchedFields: TransitionRequiredField[] = [];

  for (const [fieldId, editMetaField] of Object.entries(editMeta)) {
    const fieldName = editMetaField?.name ?? '';
    if (!wantedNames.has(fieldName.trim().toLowerCase())) continue;

    matchedFields.push({
      fieldId,
      name: fieldName,
      schemaType: (editMetaField?.allowedValues ?? []).length > 0 ? 'option' : 'string',
      allowedValues: editMetaField?.allowedValues ?? [],
    });
  }

  return matchedFields;
}

export interface DiagnoseMoveBlockInput {
  issueKey: string;
  issueSummary: string;
  targetColumnName: string;
  currentStatusName: string;
  /** Named up front by the transition screen; empty when Jira only complained afterwards. */
  screenRequiredFields: readonly TransitionRequiredField[];
  /** Jira's raw refusal, or '' when the transition screen declared its fields up front. */
  errorText: string;
  /** Statuses this card CAN reach from where it is, so a dead end can suggest a live one. */
  reachableStatusNames: readonly string[];
}

/** Names a list of things the way a person would say it out loud. */
function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Reads a move refusal and says what happened and what to do about it. */
export function diagnoseMoveBlock(input: DiagnoseMoveBlockInput): MoveBlockDiagnosis {
  const headline = `${input.issueKey} could not move to “${input.targetColumnName}”`;

  if (input.screenRequiredFields.length > 0) {
    const fieldNames = input.screenRequiredFields.map((field) => field.name);
    return {
      kind: 'screen-fields-required',
      headline,
      explanation: `Jira asks for ${joinNames(fieldNames)} before anything may enter this status.`,
      whatToDo: ['Answer the fields below, then complete the move.'],
      requiredFieldNames: fieldNames,
    };
  }

  const isNoTransition = /no such transition|does not allow moving/i.test(input.errorText);
  if (isNoTransition) {
    const explanation = `The workflow has no step from “${input.currentStatusName}” to this column,`
      + ' so Jira will not accept the move however the fields are filled in.';
    const whatToDo = input.reachableStatusNames.length > 0
      ? [
        `From “${input.currentStatusName}” this issue can only go to ${joinNames([...input.reachableStatusNames])}.`,
        'Move it there first, or ask a Jira admin to add the step you expected.',
      ]
      : ['This issue has no available transitions at all — it may be closed, or you may not have permission to move it.'];

    return { kind: 'no-such-transition', headline, explanation, whatToDo, requiredFieldNames: [] };
  }

  const requiredFieldNames = parseRequiredFieldNames(input.errorText);
  if (requiredFieldNames.length > 0) {
    return {
      kind: 'fields-required-after-attempt',
      headline,
      explanation: `Jira rejected the move because ${joinNames(requiredFieldNames)}`
        + ` ${requiredFieldNames.length === 1 ? 'is' : 'are'} missing on ${input.issueKey}.`,
      whatToDo: ['Fill in the fields below and the move will be retried automatically.'],
      requiredFieldNames,
    };
  }

  return {
    kind: 'unknown',
    headline,
    explanation: 'Jira refused the move without naming a reason the board can interpret.',
    whatToDo: [
      `Open ${input.issueKey} and try the same move in Jira — its own error message is usually more specific.`,
      input.errorText.trim() === '' ? 'No further detail was returned.' : `Jira said: ${input.errorText.trim()}`,
    ],
    requiredFieldNames: [],
  };
}
