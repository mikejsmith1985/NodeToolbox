// intakeLabel.ts — The dedup stamp: a Jira label `intake-<submissionId>` placed on every issue
// Toolbox creates, so an existing issue can be found by label before creating a duplicate. Pure
// (no I/O). See spec 006 data-model §1 and research R1.

/** Prefix that identifies a submission-dedup label. */
export const INTAKE_LABEL_PREFIX = 'intake-';

/** Jira labels cannot contain whitespace; a submission id with any is not stampable as-is. */
const WHITESPACE_PATTERN = /\s/;

/** True when a submission id can be encoded as a valid Jira label (non-empty, no whitespace). */
export function isStampableId(submissionId: string): boolean {
  const trimmed = submissionId.trim();
  return trimmed !== '' && !WHITESPACE_PATTERN.test(trimmed);
}

/** Builds the dedup label for a submission id, or null when the id cannot form a valid label. */
export function buildIntakeLabel(submissionId: string): string | null {
  const trimmed = submissionId.trim();
  if (!isStampableId(trimmed)) {
    return null;
  }
  return `${INTAKE_LABEL_PREFIX}${trimmed}`;
}

/**
 * Returns the submission id encoded in a set of labels (the first `intake-` label with its prefix
 * stripped), or null when none of the labels is a dedup stamp.
 */
export function extractSubmissionId(labels: string[]): string | null {
  const stamp = labels.find((label) => label.startsWith(INTAKE_LABEL_PREFIX) && label.length > INTAKE_LABEL_PREFIX.length);
  return stamp ? stamp.slice(INTAKE_LABEL_PREFIX.length) : null;
}
