// intakeClassifyRound.ts — The sorting exchange of an Epic Intake: what each item is, how much of it is Enrollment's,
// what to search Jira for, and which label fits — asked only where those answers are still open (spec 037,
// contracts/ai-rounds.md §1).
//
// Toolbox has already grouped the notes by their bullets; this request asks for corrections and blanks, never for
// new items. Every answer is validated here; `intakeClassifyApply.ts` then applies what survived.

import { buildIssueTextMatchTerms } from '../../../../utils/jqlTextTerms.ts';
import { MAX_CHARS_PER_PROMPT } from '../../rewrite/ai/bulkRewriteAiAssist.ts';
import {
  INTAKE_LABELS,
  ITEM_KINDS,
  ITEM_OWNERS,
  SET_ASIDE_REASONS,
  type EpicIntake,
  type IngestOutcome,
  type IngestRejection,
  type IntakeItem,
  type IntakeLabel,
  type ItemKind,
  type ItemOwner,
  type SetAsideReason,
} from '../epicIntakeModel.ts';
import { listOpenDecisions, type OpenDecision } from '../intakeChecklist.ts';
import { splitLinesIntoPromptParts } from '../notesOutline.ts';
import {
  readBoundedString,
  readReplyEnvelope,
  readVocabularyValue,
  resolveItemId,
  type IntakeRoundRequest,
  type RawReplyItem,
} from './intakeReplyEnvelope.ts';

export const CLASSIFY_REPLY_KIND = 'epicIntakeClassify';

/** Room kept in every part for the fixed instructions, so the notes themselves get the rest of the paste limit. */
const CLASSIFY_INSTRUCTION_ALLOWANCE_CHARS = 3000;

/** Search terms: at most this many per item, each at most this long. */
export const MAX_SEARCH_TERMS_PER_ITEM = 5;
export const MAX_SEARCH_TERM_CHARS = 60;

/** The longest clearer title or reason kept from an answer. */
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 400;

/** One part of the sorting request. */
export interface ClassifyRequest extends IntakeRoundRequest {
  partIndex: number;
  partCount: number;
}

/** A validated sorting answer for one item. Fields the answer left out or got wrong are null, with a reason. */
export interface ClassifyAnswer {
  itemId: string;
  lineNumbers: number[] | null;
  title: string | null;
  kind: ItemKind | null;
  /** The owner the answer named outright, which takes precedence over the share figure. Stated sizes still win. */
  owner: ItemOwner | null;
  enrollmentShare: unknown;
  hasEnrollmentShare: boolean;
  searchTerms: string[] | null;
  labelProposal: IntakeLabel | null;
  reason: string | null;
  fieldErrors: Partial<Record<'kind' | 'lines' | 'searchTerms', string>>;
}

/** A line the answer set aside. */
export interface ClassifySetAside {
  lineNumber: number;
  reason: SetAsideReason;
}

export interface ClassifyOutcome extends IngestOutcome<ClassifyAnswer> {
  setAside: ClassifySetAside[];
}

// ── Building the request ──

const ASKED_SORTING_STEPS = new Set(['sortNotes', 'decideOwners']);

function readAskedDecisions(intake: EpicIntake): OpenDecision[] {
  return listOpenDecisions(intake, true).filter((openDecision) => openDecision.turn === 'ai' && ASKED_SORTING_STEPS.has(openDecision.step));
}

function describeAskedFields(item: IntakeItem, askedDecisions: readonly OpenDecision[]): string {
  const askedSlots = new Set(askedDecisions.filter((openDecision) => openDecision.itemId === item.id).map((openDecision) => openDecision.slot));
  const fields: string[] = [];
  if (askedSlots.has('kind')) fields.push('kind');
  if (item.decisions.owner.state === 'open' && !item.decisions.owner.isAwaitingPo) fields.push('owner', 'enrollmentShare');
  if (askedSlots.has('searchTerms')) fields.push('searchTerms');
  if (item.decisions.label.state === 'open') fields.push('label');
  return fields.join(', ');
}

function describeItemForClassify(item: IntakeItem, intake: EpicIntake, askedDecisions: readonly OpenDecision[]): string {
  const itemLines = intake.lines
    .filter((line) => item.lineNumbers.includes(line.lineNumber))
    .map((line) => `  [${line.lineNumber}] ${line.rawText}`);
  const ownerNote = item.decisions.owner.state === 'settled' ? ` (owner already decided: ${item.decisions.owner.reason})` : '';
  return [`${item.id} — answer: ${describeAskedFields(item, askedDecisions)}${ownerNote}`, ...itemLines].join('\n');
}

function buildClassifyText(items: readonly IntakeItem[], intake: EpicIntake, askedDecisions: readonly OpenDecision[], partLabel: string): string {
  return [
    'You are helping a Product Owner sort meeting notes into work items for Jira Epics.',
    'Toolbox has already grouped the numbered lines below by their bullets. Correct the grouping only where it is wrong,',
    'and answer only the fields listed for each item.',
    partLabel,
    '',
    ...items.map((item) => describeItemForClassify(item, intake, askedDecisions)),
    '',
    'Fields:',
    '- kind: work | risk | personAction (a to-do for a person) | deferred (explicitly not now) | noise',
    '- owner: enrollment | shared (both Enrollment and Fulfillment have real work of their own) | fulfillment | notActionable.',
    '  Decide it yourself — the Product Owner reviews your choices afterwards rather than answering questions.',
    '- enrollmentShare: whole number 0-100 — how much of the scope is Enrollment\'s; the rest is Fulfillment\'s',
    `- searchTerms: 1-${MAX_SEARCH_TERMS_PER_ITEM} short phrases (2-4 words) likely to appear in an existing Epic's summary for the same scope`,
    '- label: Roadmap (new capability or funding ask) | Stability (upgrades, tech debt, compliance, performance)',
    '- title: optional clearer title, under 120 characters',
    '- lines: optional — only when the grouping is wrong, every line number that belongs to the item.',
    '  Sizing lines ("XL Enrollment") and sub-scope lines stay with their parent item.',
    '- setAside (top level, optional): [{"line": 7, "reason": "headingOrProse | duplicateOfAnotherLine | notWork | contextOnly"}]',
    '',
    'Rules: use only the item ids above; never invent an item; only move lines between the items above.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${CLASSIFY_REPLY_KIND}","items":[{"id":"item-1","kind":"work","owner":"enrollment","enrollmentShare":70,"searchTerms":["core integration"],"label":"Roadmap","reason":"..."}],"setAside":[]}`,
  ].join('\n');
}

/**
 * Builds the sorting request, split at item boundaries into parts that fit a chat paste. Each part lists exactly
 * the items it asks about, so a part's answer is checked against that part alone.
 */
export function buildClassifyRequests(intake: EpicIntake): ClassifyRequest[] {
  const askedDecisions = readAskedDecisions(intake);
  const askedItemIds = new Set(askedDecisions.map((openDecision) => openDecision.itemId));
  const askedItems = intake.items.filter((item) => askedItemIds.has(item.id));
  const parts = splitLinesIntoPromptParts(askedItems, intake.lines, MAX_CHARS_PER_PROMPT - CLASSIFY_INSTRUCTION_ALLOWANCE_CHARS);
  return parts.map((partItems, partIndex) => {
    const partLabel = parts.length > 1 ? `This is part ${partIndex + 1} of ${parts.length}.` : '';
    return {
      text: buildClassifyText(partItems, intake, askedDecisions, partLabel),
      itemIds: partItems.map((item) => item.id),
      partIndex,
      partCount: parts.length,
    };
  });
}

// ── Reading the answer ──

function readLineNumbers(rawLines: unknown, linePool: ReadonlySet<number>): { lineNumbers: number[] | null; error: string | null } {
  if (rawLines === undefined || rawLines === null) {
    return { lineNumbers: null, error: null };
  }
  const isValid = Array.isArray(rawLines) && rawLines.length > 0
    && rawLines.every((lineNumber) => Number.isInteger(lineNumber) && linePool.has(lineNumber as number));
  return isValid
    ? { lineNumbers: [...new Set(rawLines as number[])].sort((left, right) => left - right), error: null }
    : { lineNumbers: null, error: 'The lines must be numbers of lines in this part.' };
}

function readSearchTerms(rawTerms: unknown): { searchTerms: string[] | null; error: string | null } {
  if (!Array.isArray(rawTerms)) {
    return { searchTerms: null, error: 'No search terms given.' };
  }
  const searchTerms = rawTerms
    .map((rawTerm) => readBoundedString(rawTerm, MAX_SEARCH_TERM_CHARS))
    .map((term) => (term === null ? null : buildIssueTextMatchTerms(term, { shouldWildcardLastTerm: false })))
    .filter((term): term is string => term !== null)
    .slice(0, MAX_SEARCH_TERMS_PER_ITEM);
  return searchTerms.length > 0 ? { searchTerms, error: null } : { searchTerms: null, error: 'None of the search terms were usable.' };
}

function readClassifyAnswer(rawItem: RawReplyItem, itemId: string, linePool: ReadonlySet<number>): ClassifyAnswer {
  const fieldErrors: ClassifyAnswer['fieldErrors'] = {};
  const kind = readVocabularyValue(rawItem.kind, ITEM_KINDS);
  if (kind === null) fieldErrors.kind = `"${String(rawItem.kind)}" is not a kind.`;
  const { lineNumbers, error: linesError } = readLineNumbers(rawItem.lines, linePool);
  if (linesError !== null) fieldErrors.lines = linesError;
  const { searchTerms, error: termsError } = readSearchTerms(rawItem.searchTerms);
  if (termsError !== null) fieldErrors.searchTerms = termsError;
  return {
    itemId,
    lineNumbers,
    title: readBoundedString(rawItem.title, MAX_TITLE_CHARS),
    kind,
    enrollmentShare: rawItem.enrollmentShare,
    hasEnrollmentShare: rawItem.enrollmentShare !== undefined && rawItem.enrollmentShare !== null,
    searchTerms,
    owner: readVocabularyValue(rawItem.owner, ITEM_OWNERS),
    // "label" is what the request asks for; "labelProposal" is accepted too, from requests built before it changed.
    labelProposal: readVocabularyValue(rawItem.label ?? rawItem.labelProposal, INTAKE_LABELS),
    reason: readBoundedString(rawItem.reason, MAX_REASON_CHARS),
    fieldErrors,
  };
}

function readSetAside(rawSetAside: unknown, linePool: ReadonlySet<number>): { setAside: ClassifySetAside[]; rejected: IngestRejection[] } {
  const setAside: ClassifySetAside[] = [];
  const rejected: IngestRejection[] = [];
  for (const entry of Array.isArray(rawSetAside) ? rawSetAside : []) {
    const lineNumber = (entry as RawReplyItem)?.line;
    const reason = readVocabularyValue((entry as RawReplyItem)?.reason, SET_ASIDE_REASONS);
    if (Number.isInteger(lineNumber) && linePool.has(lineNumber as number) && reason !== null) {
      setAside.push({ lineNumber: lineNumber as number, reason });
    } else {
      rejected.push({ itemId: null, reason: `Line ${String(lineNumber)} could not be set aside.` });
    }
  }
  return { setAside, rejected };
}

/**
 * Validates one part's pasted answer against the items that part asked about. Never throws; items it does not
 * know are rejected by name, so an invented item never gets in.
 */
export function parseClassifyReply(replyText: string, intake: EpicIntake, askedItemIds: readonly string[]): ClassifyOutcome {
  const envelope = readReplyEnvelope(replyText, CLASSIFY_REPLY_KIND);
  if (envelope.wholeReplyError !== null) {
    return { accepted: [], rejected: [{ itemId: null, reason: envelope.wholeReplyError }], setAside: [] };
  }
  const linePool = new Set(intake.items.filter((item) => askedItemIds.includes(item.id)).flatMap((item) => item.lineNumbers));
  const accepted: ClassifyAnswer[] = [];
  const rejected: IngestRejection[] = [];
  for (const rawItem of envelope.items) {
    const itemId = resolveItemId(rawItem.id, askedItemIds);
    if (itemId === null) {
      rejected.push({ itemId: typeof rawItem.id === 'string' ? rawItem.id : null, reason: `"${String(rawItem.id)}" is not an item in this request.` });
    } else if (!accepted.some((answer) => answer.itemId === itemId)) {
      accepted.push(readClassifyAnswer(rawItem, itemId, linePool));
    }
  }
  const setAsideResult = readSetAside(envelope.payload.setAside, linePool);
  return { accepted, rejected: [...rejected, ...setAsideResult.rejected], setAside: setAsideResult.setAside };
}
