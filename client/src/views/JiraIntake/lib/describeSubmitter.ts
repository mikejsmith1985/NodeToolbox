// describeSubmitter.ts — Builds the wiki-markup "origin note" prepended to an issue's description
// when the submitter could not be matched to a Jira user, so the request's origin is never lost
// (spec Story D / FR-3.2). Pure (no I/O). See contracts/intake-contracts.md §C.

import type { IntakeSubmission } from './intakeTypes.ts';

/** Renders "who submitted this" from the available identity, handling missing name/email. */
function describeRequester(displayName: string, email: string): string {
  if (displayName && email) {
    return `*${displayName}* (${email})`;
  }
  if (displayName) {
    return `*${displayName}*`;
  }
  if (email) {
    return email;
  }
  return 'an unknown requester';
}

/**
 * Returns a Jira wiki-markup quote block recording that the request came from Teams and who sent
 * it. Intended to be prepended to the mapped description on the integration-account fallback path.
 */
export function describeSubmitter(submission: IntakeSubmission): string {
  const requester = describeRequester(submission.submitter.displayName.trim(), submission.submitter.email.trim());
  return `{quote}\nSubmitted via Teams by ${requester}\n{quote}`;
}
