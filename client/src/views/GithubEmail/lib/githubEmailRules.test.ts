// githubEmailRules.test.ts — Guards the classification rule table's shape and ordering. The exact
// markers are finalized from real emails; these invariants keep the table well-formed regardless.

import { describe, expect, it } from 'vitest';

import { GITHUB_EMAIL_RULES, getDefaultSerializedRules } from './githubEmailRules.ts';

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

describe('the deployment rules must be reachable from the Rules panel', () => {
  // The environment rules give each deploy its own id, but the scheduler only reads a transition
  // from a CUSTOM rule matching that id. So they are inert until an operator can seed one — which
  // is the panel's "Customize" action over getDefaultSerializedRules(). If they are missing here,
  // the whole environment distinction classifies correctly and then does nothing.
  it('offers a customizable default for every deployment environment', () => {
    const defaultRuleIds = getDefaultSerializedRules().map((rule) => rule.id)

    expect(defaultRuleIds).toContain('pr-merged-dev')
    expect(defaultRuleIds).toContain('pr-merged-int')
    expect(defaultRuleIds).toContain('pr-merged-rel')
    expect(defaultRuleIds).toContain('pr-merged-prd')
  })

  it('serializes each one with a body pattern that survives the JSON round trip', () => {
    const prodRule = getDefaultSerializedRules().find((rule) => rule.id === 'pr-merged-prd')
    const restored = new RegExp(JSON.parse(JSON.stringify(prodRule)).bodyPattern, 'i')

    expect(restored.test('Merged #967 into prd.')).toBe(true)
    expect(restored.test('Merged #967 into dev.')).toBe(false)
  })

  it('places every environment rule ahead of the generic merge rule', () => {
    // First match wins. Below it, the generic rule would swallow every deploy before its own rule
    // was reached, and all four environments would collapse back into one action.
    const ruleIds = GITHUB_EMAIL_RULES.map((rule) => rule.id)
    const genericMergeIndex = ruleIds.indexOf('pr-merged')

    for (const environmentId of ['dev', 'int', 'rel', 'prd']) {
      expect(ruleIds.indexOf(`pr-merged-${environmentId}`)).toBeLessThan(genericMergeIndex)
    }
  })
})
