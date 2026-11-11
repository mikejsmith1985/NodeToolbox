// piReviewAiAssist.ts — The PI Review AI prompt, and the parser that reads the reply back.
//
// Two pure functions with no React and no I/O, so the decisions they encode can be tested in
// milliseconds. Those decisions are what make the feature safe:
//
//   • The model returns a SIZE, never a point number. Points are derived here from the shared scale,
//     so a model has no channel through which to contradict the rubric.
//   • Parsing is lenient per field, strict per key. One bad enum must not throw away every good
//     suggestion across a whole PI — but an item naming a Feature that is not on the page is
//     reported and dropped, never applied.
//
// The reply envelope is the {kind, items[]} shape the Canvas, Aging triage and Personal Flow
// surfaces already use. Google's AI Mode — the team's only assistant (GH #499) — ignores JSON, so
// the prompt ends with a fill-in table listing every Feature; the shared record reader turns that
// table back into the same envelope, and a JSON reply from any other assistant is still read.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  type ReplyRecordColumn,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts'
import {
  FEATURE_SIZING_SCALE,
  isFeatureSizeName,
  readPointsForSize,
  type FeatureSizeName,
} from './piReviewSizing.ts'
import type { PiReviewAiFeatureContext } from './piReviewAiFetch.ts'

// ── Constants ──

/** The envelope's kind. A reply that echoes anything else is a wrong reply, not a partial one. */
const PI_REVIEW_REPLY_KIND = 'piReview'
/**
 * The longest note text the AI may contribute to a cell, matching the house constant
 * MAX_TEXT_SIGNAL_LENGTH in FeatureCanvas/ai/canvasAiAssist.ts. This is the notes column's first
 * length cap: nothing bounds it today, and Confluence renders the whole cell on one line, so an
 * uncapped reply could publish an unbounded wall of text.
 */
export const MAX_AI_NOTE_LENGTH = 300
/** Values a model uses to mean "nothing to say" — they must never reach a cell. */
const BLANKISH_NOTE_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--', 'tbd', 'unknown'])
// A "|" or line break inside a summary would split its table row, so it is written as a space.
const TABLE_CELL_BREAKING_PATTERN = /[|\r\n]+/g
/** The line the reply's table follows, so the reader can skip any intro the assistant writes first. */
const PI_REVIEW_REPLY_MARKER = 'PI_REVIEW_TABLE:'

// The fill-in table's columns. Dev Work and Test Support are only asked for when the page has them.
const ISSUE_KEY_COLUMN: ReplyRecordColumn = { field: 'issueKey', header: 'Issue key' }
const FEATURE_NAME_COLUMN: ReplyRecordColumn = { field: 'summary', header: 'Feature', isNamingOnly: true }
const SIZE_COLUMN: ReplyRecordColumn = { field: 'size', header: 'Size', answerHint: 'XS, S, M, L, XL or XXL — a size, never a point number' }
const DEV_WORK_COLUMN: ReplyRecordColumn = {
  field: 'devWork', header: 'Dev work', valueKind: 'boolean', answerHint: 'Yes when our team builds it, No when not, ___ when the material does not say',
}
const TEST_SUPPORT_COLUMN: ReplyRecordColumn = {
  field: 'testSupport', header: 'Test support', valueKind: 'boolean',
  answerHint: 'Yes when we ONLY help test another team\'s build, No when not, ___ when the material does not say',
}
const NOTE_COLUMNS: readonly ReplyRecordColumn[] = [
  { field: 'riskNote', header: 'Risk note', answerHint: 'why this is risky' },
  { field: 'dependencyNote', header: 'Dependency note', answerHint: 'why the dependency matters' },
  { field: 'implementationNote', header: 'Implementation note', answerHint: 'what the ART/RTE should know' },
  { field: 'rationale', header: 'Why this size', answerHint: 'one line on why this size' },
]

/** Every column the reader accepts — a reply carrying a box the page lacks is read, and the tab ignores it. */
const PI_REVIEW_READ_SPEC: ReplyRecordSpec = {
  kind: PI_REVIEW_REPLY_KIND,
  replyMarker: PI_REVIEW_REPLY_MARKER,
  columns: [ISSUE_KEY_COLUMN, FEATURE_NAME_COLUMN, SIZE_COLUMN, DEV_WORK_COLUMN, TEST_SUPPORT_COLUMN, ...NOTE_COLUMNS],
}

// ── Types ──

/** Where a suggestion sits in the review lifecycle. Only `accepted` has touched a row. */
export type PiReviewSuggestionState = 'pending' | 'needsPoints' | 'accepted' | 'rejected'

/** One AI result for one Feature. On acceptance it may touch only pointEstimate and notes. */
export interface PiReviewAiSuggestion {
  issueKey: string
  /** Null when the reply's size was outside the scale — reported, never coerced. */
  size: FeatureSizeName | null
  /** From the scale, never the reply. Null for XXL and for an unusable size. */
  derivedPoints: number | null
  /** Only ever set for XXL, by the user, before acceptance. */
  userSuppliedPoints: number | null
  riskNote: string | null
  dependencyNote: string | null
  implementationNote: string | null
  /**
   * Whether the team must BUILD this Feature. null when the model said nothing — silence is not a
   * judgement, and treating it as `false` would erase a human's tick.
   */
  devWork: boolean | null
  /** Whether the team is ONLY supporting another team's testing. null when the model said nothing. */
  testSupport: boolean | null
  /** Shown in review so Accept is never a blind click. Never written to a cell. */
  rationale: string | null
  state: PiReviewSuggestionState
}

/**
 * Which optional columns the page's table actually has.
 *
 * Dev Work and Test Support are optional PI Review columns — a page may carry neither. Asking the
 * model for a value the table cannot hold would produce a suggestion that silently goes nowhere, so
 * the prompt only requests the boxes the page can actually record.
 */
export interface PiReviewAiColumnAvailability {
  hasDevWorkColumn: boolean
  hasTestSupportColumn: boolean
}

/** The outcome of parsing one reply: what is usable, and an honest account of what was not. */
export interface PiReviewAiRunResult {
  /** Everything that parsed, in page-row order. */
  suggestions: PiReviewAiSuggestion[]
  /** Keys the reply named that are not on the page — reported, never applied. */
  unknownKeys: string[]
  /** Items that yielded no usable suggestion. */
  unparsedCount: number
}

// ── Prompt ──

/** Renders the scale as the model sees it, from the same constant the sizing card renders. */
function buildSizingScaleBlock(): string {
  const rungs = FEATURE_SIZING_SCALE.map((entry) => `  ${entry.size} = ${entry.pointsLabel}`).join('\n')
  return `T-shirt sizing scale (story points):\n${rungs}`
}

/** One Feature's block: the signals on a header line, the rich content indented beneath. */
function buildFeatureBlock(context: PiReviewAiFeatureContext): string {
  const headerParts = [context.issueKey]
  if (context.priority) headerParts.push(`priority ${context.priority}`)
  if (context.currentPointEstimate.trim() !== '') headerParts.push(`current estimate ${context.currentPointEstimate}`)
  if (context.hasExistingNotes) headerParts.push('already has notes')
  if (context.currentDevWork === 'Yes') headerParts.push('Dev Work: Yes')
  if (context.currentTestSupport === 'Yes') headerParts.push('Test Support: Yes')

  const lines = [`- ${headerParts.join(' · ')} — ${context.summary}`]
  // An absent field is stated, not omitted: an empty label invites the model to invent content.
  lines.push(`    description: ${context.description ?? '(none in Jira)'}`)
  lines.push(`    acceptance criteria: ${context.acceptanceCriteria ?? '(none in Jira)'}`)
  lines.push(`    linked dependencies: ${context.linkedDependencies.join('; ') || '(none linked in Jira)'}`)
  lines.push(`    linked risks: ${context.linkedRisks.join('; ') || '(none linked in Jira)'}`)
  return lines.join('\n')
}

/**
 * Builds the single prompt covering every Feature on the page.
 *
 * One run, one prompt: a PO fills a PI Review page in one sitting, so the prompt carries the whole
 * table and the reply comes back keyed by issue so each row can be accepted independently.
 */
export function buildPiReviewAiPrompt(
  contexts: readonly PiReviewAiFeatureContext[],
  columnAvailability: PiReviewAiColumnAvailability,
): string {
  const featureBlocks = contexts.map(buildFeatureBlock).join('\n')
  const issueKeyList = contexts.map((context) => context.issueKey).join(', ')
  const { hasDevWorkColumn, hasTestSupportColumn } = columnAvailability

  // Only ask for the boxes this page can record — see PiReviewAiColumnAvailability.
  const boxInstructions = [
    hasDevWorkColumn
      ? '  3. Dev work: Yes when this Feature requires development BY OUR TEAM — we write the code.'
      : '',
    hasTestSupportColumn
      ? '  4. Test support: Yes when our team is ONLY supporting the testing of ANOTHER team\'s'
        + '\n     development — they build it, we help test it. If we build it, that is not test support.'
      : '',
  ].filter(Boolean).join('\n');

  const boxRules = hasDevWorkColumn || hasTestSupportColumn
    ? '\n  - Judge the Dev Work / Test Support boxes from what the Feature asks OUR team to do. They answer'
      + '\n    different questions: Dev Work is "do we build it"; Test Support is "do we only help test what'
      + '\n    another team built". Leave a box as ___ when the material does not tell you — saying nothing'
      + '\n    is better than a guess, because a wrong tick is one a person has to catch.'
    : '';

  return `You are helping a Product Owner prepare a SAFe PI Review page for ${contexts.length} Features.

For each Feature below, decide:
  1. Its T-shirt size, using the scale. Judge from the description, acceptance criteria and links.
  2. What the ART/RTE needs to hear: the risks, the dependencies, and any implementation notes.
${boxInstructions}

${buildSizingScaleBlock()}

Rules:
  - Give the size only. Do NOT return a point number — the app derives points from the scale,
    and any point number you send is ignored.
  - Use only the issue keys listed below. Never invent a Feature or a key.
  - The linked dependencies and risks shown are already recorded in Jira and shown on the page. Do
    not restate the keys: explain WHY the dependency bites or WHAT the risk actually is. That
    explanation is the part Jira's links cannot carry.
  - If a Feature has no description or acceptance criteria, say so in "Why this size" rather than
    guessing a size silently.
  - Keep every note under ${MAX_AI_NOTE_LENGTH} characters and worth an RTE's attention.
  - Leave a note cell as ___ when you have nothing useful to say about it.${boxRules}

Features (${contexts.length} Features — cover every one):
${featureBlocks}

Issue keys you may use: ${issueKeyList}

${buildRecordReplyInstructions(buildPiReviewReplySpec(columnAvailability), listFeatureRowNamingCells(contexts))}`
}

/** The table the prompt asks for: only the boxes this page can record — see PiReviewAiColumnAvailability. */
function buildPiReviewReplySpec(columnAvailability: PiReviewAiColumnAvailability): ReplyRecordSpec {
  const boxColumns = [
    ...(columnAvailability.hasDevWorkColumn ? [DEV_WORK_COLUMN] : []),
    ...(columnAvailability.hasTestSupportColumn ? [TEST_SUPPORT_COLUMN] : []),
  ]
  return { ...PI_REVIEW_READ_SPEC, columns: [ISSUE_KEY_COLUMN, FEATURE_NAME_COLUMN, SIZE_COLUMN, ...boxColumns, ...NOTE_COLUMNS] }
}

/** One pre-filled row per Feature — its key and summary — so the reply cannot invent or drop a Feature. */
function listFeatureRowNamingCells(contexts: readonly PiReviewAiFeatureContext[]): string[][] {
  return contexts.map((context) => [context.issueKey, context.summary.replace(TABLE_CELL_BREAKING_PATTERN, ' ')])
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply needs none.
 *
 * An unreadable reply gets the whole table again; a reply that left Features without a usable answer
 * gets a table of just those Features. Nothing missing is ever guessed — the assistant is asked.
 *
 * @param runResult - The parsed reply, or null when the reply could not be read at all.
 */
export function buildPiReviewAiFollowUpPrompt(
  contexts: readonly PiReviewAiFeatureContext[],
  columnAvailability: PiReviewAiColumnAvailability,
  runResult: PiReviewAiRunResult | null,
): string {
  const replySpec = buildPiReviewReplySpec(columnAvailability)
  if (runResult === null) {
    return buildRecordFormatFixPrompt(replySpec, listFeatureRowNamingCells(contexts))
  }
  const answeredKeys = new Set(runResult.suggestions.map((suggestion) => suggestion.issueKey))
  const missingContexts = contexts.filter((context) => !answeredKeys.has(context.issueKey.toUpperCase()))
  if (missingContexts.length === 0) {
    return ''
  }
  return [
    `Your last reply gave no usable answer for ${missingContexts.map((context) => context.issueKey).join(', ')}. `
      + 'Answer only those now, in this table.',
    buildRecordReplyInstructions(replySpec, listFeatureRowNamingCells(missingContexts)),
  ].join('\n')
}

// ── Parsing ──

/** Trims, drops "nothing to say" values, and caps length so a cell can never become unbounded. */
function readNoteField(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') {
    return null
  }
  const trimmedNote = rawValue.trim()
  if (BLANKISH_NOTE_VALUES.has(trimmedNote.toLowerCase())) {
    return null
  }
  return trimmedNote.length > MAX_AI_NOTE_LENGTH ? `${trimmedNote.slice(0, MAX_AI_NOTE_LENGTH)}…` : trimmedNote
}

/**
 * Reads a checkbox verdict. Strictly boolean: a string, a number or a missing field all read as null.
 *
 * null means "the model did not say", which is deliberately NOT the same as false. Applying false
 * would untick a box a human had ticked, on the strength of the model's silence.
 */
function readCheckboxField(rawValue: unknown): boolean | null {
  return typeof rawValue === 'boolean' ? rawValue : null
}

/** Reads the size if the scale defines it; anything else becomes null rather than a nearby guess. */
function readSizeField(rawValue: unknown): FeatureSizeName | null {
  return isFeatureSizeName(rawValue) ? (String(rawValue).trim().toUpperCase() as FeatureSizeName) : null
}

/** Turns one reply item into a suggestion, or null when it carries nothing usable. */
function readSuggestion(rawItem: Record<string, unknown>, issueKey: string): PiReviewAiSuggestion | null {
  const size = readSizeField(rawItem.size)
  const riskNote = readNoteField(rawItem.riskNote)
  const dependencyNote = readNoteField(rawItem.dependencyNote)
  const implementationNote = readNoteField(rawItem.implementationNote)
  const devWork = readCheckboxField(rawItem.devWork)
  const testSupport = readCheckboxField(rawItem.testSupport)

  // Lenient per field, but an item that says nothing at all has told us nothing. A box verdict on
  // its own is a real answer, so it counts.
  const hasAnyContent = size !== null
    || riskNote !== null
    || dependencyNote !== null
    || implementationNote !== null
    || devWork !== null
    || testSupport !== null
  if (!hasAnyContent) {
    return null
  }

  const derivedPoints = size === null ? null : readPointsForSize(size)
  return {
    issueKey,
    size,
    derivedPoints,
    userSuppliedPoints: null,
    riskNote,
    dependencyNote,
    implementationNote,
    devWork,
    testSupport,
    rationale: readNoteField(rawItem.rationale),
    // XXL is "100+" — a floor, not a value. It cannot be accepted until the user supplies a number.
    state: size === 'XXL' ? 'needsPoints' : 'pending',
  }
}

/**
 * Parses an AI reply into suggestions, plus an honest account of what could not be used.
 *
 * Throws only for a reply that is wholly wrong — not JSON, or echoing another surface's kind. Every
 * other problem degrades: a bad size drops to null and the row survives for its notes; an unknown or
 * missing key drops the item. That trade is deliberate: with one item per Feature across a whole PI,
 * throwing on the first bad enum would discard a page of good work.
 *
 * @param replyText - The raw reply: the filled-in table (markdown or tab-separated) or JSON, possibly wrapped in prose.
 * @param knownIssueKeys - The Feature keys actually on the page; anything else is reported.
 */
export function parsePiReviewAiReply(
  replyText: string,
  knownIssueKeys: readonly string[],
): PiReviewAiRunResult {
  const parsedEnvelope = JSON.parse(extractRecordReplyPayload(replyText, PI_REVIEW_READ_SPEC)) as Record<string, unknown>
  if (parsedEnvelope.kind !== PI_REVIEW_REPLY_KIND) {
    throw new Error(
      `Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${PI_REVIEW_REPLY_KIND}".`,
    )
  }

  // Unique known keys, first-seen order: a page can carry the same Feature on more than one row, and
  // one Feature must yield at most one suggestion — never one identical card per duplicate row.
  const knownKeysUpper = [...new Set(knownIssueKeys.map((issueKey) => issueKey.toUpperCase()))]
  const rawItems = Array.isArray(parsedEnvelope.items) ? parsedEnvelope.items : []

  const suggestionsByKey = new Map<string, PiReviewAiSuggestion>()
  const unknownKeys: string[] = []
  let unparsedCount = 0

  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null) {
      unparsedCount += 1
      continue
    }
    const item = rawItem as Record<string, unknown>
    const rawKey = typeof item.issueKey === 'string' ? item.issueKey.trim().toUpperCase() : ''
    if (rawKey === '') {
      unparsedCount += 1
      continue
    }
    if (!knownKeysUpper.includes(rawKey)) {
      unknownKeys.push(rawKey)
      continue
    }

    const suggestion = readSuggestion(item, rawKey)
    if (suggestion === null) {
      unparsedCount += 1 // carried neither a usable size nor a note
      continue
    }
    suggestionsByKey.set(rawKey, suggestion)
  }

  // Page-row order, not reply order — the review list should read like the table.
  const suggestions = knownKeysUpper
    .map((issueKey) => suggestionsByKey.get(issueKey))
    .filter((suggestion): suggestion is PiReviewAiSuggestion => suggestion !== undefined)

  return { suggestions, unknownKeys, unparsedCount }
}
