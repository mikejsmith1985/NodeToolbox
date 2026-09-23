// checklistAiAssist.test.ts — The reply becomes a readiness verdict a team acts on, so the reader has to be
// strict: only criteria that were offered, only once each, three honest statuses, and never a pass on no evidence.

import { describe, expect, it } from 'vitest';

import { buildChecklistPrompt, listSatisfiedCriterionIds, parseChecklistIngest } from './checklistAiAssist.ts';
import type { EpicChecklistSource } from './checklistField.ts';
import { DEFAULT_DOR_CRITERIA, DEFAULT_READINESS_CRITERIA } from './dorCriteria.ts';

const EPIC: EpicChecklistSource = {
  issueKey: 'DENP-1436',
  summary: '[GIPM] - Preprocessor MBI History Enhancement',
  status: 'In Progress',
  description: 'Members enrol through the AEP channel. Stakeholders signed off the objective on 12 August.',
  acceptanceCriteria: 'Given a member enrols, the confirmation is issued within one day.',
  checklistText: '',
};

const CRITERION_IDS = DEFAULT_READINESS_CRITERIA.map((criterion) => criterion.id);
const FIRST_DOR_ID = DEFAULT_DOR_CRITERIA[0].id;
const SECOND_DOR_ID = DEFAULT_DOR_CRITERIA[1].id;

/** A reply naming only the two criteria a test cares about, against those two ids. */
function buildReply(items: unknown[]): string {
  return JSON.stringify({ kind: 'epicReadinessReview', items });
}

describe('buildChecklistPrompt', () => {
  it('gives the assistant the Epic before the criteria', () => {
    const prompt = buildChecklistPrompt(EPIC, DEFAULT_READINESS_CRITERIA);
    expect(prompt.indexOf('Preprocessor MBI History')).toBeLessThan(prompt.indexOf('Judge the Epic against'));
  });

  it('lists each criterion under its own definition, with its id and group', () => {
    const prompt = buildChecklistPrompt(EPIC, DEFAULT_READINESS_CRITERIA);

    expect(prompt).toContain('Definition of Ready:');
    expect(prompt).toContain('Definition of Done:');
    expect(prompt).toContain(`${FIRST_DOR_ID} — [Business Readiness] Business objective`);
  });

  it('asks for three honest statuses and for what is still missing', () => {
    const prompt = buildChecklistPrompt(EPIC, DEFAULT_READINESS_CRITERIA);

    expect(prompt).toContain('"partial"');
    expect(prompt).toContain('cannot be\n    "satisfied" without evidence');
    expect(prompt).toContain('what would have to be added to the Epic');
  });

  it('tells the assistant not to treat status, age or children as evidence', () => {
    expect(buildChecklistPrompt(EPIC, DEFAULT_READINESS_CRITERIA))
      .toContain('not treat the Epic\'s status, its age, or the existence of child issues as evidence');
  });

  it('includes the Epic’s children when there are any', () => {
    expect(buildChecklistPrompt(EPIC, DEFAULT_READINESS_CRITERIA, ['  DENP-1437 — Done — Build intake']))
      .toContain('DENP-1437 — Done — Build intake');
  });
});

describe('parseChecklistIngest', () => {
  it('reads the three statuses, with evidence and what is missing', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { criterionId: FIRST_DOR_ID, status: 'satisfied', evidence: 'Stakeholders signed off on 12 August.', whatIsMissing: '' },
        { criterionId: SECOND_DOR_ID, status: 'partial', evidence: 'AC exists for enrolment only.', whatIsMissing: 'AC for the rejection path.' },
      ]),
      [FIRST_DOR_ID, SECOND_DOR_ID],
    );

    expect(errors).toEqual([]);
    expect(verdicts[0]).toEqual({
      criterionId: FIRST_DOR_ID,
      status: 'satisfied',
      evidence: 'Stakeholders signed off on 12 August.',
      whatIsMissing: '',
    });
    expect(verdicts[1].status).toBe('partial');
    expect(listSatisfiedCriterionIds(verdicts)).toEqual([FIRST_DOR_ID]);
  });

  it('downgrades a pass that quoted nothing, and says why', () => {
    const { verdicts } = parseChecklistIngest(
      buildReply([{ criterionId: FIRST_DOR_ID, status: 'satisfied', evidence: '   ', whatIsMissing: '' }]),
      [FIRST_DOR_ID],
    );

    expect(verdicts[0].status).toBe('partial');
    expect(verdicts[0].whatIsMissing).toContain('nothing in the Epic was quoted');
  });

  it('refuses a criterion it was never shown', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { criterionId: 'dor-invented', status: 'satisfied', evidence: 'Looks fine.', whatIsMissing: '' },
        { criterionId: FIRST_DOR_ID, status: 'missing', evidence: '', whatIsMissing: 'State the objective.' },
      ]),
      [FIRST_DOR_ID],
    );

    expect(verdicts).toHaveLength(1);
    expect(errors[0]).toContain('dor-invented');
  });

  it('reports an unusable status as missing rather than guessing in the Epic’s favour', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([{ criterionId: FIRST_DOR_ID, status: 'probably fine', evidence: 'Some words.', whatIsMissing: '' }]),
      [FIRST_DOR_ID],
    );

    expect(verdicts[0].status).toBe('missing');
    expect(errors[0]).toContain('no usable status');
  });

  it('keeps the first answer when a criterion is answered twice', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { criterionId: FIRST_DOR_ID, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' },
        { criterionId: FIRST_DOR_ID, status: 'missing', evidence: '', whatIsMissing: 'Actually not.' },
      ]),
      [FIRST_DOR_ID],
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].status).toBe('satisfied');
    expect(errors.some((error) => error.includes('answered twice'))).toBe(true);
  });

  it('names the criteria that went unanswered', () => {
    const { errors } = parseChecklistIngest(
      buildReply([{ criterionId: FIRST_DOR_ID, status: 'missing', evidence: '', whatIsMissing: 'State it.' }]),
      CRITERION_IDS,
    );

    expect(errors.some((error) => error.includes(SECOND_DOR_ID))).toBe(true);
  });

  it('reads a reply wrapped in prose or a code fence', () => {
    const { verdicts } = parseChecklistIngest(
      `Here you go:\n\`\`\`json\n${buildReply([
        { criterionId: FIRST_DOR_ID, status: 'missing', evidence: '', whatIsMissing: 'State the objective.' },
      ])}\n\`\`\``,
      [FIRST_DOR_ID],
    );

    expect(verdicts).toHaveLength(1);
  });

  it('turns an unusable reply into one plain message rather than throwing', () => {
    expect(parseChecklistIngest('I could not do that.', CRITERION_IDS).errors).toHaveLength(1);
    expect(parseChecklistIngest(JSON.stringify({ kind: 'featureCompositionIngest', items: [] }), CRITERION_IDS).errors[0])
      .toContain('is not epicReadinessReview');
  });
});
