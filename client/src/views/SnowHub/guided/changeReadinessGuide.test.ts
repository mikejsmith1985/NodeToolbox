// changeReadinessGuide.test.ts — Proves every readiness check is explained, under the same name the checklist shows.

import { describe, expect, it } from 'vitest';

import { describeRcpRules, RCP_RULE_TITLES } from '../rcp/rcpRules.ts';
import { buildChangeReadiness, READINESS_ITEM_IDS, type ChangeReadinessFacts } from './changeReadiness.ts';
import { listReadinessRuleGuide } from './changeReadinessGuide.ts';

// Every fact unreadable: each check still returns its item, under its label.
const UNREADABLE_FACTS: ChangeReadinessFacts = {
  change: null, textFields: null, isProduction: null, plannedWindow: null, riskReview: null, isRcpActive: true,
  rcpChecks: null, outageCount: null, ctasks: null, prbs: null, attachmentFileNames: null, failureReasons: {},
};

describe('listReadinessRuleGuide', () => {
  it('explains every check, in checklist order, with something in every part', () => {
    const guide = listReadinessRuleGuide();
    expect(guide.map((entry) => entry.id)).toEqual(READINESS_ITEM_IDS);
    for (const entry of guide) {
      expect(entry.appliesTo).not.toBe('');
      expect(entry.passesWhen).not.toBe('');
      expect(entry.whyItMatters).not.toBe('');
    }
  });

  it('names each check exactly as the checklist does', () => {
    const checklistLabels = buildChangeReadiness(UNREADABLE_FACTS).map((item) => item.label);
    expect(listReadinessRuleGuide().map((entry) => entry.label)).toEqual(checklistLabels);
  });

  it('leaves out the checks a screen does not show', () => {
    const guide = listReadinessRuleGuide(new Set(['riskCheck', 'prbs']));
    expect(guide.map((entry) => entry.id)).not.toContain('riskCheck');
    expect(guide).toHaveLength(READINESS_ITEM_IDS.length - 2);
  });

  it('lists the restricted-period rules under their own check, and gives the reviewer\'s question for a gated section', () => {
    const guide = listReadinessRuleGuide();
    expect(guide.find((entry) => entry.id === 'rcp')?.subRules).toEqual(describeRcpRules());
    expect(guide.find((entry) => entry.id === 'formulaBackout')?.whyItMatters).toMatch(/^Release Management asks: /);
  });
});

describe('describeRcpRules', () => {
  it('describes all five rules from the enforced constants', () => {
    const rules = describeRcpRules();
    expect(rules.map((rule) => rule.title)).toEqual(Object.values(RCP_RULE_TITLES));
    expect(rules[0].passesWhen).toMatch(/Fri, Sat, Sun night \(7 PM to 5 AM Central\)/);
    expect(rules[4].passesWhen).toMatch(/at least 3 business days/);
  });
});
