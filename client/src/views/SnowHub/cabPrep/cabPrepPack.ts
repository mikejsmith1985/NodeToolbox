// cabPrepPack.ts — The answers, arranged as something you can actually read in a meeting.
//
// A JSON reply is not a prep pack. What a presenter needs is grouped by concern (a board asks a
// theme at a time), leads with what is NOT answered (that is what catches people out), and is
// copyable into a document, because the person presenting is often not the person who ran this.
//
// Pure formatting. No fetching, no writing, no clock.

import { CAB_CONCERN_LABELS, CAB_QUESTIONS, type CabConcern } from './cabQuestionBank.ts';
import { readUnansweredQuestionIds, type CabPreparedAnswer } from './cabPrepPrompt.ts';

/** One concern's worth of prepared answers. */
export interface CabPackSection {
  concern: CabConcern;
  heading: string;
  answers: CabPreparedAnswer[];
}

/** The pack: what is prepared, and what is not. */
export interface CabPrepPack {
  sections: CabPackSection[];
  /** Answered from the facts. */
  answeredCount: number;
  /** The model said the facts could not support an answer — a real finding, not a failure. */
  unanswerableAnswers: CabPreparedAnswer[];
  /** Questions the reply never returned at all. */
  missingQuestionTexts: string[];
}

/**
 * Groups the answers into the sections a board works through.
 *
 * Concern order comes from the bank, not from the reply: a pack whose sections move around between
 * runs is harder to use than one that is always the same shape, and the presenter is reading it
 * under pressure.
 */
export function buildCabPrepPack(answers: readonly CabPreparedAnswer[]): CabPrepPack {
  const concernOrder: CabConcern[] = [];
  CAB_QUESTIONS.forEach((question) => {
    if (!concernOrder.includes(question.concern)) concernOrder.push(question.concern);
  });

  const sections = concernOrder
    .map((concern) => ({
      concern,
      heading: CAB_CONCERN_LABELS[concern],
      answers: answers.filter((answer) => answer.concern === concern),
    }))
    // A concern nobody answered contributes no section rather than an empty heading.
    .filter((section) => section.answers.length > 0);

  const missingIds = new Set(readUnansweredQuestionIds(answers));

  return {
    sections,
    answeredCount: answers.filter((answer) => !answer.isUnanswerable).length,
    unanswerableAnswers: answers.filter((answer) => answer.isUnanswerable),
    missingQuestionTexts: CAB_QUESTIONS
      .filter((question) => missingIds.has(question.id))
      .map((question) => question.question),
  };
}

/**
 * Renders the pack as Markdown, ready to paste into a document or a message.
 *
 * The gaps come FIRST. A presenter who reads only the top of this should still walk in knowing what
 * they cannot answer — that is the failure mode the whole feature exists to prevent, and burying it
 * under thirty good answers would reintroduce it.
 */
export function formatCabPrepPack(pack: CabPrepPack, changeNumber: string): string {
  const lines: string[] = [
    `# CAB preparation — ${changeNumber || '(change not yet created)'}`,
    '',
    `${pack.answeredCount} question(s) answered from the change and its scope.`,
    '',
  ];

  if (pack.unanswerableAnswers.length > 0) {
    lines.push(
      `## Cannot be answered from what is recorded (${pack.unanswerableAnswers.length})`,
      '',
      'Fix these before the meeting, or be ready to say them out loud.',
      '',
    );
    pack.unanswerableAnswers.forEach((answer) => {
      lines.push(`- **${answer.question}**`);
      if (answer.whatWouldAnswerIt !== '') {
        lines.push(`  - What would answer it: ${answer.whatWouldAnswerIt}`);
      }
    });
    lines.push('');
  }

  if (pack.missingQuestionTexts.length > 0) {
    lines.push(
      `## Not covered by the reply (${pack.missingQuestionTexts.length})`,
      '',
      'The assistant did not return these. Ask again, or answer them yourself.',
      '',
      ...pack.missingQuestionTexts.map((questionText) => `- ${questionText}`),
      '',
    );
  }

  pack.sections.forEach((section) => {
    lines.push(`## ${section.heading}`, '');
    section.answers.forEach((answer) => {
      lines.push(`**${answer.question}**`, '');
      lines.push(answer.isUnanswerable
        ? `_Not answerable from what is recorded._${answer.whatWouldAnswerIt ? ` ${answer.whatWouldAnswerIt}` : ''}`
        : answer.answer);
      lines.push('');
    });
  });

  return lines.join('\n').trimEnd();
}
