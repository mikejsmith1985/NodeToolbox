// intakeResolveRound.ts — The one "resolve" exchange of an Epic Intake: for every Enrollment item still open after
// the DENP check, a single request asks whether an open Epic already covers it, which label a new Epic takes, and
// the new Epic's summary and nine-section description (spec 037, contracts/ai-rounds.md, AI-first redesign).
//
// The assistant decides; the PO reviews every answer once in the table, and clicking Create is the only
// confirmation. So an unsure match still settles — the row is flagged for a second look instead — and a draft is
// stored without being "accepted". Every rule the old separate match and draft exchanges enforced still holds: a
// key must come from that item's own candidates, a PO-settled answer or PO-edited draft is never replaced, and a
// reply that cannot be read at all costs nothing.

import { SECTION_LABELS, VALIDATION_MARKER } from '../../ai/featureDocSections.ts';
import { MAX_CHARS_PER_PROMPT } from '../../rewrite/ai/bulkRewriteAiAssist.ts';
import {
  INTAKE_LABELS,
  readItemDisplayTitle,
  readSettledValue,
  type Decision,
  type DuplicateCandidate,
  type DuplicateVerdict,
  type EpicDraft,
  type EpicIntake,
  type IngestOutcome,
  type IngestRejection,
  type IntakeItem,
  type IntakeLabel,
  type IntakeStepId,
  type RoundRecord,
} from '../epicIntakeModel.ts';
import {
  listOpenDecisions,
  MAX_AI_ATTEMPTS_PER_DECISION,
  recordAiRejection,
  refreshApplicability,
  replaceIntakeItem,
  settleDecision,
} from '../intakeChecklist.ts';
import { applySharedScopeSuffix, isSharedItem, MAX_EPIC_SUMMARY_CHARS, readDraftFromReply } from './intakeDraftRound.ts';
import { describeMatchVerdict, MATCH_CONFIDENCES, validateMatchVerdict } from './intakeMatchRound.ts';
import {
  readBoundedString,
  readReplyEnvelope,
  readVocabularyValue,
  resolveItemId,
  type IntakeRoundRequest,
  type RawReplyItem,
} from './intakeReplyEnvelope.ts';

export const RESOLVE_REPLY_KIND = 'epicIntakeResolve';

/** At most this many found Epics are listed per item, so one noisy search cannot crowd out every other item. */
export const MAX_CANDIDATES_IN_PROMPT = 8;

/** A found Epic's description excerpt is cut to this length in the request. */
const MAX_EXCERPT_CHARS = 120;

/** Room kept in every part for the fixed instructions, so the items themselves get the rest of the paste limit. */
const RESOLVE_INSTRUCTION_ALLOWANCE_CHARS = 3000;

/** The longest reason kept from an answer. */
const MAX_REASON_CHARS = 400;

/** The steps this exchange answers. Earlier steps belong to the sorting exchange. */
const RESOLVE_STEPS: ReadonlySet<IntakeStepId> = new Set<IntakeStepId>(['match', 'confirmLabels', 'draft']);

/** What the reason says when an asked item is missing from the answer. */
const MISSING_ANSWER_REASON = 'No answer for this item.';

/** One part of the resolve request. */
export interface ResolveRequest {
  text: string;
  itemIds: string[];
  partIndex: number;
  partCount: number;
}

/** A validated answer for one item. Parts the answer left out or got wrong are null; the errors say why. */
export interface ResolveAnswer {
  itemId: string;
  verdict: DuplicateVerdict | null;
  isConfident: boolean;
  label: IntakeLabel | null;
  draft: EpicDraft | null;
  reason: string;
  fieldErrors: Partial<Record<'verdict' | 'draft', string>>;
}

/** Where a pasted answer sits among the request's parts, recorded in the audit trail. */
export interface ResolvePartPosition {
  partIndex: number;
  partCount: number;
}

// ── Which questions each item is asked ──

/** The three questions one item can be asked here. `draft` fills the item's draft, not a decision. */
type ResolveQuestion = 'duplicate' | 'label' | 'draft';

/** True when the assistant may still answer this decision: open, not handed to the PO, not failed too often. */
function isAssistantAnswerable(decision: Decision<unknown>): boolean {
  return decision.state === 'open' && !decision.isAwaitingPo && decision.aiAttempts < MAX_AI_ATTEMPTS_PER_DECISION;
}

/**
 * The questions an item is asked, re-read from its own decisions every time: the match while it is open, and —
 * for an item that is or may become a new Epic — its label and draft while those are still the assistant's.
 */
function readAskedQuestions(item: IntakeItem): ResolveQuestion[] {
  const { decisions } = item;
  const isMatchAsked = item.searchStatus === 'ok' && isAssistantAnswerable(decisions.duplicate);
  const mayNeedNewEpic = isMatchAsked || readSettledValue(decisions.duplicate)?.verdict === 'createNew';
  const questions: ResolveQuestion[] = [];
  if (isMatchAsked) questions.push('duplicate');
  if (mayNeedNewEpic && isAssistantAnswerable(decisions.label)) questions.push('label');
  if (mayNeedNewEpic && item.draft === null && isAssistantAnswerable(decisions.draftAccepted)) questions.push('draft');
  return questions;
}

function readResolveItems(intake: EpicIntake): IntakeItem[] {
  const openItemIds = new Set(
    listOpenDecisions(intake, true)
      .filter((openDecision) => openDecision.turn === 'ai' && RESOLVE_STEPS.has(openDecision.step))
      .map((openDecision) => openDecision.itemId),
  );
  return intake.items.filter((item) => openItemIds.has(item.id) && readAskedQuestions(item).length > 0);
}

// ── Building the request ──

const QUESTION_FIELDS: Record<ResolveQuestion, string> = {
  duplicate: 'verdict, key, confidence, reason',
  label: 'label',
  draft: 'summary, description (only if it needs a new Epic)',
};

function describeCandidate(candidate: DuplicateCandidate): string {
  const excerpt = candidate.descriptionExcerpt.trim().slice(0, MAX_EXCERPT_CHARS);
  return `    ${candidate.key} [${candidate.statusName}] ${candidate.summary}${excerpt ? ` — ${excerpt}` : ''}`;
}

function describeItemForResolve(item: IntakeItem, intake: EpicIntake): string {
  const questions = readAskedQuestions(item);
  const sharedNote = isSharedItem(item) ? ' (shared with Fulfillment — write Enrollment\'s part only)' : '';
  const noteLines = intake.lines.filter((line) => item.lineNumbers.includes(line.lineNumber)).map((line) => `    ${line.rawText}`);
  const candidateLines = questions.includes('duplicate')
    ? ['  Open Epics found for this item:', ...item.candidates.slice(0, MAX_CANDIDATES_IN_PROMPT).map(describeCandidate)]
    : [];
  return [
    `${item.id}: ${readItemDisplayTitle(item)}${sharedNote}`,
    `  Answer: ${questions.map((question) => QUESTION_FIELDS[question]).join('; ')}`,
    '  Notes:',
    ...noteLines,
    ...candidateLines,
  ].join('\n');
}

function buildResolveText(itemBlocks: readonly string[], projectKey: string, partLabel: string): string {
  return [
    `You are helping a Product Owner turn meeting notes into Jira Epics in the ${projectKey} project.`,
    'Answer only the fields listed for each item. The Product Owner reviews every answer in one table afterwards.',
    partLabel,
    '',
    ...itemBlocks,
    '',
    'Fields:',
    '- verdict: "existing" (with "key") when one of the Epics listed under that item already covers the same scope; "createNew" when none does.',
    '  Choose a key ONLY from that item\'s own list. Never use a key from another item\'s list, and never invent one.',
    '- confidence: "high" when you are sure, "low" when the Product Owner should look again.',
    '- label: Roadmap (new capability or funding ask) | Stability (upgrades, tech debt, compliance, performance)',
    `- summary: one line, under ${MAX_EPIC_SUMMARY_CHARS} characters — only when the item needs a new Epic.`,
    '- description: only when the item needs a new Epic. It MUST contain these nine sections, in this order, each as "Label:" on its own line:',
    ...SECTION_LABELS.map((label) => `  - ${label}`),
    `  Where the notes do not support a section, still include it and start it with ${VALIDATION_MARKER.business},`,
    `  ${VALIDATION_MARKER.technical} or ${VALIDATION_MARKER.both}.`,
    '  Use ONLY that item\'s own notes. Do not mention sizes or costs. Do not say who or what wrote the text.',
    '',
    'Rules: use only the item ids above; never invent an item.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${RESOLVE_REPLY_KIND}","items":[{"id":"item-1","verdict":"createNew","key":null,"confidence":"high","reason":"...","label":"Roadmap","summary":"...","description":"Description:\\n..."}]}`,
  ].join('\n');
}

interface ItemBlock {
  itemId: string;
  text: string;
}

/** Packs item blocks into consecutive parts within `maxChars`, breaking only between items. A huge item travels alone. */
function packItemBlocks(blocks: readonly ItemBlock[], maxChars: number): ItemBlock[][] {
  const parts: ItemBlock[][] = [];
  let currentPart: ItemBlock[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    if (currentPart.length > 0 && currentChars + block.text.length > maxChars) {
      parts.push(currentPart);
      currentPart = [];
      currentChars = 0;
    }
    currentPart.push(block);
    currentChars += block.text.length;
  }
  return currentPart.length > 0 ? [...parts, currentPart] : parts;
}

/**
 * Builds the resolve request for every item with a match, label or draft still the assistant's to answer, split
 * at item boundaries into parts that fit a chat paste. Each part lists exactly the items it asks about, so its
 * answer is checked against that part alone. An empty list means there is nothing left to ask.
 */
export function buildResolveRequests(intake: EpicIntake): ResolveRequest[] {
  // Blocks are measured as rendered, found Epics included — the notes alone would under-count a candidate-heavy item.
  const blocks = readResolveItems(intake).map((item) => ({ itemId: item.id, text: describeItemForResolve(item, intake) }));
  const parts = packItemBlocks(blocks, MAX_CHARS_PER_PROMPT - RESOLVE_INSTRUCTION_ALLOWANCE_CHARS);
  return parts.map((partBlocks, partIndex) => {
    const partLabel = parts.length > 1 ? `This is part ${partIndex + 1} of ${parts.length}.` : '';
    const request: IntakeRoundRequest = {
      text: buildResolveText(partBlocks.map((block) => block.text), intake.targetProjectKey, partLabel),
      itemIds: partBlocks.map((block) => block.itemId),
    };
    return { ...request, partIndex, partCount: parts.length };
  });
}

// ── Reading the answer ──

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function readResolveAnswer(rawItem: RawReplyItem, item: IntakeItem): ResolveAnswer {
  const fieldErrors: ResolveAnswer['fieldErrors'] = {};
  // A field the answer left out is simply not answered; only a field it filled in wrongly is an error.
  const verdictResult = isAbsent(rawItem.verdict) ? null : validateMatchVerdict(rawItem, item);
  if (typeof verdictResult === 'string') fieldErrors.verdict = verdictResult;
  const draftResult = isAbsent(rawItem.summary) && isAbsent(rawItem.description) ? null : readDraftFromReply(rawItem);
  if (typeof draftResult === 'string') fieldErrors.draft = draftResult;
  return {
    itemId: item.id,
    verdict: typeof verdictResult === 'string' ? null : verdictResult,
    isConfident: readVocabularyValue(rawItem.confidence, MATCH_CONFIDENCES) === 'high',
    label: readVocabularyValue(rawItem.label, INTAKE_LABELS),
    draft: typeof draftResult === 'string' ? null : draftResult,
    reason: readBoundedString(rawItem.reason, MAX_REASON_CHARS) ?? 'No reason given.',
    fieldErrors,
  };
}

/**
 * Validates one part's pasted answer against the items that part asked about. Never throws: an unreadable reply
 * comes back as one rejection with no item, and an item id the part did not ask about is rejected by name.
 */
export function parseResolveReply(replyText: string, intake: EpicIntake, askedItemIds: readonly string[]): IngestOutcome<ResolveAnswer> {
  const envelope = readReplyEnvelope(replyText, RESOLVE_REPLY_KIND);
  if (envelope.wholeReplyError !== null) {
    return { accepted: [], rejected: [{ itemId: null, reason: envelope.wholeReplyError }] };
  }
  const accepted: ResolveAnswer[] = [];
  const rejected: IngestRejection[] = [];
  for (const rawItem of envelope.items) {
    const itemId = resolveItemId(rawItem.id, askedItemIds);
    const item = intake.items.find((candidate) => candidate.id === itemId);
    if (itemId === null || item === undefined) {
      rejected.push({ itemId: typeof rawItem.id === 'string' ? rawItem.id : null, reason: `"${String(rawItem.id)}" is not an item in this request.` });
    } else if (!accepted.some((answer) => answer.itemId === itemId)) {
      accepted.push(readResolveAnswer(rawItem, item));
    }
  }
  return { accepted, rejected };
}

// ── Applying the answer ──

/** An item after one answer, plus the reasons any of its questions went unanswered (for the audit trail). */
interface ItemResolution {
  item: IntakeItem;
  rejections: IngestRejection[];
}

function applyVerdict(resolution: ItemResolution, answer: ResolveAnswer): ItemResolution {
  const { item } = resolution;
  if (answer.verdict === null) {
    const reason = answer.fieldErrors.verdict ?? 'No verdict given.';
    const duplicate = recordAiRejection(item.decisions.duplicate, reason);
    return { item: { ...item, decisions: { ...item.decisions, duplicate } }, rejections: [...resolution.rejections, { itemId: item.id, reason }] };
  }
  const reason = `${describeMatchVerdict(answer.verdict)}: ${answer.reason}`;
  const duplicate = settleDecision(item.decisions.duplicate, answer.verdict, 'ai', reason);
  // AI-first: an unsure match still settles, and the review table flags the row instead of asking a question.
  const reviewFlag = answer.isConfident ? item.reviewFlag : `Unsure match: ${answer.reason}`;
  return { ...resolution, item: { ...item, reviewFlag, decisions: { ...item.decisions, duplicate } } };
}

function applyLabel(resolution: ItemResolution, answer: ResolveAnswer): ItemResolution {
  const { item } = resolution;
  // Closed by the verdict (an existing Epic needs no label) or already answered by the PO: nothing to do.
  if (item.decisions.label.state !== 'open') {
    return resolution;
  }
  if (answer.label === null) {
    // A skipped label only counts once the item is known to need a new Epic; it may yet match an existing one.
    if (readSettledValue(item.decisions.duplicate)?.verdict !== 'createNew') {
      return resolution;
    }
    const reason = 'No label given — use Roadmap or Stability.';
    const label = recordAiRejection(item.decisions.label, reason);
    return { item: { ...item, decisions: { ...item.decisions, label } }, rejections: [...resolution.rejections, { itemId: item.id, reason }] };
  }
  const label = settleDecision(item.decisions.label, answer.label, 'ai', answer.reason);
  return { ...resolution, item: { ...item, decisions: { ...item.decisions, label } } };
}

function applyDraft(resolution: ItemResolution, answer: ResolveAnswer): ItemResolution {
  const { item } = resolution;
  const isNewEpic = readSettledValue(item.decisions.duplicate)?.verdict === 'createNew';
  // A draft the PO has edited is theirs; a later answer never replaces it.
  if (!isNewEpic || item.decisions.draftAccepted.state !== 'open' || item.draft?.editedByPo) {
    return resolution;
  }
  if (answer.draft === null) {
    const reason = answer.fieldErrors.draft ?? 'No draft for this item.';
    const draftAccepted = recordAiRejection(item.decisions.draftAccepted, reason);
    return { item: { ...item, decisions: { ...item.decisions, draftAccepted } }, rejections: [...resolution.rejections, { itemId: item.id, reason }] };
  }
  // The draft is stored, not accepted: clicking Create after the review is the PO's single confirmation.
  const draft = { ...answer.draft, summary: applySharedScopeSuffix(answer.draft.summary, isSharedItem(item)) };
  return { ...resolution, item: { ...item, draft } };
}

function applyAnswerToItem(item: IntakeItem, answer: ResolveAnswer): ItemResolution {
  const questions = readAskedQuestions(item);
  let resolution: ItemResolution = { item, rejections: [] };
  if (questions.includes('duplicate')) resolution = applyVerdict(resolution, answer);
  // Re-marked between steps, so an existing match closes the label and draft before they are looked at.
  resolution = { ...resolution, item: refreshApplicability(resolution.item) };
  if (questions.includes('label')) resolution = applyLabel(resolution, answer);
  if (questions.includes('draft')) resolution = applyDraft(resolution, answer);
  return { ...resolution, item: refreshApplicability(resolution.item) };
}

/** An asked item the answer skipped: one attempt against every question it was asked. */
function recordMissingAnswer(item: IntakeItem): ItemResolution {
  const questions = readAskedQuestions(item);
  const { decisions } = item;
  const missedDecisions = {
    ...decisions,
    duplicate: questions.includes('duplicate') ? recordAiRejection(decisions.duplicate, MISSING_ANSWER_REASON) : decisions.duplicate,
    label: questions.includes('label') ? recordAiRejection(decisions.label, MISSING_ANSWER_REASON) : decisions.label,
    draftAccepted: questions.includes('draft') ? recordAiRejection(decisions.draftAccepted, MISSING_ANSWER_REASON) : decisions.draftAccepted,
  };
  const rejections = questions.length > 0 ? [{ itemId: item.id, reason: MISSING_ANSWER_REASON }] : [];
  return { item: refreshApplicability({ ...item, decisions: missedDecisions }), rejections };
}

function resolveAskedItems(intake: EpicIntake, outcome: IngestOutcome<ResolveAnswer>, askedItemIds: readonly string[]): ItemResolution[] {
  return intake.items
    .filter((item) => askedItemIds.includes(item.id))
    .map((item) => {
      const answer = outcome.accepted.find((candidate) => candidate.itemId === item.id);
      return answer === undefined ? recordMissingAnswer(item) : applyAnswerToItem(item, answer);
    });
}

/**
 * Applies one part's parsed answer. A reply that could not be read at all changes nothing and costs no attempts —
 * the PO simply pastes again. Otherwise each asked item's match, label and draft are filled where the answer is
 * usable, a question it got wrong or skipped counts one attempt (two hand it to the PO), and the part is logged.
 */
export function applyResolveOutcome(
  intake: EpicIntake,
  outcome: IngestOutcome<ResolveAnswer>,
  askedItemIds: readonly string[],
  position: ResolvePartPosition,
  nowIso: string,
): EpicIntake {
  const isWholeReplyFailure = outcome.accepted.length === 0 && outcome.rejected.some((rejection) => rejection.itemId === null);
  const resolutions = isWholeReplyFailure ? [] : resolveAskedItems(intake, outcome, askedItemIds);
  const updated = resolutions.reduce((currentIntake, resolution) => replaceIntakeItem(currentIntake, resolution.item), intake);
  const roundRecord: RoundRecord = {
    kind: RESOLVE_REPLY_KIND,
    partIndex: position.partIndex,
    partCount: position.partCount,
    acceptedCount: outcome.accepted.length,
    rejected: [...outcome.rejected, ...resolutions.flatMap((resolution) => resolution.rejections)],
    ingestedAtIso: nowIso,
  };
  return { ...updated, updatedAtIso: nowIso, roundHistory: [...updated.roundHistory, roundRecord] };
}
