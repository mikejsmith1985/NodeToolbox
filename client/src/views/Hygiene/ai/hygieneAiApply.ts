// hygieneAiApply.ts — Applies ONE accepted AI hygiene proposal to Jira.
//
// This is the write half of the Hygiene AI panel's contract: a proposal does nothing until the
// user accepts it, and accepting writes exactly one thing — one field on one issue, or one nudge
// comment. Every write is delegated to the same proven helpers the inline Fix controls on this
// page already use (featureReviewFixes), so an AI-accepted fix and a hand-typed fix are literally
// the same Jira request.

import { jiraPost } from '../../../services/jiraApi.ts'
import {
  fetchFeatureReviewEditMeta,
  readFeatureReviewSelectOptions,
  saveFeatureReviewFixVersion,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewStoryPoints,
} from '../../SprintDashboard/featureReviewFixes.ts'
import type { BuiltInHygieneCheckId, HygieneFieldConfig } from '../checks/hygieneChecks.ts'
import { HYGIENE_FIX_BY_CHECK, resolveFixFieldId } from '../hygieneFix.ts'
import type { HygieneAiProposal } from './hygieneAiAssist.ts'

/** Posts the stale-ticket nudge as a plain Jira comment on the issue. */
async function postNudgeComment(issueKey: string, commentBody: string): Promise<void> {
  await jiraPost<unknown>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, { body: commentBody })
}

/**
 * Writes a Program Increment proposal. PI fields are usually select-style, so the proposed text
 * must resolve to one of Jira's allowed option values — a near-miss is an error the user sees,
 * never a silent wrong write. Fields without options fall back to a plain field write.
 */
async function applyProgramIncrementProposal(issueKey: string, fieldId: string, proposedValue: string): Promise<void> {
  const editMetaFields = await fetchFeatureReviewEditMeta(issueKey)
  const editMetaField = editMetaFields[fieldId]
  const allowedOptions = readFeatureReviewSelectOptions(editMetaField)
  if (allowedOptions.length === 0) {
    await saveFeatureReviewSimpleField(issueKey, fieldId, proposedValue)
    return
  }

  const normalizedProposal = proposedValue.trim().toLowerCase()
  const matchedOption = allowedOptions.find(
    (option) => option.label.trim().toLowerCase() === normalizedProposal || option.value.trim().toLowerCase() === normalizedProposal,
  )
  if (!matchedOption) {
    const optionPreview = allowedOptions.slice(0, 5).map((option) => option.label).join(', ')
    throw new Error(`"${proposedValue}" is not an allowed value for this field. Allowed values include: ${optionPreview}`)
  }
  await saveFeatureReviewOptionField(issueKey, fieldId, matchedOption.value, editMetaField)
}

/**
 * Applies one accepted proposal via the flag's registered fix route.
 *
 * Throws with a user-readable message when the write cannot be made safely (unconfigured field,
 * value outside the field's allowed options) — the panel shows that message on the proposal row.
 */
export async function applyHygieneAiProposal(
  proposal: HygieneAiProposal,
  fieldConfig: HygieneFieldConfig,
): Promise<void> {
  const { issueKey, checkId, proposedValue } = proposal

  if (checkId === 'stale') {
    await postNudgeComment(issueKey, proposedValue)
    return
  }
  if (checkId === 'missing-sp') {
    await saveFeatureReviewStoryPoints(issueKey, proposedValue)
    return
  }
  if (checkId === 'missing-fix-version') {
    // Jira validates the version name on write; an unknown name surfaces as the request's error.
    await saveFeatureReviewFixVersion(issueKey, proposedValue)
    return
  }

  const descriptor = HYGIENE_FIX_BY_CHECK[checkId as BuiltInHygieneCheckId]
  const fieldId = descriptor ? resolveFixFieldId(descriptor, fieldConfig) : null
  if (!fieldId) {
    throw new Error('This flag has no configured Jira field to write — fix it in Jira instead.')
  }

  if (checkId === 'missing-pi') {
    await applyProgramIncrementProposal(issueKey, fieldId, proposedValue)
    return
  }

  // The remaining accepted checks (summary, acceptance criteria, due/target dates) are plain
  // text/date fields.
  await saveFeatureReviewSimpleField(issueKey, fieldId, proposedValue)
}
