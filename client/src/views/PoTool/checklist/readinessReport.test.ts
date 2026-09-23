// readinessReport.test.ts — The report is what a team acts on, so it must never overstate readiness: an
// unanswered criterion is not a pass, and the verdict line has to say NOT MET while anything is outstanding.

import { describe, expect, it } from 'vitest';

import { DEFAULT_DOR_CRITERIA, DEFAULT_READINESS_CRITERIA } from './dorCriteria.ts';
import {
  buildReadinessReport,
  describeDefinitionVerdict,
  formatReadinessReportMarkdown,
  listOutstandingRows,
  type CriterionVerdict,
} from './readinessReport.ts';

/** Every DoR criterion satisfied, with evidence. */
function buildAllSatisfiedVerdicts(): CriterionVerdict[] {
  return DEFAULT_DOR_CRITERIA.map((criterion) => ({
    criterionId: criterion.id,
    status: 'satisfied' as const,
    evidence: 'The Epic says so.',
    whatIsMissing: '',
  }));
}

describe('buildReadinessReport', () => {
  it('has a row for every criterion, answered or not', () => {
    const report = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'Preprocessor MBI History Enhancement',
      criteria: DEFAULT_READINESS_CRITERIA,
      verdicts: [],
      criteriaSource: 'standardTemplate',
    });

    expect(report.rows).toHaveLength(DEFAULT_READINESS_CRITERIA.length);
    expect(report.rows.every((row) => row.verdict === null)).toBe(true);
  });

  it('counts an unanswered criterion as unanswered, never as satisfied', () => {
    const report = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'An Epic',
      criteria: DEFAULT_DOR_CRITERIA,
      verdicts: [{ criterionId: DEFAULT_DOR_CRITERIA[0].id, status: 'satisfied', evidence: 'Signed off.', whatIsMissing: '' }],
      criteriaSource: 'issueChecklist',
    });

    expect(report.totals.dor).toEqual({
      satisfied: 1,
      partial: 0,
      missing: 0,
      unanswered: DEFAULT_DOR_CRITERIA.length - 1,
      total: DEFAULT_DOR_CRITERIA.length,
    });
  });

  it('counts each definition separately', () => {
    const report = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'An Epic',
      criteria: DEFAULT_READINESS_CRITERIA,
      verdicts: buildAllSatisfiedVerdicts(),
      criteriaSource: 'standardTemplate',
    });

    expect(report.totals.dor.satisfied).toBe(DEFAULT_DOR_CRITERIA.length);
    expect(report.totals.dod.satisfied).toBe(0);
  });
});

describe('describeDefinitionVerdict', () => {
  it('says MET only when every criterion is satisfied', () => {
    expect(describeDefinitionVerdict({ satisfied: 6, partial: 0, missing: 0, unanswered: 0, total: 6 }, 'dor'))
      .toContain('MET — all 6 criteria are satisfied');
  });

  it('says NOT MET, with what is outstanding', () => {
    const verdictLine = describeDefinitionVerdict({ satisfied: 3, partial: 2, missing: 1, unanswered: 0, total: 6 }, 'dor');
    expect(verdictLine).toContain('NOT MET — 3 of 6 satisfied');
    expect(verdictLine).toContain('2 partly, 1 missing');
  });

  it('refuses to call a partly-checked definition met', () => {
    expect(describeDefinitionVerdict({ satisfied: 5, partial: 0, missing: 0, unanswered: 1, total: 6 }, 'dor'))
      .toContain('not fully checked');
  });
});

describe('listOutstandingRows', () => {
  it('returns what the PO has to act on, and nothing that is done', () => {
    const report = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'An Epic',
      criteria: DEFAULT_DOR_CRITERIA,
      verdicts: buildAllSatisfiedVerdicts(),
      criteriaSource: 'issueChecklist',
    });

    expect(listOutstandingRows(report)).toEqual([]);
  });
});

describe('formatReadinessReportMarkdown', () => {
  it('reads as a report: the Epic, the verdict, then the criteria with evidence and gaps', () => {
    const report = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'Preprocessor MBI History Enhancement',
      criteria: DEFAULT_DOR_CRITERIA,
      verdicts: [
        { criterionId: DEFAULT_DOR_CRITERIA[0].id, status: 'satisfied', evidence: 'Signed off on 12 August.', whatIsMissing: '' },
        { criterionId: DEFAULT_DOR_CRITERIA[1].id, status: 'missing', evidence: '', whatIsMissing: 'Write the acceptance criteria.' },
      ],
      criteriaSource: 'issueChecklist',
    });
    const markdown = formatReadinessReportMarkdown(report);

    expect(markdown).toContain('# Readiness review — DENP-1436: Preprocessor MBI History Enhancement');
    expect(markdown).toContain('## Definition of Ready');
    expect(markdown).toContain('### Business Readiness');
    expect(markdown).toContain('Evidence: Signed off on 12 August.');
    expect(markdown).toContain('Still needed: Write the acceptance criteria.');
    expect(markdown).toContain('❔');
  });

  it('says which criteria it checked against, because that changes what the report claims', () => {
    const standardReport = buildReadinessReport({
      issueKey: 'DENP-1436',
      issueSummary: 'An Epic',
      criteria: DEFAULT_DOR_CRITERIA,
      verdicts: [],
      criteriaSource: 'standardTemplate',
    });

    expect(formatReadinessReportMarkdown(standardReport)).toContain('standard Definition of Ready and Done');
    expect(formatReadinessReportMarkdown({ ...standardReport, criteriaSource: 'issueChecklist' }))
      .toContain('this Epic’s own checklist');
  });
});
