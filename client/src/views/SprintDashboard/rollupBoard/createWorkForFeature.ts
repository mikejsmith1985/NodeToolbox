// createWorkForFeature.ts — Builds the payloads for adding a new issue under a Feature on the board.
//
// Creating work from the board is only worth doing if the new issue APPEARS on the board afterwards.
// That is not automatic: this board's scope is `<PI field> = "PI 26.4"`, and its lanes come from the
// Feature Link field, so an issue created with neither is invisible the moment it is saved — the exact
// failure that hid ENCUC-2208 and DENP-1387 for a whole PI. Both are therefore set from the lane and
// the current scope rather than left for someone to remember.
//
// Creation happens in two steps, and this module builds both. Step one carries only what Jira always
// accepts (project, type, summary) so the issue reliably exists; step two applies the Feature Link and
// PI. Splitting them means a rejected custom field leaves a real, findable issue behind rather than
// failing the whole action — and the caller can say exactly which half worked.

// ── Named constants ──

/** Jira schema types this module knows how to shape a value for. */
const OPTION_SCHEMA_TYPE = 'option';
const STRING_SCHEMA_TYPE = 'string';
const ARRAY_SCHEMA_TYPE = 'array';

/** One field as the create/edit metadata describes it. */
export interface CreateMetaFieldShape {
  schema?: { type?: string; custom?: string };
  allowedValues?: Array<{ id?: string; value?: string; name?: string }>;
}

// ── Step one: the issue itself ──

export interface NewWorkRequest {
  projectKey: string;
  issueTypeId: string;
  summary: string;
}

/**
 * Builds the create payload, carrying only the three things Jira accepts on every screen.
 *
 * Nothing instance-specific goes in here on purpose. A custom field that is not on the project's create
 * screen makes Jira reject the whole request, and a create that fails takes the summary the person just
 * typed with it.
 */
export function buildNewWorkPayload(request: NewWorkRequest): { fields: Record<string, unknown> } {
  return {
    fields: {
      project: { key: request.projectKey },
      issuetype: { id: request.issueTypeId },
      summary: request.summary.replace(/\s+/g, ' ').trim(),
    },
  };
}

/** True when the request has everything Jira needs; the caller must not send an incomplete one. */
export function isNewWorkRequestComplete(request: NewWorkRequest): boolean {
  return request.projectKey.trim() !== ''
    && request.issueTypeId.trim() !== ''
    && request.summary.trim() !== '';
}

// ── Step two: making it visible on this board ──

/**
 * Shapes one field value the way its own metadata says Jira wants it.
 *
 * The same logical value is written three different ways depending on the field: a select wants
 * `{ value }`, a text field wants the bare string, and a multi-select wants an array of those objects.
 * Guessing produces a 400 that reads like a permissions problem, so the schema decides.
 *
 * @returns The shaped value, or null when this instance does not offer the field at all — the caller
 *          then omits it rather than writing something Jira will refuse.
 */
export function shapeFieldValue(
  fieldShape: CreateMetaFieldShape | undefined,
  rawValue: string,
): unknown | null {
  if (!fieldShape || rawValue.trim() === '') return null;

  const schemaType = String(fieldShape.schema?.type ?? '');

  if (schemaType === OPTION_SCHEMA_TYPE) {
    return { value: rawValue };
  }
  if (schemaType === ARRAY_SCHEMA_TYPE) {
    return [{ value: rawValue }];
  }
  if (schemaType === STRING_SCHEMA_TYPE || schemaType === '') {
    return rawValue;
  }
  // Anything else (issue links, versions, users) is written as a plain string, which is how this
  // instance's Feature Link field behaves; a wrong guess surfaces as Jira's own message.
  return rawValue;
}

export interface BoardVisibilityFields {
  featureLinkFieldId: string;
  featureKey: string;
  piFieldId: string;
  piValue: string;
}

/**
 * Builds the follow-up edit that makes a new issue visible on this board.
 *
 * Both fields matter for a different reason: without the Feature Link the issue lands in "No Feature",
 * and without the PI it is outside the dashboard's scope entirely and appears nowhere at all.
 *
 * @returns The update payload, or null when there is nothing this instance will accept — the caller
 *          skips the request instead of sending an empty edit.
 */
export function buildBoardVisibilityPayload(
  fields: BoardVisibilityFields,
  fieldShapesById: Record<string, CreateMetaFieldShape | undefined>,
): { fields: Record<string, unknown> } | null {
  const updateFields: Record<string, unknown> = {};

  const featureLinkValue = fields.featureLinkFieldId
    ? shapeFieldValue(fieldShapesById[fields.featureLinkFieldId], fields.featureKey)
    : null;
  if (featureLinkValue !== null) updateFields[fields.featureLinkFieldId] = featureLinkValue;

  const piValue = fields.piFieldId
    ? shapeFieldValue(fieldShapesById[fields.piFieldId], fields.piValue)
    : null;
  if (piValue !== null) updateFields[fields.piFieldId] = piValue;

  return Object.keys(updateFields).length > 0 ? { fields: updateFields } : null;
}

/**
 * Says plainly which parts of the creation worked.
 *
 * A half-finished create is the outcome most likely to mislead: the issue exists, so "failed" is wrong,
 * but it will not appear on this board, so "done" is worse.
 */
export function describeCreationOutcome(
  createdIssueKey: string,
  wasMadeVisible: boolean,
  visibilityError: string | null,
): string {
  if (wasMadeVisible) {
    return `${createdIssueKey} created and linked — it should appear on this board now.`;
  }
  return `${createdIssueKey} was created, but its Feature Link and PI could not be set`
    + `${visibilityError ? ` (${visibilityError})` : ''},`
    + ' so it will not show on this board until those are filled in.';
}
