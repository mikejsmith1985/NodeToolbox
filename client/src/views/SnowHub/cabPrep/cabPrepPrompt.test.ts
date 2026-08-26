// cabPrepPrompt.test.ts — One prompt, and the reply it is allowed to come back with.

import { describe, expect, it } from 'vitest';

import { buildCabFactSheet, type CabChangeFacts } from './cabFactSheet.ts';
import { buildCabPrepPrompt, parseCabPrepReply, readUnansweredQuestionIds } from './cabPrepPrompt.ts';
import { CAB_QUESTIONS } from './cabQuestionBank.ts';

const CHANGE: CabChangeFacts = {
  changeNumber: 'CHG0041298',
  shortDescription: 'Enrollment - Cleanup Crew - SF integration uplift',
  description: 'Moves the enrolment feed onto the new transformer.',
  justification: 'The current feed breaches its SLA twice a month.',
  riskImpactAnalysis: 'Medium.',
  implementationPlan: 'Deploy and verify.',
  backoutPlan: 'Redeploy the previous artefact.',
  testPlan: 'Regression pack in INT.',
  assessment: { Impact: '2 - Medium' },
  environments: [{ name: 'PRD', plannedStart: '2026-09-10 22:00', plannedEnd: '2026-09-11 02:00' }],
  changeTaskNames: ['Deploy transformer'],
};

const FACT_SHEET = buildCabFactSheet(CHANGE, [{
  key: 'ENCUC-2213',
  summary: '[DEV] COB/MSP ingestion',
  issueType: 'Story',
  status: 'Done',
  assignee: 'Ramirez, Dana',
  storyPoints: 3,
  isComplete: true,
}]);

function replyWith(answers: unknown[]): string {
  return JSON.stringify({ kind: 'cabPrep', answers });
}

describe('buildCabPrepPrompt', () => {
  it('puts the facts BEFORE the questions', () => {
    // So the model reads what it has before it reads what it is being asked, which reduces the pull
    // to answer from the question's phrasing rather than from the evidence.
    const prompt = buildCabPrepPrompt(FACT_SHEET);

    expect(prompt.indexOf('=== THE FACTS ===')).toBeLessThan(prompt.indexOf('=== THE QUESTIONS TO ANSWER ==='));
  });

  it('carries every question in the bank, by id', () => {
    const prompt = buildCabPrepPrompt(FACT_SHEET);

    CAB_QUESTIONS.forEach((question) => {
      expect(prompt).toContain(`[${question.id}]`);
    });
  });

  it('tells the model what each question is really checking', () => {
    // "Why do we have to do this?" is rarely a request for the business case — it is a test of
    // whether the change could have waited.
    const prompt = buildCabPrepPrompt(FACT_SHEET);

    expect(prompt).toContain('what they are really asking:');
    expect(prompt).toContain('regulatory date, a dependency, an expiring');
  });

  it('forbids answering a question the facts cannot support', () => {
    const prompt = buildCabPrepPrompt(FACT_SHEET);

    expect(prompt).toContain('ANSWER ONLY FROM THE FACTS BELOW');
    expect(prompt).toContain('repeated aloud to directors');
  });

  it('forbids the model adding questions of its own', () => {
    // The value of the pack is that it is the same shape every week.
    expect(buildCabPrepPrompt(FACT_SHEET)).toContain('Do not add questions of your own.');
  });

  it('embeds the gap list, so an empty field cannot be answered from', () => {
    const emptyBackout = buildCabFactSheet({ ...CHANGE, backoutPlan: '' }, []);

    expect(buildCabPrepPrompt(emptyBackout)).toContain('Empty change fields: Backout plan');
  });
});

describe('parseCabPrepReply', () => {
  it('keeps an answer that matches a question in the bank', () => {
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'why-now', answer: 'The vendor contract lapses on the 30th.', isUnanswerable: false, whatWouldAnswerIt: '' },
    ]));

    expect(ingest.answers[0].question).toBe('Why does this have to go now rather than next cycle?');
    expect(ingest.answers[0].concern).toBe('justification');
  });

  it('keeps an UNANSWERABLE verdict, which is itself an answer a board needs', () => {
    // "We have no backout plan" must not be silently dropped for having an empty answer.
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'backout-tested', answer: '', isUnanswerable: true, whatWouldAnswerIt: 'A recorded backout rehearsal.' },
    ]));

    expect(ingest.answers).toHaveLength(1);
    expect(ingest.answers[0].isUnanswerable).toBe(true);
    expect(ingest.answers[0].whatWouldAnswerIt).toBe('A recorded backout rehearsal.');
  });

  it('rejects a question the bank never asked', () => {
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'invented-question', answer: 'x', isUnanswerable: false, whatWouldAnswerIt: '' },
    ]));

    expect(ingest.answers).toEqual([]);
    expect(ingest.rejectedItems[0].reason).toBe('is not a question from the bank');
  });

  it('rejects an empty answer that was not marked unanswerable', () => {
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'why-now', answer: '   ', isUnanswerable: false, whatWouldAnswerIt: '' },
    ]));

    expect(ingest.rejectedItems[0].reason).toBe('has no answer and was not marked unanswerable');
  });

  it('rejects an answer carrying a property the schema does not have', () => {
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'why-now', answer: 'x', isUnanswerable: false, whatWouldAnswerIt: '', confidence: 0.9 },
    ]));

    expect(ingest.rejectedItems[0].reason).toContain('unexpected property "confidence"');
  });

  it('keeps the good answers when one is malformed', () => {
    // One bad item must not discard thirty good ones the morning of a meeting.
    const ingest = parseCabPrepReply(replyWith([
      { questionId: 'why-now', answer: 'Contract lapses.', isUnanswerable: false, whatWouldAnswerIt: '' },
      { questionId: 'nonsense', answer: 'x', isUnanswerable: false, whatWouldAnswerIt: '' },
    ]));

    expect(ingest.answers).toHaveLength(1);
    expect(ingest.rejectedItems).toHaveLength(1);
  });

  it('refuses a reply meant for a different prompt', () => {
    expect(() => parseCabPrepReply(JSON.stringify({ kind: 'piReview', answers: [] })))
      .toThrow('not "cabPrep"');
  });

  it('refuses a reply with no answers array', () => {
    expect(() => parseCabPrepReply(JSON.stringify({ kind: 'cabPrep' })))
      .toThrow('carries no answers array');
  });
});

describe('readUnansweredQuestionIds', () => {
  it('names the questions the reply never came back with', () => {
    // A question that silently vanished is one the presenter walks in without and does not know it.
    const unanswered = readUnansweredQuestionIds([{
      questionId: 'why-now',
      question: 'x',
      concern: 'justification',
      answer: 'y',
      isUnanswerable: false,
      whatWouldAnswerIt: '',
    }]);

    expect(unanswered).not.toContain('why-now');
    expect(unanswered).toContain('backout-tested');
  });

  it('reports every question as unanswered for an empty reply', () => {
    expect(readUnansweredQuestionIds([])).toHaveLength(CAB_QUESTIONS.length);
  });
});
