// intakeRuleExport.ts — Handing a whole intake rule set over, and taking one back.
//
// A rule set lives on one machine, is edited over months, and is the thing people actually need to
// compare and reproduce. Until now the only way to share it was a screenshot per rule, which is why
// nobody could answer "do I have duplicates?" or "why does yours cancel things and mine doesn't?"
//
// Two shapes, deliberately: JSON for machines (round-trips exactly, imports back) and a readable
// summary for people (what each rule MATCHES and what it DOES). A JSON dump answers the first
// question badly and the second not at all.

import { validateSerializedRule, type SerializedEmailRule } from '../GithubEmail/lib/githubEmailRules.ts'

/** Marks the payload as a rule export, so an unrelated JSON file is refused rather than imported. */
const RULE_EXPORT_KIND = 'githubEmailRuleExport'

/** Line break for the readable summary — named so no template literal has to carry a raw one. */
const NEWLINE = String.fromCharCode(10)

/** The outcome of reading an export: the usable rules, plus an honest count of what was dropped. */
export interface RuleImportResult {
  ok: boolean
  rules: SerializedEmailRule[]
  /** Rules present in the payload that would not compile and were left out. */
  rejectedCount: number
  message: string
}

/**
 * Serialises the rule set with the build that produced it.
 *
 * `builtInRules` is included because a custom-only export answers the wrong question. What runs on a
 * machine is the custom rules FOLLOWED BY the built-in defaults the operator has not overridden — so
 * an export of three custom rules, reviewed on its own, hides most of what actually classifies email
 * and every status those defaults can move an issue to.
 */
export function buildRuleExport(
  rules: readonly SerializedEmailRule[],
  appVersion: string | null,
  builtInRules: readonly SerializedEmailRule[] = [],
): string {
  const customisedIds = new Set(rules.map((rule) => rule.id))
  const activeBuiltIns = builtInRules.filter((builtInRule) => !customisedIds.has(builtInRule.id))

  return JSON.stringify({
    kind: RULE_EXPORT_KIND,
    appVersion: appVersion ?? 'unknown',
    ruleCount: rules.length,
    rules,
    // Named separately so an import cannot turn a default into a custom rule by accident, while a
    // reviewer still sees everything that runs.
    builtInRuleCount: activeBuiltIns.length,
    builtInRulesStillActive: activeBuiltIns,
  }, null, 2)
}

/**
 * Reads a pasted export back into rules.
 *
 * Validation uses `validateSerializedRule`, NOT `compileCustomRule`. The latter deliberately returns
 * null for a DISABLED rule — correct when deciding what to classify with, and quietly wrong here: it
 * would drop every switched-off rule from an export, so a round trip would lose exactly the rules
 * somebody had chosen to keep but not run.
 *
 * A rule that genuinely fails validation is dropped and COUNTED — one bad entry must not cost the
 * other forty, and a silent loss is worse than either.
 */
export function parseRuleExport(payloadText: string): RuleImportResult {
  let parsedPayload: unknown
  try {
    parsedPayload = JSON.parse(payloadText)
  } catch {
    return { ok: false, rules: [], rejectedCount: 0, message: 'That could not be read as JSON.' }
  }

  const payloadRecord = (parsedPayload ?? {}) as { kind?: unknown; rules?: unknown }
  if (payloadRecord.kind !== RULE_EXPORT_KIND) {
    return { ok: false, rules: [], rejectedCount: 0, message: 'That is not a rule export — the "kind" field does not match.' }
  }

  const candidateRules = Array.isArray(payloadRecord.rules) ? payloadRecord.rules : []
  const compiledRules = candidateRules
    .map((candidate) => ({ candidate, compiled: validateSerializedRule(candidate) }))
  const usableRules = compiledRules
    .filter((entry) => entry.compiled !== null)
    .map((entry) => entry.candidate as SerializedEmailRule)
  const rejectedCount = compiledRules.length - usableRules.length

  return {
    ok: true,
    rules: usableRules,
    rejectedCount,
    message: rejectedCount === 0
      ? `Read ${usableRules.length} rule(s).`
      : `Read ${usableRules.length} rule(s); ${rejectedCount} could not be compiled and were left out.`,
  }
}

/** The actions one rule performs, or a plain statement that it performs none. */
function describeRuleActions(rule: SerializedEmailRule): string {
  const actions = [
    rule.transitionStatus ? `status → ${rule.transitionStatus}` : '',
    rule.parentTransitionStatus ? `parent → ${rule.parentTransitionStatus}` : '',
    rule.parentSubStatusValue ? `sub-status → ${rule.parentSubStatusValue}` : '',
  ].filter((action) => action !== '')

  return actions.length === 0 ? 'comment only' : actions.join(', ')
}

/** What one rule matches on — the half a reader needs to spot two rules catching the same email. */
function describeRuleMatcher(rule: SerializedEmailRule): string {
  const matchers = [
    rule.subjectPattern ? `subject~/${rule.subjectPattern}/` : '',
    rule.bodyPattern ? `body~/${rule.bodyPattern}/` : '',
    (rule.reasonHeaderIn ?? []).length > 0 ? `reason in [${(rule.reasonHeaderIn ?? []).join(', ')}]` : '',
    rule.requiresPrNumber ? 'needs PR number' : '',
  ].filter((matcher) => matcher !== '')

  return matchers.length === 0 ? '(matches nothing on its own)' : matchers.join(' AND ')
}

/**
 * A readable account of the rule set — one block per rule, matcher then actions.
 *
 * Exists beside the JSON because the questions people actually ask ("which rule moves things to
 * Done?", "do these two catch the same email?") are answerable at a glance here and only by careful
 * reading of a JSON dump.
 */
export function summariseRulesForReview(
  rules: readonly SerializedEmailRule[],
  builtInRules: readonly SerializedEmailRule[] = [],
): string {
  const customisedIds = new Set(rules.map((rule) => rule.id))
  const activeBuiltIns = builtInRules.filter((builtInRule) => !customisedIds.has(builtInRule.id))
  const builtInSection = activeBuiltIns.length === 0
    ? []
    : [
      '',
      `Built-in rules still active (${activeBuiltIns.length}) — these run too, after the custom ones:`,
      ...activeBuiltIns.map((rule) => [
        `  ${rule.id}`,
        `      event:   ${rule.eventType}`,
        `      matches: ${describeRuleMatcher(rule)}`,
        `      does:    ${describeRuleActions(rule)}`,
      ].join(NEWLINE)),
    ]

  if (rules.length === 0) {
    return ['No custom rules configured — classification uses the built-in rules only.', ...builtInSection].join(NEWLINE)
  }

  return [
    `Custom intake rules (${rules.length}):`,
    ...rules.map((rule) => [
      `  ${rule.id}${rule.isEnabled === false ? '  [DISABLED]' : ''}`,
      `      event:   ${rule.eventType}`,
      `      matches: ${describeRuleMatcher(rule)}`,
      `      does:    ${describeRuleActions(rule)}`,
    ].join(NEWLINE)),
    ...builtInSection,
  ].join(NEWLINE)
}
