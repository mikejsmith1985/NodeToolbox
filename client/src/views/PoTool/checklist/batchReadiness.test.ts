// batchReadiness.test.ts — Reviewing twenty Epics at once is exactly where a plausible verdict can end up
// attached to the wrong Epic, so these prove the reply is bound to the keys that were actually asked about.

import { describe, expect, it } from 'vitest';

import {
  buildBatchReadinessPrompts,
  buildBatchReadinessReport,
  buildBatchSummary,
  formatBatchReportMarkdown,
  DEFAULT_MAX_VERDICTS_PER_PART,
  MAX_CHARS_PER_PROMPT,
  parseBatchReadinessIngest,
  type BatchEpic,
} from './batchReadiness.ts';
import { DEFAULT_DOR_CRITERIA, DEFAULT_READINESS_CRITERIA } from './dorCriteria.ts';
import type { CriterionVerdict } from './readinessReport.ts';

const FIRST_CRITERION_ID = DEFAULT_DOR_CRITERIA[0].id;
const SECOND_CRITERION_ID = DEFAULT_DOR_CRITERIA[1].id;

function buildEpic(issueKey: string, overrides: Partial<BatchEpic['source']> = {}): BatchEpic {
  return {
    source: {
      issueKey,
      summary: `${issueKey} summary`,
      status: 'In Progress',
      description: 'Stakeholders signed off the objective on 12 August.',
      acceptanceCriteria: 'Given a member enrols…',
      checklistText: '',
      ...overrides,
    },
    childSummaryLines: [`  ${issueKey}-child — Done — Build it`],
  };
}

function buildReply(items: unknown[]): string {
  return JSON.stringify({ kind: 'epicReadinessBatch', items });
}

describe('buildBatchReadinessPrompts', () => {
  it('covers the whole batch in one prompt when it fits', () => {
    const prompts = buildBatchReadinessPrompts([buildEpic('DENP-1'), buildEpic('DENP-2')], DEFAULT_DOR_CRITERIA);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('DENP-1');
    expect(prompts[0]).toContain('DENP-2');
    expect(prompts[0]).not.toContain('Part 1 of');
  });

  it('splits a batch that outgrows the cap, and numbers the parts', () => {
    const hugeDescription = 'x'.repeat(2000);
    const epics = Array.from({ length: 12 }, (_unusedEntry, index) => buildEpic(`DENP-${index}`, { description: hugeDescription }));

    const prompts = buildBatchReadinessPrompts(epics, DEFAULT_DOR_CRITERIA);

    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[0]).toContain(`Part 1 of ${prompts.length}`);
    prompts.forEach((prompt) => expect(prompt.length).toBeLessThanOrEqual(MAX_CHARS_PER_PROMPT * 1.5));
  });

  it('repeats the criteria in every part, so a part is a complete brief', () => {
    const epics = Array.from({ length: 12 }, (_unusedEntry, index) => buildEpic(`DENP-${index}`, { description: 'y'.repeat(2000) }));

    buildBatchReadinessPrompts(epics, DEFAULT_DOR_CRITERIA).forEach((prompt) => {
      expect(prompt).toContain(FIRST_CRITERION_ID);
      expect(prompt).toContain('cannot be "satisfied"');
    });
  });

  it('tells the assistant that evidence from one Epic never counts for another', () => {
    expect(buildBatchReadinessPrompts([buildEpic('DENP-1')], DEFAULT_DOR_CRITERIA)[0])
      .toContain('evidence from one Epic never counts for another');
  });

  it('builds nothing for an empty batch', () => {
    expect(buildBatchReadinessPrompts([], DEFAULT_DOR_CRITERIA)).toEqual([]);
  });
});

describe('parseBatchReadinessIngest', () => {
  it('groups the verdicts by the Epic they belong to', () => {
    const { verdictsByIssueKey, errors } = parseBatchReadinessIngest(
      buildReply([
        { key: 'DENP-1', criterionId: FIRST_CRITERION_ID, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' },
        { key: 'DENP-2', criterionId: FIRST_CRITERION_ID, status: 'missing', evidence: '', whatIsMissing: 'State the objective.' },
      ]),
      ['DENP-1', 'DENP-2'],
      [FIRST_CRITERION_ID],
    );

    expect(errors).toEqual([]);
    expect(verdictsByIssueKey['DENP-1'][0].status).toBe('satisfied');
    expect(verdictsByIssueKey['DENP-2'][0].whatIsMissing).toBe('State the objective.');
  });

  it('drops a verdict for an Epic that was not in the query', () => {
    const { verdictsByIssueKey, errors } = parseBatchReadinessIngest(
      buildReply([{ key: 'OTHER-9', criterionId: FIRST_CRITERION_ID, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' }]),
      ['DENP-1'],
      [FIRST_CRITERION_ID],
    );

    expect(verdictsByIssueKey).toEqual({});
    expect(errors[0]).toContain('OTHER-9');
  });

  it('matches keys regardless of the case they come back in', () => {
    const { verdictsByIssueKey } = parseBatchReadinessIngest(
      buildReply([{ key: 'denp-1', criterionId: FIRST_CRITERION_ID, status: 'missing', evidence: '', whatIsMissing: 'Write it.' }]),
      ['DENP-1'],
      [FIRST_CRITERION_ID],
    );

    expect(verdictsByIssueKey['DENP-1']).toHaveLength(1);
  });

  it('will not pass a criterion the assistant quoted nothing for', () => {
    const { verdictsByIssueKey } = parseBatchReadinessIngest(
      buildReply([{ key: 'DENP-1', criterionId: FIRST_CRITERION_ID, status: 'satisfied', evidence: '', whatIsMissing: '' }]),
      ['DENP-1'],
      [FIRST_CRITERION_ID],
    );

    expect(verdictsByIssueKey['DENP-1'][0].status).toBe('partial');
  });

  it('keeps the first answer when one Epic answers a criterion twice', () => {
    const { verdictsByIssueKey, errors } = parseBatchReadinessIngest(
      buildReply([
        { key: 'DENP-1', criterionId: FIRST_CRITERION_ID, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' },
        { key: 'DENP-1', criterionId: FIRST_CRITERION_ID, status: 'missing', evidence: '', whatIsMissing: 'No.' },
      ]),
      ['DENP-1'],
      [FIRST_CRITERION_ID],
    );

    expect(verdictsByIssueKey['DENP-1']).toHaveLength(1);
    expect(errors.some((error) => error.includes('twice'))).toBe(true);
  });

  it('turns an unusable reply into one plain message', () => {
    expect(parseBatchReadinessIngest('nope', ['DENP-1'], [FIRST_CRITERION_ID]).errors).toHaveLength(1);
    expect(parseBatchReadinessIngest(JSON.stringify({ kind: 'epicReadinessReview', items: [] }), ['DENP-1'], [FIRST_CRITERION_ID]).errors[0])
      .toContain('is not epicReadinessBatch');
  });
});

describe('the batch report', () => {
  const EPICS = [buildEpic('DENP-1'), buildEpic('DENP-2')];
  const CRITERIA_BY_KEY = {
    'DENP-1': { criteria: DEFAULT_DOR_CRITERIA.slice(0, 2), source: 'standardTemplate' as const },
    'DENP-2': { criteria: DEFAULT_DOR_CRITERIA.slice(0, 2), source: 'issueChecklist' as const },
  };
  const VERDICTS: Record<string, CriterionVerdict[]> = {
    'DENP-1': [
      { criterionId: FIRST_CRITERION_ID, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' },
      { criterionId: SECOND_CRITERION_ID, status: 'satisfied', evidence: 'AC are written.', whatIsMissing: '' },
    ],
    'DENP-2': [
      { criterionId: FIRST_CRITERION_ID, status: 'missing', evidence: '', whatIsMissing: 'State the objective.' },
    ],
  };

  function buildBatch() {
    return buildBatchReadinessReport({
      jql: 'project = DENP AND issuetype = Epic',
      epics: EPICS,
      criteriaByIssueKey: CRITERIA_BY_KEY,
      verdictsByIssueKey: VERDICTS,
    });
  }

  it('builds one report per Epic, in the order the query returned them', () => {
    expect(buildBatch().reports.map((report) => report.issueKey)).toEqual(['DENP-1', 'DENP-2']);
  });

  it('summarises each Epic in words rather than a fraction to decode', () => {
    const [firstRow, secondRow] = buildBatchSummary(buildBatch());

    expect(firstRow.dorVerdict).toBe('MET — all 2');
    expect(firstRow.outstandingCount).toBe(0);
    expect(secondRow.dorVerdict).toBe('0 of 2 met · 1 gap · 1 unanswered');
  });

  it('counts an unanswered criterion as outstanding, because it is certainly not met', () => {
    // The reported oddity: nine outstanding reported beside one unanswered, which did not add up.
    const [, secondRow] = buildBatchSummary(buildBatch());

    expect(secondRow.outstandingCount).toBe(2);
  });

  it('says an Epic nobody reviewed was not reviewed, rather than counting it as ready', () => {
    const batch = buildBatchReadinessReport({
      jql: 'x',
      epics: EPICS,
      criteriaByIssueKey: CRITERIA_BY_KEY,
      verdictsByIssueKey: {},
    });

    expect(buildBatchSummary(batch).every((row) => row.isReviewed === false)).toBe(true);
    expect(buildBatchSummary(batch)[0].dorVerdict).toBe('not reviewed');
  });

  it('writes one document: the query, a summary table, then each Epic in detail', () => {
    const markdown = formatBatchReportMarkdown(buildBatch());

    expect(markdown).toContain('Query: `project = DENP AND issuetype = Epic`');
    expect(markdown).toContain('| Epic | Summary | Definition of Ready | Definition of Done | Outstanding |');
    expect(markdown).toContain('| DENP-1 | DENP-1 summary | MET — all 2 |');
    expect(markdown).toContain('## DENP-2 — DENP-2 summary');
    expect(markdown).toContain('Still needed: State the objective.');
    expect(markdown).toContain('Epics reviewed: 2 of 2');
  });
});

// ── Parts are sized by the REPLY, not the prompt (GH #387) ──

describe('how a batch is split', () => {
  /** The reported case: eighteen Epics against the team's eleven criteria. */
  const EIGHTEEN_EPICS = Array.from({ length: 18 }, (_unusedEntry, index) => buildEpic(`DENP-${index + 1}`));

  it('asks for no more answers per part than an assistant will finish', () => {
    // Six Epics fitted the old character cap and then asked for sixty-six verdicts, which came back truncated.
    const prompts = buildBatchReadinessPrompts(EIGHTEEN_EPICS, DEFAULT_READINESS_CRITERIA);
    const epicsPerPart = prompts.map((prompt) => (prompt.match(/^### DENP-/gm) ?? []).length);

    expect(Math.max(...epicsPerPart) * DEFAULT_READINESS_CRITERIA.length)
      .toBeLessThanOrEqual(DEFAULT_MAX_VERDICTS_PER_PART);
    expect(epicsPerPart.reduce((total, count) => total + count, 0)).toBe(18);
  });

  it('honours a smaller budget for an assistant that writes shorter replies', () => {
    const prompts = buildBatchReadinessPrompts(EIGHTEEN_EPICS, DEFAULT_READINESS_CRITERIA, DEFAULT_READINESS_CRITERIA.length);

    expect(prompts).toHaveLength(18);
    expect((prompts[0].match(/^### DENP-/gm) ?? [])).toHaveLength(1);
  });

  it('still puts one Epic in a part when the criteria alone exceed the budget', () => {
    const prompts = buildBatchReadinessPrompts(EIGHTEEN_EPICS, DEFAULT_READINESS_CRITERIA, 3);

    expect(prompts).toHaveLength(18);
  });

  it('asks for short answers, because a truncated long one is worth less than a finished short one', () => {
    expect(buildBatchReadinessPrompts([buildEpic('DENP-1')], DEFAULT_READINESS_CRITERIA)[0])
      .toContain('under 25 words');
  });

  it('demands the gap be written as an instruction the PO can act on', () => {
    const prompt = buildBatchReadinessPrompts([buildEpic('DENP-1')], DEFAULT_READINESS_CRITERIA)[0];

    expect(prompt).toContain('Start it with a verb and name the specific thing to write');
    expect(prompt).toContain('not "dependencies should be identified"');
  });
});
