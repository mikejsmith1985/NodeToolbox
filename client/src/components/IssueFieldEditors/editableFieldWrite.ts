// editableFieldWrite.ts — Sends one edited field to Jira through the right existing writer.
//
// This module decides WHICH writer, never HOW to write. Every branch below ends in a function that
// already shipped and is already exercised by Feature Review, so a field edited from the board and
// the same field edited from Feature Review produce byte-identical requests.
//
// Two branches exist only because Jira's own API is not uniform, and both are load-bearing:
//
//   • fixVersions must go through the `update`/`set` shape, not `fields` — that is what the shipped
//     fix-version writer does, and a plain field write of an array of names is rejected.
//   • story points on this instance are a DROPDOWN, not a number. Writing a raw number to them fails.
//     Its own writer knows that; nothing else does, so the field ids are checked by name here.

import {
  getStoryPointsCandidateFieldIds,
  saveFeatureReviewFixVersion,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewStoryPoints,
  saveFeatureReviewUserField,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import type { EditableFieldPlan } from './editableFieldPlan.ts';

/** Jira's own field id for fix versions, which needs the update-set shape rather than a field write. */
const FIX_VERSIONS_FIELD_ID = 'fixVersions';

/**
 * Which writer a field's plan calls for.
 *
 * Split out from the write itself so the routing can be tested without a network — the routing is
 * the part that can be wrong, and the writers it routes to are already proven.
 */
export type FieldWriteRoute = 'fix-version' | 'story-points' | 'user' | 'option' | 'simple';

/** Picks the writer for one field. Order matters: the two special cases are asked about first. */
export function resolveFieldWriteRoute(fieldPlan: EditableFieldPlan): FieldWriteRoute {
  if (fieldPlan.fieldId === FIX_VERSIONS_FIELD_ID) return 'fix-version';
  if (getStoryPointsCandidateFieldIds().includes(fieldPlan.fieldId)) return 'story-points';
  if (fieldPlan.editorKind === 'user') return 'user';
  if (fieldPlan.editorKind === 'select') return 'option';
  return 'simple';
}

/**
 * Writes one field's new value.
 *
 * Nothing is refused up front. Whether a write lands is Jira's answer to give, and every failure
 * path already exists: the editor keeps the committed value and shows the reason in place.
 */
export async function saveEditableField(
  issueKey: string,
  fieldPlan: EditableFieldPlan,
  nextValue: string,
): Promise<void> {
  switch (resolveFieldWriteRoute(fieldPlan)) {
    case 'fix-version':
      return saveFeatureReviewFixVersion(issueKey, nextValue);
    case 'story-points':
      return saveFeatureReviewStoryPoints(issueKey, nextValue);
    case 'user':
      return saveFeatureReviewUserField(issueKey, fieldPlan.fieldId, nextValue);
    case 'option':
      return saveFeatureReviewOptionField(issueKey, fieldPlan.fieldId, nextValue, fieldPlan.editMetaField);
    default:
      return saveFeatureReviewSimpleField(issueKey, fieldPlan.fieldId, nextValue);
  }
}
