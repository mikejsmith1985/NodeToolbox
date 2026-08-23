// fixVersionInheritance.ts — Taking the release off the parent Feature instead of hunting for it.
//
// Every date the tool derives hangs off ONE input: the release the work is committed to. An issue
// with no fix version therefore gets no Due date, no Target End and no Target Start — one blank
// field silently costs three. And the answer is almost never in doubt: a story belongs to the
// release its Feature belongs to.
//
// The Feature's own version is chosen by `readDrivingFixVersion`, the same function the date policy
// uses to decide which version dates an issue. That is the point of importing it rather than picking
// the first: a child that inherits a DIFFERENT version from the one its dates would be derived from
// is a bug that only shows up weeks later, as a date nobody can explain.

import {
  explainMissingDrivingFixVersion,
  readDrivingFixVersion,
  type IssueFixVersion,
} from './checks/issueDateRules.ts';

/** The outcome of asking the Feature: a version name to write, or the reason there is none. */
export interface InheritedFixVersionChoice {
  /** The version name to set on the child, or null when nothing can be inherited. */
  fixVersionName: string | null;
  /** Which Feature supplied it, for the confirmation shown before writing. */
  sourceIssueKey: string | null;
  /** Why nothing was chosen — shown instead of a fix, so the gap is explained rather than silent. */
  declinedReason: string | null;
}

/**
 * Decides which fix version to inherit from a parent Feature, or refuses and says why.
 *
 * A Feature that cannot date its own work cannot date its children's either, so the refusal reuses
 * the date policy's own explanation — meaning the child's flag and the Feature's flag always give
 * the same account of the same problem.
 */
export function chooseInheritedFixVersion(
  sourceIssueKey: string | null,
  sourceFixVersions: readonly IssueFixVersion[],
): InheritedFixVersionChoice {
  if (sourceIssueKey === null || sourceIssueKey.trim() === '') {
    return {
      fixVersionName: null,
      sourceIssueKey: null,
      declinedReason: 'the issue has no Feature link to copy a release from',
    };
  }

  const drivingFixVersion = readDrivingFixVersion(sourceFixVersions);
  if (drivingFixVersion === null) {
    return {
      fixVersionName: null,
      sourceIssueKey,
      declinedReason: `${sourceIssueKey} cannot supply one: ${explainMissingDrivingFixVersion(sourceFixVersions)}`,
    };
  }

  const versionName = (drivingFixVersion.name ?? '').trim();
  if (versionName === '') {
    // Jira allows a nameless version, and the write is BY NAME. Refusing beats writing an empty one.
    return {
      fixVersionName: null,
      sourceIssueKey,
      declinedReason: `${sourceIssueKey}'s fix version has no name to copy`,
    };
  }

  return { fixVersionName: versionName, sourceIssueKey, declinedReason: null };
}
