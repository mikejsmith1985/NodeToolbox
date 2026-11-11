// cabPrepPrompt.ts — The one prompt, and the reply it is allowed to come back with.
//
// The model's job is narrow on purpose: answer OUR questions against THESE facts. It does not choose
// the questions (the bank does), does not gather the facts (the fact sheet does), and cannot write
// anything to ServiceNow or Jira — this produces a document a person reads before a meeting.
//
// The rule that matters most: an unanswerable question must come back UNANSWERED, naming the field
// that would have answered it. A board meeting is exactly where a confident invention does damage,
// because the answer is repeated aloud by someone who trusts it.
//
// Google's AI Mode — the team's only assistant since 2026-11 (GH #499) — ignores a JSON reply format but completes a
// table. So the prompt ends with a fill-in table listing every question, and its reader turns the table back into the
// same JSON every rule below already checks. A JSON reply still reads. Questions left blank get a follow-up for the SAME
// chat asking for just those rows — an answer is never guessed for them.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import {
  CAB_CONCERN_LABELS,
  CAB_QUESTIONS,
  type CabConcern,
  type CabQuestion,
} from './cabQuestionBank.ts';
import { formatCabFactSheet, type CabFactSheet } from './cabFactSheet.ts';

/** One prepared answer, as the pack renders it. */
export interface CabPreparedAnswer {
  questionId: string;
  question: string;
  concern: CabConcern;
  /** The answer, or an empty string when the facts could not support one. */
  answer: string;
  /**
   * True when the model reported it could not answer from the facts given.
   *
   * Kept as its own flag rather than inferred from an empty answer, because "we have no backout
   * plan" is itself an answer a board needs to hear, and it must not be silently dropped.
   */
  isUnanswerable: boolean;
  /** What is needed to answer it — a CHG field, a person, a test result. */
  whatWouldAnswerIt: string;
}

/** A parsed reply: what came back usable, and what did not. */
export interface CabPrepIngest {
  answers: CabPreparedAnswer[];
  /** Items the reply carried that no question in the bank matches. */
  rejectedItems: Array<{ id: string; reason: string }>;
}

/** The only properties an answer may carry. Anything else is the model inventing a field. */
const ALLOWED_ANSWER_PROPERTIES = new Set(['questionId', 'answer', 'isUnanswerable', 'whatWouldAnswerIt']);

/** The instruction block, stated before the model sees anything it could be tempted to embellish. */
const PROMPT_PREAMBLE = [
  'You are preparing someone to present a change at a Change Advisory Board.',
  '',
  'ANSWER ONLY FROM THE FACTS BELOW. You have no other knowledge of this change.',
  'If the facts do not support an answer, say so — set "isUnanswerable" and name what would answer it.',
  'A confident guess is the worst possible output here: it will be repeated aloud to directors by',
  'someone who trusts it, and they will be the one caught out, not you.',
  '',
  'Do not soften a gap. "There is no backout plan recorded" is a useful answer; inventing a',
  'plausible backout procedure is not.',
  'Do not describe yourself, and do not attribute the text to an assistant.',
  '',
].join('\n');

/**
 * The reply as a fill-in table: one row per bank question, its id and words filled in. Each column becomes the answer
 * property of the same name, so every rule on a JSON answer applies to a table row unchanged.
 */
export const CAB_PREP_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'cabPrep',
  replyMarker: 'CAB_PREP_TABLE:',
  columns: [
    { field: 'questionId', header: 'Question ID' },
    { field: 'question', header: 'Question', isNamingOnly: true },
    { field: 'answer', header: 'Answer', answerHint: 'two or three sentences, as the presenter would say them out loud' },
    { field: 'isUnanswerable', header: 'Unanswerable', valueKind: 'boolean', answerHint: 'yes when the facts do not support an answer, otherwise no' },
    { field: 'whatWouldAnswerIt', header: 'What would answer it', answerHint: 'only for an unanswerable question: the CHG field, person or test result that would answer it' },
  ],
};

/** Each question's naming cells — its id and its words — for one table row. */
function buildQuestionRows(questionIds: readonly string[]): string[][] {
  return CAB_QUESTIONS
    .filter((question) => questionIds.includes(question.id))
    .map((question) => [question.id, question.question]);
}

/** Spells out the reply shape, including that there is nowhere to put a new question. */
function buildReplyInstruction(): string {
  return [
    '',
    'Do not add questions of your own. Do not change a Question ID.',
    buildRecordReplyInstructions(CAB_PREP_REPLY_SPEC, buildQuestionRows(CAB_QUESTIONS.map((question) => question.id))),
  ].join('\n');
}

/** One question as the prompt states it: the words, and the concern behind them. */
function describeQuestion(question: CabQuestion): string {
  return `  - [${question.id}] ${question.question}\n`
    + `      what they are really asking: ${question.whatTheyAreReallyAsking}`;
}

/** The question bank, grouped by concern so the model answers a theme at a time. */
function describeQuestionBank(): string[] {
  const concernOrder: CabConcern[] = [];
  CAB_QUESTIONS.forEach((question) => {
    if (!concernOrder.includes(question.concern)) concernOrder.push(question.concern);
  });

  return concernOrder.flatMap((concern) => [
    '',
    `${CAB_CONCERN_LABELS[concern].toUpperCase()}:`,
    ...CAB_QUESTIONS.filter((question) => question.concern === concern).map((question) => describeQuestion(question)),
  ]);
}

/**
 * Builds the CAB preparation prompt.
 *
 * The facts come BEFORE the questions so the model reads what it has before it reads what it is
 * being asked — which measurably reduces the temptation to answer from the question's phrasing
 * rather than from the evidence.
 */
export function buildCabPrepPrompt(factSheet: CabFactSheet): string {
  return [
    PROMPT_PREAMBLE,
    '=== THE FACTS ===',
    formatCabFactSheet(factSheet),
    '',
    '=== THE QUESTIONS TO ANSWER ===',
    'Answer every one. Where the facts do not support an answer, mark it unanswerable.',
    ...describeQuestionBank(),
    '',
    'Write each answer as the presenter would say it out loud: two or three sentences, specific,',
    'naming issue keys, dates and people where the facts give them.',
    buildReplyInstruction(),
  ].join('\n');
}

/** Reads one answer, or explains why it cannot be used. */
function readAnswer(
  rawAnswer: unknown,
  index: number,
  questionsById: ReadonlyMap<string, CabQuestion>,
): { answer: CabPreparedAnswer } | { rejection: { id: string; reason: string } } {
  const candidate = rawAnswer as Record<string, unknown>;
  const questionId = typeof candidate?.questionId === 'string' ? candidate.questionId.trim() : `answer ${index + 1}`;

  const unexpectedProperty = Object.keys(candidate ?? {})
    .find((propertyName) => !ALLOWED_ANSWER_PROPERTIES.has(propertyName));
  if (unexpectedProperty !== undefined) {
    return { rejection: { id: questionId, reason: `carries an unexpected property "${unexpectedProperty}"` } };
  }

  const question = questionsById.get(questionId);
  if (question === undefined) {
    // A question nobody asked. Rejected rather than shown: the value of the pack is that it is the
    // same shape every week, and a model-invented question breaks that quietly.
    return { rejection: { id: questionId, reason: 'is not a question from the bank' } };
  }

  const isUnanswerable = candidate?.isUnanswerable === true;
  const answerText = typeof candidate?.answer === 'string' ? candidate.answer.trim() : '';
  if (!isUnanswerable && answerText === '') {
    return { rejection: { id: questionId, reason: 'has no answer and was not marked unanswerable' } };
  }

  return {
    answer: {
      questionId,
      question: question.question,
      concern: question.concern,
      answer: answerText,
      isUnanswerable,
      whatWouldAnswerIt: typeof candidate?.whatWouldAnswerIt === 'string'
        ? candidate.whatWouldAnswerIt.trim()
        : '',
    },
  };
}

/**
 * Parses a pasted reply, keeping what is usable and naming what is not.
 *
 * Never all-or-nothing: one malformed answer must not discard thirty good ones the morning of a
 * meeting. The rejections are reported rather than dropped, because an answer that silently vanished
 * is one the presenter walks in without and does not know it.
 */
export function parseCabPrepReply(replyText: string): CabPrepIngest {
  const payload = JSON.parse(extractRecordReplyPayload(replyText, CAB_PREP_REPLY_SPEC)) as { kind?: unknown; answers?: unknown; items?: unknown };

  if (payload.kind !== 'cabPrep') {
    throw new Error(`This reply is for "${String(payload.kind)}", not "cabPrep".`);
  }
  // A filled-in table is read back as "items"; a JSON reply carries "answers".
  if (payload.answers === undefined && Array.isArray(payload.items)) {
    payload.answers = payload.items;
  }
  if (!Array.isArray(payload.answers)) {
    throw new Error('The reply carries no answers array.');
  }

  const questionsById = new Map(CAB_QUESTIONS.map((question) => [question.id, question]));
  const answers: CabPreparedAnswer[] = [];
  const rejectedItems: Array<{ id: string; reason: string }> = [];

  payload.answers.forEach((rawAnswer, index) => {
    const outcome = readAnswer(rawAnswer, index, questionsById);
    if ('answer' in outcome) {
      answers.push(outcome.answer);
      return;
    }
    rejectedItems.push(outcome.rejection);
  });

  return { answers, rejectedItems };
}

/** Which bank questions the reply never came back with, so the gap is visible before the meeting. */
export function readUnansweredQuestionIds(answers: readonly CabPreparedAnswer[]): string[] {
  const answeredIds = new Set(answers.map((answer) => answer.questionId));
  return CAB_QUESTIONS.filter((question) => !answeredIds.has(question.id)).map((question) => question.id);
}

/**
 * One round's answers so far: a follow-up reply answers only the questions left out, so its answers are added to the
 * earlier ones, a question answered twice taking its later answer.
 */
export function mergeCabPreparedAnswers(
  earlierAnswers: readonly CabPreparedAnswer[],
  laterAnswers: readonly CabPreparedAnswer[],
): CabPreparedAnswer[] {
  const laterIds = new Set(laterAnswers.map((answer) => answer.questionId));
  return [...earlierAnswers.filter((answer) => !laterIds.has(answer.questionId)), ...laterAnswers];
}

/**
 * The follow-up for the same AI chat, or '' when every question has an answer. An unreadable reply gets the whole table
 * again; a reply that left questions out gets a table of only those, so the answers already given are kept.
 */
export function buildCabPrepFollowUp(answers: readonly CabPreparedAnswer[], wasReplyUnreadable: boolean): string {
  if (wasReplyUnreadable) {
    return buildRecordFormatFixPrompt(CAB_PREP_REPLY_SPEC, buildQuestionRows(CAB_QUESTIONS.map((question) => question.id)));
  }
  const unansweredIds = readUnansweredQuestionIds(answers);
  if (unansweredIds.length === 0) {
    return '';
  }
  return [
    `Your last reply left ${unansweredIds.length} ${unansweredIds.length === 1 ? 'question' : 'questions'} out. Answer only these now, from the same facts.`,
    buildRecordReplyInstructions(CAB_PREP_REPLY_SPEC, buildQuestionRows(unansweredIds)),
  ].join('\n');
}
