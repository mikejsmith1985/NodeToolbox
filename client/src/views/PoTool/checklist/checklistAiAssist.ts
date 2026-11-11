// checklistAiAssist.ts — One prompt that reviews an Epic against the Definition of Ready and Definition of Done,
// and a strict reader for the answer.
//
// The prompt asks for a judgement per criterion, not a tick: satisfied, partly satisfied, or missing — with the
// words in the Epic that support it, and what is still needed. That last field is the one the PO actually works
// from, so a reply that omits it is incomplete even when its verdict is right.
//
// Same contract as every other AI surface here: prompt out, reply in, nothing written to Jira by this file.
//
// The team's assistant is Google's AI Mode, which ignores JSON instructions (GH #499). So the prompt ends with a
// fill-in table listing every criterion, and the reader turns that table back into the same {kind, items[]} JSON the
// strict checks below already validate. A JSON reply is still read. A reply that is unreadable, or leaves criteria
// out, gets a follow-up for the same chat asking only for the table or only for the missing rows — never a guess.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  isUnreadableRecordReply,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import { DEFINITION_LABELS, type ReadinessCriterion } from './dorCriteria.ts';
import type { CriterionStatus, CriterionVerdict } from './readinessReport.ts';
import type { EpicChecklistSource } from './checklistField.ts';

/** The fixed discriminator the assistant must echo, so another reply cannot be ingested here by accident. */
const CHECKLIST_INGEST_KIND = 'epicReadinessReview';

/** The answers a status cell may hold, said once in the prompt's rules. */
export const STATUS_ANSWER_HINT = 'satisfied, partial or missing';
/** What the evidence cell takes. */
export const EVIDENCE_ANSWER_HINT = 'the words in the Epic that show it; leave ___ when there are none';
/** What the "what is missing" cell takes. */
export const WHAT_IS_MISSING_ANSWER_HINT = 'what must be added to the Epic to meet it; leave ___ when satisfied';

/** The fill-in table the single-Epic review is answered in: one row per criterion, its id and words filled in. */
export const CHECKLIST_REPLY_SPEC: ReplyRecordSpec = {
  kind: CHECKLIST_INGEST_KIND,
  replyMarker: 'READINESS_REVIEW_TABLE:',
  columns: [
    { field: 'criterionId', header: 'Criterion id' },
    { field: 'criterionText', header: 'Criterion', isNamingOnly: true },
    { field: 'status', header: 'Status', answerHint: STATUS_ANSWER_HINT },
    { field: 'evidence', header: 'Evidence', answerHint: EVIDENCE_ANSWER_HINT },
    { field: 'whatIsMissing', header: 'What is missing', answerHint: WHAT_IS_MISSING_ANSWER_HINT },
  ],
};

// A "|" inside a criterion's words would split its row into extra cells, so it is written as "/".
const TABLE_CELL_SEPARATOR_PATTERN = /\|/g;

/** One criterion's prefilled cells: its id, then its words. */
function buildCriterionRowCells(criterion: ReadinessCriterion): string[] {
  return [criterion.id, criterion.text.replace(TABLE_CELL_SEPARATOR_PATTERN, '/')];
}

/**
 * The follow-up for a reply that answered only some rows: the same rules and table, holding only those rows. It asks
 * for nothing already answered, so the verdicts that did come back stand.
 */
export function buildMissingRowsFollowUpPrompt(spec: ReplyRecordSpec, missingRowCells: readonly (readonly string[])[]): string {
  return [
    `Your last reply left ${missingRowCells.length} row(s) out. Answer only these rows now, in the same way.`,
    buildRecordReplyInstructions(spec, missingRowCells),
  ].join('\n');
}

/** The outcome of reading one reply: the verdicts that survived, and what was wrong with the rest. */
export interface ChecklistIngestResult {
  verdicts: CriterionVerdict[];
  errors: string[];
}

/** How much of the Epic's description to include, so one enormous Epic cannot crowd out the criteria. */
const MAX_DESCRIPTION_CHARS = 8000;

/** The statuses the assistant may answer with. */
const ALLOWED_STATUSES: CriterionStatus[] = ['satisfied', 'partial', 'missing'];

/** Trims one long field and says plainly that it was cut. */
function readTrimmedText(text: string): string {
  const trimmedText = text.trim();
  if (trimmedText.length <= MAX_DESCRIPTION_CHARS) {
    return trimmedText;
  }
  return `${trimmedText.slice(0, MAX_DESCRIPTION_CHARS)}\n… (truncated — open the Epic for the rest)`;
}

/** Writes one criterion as the prompt lists it: its id, its group, and its words. */
function describeCriterion(criterion: ReadinessCriterion): string {
  return `  ${criterion.id} — [${criterion.section}] ${criterion.text}`;
}

/** Lists one definition's criteria under its own heading, or nothing when it has none. */
function describeDefinitionCriteria(criteria: readonly ReadinessCriterion[], definition: 'dor' | 'dod'): string[] {
  const definitionCriteria = criteria.filter((criterion) => criterion.definition === definition);
  if (definitionCriteria.length === 0) {
    return [];
  }
  return [`${DEFINITION_LABELS[definition]}:`, ...definitionCriteria.map(describeCriterion), ''];
}

/**
 * Builds the prompt the PO copies into their assistant.
 *
 * The Epic leads and the criteria follow, deliberately: an assistant given the criteria first tends to argue each
 * one into being met, while one that reads the Epic first is judging what is actually written there.
 */
export function buildChecklistPrompt(
  epic: EpicChecklistSource,
  criteria: readonly ReadinessCriterion[],
  /** The Epic's children, as "KEY — status — summary" lines. Evidence for scope and delivery criteria. */
  childSummaryLines: readonly string[] = [],
): string {
  return [
    'You are reviewing a Jira Epic against a team\'s Definition of Ready and Definition of Done.',
    'You are the sceptical reviewer in a refinement session: your job is to find what is not yet written down,',
    'not to reassure the Product Owner.',
    '',
    `Epic ${epic.issueKey} (status: ${epic.status || 'unknown'})`,
    `Summary: ${epic.summary}`,
    '',
    'Description:',
    readTrimmedText(epic.description) || '(empty)',
    '',
    'Acceptance criteria:',
    readTrimmedText(epic.acceptanceCriteria) || '(none recorded)',
    '',
    childSummaryLines.length > 0
      ? `Work under this Epic:\n${childSummaryLines.join('\n')}`
      : 'Work under this Epic: (none found)',
    '',
    'Judge the Epic against every criterion below:',
    '',
    ...describeDefinitionCriteria(criteria, 'dor'),
    ...describeDefinitionCriteria(criteria, 'dod'),
    'For each criterion answer with one status:',
    '  "satisfied" — the Epic clearly meets it, and you can quote the words that show it.',
    '  "partial"   — something is written about it, but it is incomplete, vague, or unverifiable as written.',
    '  "missing"   — the Epic says nothing that meets it.',
    '',
    'Rules:',
    '  • "Evidence" must quote or closely paraphrase the actual words in the Epic. A criterion cannot be',
    '    "satisfied" without evidence. If you have nothing to quote, the answer is "missing".',
    '  • "What is missing" must say what would have to be added to the Epic to satisfy the criterion. For a',
    '    satisfied criterion, leave it blank.',
    '  • Judge only what is written above. Do not assume work happened because the Epic looks mature, and do',
    '    not treat the Epic\'s status, its age, or the existence of child issues as evidence on its own.',
    '  • Answer every criterion id exactly once. Use only the ids given. Do not invent criteria.',
    '',
    buildRecordReplyInstructions(CHECKLIST_REPLY_SPEC, criteria.map(buildCriterionRowCells)),
  ].join('\n');
}

/**
 * The follow-up to paste into the same chat when a reply could not be read in full: the whole table again when it
 * was unreadable, only the unanswered criteria when some were left out, or '' when nothing is missing.
 */
export function buildChecklistFollowUpPrompt(
  responseText: string,
  criteria: readonly ReadinessCriterion[],
  answeredVerdicts: readonly CriterionVerdict[],
): string {
  const allRowCells = criteria.map(buildCriterionRowCells);
  if (isUnreadableRecordReply(responseText, CHECKLIST_REPLY_SPEC)) {
    return buildRecordFormatFixPrompt(CHECKLIST_REPLY_SPEC, allRowCells);
  }
  const answeredIds = new Set(answeredVerdicts.map((verdict) => verdict.criterionId));
  const missingCriteria = criteria.filter((criterion) => !answeredIds.has(criterion.id));
  return missingCriteria.length === 0
    ? ''
    : buildMissingRowsFollowUpPrompt(CHECKLIST_REPLY_SPEC, missingCriteria.map(buildCriterionRowCells));
}

/** Coerces anything to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// An answer engine writes "Partly satisfied" or "Partially met" for the partial status; it means the same thing.
const PARTIAL_STATUS_PATTERN = /^part(?:ly|ial|ially)\b/;
// Trailing punctuation an answer engine adds to a one-word cell: "Missing."
const TRAILING_PUNCTUATION_PATTERN = /[.!]+$/;

/**
 * Reads the status, or null for an unrecognised one — the caller reports that as missing rather than guessing in
 * the Epic's favour.
 */
export function readCriterionStatus(value: unknown): CriterionStatus | null {
  const statusText = readTrimmedString(value).toLowerCase().replace(TRAILING_PUNCTUATION_PATTERN, '');
  if (PARTIAL_STATUS_PATTERN.test(statusText)) {
    return 'partial';
  }
  return ALLOWED_STATUSES.find((allowedStatus) => allowedStatus === statusText) ?? null;
}

/**
 * True when a reply row carries no answer at all — a table row whose blanks were all left in. It is reported as
 * unanswered, never read as "missing": a blank is the absence of a judgement, not a judgement.
 */
export function isBlankAnswerRow(candidateItem: Record<string, unknown>): boolean {
  return ['status', 'evidence', 'whatIsMissing'].every((field) => readTrimmedString(candidateItem[field]) === '');
}

/**
 * Reads the assistant's reply.
 *
 * Never throws. Three rules protect the report: a criterion id the prompt did not offer is dropped with an error
 * (an assistant must not invent criteria the team never agreed), a "satisfied" with no evidence is downgraded to
 * "partial" (the quote IS the argument), and a criterion nobody answered is simply left unanswered — the report
 * says so rather than counting it as a pass.
 */
export function parseChecklistIngest(
  responseText: string,
  offeredCriterionIds: readonly string[],
): ChecklistIngestResult {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(extractRecordReplyPayload(responseText, CHECKLIST_REPLY_SPEC));
    if (typeof parsed !== 'object' || parsed === null) {
      return { verdicts: [], errors: ['The assistant response was not valid JSON.'] };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { verdicts: [], errors: ['No JSON object found in the assistant response.'] };
  }

  if (payload.kind !== CHECKLIST_INGEST_KIND) {
    return { verdicts: [], errors: [`Response kind "${String(payload.kind)}" is not ${CHECKLIST_INGEST_KIND}.`] };
  }
  if (!Array.isArray(payload.items)) {
    return { verdicts: [], errors: ['The "items" field is missing or is not a list.'] };
  }

  const allowedCriterionIds = new Set(offeredCriterionIds);
  const seenCriterionIds = new Set<string>();
  const verdicts: CriterionVerdict[] = [];
  const errors: string[] = [];

  payload.items.forEach((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      errors.push('An entry in "items" was not an object, so it was ignored.');
      return;
    }
    const candidateItem = candidate as Record<string, unknown>;
    const criterionId = readTrimmedString(candidateItem.criterionId);
    // A row left blank is not answered — it falls through to the "not answered" report below.
    if (allowedCriterionIds.has(criterionId) && isBlankAnswerRow(candidateItem)) {
      return;
    }

    if (!allowedCriterionIds.has(criterionId)) {
      errors.push(`"${criterionId || '(no id)'}" is not one of the criteria, so it was ignored.`);
      return;
    }
    if (seenCriterionIds.has(criterionId)) {
      errors.push(`"${criterionId}" was answered twice; only the first answer was kept.`);
      return;
    }
    seenCriterionIds.add(criterionId);

    const evidence = readTrimmedString(candidateItem.evidence);
    const claimedStatus = readCriterionStatus(candidateItem.status);
    if (claimedStatus === null) {
      errors.push(`"${criterionId}" came back with no usable status, so it is reported as missing.`);
    }

    // A claim of "satisfied" with nothing quoted is not a weaker claim — it is no claim, so it does not pass.
    const isUnevidencedPass = claimedStatus === 'satisfied' && evidence === '';
    const status: CriterionStatus = isUnevidencedPass ? 'partial' : claimedStatus ?? 'missing';

    verdicts.push({
      criterionId,
      status,
      evidence,
      whatIsMissing: isUnevidencedPass
        ? 'Reported as satisfied but nothing in the Epic was quoted — confirm this yourself before relying on it.'
        : readTrimmedString(candidateItem.whatIsMissing),
    });
  });

  offeredCriterionIds
    .filter((offeredCriterionId) => !seenCriterionIds.has(offeredCriterionId))
    .forEach((unansweredCriterionId) => {
      errors.push(`"${unansweredCriterionId}" was not answered, so it is reported as unanswered.`);
    });

  return { verdicts, errors };
}

/** The criteria the review judged satisfied — the ones a PO would tick if the checklist can be written. */
export function listSatisfiedCriterionIds(verdicts: readonly CriterionVerdict[]): string[] {
  return verdicts.filter((verdict) => verdict.status === 'satisfied').map((verdict) => verdict.criterionId);
}
