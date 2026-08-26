// cabQuestionBank.test.ts — The bank is ours, so its shape is a thing to protect.

import { describe, expect, it } from 'vitest';

import {
  CAB_CONCERN_LABELS,
  CAB_QUESTIONS,
  readCommonlyUnpreparedQuestions,
  readOrderedConcerns,
  readQuestionsForConcern,
} from './cabQuestionBank.ts';

describe('the question bank', () => {
  it('gives every question a unique id, because the reply is keyed on them', () => {
    const questionIds = CAB_QUESTIONS.map((question) => question.id);

    expect(new Set(questionIds).size).toBe(questionIds.length);
  });

  it('says what every question is really checking', () => {
    // Without it the model answers the wording. "Why do we have to do this?" is rarely a request for
    // the business case.
    CAB_QUESTIONS.forEach((question) => {
      expect(question.whatTheyAreReallyAsking.length).toBeGreaterThan(20);
    });
  });

  it('covers the four the user named, which are the ones everybody expects', () => {
    const questionIds = CAB_QUESTIONS.map((question) => question.id);

    expect(questionIds).toEqual(expect.arrayContaining([
      'why-at-all', 'impact-if-we-do', 'impact-if-we-dont',
    ]));
  });

  it('covers the harder ones a director asks ninth', () => {
    // The point of the feature: the obvious four get prepared anyway.
    const questionIds = CAB_QUESTIONS.map((question) => question.id);

    expect(questionIds).toEqual(expect.arrayContaining([
      'backout-tested',       // almost always "no", and better said than discovered
      'what-was-not-tested',  // every change has a gap; claiming none means nobody looked
      'point-of-no-return',   // when the real go/no-go is
      'data-touched',         // whether a backout restores anything
      'single-point',         // key-person risk
      'scope-changed',        // late descoping, and what it did to the testing
    ]));
  });

  it('labels every concern it uses', () => {
    readOrderedConcerns().forEach((concern) => {
      expect(CAB_CONCERN_LABELS[concern]).toBeTruthy();
    });
  });

  it('groups every question under a concern that has a label', () => {
    CAB_QUESTIONS.forEach((question) => {
      expect(Object.keys(CAB_CONCERN_LABELS)).toContain(question.concern);
    });
  });
});

describe('readQuestionsForConcern', () => {
  it('returns only that concern-s questions', () => {
    const backoutQuestions = readQuestionsForConcern('backout');

    expect(backoutQuestions.length).toBeGreaterThan(0);
    backoutQuestions.forEach((question) => expect(question.concern).toBe('backout'));
  });
});

describe('readCommonlyUnpreparedQuestions', () => {
  it('names a substantial share of the bank, because that is where the value is', () => {
    const unprepared = readCommonlyUnpreparedQuestions();

    expect(unprepared.length).toBeGreaterThanOrEqual(10);
    expect(unprepared.length).toBeLessThan(CAB_QUESTIONS.length);
  });

  it('does not flag the obvious four — those get prepared anyway', () => {
    const unpreparedIds = readCommonlyUnpreparedQuestions().map((question) => question.id);

    expect(unpreparedIds).not.toContain('why-at-all');
    expect(unpreparedIds).not.toContain('impact-if-we-do');
    expect(unpreparedIds).not.toContain('impact-if-we-dont');
  });
});

describe('readOrderedConcerns', () => {
  it('leads with justification, which is where a board starts', () => {
    expect(readOrderedConcerns()[0]).toBe('justification');
  });

  it('lists each concern once', () => {
    const concerns = readOrderedConcerns();

    expect(new Set(concerns).size).toBe(concerns.length);
  });
});
