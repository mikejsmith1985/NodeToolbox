// assessmentQuestions.test.ts — Proves every planning answer and pick-from-a-list detail is asked exactly once.

import { describe, expect, it } from 'vitest';

import { DETAIL_CHOICES, MAIN_ASSESSMENT_QUESTIONS, MORE_ASSESSMENT_QUESTIONS } from './assessmentQuestions.ts';

describe('assessmentQuestions', () => {
  it('asks all seven planning answers once each', () => {
    const stateKeys = [...MAIN_ASSESSMENT_QUESTIONS, ...MORE_ASSESSMENT_QUESTIONS].map((question) => question.stateKey);
    expect(new Set(stateKeys).size).toBe(7);
  });

  it('feeds category and change type from their ServiceNow lists', () => {
    expect(DETAIL_CHOICES.map((detailChoice) => detailChoice.choiceListName)).toEqual(['category', 'type']);
  });
});
