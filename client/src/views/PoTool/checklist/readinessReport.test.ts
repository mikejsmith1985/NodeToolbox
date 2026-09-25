// readinessReport.test.ts — The report is what a team acts on, so it must never overstate readiness: an
// unanswered criterion is not a pass, and the verdict line has to say NOT MET while anything is outstanding.

import { describe, expect, it } from 'vitest';

import { DEFAULT_DOR_CRITERIA, DEFAULT_READINESS_CRITERIA } from './dorCriteria.ts';
import {
  buildReadinessReport,
  describeDefinitionVerdict,
  formatReadinessReport,
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

describe('formatReadinessReport', () => {
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
    const markdown = formatReadinessReport(report);

    expect(markdown).toContain('# Readiness review — DENP-1436: Preprocessor MBI History Enhancement');
    expect(markdown).toContain('## Definition of Ready');
    expect(markdown).toContain('### Business Readiness');
    expect(markdown).toContain('What the Epic says: Signed off on 12 August.');
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

    expect(formatReadinessReport(standardReport))
      .toContain('standard Definition of Ready and Definition of Done');
    // How Toolbox obtained the criteria is its own business, not something a reader of the Epic needs.
    expect(formatReadinessReport(standardReport)).not.toContain('could not be read');
    expect(formatReadinessReport({ ...standardReport, criteriaSource: 'issueChecklist' }))
      .toContain('this Epic’s own checklist');
  });
});

// ── The same report, in the markup of wherever it is pasted (GH #387) ──

describe('formatReadinessReport — Jira', () => {
  function buildReport() {
    return buildReadinessReport({
      issueKey: 'DENP-1440',
      issueSummary: 'EGWP - Disable SmartyAddress Validation',
      criteria: DEFAULT_DOR_CRITERIA.slice(0, 1),
      verdicts: [{
        criterionId: DEFAULT_DOR_CRITERIA[0].id,
        status: 'partial',
        evidence: 'Business reported inconsistent behaviour.',
        whatIsMissing: 'Define measurable success criteria.',
      }],
      criteriaSource: 'standardTemplate',
    });
  }

  it('writes headings and emphasis the way Jira renders them', () => {
    const jiraReport = formatReadinessReport(buildReport(), 'jira');

    expect(jiraReport).toContain('h1. Readiness review — DENP-1440');
    expect(jiraReport).toContain('h2. Definition of Ready');
    expect(jiraReport).toContain('h3. Business Readiness');
    expect(jiraReport).not.toContain('## ');
    // Jira emphasises with one asterisk; two would be Markdown's bold, shown literally in a Jira comment.
    // (Two asterisks at the START of a line are Jira's nested bullet, which is why this checks the text itself.)
    expect(jiraReport).not.toContain(`**${DEFAULT_DOR_CRITERIA[0].text}**`);
    expect(jiraReport).toContain(`*${DEFAULT_DOR_CRITERIA[0].text}*`);
  });

  it('nests the detail with repeated bullets, which is how Jira nests', () => {
    const jiraReport = formatReadinessReport(buildReport(), 'jira');

    expect(jiraReport).toContain('** Still needed: Define measurable success criteria.');
    expect(jiraReport).toContain('** What the Epic says: Business reported inconsistent behaviour.');
  });

  it('still writes Markdown when Markdown is what is wanted', () => {
    expect(formatReadinessReport(buildReport(), 'markdown')).toContain('## Definition of Ready');
  });
});
