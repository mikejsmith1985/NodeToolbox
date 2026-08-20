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
import { deriveIssueDates, readDrivingFixVersion } from '../checks/issueDateRules.ts'
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
 * Status-name fragments that mean the issue is deliberately parked. A stale NUDGE on a blocked
 * issue is noise, not hygiene — the assignee already knows why it isn't moving — so those issues
 * never get a stale ask at all. Mirrors the blocked detection the Today tab uses.
 */
const BLOCKED_STATUS_FRAGMENTS = ['blocked', 'impeded', 'on hold'] as const
/** Per-comment excerpt cap for the stale conversation — enough to judge, not the whole essay. */
const LAST_COMMENT_EXCERPT_LENGTH = 300

/**
 * The flags the AI may propose fixes for, with the per-flag instruction the prompt carries.
 *
 * Deliberately only the field-writable ones plus a stale-nudge comment: flags that are a human
 * judgement call (who should own this?) or that are fixed on a different issue entirely are not
 * offered to the model — a proposal there could only ever be a guess.
 *
 * The DATE flags are here, and how they are asked matters. They were first listed with the team's
 * policy spelled out — "21 calendar days before the fix version release date", "two working days
 * after Ready to Work" — while the per-issue block carried no fix version, no release date and no
 * status history. The model did as it was told and omitted everything, replying
 * `{"kind":"hygiene","items":[]}` to fifty-three issues.
 *
 * They were then removed altogether on the reasoning that a formula beats an LLM. That was the wrong
 * call: it answered a question nobody asked and took away a route somebody relies on.
 *
 * `dates-out-of-sync` is NOT offered, for a different reason: it covers three fields at once, so an
 * accepted proposal has no single field to write to and the apply path would refuse it. The three
 * specific missing-date fixes cover the same ground with a target each, and the deterministic
 * "Fix all date mismatches" button handles the combined case.
 *
 * The fix is to hand the model the ANSWER rather than the arithmetic. `buildFindingBlock` computes
 * the policy value with the same module the deterministic fix uses and states it in the prompt, so a
 * proposal cannot be unanswerable and cannot disagree with the button beside it. A date the policy
 * cannot derive is said to be underivable, which is an instruction to omit, not to guess.
 */
export const AI_FIXABLE_CHECK_INSTRUCTIONS: Record<string, string> = {
  'missing-summary': 'propose a concise, specific summary (one line).',
  'no-ac': 'propose acceptance criteria in Given/When/Then form based on the description.',
  'missing-fix-version': 'choose one of the release names listed for that project — never invent one.',
  'missing-pi': 'propose the Program Increment value exactly as used on sibling issues.',
  'missing-sp': 'propose a story-point estimate as a plain number.',
  // Each date fix carries its policy value in the issue block; the model copies it, never computes it.
  'missing-due-date': 'copy the "policy value for Due Date" shown for that issue, exactly. Omit the fix if none is shown.',
  'missing-target-start': 'copy the "policy value for Target Start" shown for that issue, exactly. Omit the fix if none is shown, which is usual: that date comes from the status history.',
  'missing-target-end': 'copy the "policy value for Target End" shown for that issue, exactly. Omit the fix if none is shown.',
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

/** One comment in a stale issue's recent conversation. */
export interface StaleIssueComment {
  author: string | null
  date: string | null
  body: string
}

/**
 * A stale issue's recent conversation (oldest first), fetched on demand so the model can judge a
 * nudge's worth. Several comments, not just the last: a bare "Thank you" on top of "pushed to dev,
 * ready for internal testing" explains the wait perfectly well — one comment alone does not.
 */
export interface StaleIssueContext {
  recentComments: StaleIssueComment[]
}

// ── Prompt ──

/** True when the issue sits in a deliberately-parked status (blocked / impeded / on hold). */
export function isBlockedStatusIssue(finding: HygieneFinding): boolean {
  const statusName = (finding.issue.fields.status?.name ?? '').toLowerCase()
  return BLOCKED_STATUS_FRAGMENTS.some((blockedFragment) => statusName.includes(blockedFragment))
}

/**
 * The flags the AI will actually be asked about for this finding.
 *
 * The stale ask is dropped outright for blocked-status issues — that exclusion is deterministic
 * app data, so it is enforced here rather than hoped for in the prompt (GH #167 follow-up: "don't
 * ask for an update when the ticket already says why it's waiting").
 */
export function readAiFixableFlags(
  finding: HygieneFinding,
  /**
   * The checks the page is currently filtered to, or empty for "no filter".
   *
   * A run over an unfiltered board produced a 181,411-character prompt against a 128,000-character
   * input box, so the paste was simply refused (GH #375). Most of that bulk was answers nobody was
   * looking at: filtering to stale issues and then being asked about every missing estimate and
   * every absent acceptance criterion as well. Someone reading one flag is working on one flag.
   */
  restrictToCheckIds: readonly string[] = [],
): HygieneFinding['flags'] {
  return finding.flags.filter((flag) => {
    if (!(flag.checkId in AI_FIXABLE_CHECK_INSTRUCTIONS)) return false
    if (restrictToCheckIds.length > 0 && !restrictToCheckIds.includes(flag.checkId)) return false
    if (flag.checkId === 'stale' && isBlockedStatusIssue(finding)) return false
    return true
  })
}

/** True when this finding carries at least one flag the AI is allowed to propose a fix for. */
export function hasAiFixableFlags(finding: HygieneFinding, restrictToCheckIds: readonly string[] = []): boolean {
  return readAiFixableFlags(finding, restrictToCheckIds).length > 0
}

/** The stale ask's context lines: current status plus the recent conversation, oldest first. */
function buildStaleContextLines(finding: HygieneFinding, staleContext: StaleIssueContext | undefined): string[] {
  const statusName = finding.issue.fields.status?.name ?? '(unknown)'
  const recentComments = staleContext?.recentComments ?? []
  if (recentComments.length === 0) {
    return [`    status: ${statusName}`, '    recent comments: (none)']
  }
  return [
    `    status: ${statusName}`,
    '    recent comments (oldest first):',
    ...recentComments.map((comment) =>
      `      - (${comment.author ?? 'unknown'}, ${comment.date ?? 'undated'}) ${comment.body.slice(0, LAST_COMMENT_EXCERPT_LENGTH)}`,
    ),
  ]
}

/** One issue's block: identity and signals on the header, the fixable flags as numbered asks. */
function buildFindingBlock(
  finding: HygieneFinding,
  staleContextsByKey: Record<string, StaleIssueContext>,
  restrictToCheckIds: readonly string[] = [],
): string {
  const issueFields = finding.issue.fields
  const fixableFlags = readAiFixableFlags(finding, restrictToCheckIds)
  const isStaleAsked = fixableFlags.some((flag) => flag.checkId === 'stale')
  const rawDescription = typeof issueFields.description === 'string' ? issueFields.description : ''
  const descriptionExcerpt = rawDescription.slice(0, DESCRIPTION_EXCERPT_LENGTH)

  const lines = [
    `- ${finding.issue.key} · ${issueFields.issuetype?.name ?? 'issue'} · ${issueFields.summary ?? '(no summary)'}`,
    `    description: ${descriptionExcerpt.trim() || '(none in Jira)'}`,
    finding.programIncrement ? `    program increment: ${finding.programIncrement}` : '',
    ...buildDatePolicyLines(finding, fixableFlags),
    ...(isStaleAsked ? buildStaleContextLines(finding, staleContextsByKey[finding.issue.key]) : []),
    `    fixes needed:`,
    ...fixableFlags.map((flag) => `      * ${flag.checkId}: ${AI_FIXABLE_CHECK_INSTRUCTIONS[flag.checkId]}`),
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * The date facts one issue's block carries: the release it is committed to, and the value the policy
 * says each flagged date should hold.
 *
 * Computed with the SAME `deriveIssueDates` the deterministic fix uses, so the proposal the model
 * copies and the value the "Fix all" button writes are the same number by construction rather than
 * by two implementations happening to agree.
 *
 * Target Start needs the changelog entry for "Ready to Work", which the scan does not fetch — so it
 * is reported as underivable here and left to the inline fix, which reads it per issue. Saying so is
 * the point: a blank line invites a guess, and a guessed commitment date is indistinguishable from a
 * real one once written.
 */
function buildDatePolicyLines(finding: HygieneFinding, fixableFlags: readonly { checkId: string }[]): string[] {
  const dateCheckIds = ['missing-due-date', 'missing-target-end', 'missing-target-start', 'dates-out-of-sync']
  if (!fixableFlags.some((flag) => dateCheckIds.includes(flag.checkId))) {
    return []
  }

  const issueFields = finding.issue.fields as unknown as Record<string, unknown>
  const fixVersions = (issueFields.fixVersions ?? []) as Array<{ name?: string; releaseDate?: string; released?: boolean }>
  const drivingFixVersion = readDrivingFixVersion(fixVersions)
  const derived = deriveIssueDates({
    fixVersions,
    readyToWorkEnteredIso: null,
    currentDueDate: null,
    currentTargetStart: null,
    currentTargetEnd: null,
  })

  return [
    drivingFixVersion
      ? `    fix version: ${drivingFixVersion.name} (releases ${drivingFixVersion.releaseDate})`
      : '    fix version: none with a release date — every date below cannot be derived',
    derived.dueDate ? `    policy value for Due Date: ${derived.dueDate}` : '    Due Date cannot be derived — omit that fix',
    derived.targetEnd ? `    policy value for Target End: ${derived.targetEnd}` : '    Target End cannot be derived — omit that fix',
    // Target Start comes from the issue's status history, which the scan does not fetch — the inline
    // fix reads it per issue. Saying so is an instruction to omit, not an invitation to estimate.
    '    Target Start cannot be derived here (needs the issue status history) — omit that fix',
  ]
}

/**
 * Builds the single prompt covering every AI-fixable flag currently on the page.
 *
 * Findings whose flags are all outside the AI's remit are omitted entirely — the model should
 * never see an issue it has nothing to propose for. Stale asks carry the issue's status and last
 * comment (when supplied) so the model can decline to nudge a ticket that already explains itself.
 */
/**
 * The agent's input box refuses a longer paste. Measured, not guessed: a whole-board run reported
 * "181,411 / 128,000 — Character limit exceeded" (GH #375). The budget sits below the limit so the
 * few characters a chat client adds around a paste cannot push a fitting prompt back over it.
 */
export const DEFAULT_PROMPT_CHARACTER_BUDGET = 120_000

/**
 * The guidance on judging a stale thread. Hoisted out of the template so the character budget can
 * reserve its exact length rather than an estimate — a guess here reappears as a prompt that
 * overshoots the agent's input box by a few hundred characters and is refused all over again.
 */
const STALE_JUDGEMENT_RULES = `  - For "stale" fixes: read the issue's status and its recent comments — the WHOLE conversation,
    not just the newest line (a bare "thanks" often sits on top of the comment that explains
    everything). If the thread already explains why the ticket is waiting (blocked by other work,
    waiting on a dependency or another team, queued or ready for testing, deprioritized, scheduled
    for later), OMIT the stale fix for that issue — asking for an update the ticket has already
    given is noise, not hygiene. Only propose a nudge when the thread is genuinely silent about
    why it has stalled.
`

/** The ", " that joins one more key onto the "keys you may use" list. */
const KEY_LIST_SEPARATOR_LENGTH = 2

/** Covers the handful of characters the issue COUNT in the header grows by as issues are added. */
const BUDGET_SAFETY_MARGIN = 16

/** How the caller narrows the prompt: to the page's filter, and to what the agent will accept. */
export interface HygieneAiPromptOptions {
  /** Check ids the page is filtered to. Empty means "no filter — ask about every fixable flag". */
  restrictToCheckIds?: readonly string[]
  maxCharacterCount?: number
}

/** A built prompt together with an honest account of the issues it could not carry. */
export interface HygieneAiPromptPlan {
  promptText: string
  /** Issues actually described in the prompt. */
  includedCount: number
  /**
   * The keys the prompt carried. The reply parser trusts THIS, not the page's full key list — an
   * issue trimmed for budget must not have a proposal accepted for it from a stale earlier reply.
   */
  includedIssueKeys: string[]
  /** Issues left out to stay inside the budget — never silently dropped. */
  omittedCount: number
}

/**
 * Builds the prompt, narrowed to the page's filter and trimmed to fit the agent's input box.
 *
 * Issues are kept in the order given — the order on screen — so what survives is the top of the
 * list the user is looking at rather than an arbitrary subset. Whole issues are dropped, never part
 * of one: a half-described issue invites a proposal made from half the facts.
 *
 * The count that could not be carried is RETURNED rather than swallowed. A prompt that quietly
 * covers 60 of 300 issues reads exactly like one that covers all of them, and the difference is
 * only discovered when the missing 240 turn up unfixed weeks later.
 */
export function buildHygieneAiPromptPlan(
  findings: readonly HygieneFinding[],
  options: HygieneAiPromptOptions = {},
  staleContextsByKey: Record<string, StaleIssueContext> = {},
  openVersionNamesByProject: Record<string, readonly string[]> = {},
): HygieneAiPromptPlan {
  const restrictToCheckIds = options.restrictToCheckIds ?? []
  const characterBudget = options.maxCharacterCount ?? DEFAULT_PROMPT_CHARACTER_BUDGET
  const fixableFindings = findings.filter((finding) => hasAiFixableFlags(finding, restrictToCheckIds))

  const renderAll = () => renderPrompt(fixableFindings, staleContextsByKey, openVersionNamesByProject, restrictToCheckIds)
  const wholeSetPrompt = renderAll()
  if (wholeSetPrompt.length <= characterBudget) {
    return {
      promptText: wholeSetPrompt,
      includedCount: fixableFindings.length,
      includedIssueKeys: fixableFindings.map((finding) => finding.issue.key),
      omittedCount: 0,
    }
  }

  // Cost is measured per issue against an EMPTY scaffold rather than by trimming the full prompt,
  // because an issue costs the prompt twice: its description block, and its key in the "keys you may
  // use" list. Reserving the full 400-key list up front would price out issues that comfortably fit
  // once the list shrinks with them.
  const emptyScaffoldLength = renderPrompt([], staleContextsByKey, openVersionNamesByProject, restrictToCheckIds).length
  const perFindingCosts = fixableFindings.map((finding) =>
    buildFindingBlock(finding, staleContextsByKey, restrictToCheckIds).length + 1
    + finding.issue.key.length + KEY_LIST_SEPARATOR_LENGTH)

  const isStaleAskedAnywhere = fixableFindings.some((finding) =>
    readAiFixableFlags(finding, restrictToCheckIds).some((flag) => flag.checkId === 'stale'))
  const staleGuidanceReserve = isStaleAskedAnywhere ? STALE_JUDGEMENT_RULES.length : 0

  let remainingCharacters = characterBudget - emptyScaffoldLength - staleGuidanceReserve - BUDGET_SAFETY_MARGIN
  let includedCount = 0
  while (includedCount < perFindingCosts.length && perFindingCosts[includedCount] <= remainingCharacters) {
    remainingCharacters -= perFindingCosts[includedCount]
    includedCount += 1
  }

  const chosenFindings = fixableFindings.slice(0, includedCount)
  return {
    promptText: renderPrompt(chosenFindings, staleContextsByKey, openVersionNamesByProject, restrictToCheckIds),
    includedCount,
    includedIssueKeys: chosenFindings.map((finding) => finding.issue.key),
    omittedCount: fixableFindings.length - includedCount,
  }
}

export function buildHygieneAiPrompt(
  findings: readonly HygieneFinding[],
  staleContextsByKey: Record<string, StaleIssueContext> = {},
  /**
   * The open releases each project actually has, keyed by project.
   *
   * Without this the model was told to "propose the fix version NAME exactly as it would appear in
   * Jira" and had nothing to go on, so it invented plausible-looking names — "PY 2027 AEP" — which
   * Jira then rejected with a 400. A model cannot guess a release schedule; it can pick from one.
   */
  openVersionNamesByProject: Record<string, readonly string[]> = {},
  options: HygieneAiPromptOptions = {},
): string {
  return buildHygieneAiPromptPlan(findings, options, staleContextsByKey, openVersionNamesByProject).promptText
}

/** Renders the prompt for an already-chosen set of findings. Pure string assembly, no selection. */
function renderPrompt(
  chosenFindings: readonly HygieneFinding[],
  staleContextsByKey: Record<string, StaleIssueContext>,
  openVersionNamesByProject: Record<string, readonly string[]>,
  restrictToCheckIds: readonly string[],
): string {
  const fixableFindings = chosenFindings
  const issueKeyList = fixableFindings.map((finding) => finding.issue.key).join(', ')
  // Seven lines of guidance on judging a stale thread are worth their length when a nudge is being
  // asked for and are pure noise when one is not — which is every run filtered to another flag.
  const isAnyStaleAsked = fixableFindings.some((finding) =>
    readAiFixableFlags(finding, restrictToCheckIds).some((flag) => flag.checkId === 'stale'))
  const staleRulesSection = isAnyStaleAsked ? STALE_JUDGEMENT_RULES : ''
  const releaseLines = Object.entries(openVersionNamesByProject)
    .filter(([, versionNames]) => versionNames.length > 0)
    .map(([projectKey, versionNames]) => `  ${projectKey}: ${versionNames.join(' | ')}`)
  const releaseSection = releaseLines.length > 0
    ? '\n\nOpen releases per project — a fix version MUST be copied exactly from this list:\n'
      + releaseLines.join('\n')
    : '\n\nNo release list was available, so OMIT every fix-version fix rather than guessing a name.'

  return `You are helping clean up Jira issue-health ("hygiene") flags. For each issue below, propose a
concrete value for each listed fix. A human reviews every proposal and accepts or declines it
individually before anything is written.

Rules:
  - Use only the issue keys listed below. Never invent an issue or a key.
  - Dates must be YYYY-MM-DD. Story points must be a plain positive number.
  - Keep field values under ${MAX_AI_FIX_VALUE_LENGTH} characters.${isAnyStaleAsked ? ` A nudge comment may run to ${MAX_AI_COMMENT_LENGTH}.` : ''}
  - Omit a fix entirely when the context is not enough to propose responsibly — a human has to
    catch every bad guess, so say nothing rather than guess.
${staleRulesSection}  - Give a one-line "rationale" per fix so the reviewer understands your reasoning.

Issues (${fixableFindings.length}):
${fixableFindings.map((finding) => buildFindingBlock(finding, staleContextsByKey, restrictToCheckIds)).join('\n')}

Issue keys you may use: ${issueKeyList}${releaseSection}

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
