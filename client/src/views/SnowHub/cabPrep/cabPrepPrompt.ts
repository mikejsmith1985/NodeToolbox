// cabPrepPrompt.ts — The one prompt, and the reply it is allowed to come back with.
//
// The model's job is narrow on purpose: answer OUR questions against THESE facts. It does not choose
// the questions (the bank does), does not gather the facts (the fact sheet does), and cannot write
// anything to ServiceNow or Jira — this produces a document a person reads before a meeting.
//
// The rule that matters most: an unanswerable question must come back UNANSWERED, naming the field
// that would have answered it. A board meeting is exactly where a confident invention does damage,
// because the answer is repeated aloud by someone who trusts it.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
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

/** Spells out the reply shape, including that there is nowhere to put a new question. */
function buildReplyInstruction(): string {
  return [
    '',
    'Reply with JSON only, in exactly this shape:',
    '{"kind":"cabPrep","answers":[{"questionId":"...","answer":"...",'
      + '"isUnanswerable":false,"whatWouldAnswerIt":""}]}',
    'Use the questionId values exactly as given. Do not add questions of your own.',
    'No other properties are permitted on an answer.',
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
  const payload = JSON.parse(extractJsonPayload(replyText)) as { kind?: unknown; answers?: unknown };

  if (payload.kind !== 'cabPrep') {
    throw new Error(`This reply is for "${String(payload.kind)}", not "cabPrep".`);
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
