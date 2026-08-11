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
 * and without the PI it falls outside the dashboard's scope entirely and appears nowhere at all.
 *
 * Neither value is shaped here. The PI field goes through `resolvePiFieldUpdateValue` and the Feature
 * Link through `buildFeatureFieldUpdateFields` — the same writers the PI closeout remap already uses
 * against this instance. Re-deriving either would be a second opinion about a shape the app has
 * already settled, and the two could drift.
 *
 * @returns The update payload, or null when there is nothing this instance will accept — the caller
 *          skips the request instead of sending an empty edit.
 */
export function buildBoardVisibilityPayload(
  fields: BoardVisibilityFields,
  shapePiValue: (piValue: string) => unknown,
  shapeFeatureLink: (featureLinkFieldId: string, featureKey: string) => Record<string, unknown>,
): { fields: Record<string, unknown> } | null {
  const updateFields: Record<string, unknown> = {};

  if (fields.featureLinkFieldId && fields.featureKey.trim() !== '') {
    Object.assign(updateFields, shapeFeatureLink(fields.featureLinkFieldId, fields.featureKey.trim()));
  }
  if (fields.piFieldId && fields.piValue.trim() !== '') {
    updateFields[fields.piFieldId] = shapePiValue(fields.piValue.trim());
  }

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
