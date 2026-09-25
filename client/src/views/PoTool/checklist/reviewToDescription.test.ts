// reviewToDescription.test.ts — Writing a description means writing all of it, so these prove the Epic keeps
// everything it already said and never accumulates a stack of contradictory reviews.

import { describe, expect, it } from 'vitest';

import { appendReviewToDescription, describeWriteRefusal, hasExistingReview } from './reviewToDescription.ts';
import { MAX_JIRA_DESCRIPTION_CHARS } from '../ai/featureEnrichMerge.ts';

const EXISTING_DESCRIPTION = '<p dir="auto">EAM Upgrade - implement the incomplete mapping.</p>';
const REVIEW_HTML = '<h1>Readiness review</h1><p>Definition of Ready: NOT MET</p>';

describe('appendReviewToDescription', () => {
  it('keeps what the Epic already said, and puts the review after it', () => {
    const updated = appendReviewToDescription(EXISTING_DESCRIPTION, REVIEW_HTML);

    expect(updated.startsWith(EXISTING_DESCRIPTION)).toBe(true);
    expect(updated).toContain(REVIEW_HTML);
  });

  it('replaces a review written earlier instead of stacking a second one', () => {
    const once = appendReviewToDescription(EXISTING_DESCRIPTION, REVIEW_HTML);
    const twice = appendReviewToDescription(once, '<h1>Readiness review</h1><p>Definition of Ready: MET</p>');

    expect(twice.match(/<h1>Readiness review<\/h1>/g)).toHaveLength(1);
    expect(twice).toContain('Definition of Ready: MET');
    expect(twice).not.toContain('Definition of Ready: NOT MET');
    expect(twice).toContain('EAM Upgrade - implement the incomplete mapping.');
  });

  it('is just the review when the Epic has no description yet', () => {
    expect(appendReviewToDescription('', REVIEW_HTML)).toContain(REVIEW_HTML);
    expect(appendReviewToDescription('', REVIEW_HTML).startsWith('<!-- nodetoolbox')).toBe(true);
  });

  it('says whether a description already carries a review', () => {
    expect(hasExistingReview(EXISTING_DESCRIPTION)).toBe(false);
    expect(hasExistingReview(appendReviewToDescription(EXISTING_DESCRIPTION, REVIEW_HTML))).toBe(true);
  });
});

describe('describeWriteRefusal', () => {
  it('allows a description that fits', () => {
    expect(describeWriteRefusal(EXISTING_DESCRIPTION, REVIEW_HTML)).toBeNull();
  });

  it('refuses one Jira would reject, saying how much has to come out', () => {
    const hugeDescription = 'x'.repeat(MAX_JIRA_DESCRIPTION_CHARS - 50);

    const refusal = describeWriteRefusal(hugeDescription, REVIEW_HTML);

    expect(refusal).toContain('Jira allows 32,767');
    expect(refusal).toMatch(/would have to come out/);
  });

  it('measures the result, not the review, so re-running a review does not refuse itself', () => {
    // The Epic already carries a review that nearly fills the field. Replacing it is not adding to it.
    const nearlyFullReview = `<p>${'y'.repeat(MAX_JIRA_DESCRIPTION_CHARS - 200)}</p>`;
    const descriptionWithReview = appendReviewToDescription(EXISTING_DESCRIPTION, nearlyFullReview);

    expect(describeWriteRefusal(descriptionWithReview, REVIEW_HTML)).toBeNull();
  });
});
