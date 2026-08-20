// featureLinkInheritFix.ts — The one-click "take the Feature link from the linked story" fix.
//
// Pairs the pure decision in `featureLinkInheritance.ts` with the two things it cannot do: read the
// siblings' Feature link, and write the chosen one. Both are delegated — the read is a plain issue
// GET, the write is the same `saveFeatureReviewIssueLinkField` the manual picker already uses, so an
// inherited link and a hand-picked one are literally the same Jira request.

import { jiraGet } from '../../services/jiraApi.ts';
import { saveFeatureReviewIssueLinkField } from '../SprintDashboard/featureReviewFixes.ts';
import {
  chooseInheritedFeatureLink,
  readSameProjectLinkedKeys,
  type InheritedFeatureLinkChoice,
} from './featureLinkInheritance.ts';
import type { JiraIssue } from './checks/hygieneChecks.ts';

/**
 * Reads one issue's Feature link, whatever shape Jira returns it in.
 *
 * The field is configured per instance and comes back either as a bare issue key or as an object
 * carrying one, depending on how the custom field is defined. Reading only the string form would
 * silently report "no Feature link" on an issue that plainly has one.
 */
function readFeatureLinkValue(fieldValue: unknown): string | null {
  if (typeof fieldValue === 'string') {
    return fieldValue.trim() === '' ? null : fieldValue.trim();
  }
  const linkedKey = (fieldValue as { key?: unknown } | null)?.key;
  return typeof linkedKey === 'string' && linkedKey.trim() !== '' ? linkedKey.trim() : null;
}

/**
 * Works out which Feature link this issue should inherit, without writing anything.
 *
 * An issue with no same-project link costs NO request — the links are already on the issue from the
 * hygiene scan, so the common "nothing to inherit" case is answered locally.
 *
 * A sibling that cannot be read counts as carrying no Feature link rather than failing the fix: a
 * permission error on one linked issue is ordinary, and it must not cost the value a readable
 * sibling would have supplied.
 */
export async function planInheritedFeatureLink(
  issue: JiraIssue,
  featureLinkFieldId: string,
): Promise<InheritedFeatureLinkChoice> {
  const linkedKeys = readSameProjectLinkedKeys(issue);
  if (linkedKeys.length === 0) {
    return chooseInheritedFeatureLink([]);
  }

  const linkedIssues = await Promise.all(linkedKeys.map(async (linkedKey) => {
    try {
      const response = await jiraGet<{ fields?: Record<string, unknown> }>(
        `/rest/api/2/issue/${encodeURIComponent(linkedKey)}?fields=${encodeURIComponent(featureLinkFieldId)}`,
      );
      return { issueKey: linkedKey, featureLinkValue: readFeatureLinkValue(response.fields?.[featureLinkFieldId]) };
    } catch {
      return { issueKey: linkedKey, featureLinkValue: null };
    }
  }));

  return chooseInheritedFeatureLink(linkedIssues);
}

/**
 * Writes the inherited Feature link, or throws with the reason none could be inherited.
 *
 * Throwing rather than returning quietly is deliberate: the caller is an inline Fix button, and a
 * button that reports success after writing nothing is how a hundred issues stay wrong while looking
 * fixed. The message names the actual obstacle, so "they disagree" reads differently from "there is
 * nothing to copy" — the first needs a human decision, the second needs a link.
 */
export async function applyInheritedFeatureLink(
  issue: JiraIssue,
  featureLinkFieldId: string,
): Promise<InheritedFeatureLinkChoice> {
  const plan = await planInheritedFeatureLink(issue, featureLinkFieldId);
  if (plan.featureLinkValue === null) {
    throw new Error(`Cannot copy a Feature link: ${plan.declinedReason}.`);
  }

  await saveFeatureReviewIssueLinkField(issue.key, featureLinkFieldId, plan.featureLinkValue);
  return plan;
}
