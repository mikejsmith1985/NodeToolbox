// intakeRuleExport.test.ts — Handing a whole rule set over, and taking one back.
//
// A rule set lives on one machine and is the thing people need to compare, review, and reproduce.
// Without an export the only way to share it was a screenshot per rule.

import { describe, expect, it } from 'vitest'

import { buildRuleExport, parseRuleExport, summariseRulesForReview } from './intakeRuleExport.ts'
import type { SerializedEmailRule } from '../GithubEmail/lib/githubEmailRules.ts'

const RULES: SerializedEmailRule[] = [
  {
    id: 'org-pr-merged', eventType: 'pr_merged', bodyPattern: 'merged commit', requiresPrNumber: true,
    transitionStatus: 'Done', parentTransitionStatus: 'Ready for Testing', parentSubStatusValue: 'Dev Complete',
  },
  { id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', isEnabled: false },
]

describe('buildRuleExport', () => {
  it('produces JSON that parses back to the same rules', () => {
    const parsed = parseRuleExport(buildRuleExport(RULES, '0.210.0'))
    expect(parsed.ok).toBe(true)
    expect(parsed.rules.map((rule) => rule.id)).toEqual(['org-pr-merged', 'org-pr-opened'])
  })

  it('stamps the build that produced it, so an old export is recognisable', () => {
    expect(buildRuleExport(RULES, '0.210.0')).toContain('0.210.0')
  })
})

describe('parseRuleExport', () => {
  it('refuses a payload that is not a rule export rather than importing rubbish', () => {
    const parsed = parseRuleExport('{"kind":"somethingElse","rules":[]}')
    expect(parsed.ok).toBe(false)
    expect(parsed.message).toMatch(/not a rule export/i)
  })

  it('refuses text that is not JSON at all, and says so', () => {
    expect(parseRuleExport('not json').message).toMatch(/could not be read/i)
  })

  it('drops a rule that would not compile and reports how many, rather than failing the whole import', () => {
    // One bad rule must not cost the other forty. The count is reported so the loss is never silent.
    const payload = JSON.stringify({
      kind: 'githubEmailRuleExport',
      rules: [RULES[0], { id: '', eventType: 'pr_opened' }],
    })
    const parsed = parseRuleExport(payload)
    expect(parsed.ok).toBe(true)
    expect(parsed.rules).toHaveLength(1)
    expect(parsed.rejectedCount).toBe(1)
  })
})

describe('summariseRulesForReview', () => {
  it('lays out each rule\'s matcher and every action it takes', () => {
    // The review question is "what does this rule DO" — event, status, parent status, sub-status —
    // which is exactly what a raw JSON dump makes hard to read at a glance.
    const summary = summariseRulesForReview(RULES)
    expect(summary).toContain('org-pr-merged')
    expect(summary).toContain('pr_merged')
    expect(summary).toContain('status → Done')
    expect(summary).toContain('parent → Ready for Testing')
    expect(summary).toContain('sub-status → Dev Complete')
  })

  it('marks a disabled rule, which otherwise reads as active', () => {
    expect(summariseRulesForReview(RULES)).toContain('DISABLED')
  })

  it('says a rule sets no status rather than leaving the line blank', () => {
    expect(summariseRulesForReview([RULES[1]])).toContain('comment only')
  })

  it('reports an empty rule set as empty', () => {
    expect(summariseRulesForReview([])).toContain('No custom rules')
  })
})
