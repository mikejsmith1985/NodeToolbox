// featureLinkInheritance.ts — Reading a Feature link off a linked sibling instead of retyping it.
//
// The team splits one piece of work into a [DEV] story and an [SL] test story and links them, but
// only the DEV story carries the Feature link. The SL story is then flagged "missing feature link"
// indefinitely: the AI panel cannot propose one (a Feature link is a lookup, not a judgement, so
// offering it to a model could only ever produce a guess), and fixing it by hand means opening the
// sibling to read a value that is one field away from the flag.
//
// The links are already on the issue — `issuelinks` is in the hygiene scan's base fields — so
// finding the candidates costs nothing. Only reading their Feature link needs a request.
//
// Two rules keep this safe. Candidates are restricted to the SAME PROJECT, because a link to another
// project's issue (a QE clone, say) carries that project's Feature. And siblings that DISAGREE are
// refused outright rather than resolved by preference: a wrong Feature link is not a smaller version
// of a missing one — it misreports on the roll-up board and in everything built from it, while a
// missing one merely stays flagged.

import type { JiraIssueLink } from '../../types/jira.ts';
// The hygiene scan's own issue shape, not the fuller one in types/jira — this reads what the scan
// actually produces, and the two differ (the scan's carries no `id`).
import type { JiraIssue } from './checks/hygieneChecks.ts';

/** One sibling and whatever Feature link it holds. */
export interface LinkedIssueFeatureLink {
  issueKey: string;
  featureLinkValue: string | null;
}

/** The outcome of asking the siblings: a value to write, or the reason there is none. */
export interface InheritedFeatureLinkChoice {
  featureLinkValue: string | null;
  /** Which sibling supplied it, for the confirmation shown before writing. */
  sourceIssueKey: string | null;
  /** Why nothing was chosen — shown instead of a fix, so the gap is explained rather than silent. */
  declinedReason: string | null;
}

/** Reads the project prefix from an issue key: the "ENFCT" of "ENFCT-2042". */
function readProjectKey(issueKey: string): string {
  const separatorIndex = issueKey.lastIndexOf('-');
  return separatorIndex === -1 ? issueKey : issueKey.slice(0, separatorIndex);
}

/**
 * The keys of linked issues in the SAME project as this issue, in link order and de-duplicated.
 *
 * Same project only: a Feature link taken from another project's issue would point at a Feature that
 * does not belong to this one's hierarchy, which is worse than the flag it was meant to clear.
 */
export function readSameProjectLinkedKeys(issue: JiraIssue): string[] {
  const issueLinks = ((issue.fields as { issuelinks?: JiraIssueLink[] })?.issuelinks) ?? [];
  const ownProjectKey = readProjectKey(issue.key);

  const linkedKeys = issueLinks
    .flatMap((issueLink) => [issueLink.inwardIssue?.key, issueLink.outwardIssue?.key])
    .filter((linkedKey): linkedKey is string => typeof linkedKey === 'string' && linkedKey !== '')
    .filter((linkedKey) => linkedKey !== issue.key)
    .filter((linkedKey) => readProjectKey(linkedKey) === ownProjectKey);

  return [...new Set(linkedKeys)];
}

/**
 * Decides which Feature link to inherit, or refuses and says why.
 *
 * Agreement is the whole test: one value across every sibling that has one. Two different Features
 * mean the siblings genuinely belong to different work, and no tie-break — first, newest, most
 * common — is anything but a guess dressed up as a rule.
 */
export function chooseInheritedFeatureLink(
  linkedIssues: readonly LinkedIssueFeatureLink[],
): InheritedFeatureLinkChoice {
  const carriers = linkedIssues.filter((linkedIssue) => (linkedIssue.featureLinkValue ?? '').trim() !== '');
  if (carriers.length === 0) {
    return {
      featureLinkValue: null,
      sourceIssueKey: null,
      declinedReason: 'no linked issue in this project carries a Feature link',
    };
  }

  const distinctValues = [...new Set(carriers.map((carrier) => (carrier.featureLinkValue ?? '').trim()))];
  if (distinctValues.length > 1) {
    return {
      featureLinkValue: null,
      sourceIssueKey: null,
      declinedReason: `linked issues disagree — they name ${distinctValues.join(' and ')}`,
    };
  }

  return {
    featureLinkValue: distinctValues[0],
    sourceIssueKey: carriers[0].issueKey,
    declinedReason: null,
  };
}
