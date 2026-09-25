// readinessReport.ts — The Definition of Ready / Definition of Done validation report.
//
// This is the point of the tool. A PO asking "is this Epic ready?" wants a verdict with reasons: what is
// satisfied and on what evidence, what is only half-there, what is missing, and what would have to be written
// down to close each gap. Ticking checklist boxes is a consequence of the report, not the purpose of it.
//
// Pure: a report is built from criteria plus verdicts and nothing else, so the screen, the copied markdown and
// any checkbox it later ticks are all reading one computation (the surfaces-agree-by-construction rule).

import { DEFINITION_LABELS, type CriteriaSource, type ReadinessCriterion, type ReadinessDefinition } from './dorCriteria.ts';
import { buildReportMarkup, type ReportFlavour, type ReportMarkup } from './reportMarkup.ts';

/** How well the Epic meets one criterion. Three states, because "partly" is the answer that usually matters. */
export type CriterionStatus = 'satisfied' | 'partial' | 'missing';

/** What the assistant concluded about one criterion. */
export interface CriterionVerdict {
  criterionId: string;
  status: CriterionStatus;
  /** The words in the Epic that support the verdict. Required for 'satisfied' — see the ingest rules. */
  evidence: string;
  /** What is still needed. The half of the report a PO can act on. */
  whatIsMissing: string;
}

/** One line of the report: the criterion, and what was found for it. */
export interface ReportRow {
  criterion: ReadinessCriterion;
  /** Absent when the assistant did not answer for this criterion — reported as unanswered, never as a pass. */
  verdict: CriterionVerdict | null;
}

/** The whole report for one Epic. */
export interface ReadinessReport {
  issueKey: string;
  issueSummary: string;
  /** Whether the criteria came from the Epic's own checklist or from the standard template. */
  criteriaSource: CriteriaSource;
  rows: ReportRow[];
  /** How many criteria are satisfied, partial, missing and unanswered, per definition. */
  totals: Record<ReadinessDefinition, ReadinessTotals>;
}

/** The counts a PO reads first. */
export interface ReadinessTotals {
  satisfied: number;
  partial: number;
  missing: number;
  unanswered: number;
  total: number;
}

/** What each status is called on screen and in the copied report. */
export const STATUS_LABELS: Record<CriterionStatus, string> = {
  satisfied: 'Satisfied',
  partial: 'Partly satisfied',
  missing: 'Missing',
};

/** A plain marker per status, so the copied report reads at a glance in Jira, Teams or Confluence. */
const STATUS_MARKERS: Record<CriterionStatus, string> = {
  satisfied: '✅',
  partial: '🟡',
  missing: '❌',
};

function buildEmptyTotals(): ReadinessTotals {
  return { satisfied: 0, partial: 0, missing: 0, unanswered: 0, total: 0 };
}

/** Counts the rows per definition. An unanswered criterion counts as unanswered, never as satisfied. */
function countTotals(rows: readonly ReportRow[]): Record<ReadinessDefinition, ReadinessTotals> {
  const totals: Record<ReadinessDefinition, ReadinessTotals> = { dor: buildEmptyTotals(), dod: buildEmptyTotals() };

  rows.forEach((row) => {
    const definitionTotals = totals[row.criterion.definition];
    definitionTotals.total += 1;
    if (!row.verdict) {
      definitionTotals.unanswered += 1;
      return;
    }
    definitionTotals[row.verdict.status] += 1;
  });

  return totals;
}

/** Builds the report: every criterion appears, answered or not. */
export function buildReadinessReport(input: {
  issueKey: string;
  issueSummary: string;
  criteria: readonly ReadinessCriterion[];
  verdicts: readonly CriterionVerdict[];
  criteriaSource: CriteriaSource;
}): ReadinessReport {
  const verdictByCriterionId = new Map(input.verdicts.map((verdict) => [verdict.criterionId, verdict]));
  const rows: ReportRow[] = input.criteria.map((criterion) => ({
    criterion,
    verdict: verdictByCriterionId.get(criterion.id) ?? null,
  }));

  return {
    issueKey: input.issueKey,
    issueSummary: input.issueSummary,
    criteriaSource: input.criteriaSource,
    rows,
    totals: countTotals(rows),
  };
}

/** The one-line verdict on a definition: ready, or not ready and why not. */
export function describeDefinitionVerdict(totals: ReadinessTotals, definition: ReadinessDefinition): string {
  const definitionLabel = DEFINITION_LABELS[definition];
  if (totals.total === 0) {
    return `${definitionLabel}: no criteria to check.`;
  }
  if (totals.unanswered > 0) {
    return `${definitionLabel}: not fully checked — ${totals.unanswered} of ${totals.total} criteria were not answered.`;
  }
  if (totals.satisfied === totals.total) {
    return `${definitionLabel}: MET — all ${totals.total} criteria are satisfied.`;
  }
  const outstandingCount = totals.partial + totals.missing;
  return `${definitionLabel}: NOT MET — ${totals.satisfied} of ${totals.total} satisfied, `
    + `${outstandingCount} still outstanding (${totals.partial} partly, ${totals.missing} missing).`;
}

/** The rows a PO has to act on, in report order. */
export function listOutstandingRows(report: ReadinessReport): ReportRow[] {
  return report.rows.filter((row) => !row.verdict || row.verdict.status !== 'satisfied');
}

/** Writes one row as the copied report shows it, in the markup of wherever it is going. */
function formatReportRow(row: ReportRow, markup: ReportMarkup): string[] {
  if (!row.verdict) {
    return [markup.bullet(1, `❔ ${markup.bold(row.criterion.text)} — not answered.`)];
  }
  const lines = [
    markup.bullet(1, `${STATUS_MARKERS[row.verdict.status]} ${markup.bold(row.criterion.text)} — ${STATUS_LABELS[row.verdict.status]}`),
  ];
  if (row.verdict.whatIsMissing !== '') {
    lines.push(markup.bullet(2, `Still needed: ${row.verdict.whatIsMissing}`));
  }
  if (row.verdict.evidence !== '') {
    lines.push(markup.bullet(2, `What the Epic says: ${row.verdict.evidence}`));
  }
  return lines;
}

/** Groups a definition's rows under their section headers, in the order they were given. */
function formatDefinitionSection(
  report: ReadinessReport,
  definition: ReadinessDefinition,
  markup: ReportMarkup,
): string[] {
  const definitionRows = report.rows.filter((row) => row.criterion.definition === definition);
  if (definitionRows.length === 0) {
    return [];
  }

  const lines = [
    '',
    markup.heading(2, DEFINITION_LABELS[definition]),
    '',
    describeDefinitionVerdict(report.totals[definition], definition),
    '',
  ];
  let lastSection = '';

  definitionRows.forEach((row) => {
    if (row.criterion.section !== lastSection && row.criterion.section !== '') {
      lines.push(markup.heading(3, row.criterion.section));
      lastSection = row.criterion.section;
    }
    lines.push(...formatReportRow(row, markup));
  });

  return lines;
}

/**
 * Writes the report for pasting into Jira, Teams or Confluence.
 *
 * The header says which criteria were used, because a report checked against the standard template rather than
 * this Epic's own checklist is a slightly different claim, and the reader is entitled to know which it is.
 */
export function formatReadinessReport(report: ReadinessReport, flavour: ReportFlavour = 'markdown'): string {
  const markup = buildReportMarkup(flavour);
  // Says which criteria were used and stops there. Whether Toolbox could read the Epic's own checklist is its
  // own plumbing, and a reader of the Epic has no use for it.
  const sourceNote = report.criteriaSource === 'issueChecklist'
    ? 'Checked against this Epic’s own checklist.'
    : 'Checked against the team’s standard Definition of Ready and Definition of Done.';

  return markup.finalize([
    markup.heading(1, `Readiness review — ${report.issueKey}: ${report.issueSummary}`),
    '',
    sourceNote,
    ...formatDefinitionSection(report, 'dor', markup),
    ...formatDefinitionSection(report, 'dod', markup),
    '',
  ]);
}
