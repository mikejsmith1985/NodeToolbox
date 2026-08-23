// fixVersionInheritFix.ts — The one-click "take the release from the parent Feature" fix.
//
// Pairs the pure decision in `fixVersionInheritance.ts` with the two things it cannot do: read the
// Feature's fix versions, and write the chosen one. Both are delegated — the read is a plain issue
// GET, the write is the same `saveFeatureReviewFixVersion` the manual picker already uses, so an
// inherited release and a hand-picked one are literally the same Jira request.
//
// Why this fix exists at all: a missing fix version costs THREE dates, not one. Due, Target End and
// Target Start all hang off the release, so the bulk date fix reports an issue as undatable when the
// only thing actually missing is a field its Feature already holds.

import { jiraGet } from '../../services/jiraApi.ts';
import { saveFeatureReviewFixVersion } from '../SprintDashboard/featureReviewFixes.ts';
import { chooseInheritedFixVersion, type InheritedFixVersionChoice } from './fixVersionInheritance.ts';
import type { IssueFixVersion } from './checks/issueDateRules.ts';
import type { HygieneFieldConfig, JiraIssue } from './checks/hygieneChecks.ts';

/**
 * The Feature (or parent) this issue hangs off, whatever shape the link field returns.
 *
 * The configured field comes back either as a bare issue key or as an object carrying one, and
 * reading only the string form would report "no Feature" on an issue that plainly has one. Falls
 * back to the native parent, which is the link a sub-task or a team-managed story actually uses.
 */
export function readParentFeatureKey(issue: JiraIssue, fieldConfig: HygieneFieldConfig): string | null {
  for (const featureFieldId of fieldConfig.featureLinkFieldIds) {
    if (featureFieldId === 'parent') continue;
    const rawFieldValue = (issue.fields as unknown as Record<string, unknown>)[featureFieldId];
    if (typeof rawFieldValue === 'string' && rawFieldValue.includes('-')) return rawFieldValue.trim();
    const linkedKey = (rawFieldValue as { key?: unknown } | null)?.key;
    if (typeof linkedKey === 'string' && linkedKey.trim() !== '') return linkedKey.trim();
  }
  return issue.fields.parent?.key ?? null;
}

/**
 * Works out which release this issue should inherit, without writing anything.
 *
 * An issue with no Feature link costs NO request — the link is already on the issue from the hygiene
 * scan, so the common "nothing to inherit" case is answered locally.
 *
 * A Feature that cannot be read counts as carrying no release rather than failing the fix: a
 * permission error on one Feature is ordinary, and the button simply does not appear.
 */
export async function planInheritedFixVersion(
  issue: JiraIssue,
  fieldConfig: HygieneFieldConfig,
): Promise<InheritedFixVersionChoice> {
  const parentFeatureKey = readParentFeatureKey(issue, fieldConfig);
  if (parentFeatureKey === null) {
    return chooseInheritedFixVersion(null, []);
  }

  try {
    const response = await jiraGet<{ fields?: { fixVersions?: IssueFixVersion[] } }>(
      `/rest/api/2/issue/${encodeURIComponent(parentFeatureKey)}?fields=fixVersions`,
    );
    return chooseInheritedFixVersion(parentFeatureKey, response.fields?.fixVersions ?? []);
  } catch {
    return chooseInheritedFixVersion(parentFeatureKey, []);
  }
}

/**
 * Writes the inherited release, or throws with the reason none could be inherited.
 *
 * Throwing rather than returning quietly is deliberate: the caller is an inline Fix button, and a
 * button that reports success after writing nothing is how a hundred issues stay wrong while looking
 * fixed. The message names the actual obstacle, so "the Feature has no release date either" reads
 * differently from "there is no Feature" — those need different people.
 */
export async function applyInheritedFixVersion(
  issue: JiraIssue,
  fieldConfig: HygieneFieldConfig,
): Promise<InheritedFixVersionChoice> {
  const plan = await planInheritedFixVersion(issue, fieldConfig);
  if (plan.fixVersionName === null) {
    throw new Error(`Cannot copy a release: ${plan.declinedReason}.`);
  }

  await saveFeatureReviewFixVersion(issue.key, plan.fixVersionName);
  return plan;
}
