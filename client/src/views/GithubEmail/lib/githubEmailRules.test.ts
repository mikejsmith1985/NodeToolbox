// githubEmailRules.test.ts — Guards the classification rule table's shape and ordering. The exact
// markers are finalized from real emails; these invariants keep the table well-formed regardless.

import { describe, expect, it } from 'vitest';

import { GITHUB_EMAIL_RULES } from './githubEmailRules.ts';

describe('GITHUB_EMAIL_RULES', () => {
  it('every rule has a stable id, an event type, and at least one predicate', () => {
    for (const rule of GITHUB_EMAIL_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.eventType).toBeTruthy();
      const hasPredicate = Boolean(rule.reasonHeaderIn || rule.subjectMarker || rule.bodyMarker);
      expect(hasPredicate).toBe(true);
    }
  });

  it('rule ids are unique', () => {
    const ids = GITHUB_EMAIL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the merge rule is ordered before the opened rule (a merge email also mentions the PR)', () => {
    const mergedIndex = GITHUB_EMAIL_RULES.findIndex((rule) => rule.eventType === 'pr_merged');
    const openedIndex = GITHUB_EMAIL_RULES.findIndex((rule) => rule.eventType === 'pr_opened');
    expect(mergedIndex).toBeGreaterThanOrEqual(0);
    expect(mergedIndex).toBeLessThan(openedIndex);
  });
});
