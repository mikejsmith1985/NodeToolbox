// hygieneAiAssist.ts — The Hygiene AI prompt, and the parser that reads the reply back.
//
// Two pure functions with no React and no I/O, mirroring the PI Review AI module (the house
// pattern): the panel builds ONE prompt covering every AI-fixable flag on the page, an external
// agent replies with the shared {kind, items[]} envelope, and each proposal is then accepted or
// declined individually — nothing reaches Jira without a per-item human click.
//
// Parsing is lenient per field, strict per key: one malformed proposal must not throw away the
// rest, but an item naming an issue that is not on the page is reported and dropped, never applied.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts'
import type { HygieneFinding } from '../checks/hygieneChecks.ts'

// ── Constants ──

/** The envelope's kind. A reply that echoes anything else is a wrong reply, not a partial one. */
const HYGIENE_AI_REPLY_KIND = 'hygiene'
/** Longest field value the AI may propose — matches the house cap in the PI Review module. */
export const MAX_AI_FIX_VALUE_LENGTH = 300
/** A stale-nudge comment can breathe a little more than a field value. */
export const MAX_AI_COMMENT_LENGTH = 600
/** How much of an issue description the prompt carries — enough context, not the whole novel. */
const DESCRIPTION_EXCERPT_LENGTH = 400
/** Values a model uses to mean "nothing to say" — they must never reach a field. */
const BLANKISH_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--', 'tbd', 'unknown'])
/** ISO date shape the date-fix checks require (Jira's own field format). */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The flags the AI may propose fixes for, with the per-flag instruction the prompt carries.
 *
 * Deliberately only the field-writable ones plus a stale-nudge comment: flags that are a human
 * judgement call (who should own this?) or that are fixed on a different issue entirely are not
 * offered to the model — a proposal there could only ever be a guess.
 */
export const AI_FIXABLE_CHECK_INSTRUCTIONS: Record<string, string> = {
  'missing-summary': 'propose a concise, specific summary (one line).',
  'no-ac': 'propose acceptance criteria in Given/When/Then form based on the description.',
  'missing-due-date': 'propose a due date as YYYY-MM-DD, reasoned from the issue context.',
  'missing-target-start': 'propose a target start date as YYYY-MM-DD.',
  'missing-target-end': 'propose a target end date as YYYY-MM-DD (after the start).',
  'missing-fix-version': 'propose the fix version NAME exactly as it would appear in Jira.',
  'missing-pi': 'propose the Program Increment value exactly as used on sibling issues.',
  'missing-sp': 'propose a story-point estimate as a plain number.',
  stale: 'propose a short, polite nudge comment asking the assignee for a status update (it will be posted as a Jira comment).',
}

// ── Types ──

/** One AI-proposed fix for one flag on one issue, awaiting the user's accept/decline. */
export interface HygieneAiProposal {
  issueKey: string
  checkId: string
  /** The value to write (field text, YYYY-MM-DD, a number for points, or the comment body). */
  proposedValue: string
  /** Shown beside the proposal so accepting is never a blind click. Never written to Jira. */
  rationale: string | null
}

/** The outcome of parsing one reply: what is usable, and an honest account of what was not. */
export interface HygieneAiRunResult {
  proposals: HygieneAiProposal[]
  /** Keys the reply named that are not on the page — reported, never applied. */
  unknownKeys: string[]
  /** Items or fixes that yielded nothing usable. */
  unparsedCount: number
}

// ── Prompt ──

/** True when this finding carries at least one flag the AI is allowed to propose a fix for. */
export function hasAiFixableFlags(finding: HygieneFinding): boolean {
  return finding.flags.some((flag) => flag.checkId in AI_FIXABLE_CHECK_INSTRUCTIONS)
}

/** One issue's block: identity and signals on the header, the fixable flags as numbered asks. */
function buildFindingBlock(finding: HygieneFinding): string {
  const issueFields = finding.issue.fields
  const fixableFlags = finding.flags.filter((flag) => flag.checkId in AI_FIXABLE_CHECK_INSTRUCTIONS)
  const rawDescription = typeof issueFields.description === 'string' ? issueFields.description : ''
  const descriptionExcerpt = rawDescription.slice(0, DESCRIPTION_EXCERPT_LENGTH)

  const lines = [
    `- ${finding.issue.key} · ${issueFields.issuetype?.name ?? 'issue'} · ${issueFields.summary ?? '(no summary)'}`,
    `    description: ${descriptionExcerpt.trim() || '(none in Jira)'}`,
    finding.programIncrement ? `    program increment: ${finding.programIncrement}` : '',
    `    fixes needed:`,
    ...fixableFlags.map((flag) => `      * ${flag.checkId}: ${AI_FIXABLE_CHECK_INSTRUCTIONS[flag.checkId]}`),
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * Builds the single prompt covering every AI-fixable flag currently on the page.
 *
 * Findings whose flags are all outside the AI's remit are omitted entirely — the model should
 * never see an issue it has nothing to propose for.
 */
export function buildHygieneAiPrompt(findings: readonly HygieneFinding[]): string {
  const fixableFindings = findings.filter(hasAiFixableFlags)
  const issueKeyList = fixableFindings.map((finding) => finding.issue.key).join(', ')

  return `You are helping clean up Jira issue-health ("hygiene") flags. For each issue below, propose a
concrete value for each listed fix. A human reviews every proposal and accepts or declines it
individually before anything is written.

Rules:
  - Use only the issue keys listed below. Never invent an issue or a key.
  - Dates must be YYYY-MM-DD. Story points must be a plain positive number.
  - Keep field values under ${MAX_AI_FIX_VALUE_LENGTH} characters; a stale-nudge comment under ${MAX_AI_COMMENT_LENGTH}.
  - Omit a fix entirely when the context is not enough to propose responsibly — a human has to
    catch every bad guess, so say nothing rather than guess.
  - Give a one-line "rationale" per fix so the reviewer understands your reasoning.

Issues (${fixableFindings.length}):
${fixableFindings.map(buildFindingBlock).join('\n')}

Issue keys you may use: ${issueKeyList}

Reply with this JSON object and nothing else:
{
  "kind": "hygiene",
  "items": [
    {
      "issueKey": "<one of the keys above>",
      "fixes": [
        { "checkId": "<one of the fix ids listed for that issue>", "value": "<proposed value>", "rationale": "<one line>" }
      ]
    }
  ]
}`
}

// ── Parsing ──

/** Trims, drops "nothing to say" values, and caps length so a field can never become unbounded. */
function readValueField(rawValue: unknown, maxLength: number): string | null {
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return null
  }
  const trimmedValue = String(rawValue).trim()
  if (BLANKISH_VALUES.has(trimmedValue.toLowerCase())) {
    return null
  }
  return trimmedValue.length > maxLength ? `${trimmedValue.slice(0, maxLength)}…` : trimmedValue
}

/** Validates the proposed value against the shape its check requires; null means "unusable". */
function readProposalValue(checkId: string, rawValue: unknown): string | null {
  const maxLength = checkId === 'stale' ? MAX_AI_COMMENT_LENGTH : MAX_AI_FIX_VALUE_LENGTH
  const value = readValueField(rawValue, maxLength)
  if (value === null) {
    return null
  }
  if (checkId === 'missing-due-date' || checkId === 'missing-target-start' || checkId === 'missing-target-end') {
    return ISO_DATE_PATTERN.test(value) ? value : null
  }
  if (checkId === 'missing-sp') {
    const parsedPoints = Number(value)
    return Number.isFinite(parsedPoints) && parsedPoints > 0 ? String(parsedPoints) : null
  }
  return value
}

/**
 * Parses an AI reply into per-fix proposals, plus an honest account of what could not be used.
 *
 * Throws only for a reply that is wholly wrong — not JSON, or echoing another surface's kind.
 * Every other problem degrades per item or per fix rather than discarding the page's work.
 */
export function parseHygieneAiReply(
  replyText: string,
  knownIssueKeys: readonly string[],
): HygieneAiRunResult {
  const parsedEnvelope = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>
  if (parsedEnvelope.kind !== HYGIENE_AI_REPLY_KIND) {
    throw new Error(
      `Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${HYGIENE_AI_REPLY_KIND}".`,
    )
  }

  const knownKeysUpper = new Set(knownIssueKeys.map((issueKey) => issueKey.toUpperCase()))
  const rawItems = Array.isArray(parsedEnvelope.items) ? parsedEnvelope.items : []

  const proposals: HygieneAiProposal[] = []
  const unknownKeys: string[] = []
  let unparsedCount = 0

  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null) {
      unparsedCount += 1
      continue
    }
    const item = rawItem as Record<string, unknown>
    const issueKey = typeof item.issueKey === 'string' ? item.issueKey.trim().toUpperCase() : ''
    if (issueKey === '') {
      unparsedCount += 1
      continue
    }
    if (!knownKeysUpper.has(issueKey)) {
      unknownKeys.push(issueKey)
      continue
    }

    const rawFixes = Array.isArray(item.fixes) ? item.fixes : []
    for (const rawFix of rawFixes) {
      if (typeof rawFix !== 'object' || rawFix === null) {
        unparsedCount += 1
        continue
      }
      const fix = rawFix as Record<string, unknown>
      const checkId = typeof fix.checkId === 'string' ? fix.checkId.trim() : ''
      if (!(checkId in AI_FIXABLE_CHECK_INSTRUCTIONS)) {
        unparsedCount += 1
        continue
      }
      const proposedValue = readProposalValue(checkId, fix.value)
      if (proposedValue === null) {
        unparsedCount += 1
        continue
      }
      proposals.push({
        issueKey,
        checkId,
        proposedValue,
        rationale: readValueField(fix.rationale, MAX_AI_FIX_VALUE_LENGTH),
      })
    }
  }

  return { proposals, unknownKeys, unparsedCount }
}
