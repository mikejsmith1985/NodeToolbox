// reviewToDescription.ts — Puts the readiness review on the Epic itself, at the end of its description.
//
// Copying the report out and pasting it in never rendered: this Jira's rich-text editor stores HTML, so a
// Markdown or wiki-markup paste arrives as the characters themselves. Writing it directly sidesteps the
// clipboard entirely — Toolbox appends the review as HTML, which is what the field already holds.
//
// Writing a description means writing ALL of it, so the two rules here are the same ones the checklist tick
// follows: everything already in the description comes back untouched, and running the review again REPLACES its
// own block rather than stacking a second copy under the first.

import { checkDescriptionLength, MAX_JIRA_DESCRIPTION_CHARS } from '../ai/featureEnrichMerge.ts';

/** Wraps the written review so a later run can find its own block and replace it. */
const REVIEW_BLOCK_START = '<!-- nodetoolbox:readiness-review -->';
const REVIEW_BLOCK_END = '<!-- /nodetoolbox:readiness-review -->';

/** Removes a block this tool wrote earlier, leaving everything else exactly as it was. */
function removeExistingReview(description: string): string {
  const blockPattern = new RegExp(`\\s*${REVIEW_BLOCK_START}[\\s\\S]*?${REVIEW_BLOCK_END}`, 'g');
  return description.replace(blockPattern, '').trimEnd();
}

/** Whether this description already carries a review Toolbox wrote. */
export function hasExistingReview(description: string): boolean {
  return description.includes(REVIEW_BLOCK_START);
}

/**
 * Appends the review to the end of a description, replacing a review written earlier.
 *
 * Idempotent on purpose: a PO re-runs a review after fixing what it found, and an Epic carrying three
 * contradictory reviews is worse than one carrying none.
 */
export function appendReviewToDescription(existingDescription: string, reviewHtml: string): string {
  const descriptionWithoutReview = removeExistingReview(existingDescription);
  const reviewBlock = [REVIEW_BLOCK_START, reviewHtml, REVIEW_BLOCK_END].join('\n');

  return descriptionWithoutReview === '' ? reviewBlock : `${descriptionWithoutReview}\n${reviewBlock}`;
}

/** Why a review cannot be written, in the PO's terms, or null when it can. */
export function describeWriteRefusal(existingDescription: string, reviewHtml: string): string | null {
  const wouldBeDescription = appendReviewToDescription(existingDescription, reviewHtml);
  const lengthCheck = checkDescriptionLength(wouldBeDescription);

  if (!lengthCheck.isOverLimit) {
    return null;
  }
  return `Adding the review would make the description ${lengthCheck.length.toLocaleString()} characters. `
    + `Jira allows ${MAX_JIRA_DESCRIPTION_CHARS.toLocaleString()}, so ${lengthCheck.excessCharacters.toLocaleString()} `
    + 'would have to come out of the Epic first.';
}
