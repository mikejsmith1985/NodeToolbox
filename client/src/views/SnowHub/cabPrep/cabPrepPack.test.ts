// cabPrepPack.test.ts — Answers arranged as something a presenter can read under pressure.

import { describe, expect, it } from 'vitest';

import { buildCabPrepPack, formatCabPrepPack } from './cabPrepPack.ts';
import type { CabPreparedAnswer } from './cabPrepPrompt.ts';

function answer(overrides: Partial<CabPreparedAnswer> = {}): CabPreparedAnswer {
  return {
    questionId: 'why-now',
    question: 'Why does this have to go now rather than next cycle?',
    concern: 'justification',
    answer: 'The vendor contract lapses on the 30th.',
    isUnanswerable: false,
    whatWouldAnswerIt: '',
    ...overrides,
  };
}

describe('buildCabPrepPack', () => {
  it('groups answers under the concern a board works through', () => {
    const pack = buildCabPrepPack([
      answer(),
      answer({ questionId: 'how-back-out', concern: 'backout', question: 'How do we back this out?' }),
    ]);

    expect(pack.sections.map((section) => section.concern)).toEqual(['justification', 'backout']);
  });

  it('keeps the bank-s concern order, not the reply-s', () => {
    // A pack whose sections move between runs is harder to use, and the presenter is reading it
    // under pressure.
    const pack = buildCabPrepPack([
      answer({ questionId: 'how-back-out', concern: 'backout', question: 'x' }),
      answer(),
    ]);

    expect(pack.sections[0].concern).toBe('justification');
  });

  it('leaves out a concern nobody answered rather than showing an empty heading', () => {
    const pack = buildCabPrepPack([answer()]);

    expect(pack.sections).toHaveLength(1);
  });

  it('counts an unanswerable verdict separately from an answer', () => {
    const pack = buildCabPrepPack([
      answer(),
      answer({ questionId: 'backout-tested', concern: 'backout', isUnanswerable: true, answer: '' }),
    ]);

    expect(pack.answeredCount).toBe(1);
    expect(pack.unanswerableAnswers).toHaveLength(1);
  });

  it('names the questions the reply never returned', () => {
    const pack = buildCabPrepPack([answer()]);

    expect(pack.missingQuestionTexts.length).toBeGreaterThan(0);
    expect(pack.missingQuestionTexts).not.toContain('Why does this have to go now rather than next cycle?');
  });
});

describe('formatCabPrepPack', () => {
  it('puts the GAPS first, above thirty good answers', () => {
    // A presenter who reads only the top should still walk in knowing what they cannot answer.
    const pack = buildCabPrepPack([
      answer(),
      answer({
        questionId: 'backout-tested',
        concern: 'backout',
        question: 'Has the backout itself been tested?',
        isUnanswerable: true,
        answer: '',
        whatWouldAnswerIt: 'A recorded backout rehearsal.',
      }),
    ]);

    const markdown = formatCabPrepPack(pack, 'CHG0041298');

    expect(markdown.indexOf('Cannot be answered')).toBeLessThan(markdown.indexOf('## Why at all'));
    expect(markdown).toContain('A recorded backout rehearsal.');
  });

  it('names the change it prepared for', () => {
    expect(formatCabPrepPack(buildCabPrepPack([answer()]), 'CHG0041298')).toContain('CHG0041298');
  });

  it('says the change does not exist yet rather than printing a blank heading', () => {
    expect(formatCabPrepPack(buildCabPrepPack([answer()]), '')).toContain('(change not yet created)');
  });

  it('shows the questions the reply skipped, so they can be asked again', () => {
    const markdown = formatCabPrepPack(buildCabPrepPack([answer()]), 'CHG1');

    expect(markdown).toContain('Not covered by the reply');
    expect(markdown).toContain('Has the backout itself been tested?');
  });

  it('renders an answer under its question, as Markdown a document can take', () => {
    const markdown = formatCabPrepPack(buildCabPrepPack([answer()]), 'CHG1');

    expect(markdown).toContain('**Why does this have to go now rather than next cycle?**');
    expect(markdown).toContain('The vendor contract lapses on the 30th.');
  });

  it('omits both gap sections when there is nothing to report', () => {
    const everyAnswer = buildCabPrepPack([answer()]);
    everyAnswer.missingQuestionTexts = [];

    const markdown = formatCabPrepPack(everyAnswer, 'CHG1');

    expect(markdown).not.toContain('Cannot be answered');
    expect(markdown).not.toContain('Not covered by the reply');
  });
});
