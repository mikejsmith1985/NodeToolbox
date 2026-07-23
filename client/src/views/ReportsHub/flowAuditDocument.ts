// flowAuditDocument.ts — Renders the Personal Workflow report as an auditable Markdown document.
//
// The report states things about how named people are performing. Numbers like that get quoted, so
// they have to be checkable: every metric carries its meaning and formula, every claim carries a
// Jira link that returns exactly the issues behind it, and the one figure no Jira search can
// reproduce — hands-on cycle time — carries a worked example proving how it was derived.
//
// Two economies keep a whole-team document readable: a metric is explained ONCE (the derivation is
// identical for everyone), and the links are PER PERSON (so no individual's number hides inside an
// aggregate). Per-issue detail goes last, where it supports the figures without burying them.
//
// The generator is pure — the timestamp is injected, nothing is fetched — so the document itself is
// exhaustively unit-testable. For a feature whose value is trustworthiness, that is the point.

import {
  buildCreditedIssuesLink,
  buildExcludedIssuesLink,
  buildFetchedIssuesLink,
} from './flowAuditLinks.ts';
import {
  FLOW_AUDIT_METRICS,
  renderMetricExplanation,
  renderWorkedExample,
} from './flowAuditMetrics.ts';
import type { PersonalFlowExclusionReason, PersonalFlowResult } from './personalFlow.ts';

/** The facts about the run itself, which let the document stand alone. */
export interface RunEnvelope {
  rosterLabel: string;
  windowDays: number;
  windowStartIso: string;
  windowEndIso: string;
  /** Passed in, never read from the clock — this is what keeps the generator deterministic. */
  generatedAtIso: string;
  toolVersion: string;
  ceilingReached: { kind: 'per-person' | 'run-budget'; affectedPeople: string[] } | null;
  /** Null when unconfigured; links then degrade to query text rather than breaking. */
  jiraBaseUrl: string | null;
}

/** One person's row: their figures, or an honest reason there are none. */
export interface PersonAuditRow {
  personDisplayName: string;
  roleLabels: string;
  figures: PersonalFlowResult | null;
  errorMessage: string | null;
  /** How many issues were fetched before the engine's windowing — the reconciliation's top line. */
  fetchedIssueCount: number;
  ceilingReached: 'per-person' | 'run-budget' | null;
}

export interface FlowAuditInput {
  envelope: RunEnvelope;
  /** Every person in the roster, INCLUDING those whose analysis failed. */
  rows: PersonAuditRow[];
  /** Status id → display name, so the worked example reads in Jira's own vocabulary. */
  statusNamesById: Readonly<Record<string, string>>;
}

/** Plain-English explanations for why fetched issues were not credited. */
const EXCLUSION_EXPLANATIONS: Record<PersonalFlowExclusionReason, string> = {
  'not-owned': 'Never assigned to this person at any point, so none of their time is in it.',
  'wip-open': 'Still open and still assigned to them — work in progress, not yet completed.',
  'completed-out-of-window': 'They finished it, but before this reporting window began.',
};

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatNullable(value: number | null): string {
  return value === null ? 'n/a' : formatValue(value);
}

/** Renders a link as markdown, or as bare query text when no base URL was configured. */
function renderLink(label: string, link: { href: string; queryText: string; isClickable: boolean }): string {
  return link.isClickable ? `[${label}](${link.href})` : `${label} — \`${link.queryText}\``;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function renderHeader(envelope: RunEnvelope): string {
  return [
    `# Personal Workflow — audit report: ${envelope.rosterLabel}`,
    '',
    `| | |`,
    `|---|---|`,
    `| Roster | ${envelope.rosterLabel} |`,
    `| Window | ${envelope.windowDays} days (${envelope.windowStartIso.slice(0, 10)} → ${envelope.windowEndIso.slice(0, 10)}) |`,
    `| Generated | ${envelope.generatedAtIso} |`,
    `| Tool version | ${envelope.toolVersion} |`,
    '',
    '> **What this is.** Delivery figures for **named individuals**, with the working shown for each '
      + 'number and links to the exact Jira issues behind it. Anyone who can read this page can read '
      + 'these figures and the issue summaries they quote.',
  ].join('\n');
}

/** The completeness notice — only when a ceiling stopped the analysis seeing everything. */
function renderCompletenessNotice(envelope: RunEnvelope): string {
  if (!envelope.ceilingReached) {
    return '';
  }
  const ceilingLabel = envelope.ceilingReached.kind === 'per-person'
    ? 'the per-person issue ceiling'
    : 'the overall run budget';
  return [
    '',
    `> ⚠️ **These figures are incomplete.** The analysis stopped at ${ceilingLabel}, so the numbers `
      + `below describe a subset of the work in this window, not all of it. Affected: `
      + `**${envelope.ceilingReached.affectedPeople.join(', ')}**.`,
  ].join('\n');
}

function renderTeamFigures(input: FlowAuditInput): string {
  const headerRows = [
    '## Team figures',
    '',
    '| Person | Role(s) | Issues | Points | Issues/Wk | Points/Wk | Avg Cycle | Median Cycle | Their issues in Jira |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  const bodyRows = input.rows.map((row) => {
    if (!row.figures) {
      return `| ${row.personDisplayName} | ${row.roleLabels} | — | — | — | — | — | — | `
        + `_Not reported: ${row.errorMessage ?? 'analysis failed'}_ |`;
    }
    const creditedKeys = row.figures.perIssue.map((issue) => issue.key);
    const link = buildCreditedIssuesLink(creditedKeys, input.envelope.jiraBaseUrl);
    const incompleteMark = row.ceilingReached ? ' ⚠️' : '';
    return `| ${row.personDisplayName}${incompleteMark} | ${row.roleLabels} `
      + `| ${row.figures.issueCount} | ${formatValue(row.figures.totalStoryPoints)} `
      + `| ${formatValue(row.figures.throughput.issuesPerWeek)} `
      + `| ${formatValue(row.figures.throughput.pointsPerWeek)} `
      + `| ${formatNullable(row.figures.cycleTime.averageDays)} `
      + `| ${formatNullable(row.figures.cycleTime.medianDays)} `
      + `| ${renderLink('Open', link)} |`;
  });

  return [...headerRows, ...bodyRows].join('\n');
}

/** Explains every metric once, with a worked value drawn from the first person who has figures. */
function renderMetricExplanations(input: FlowAuditInput): string {
  const exampleRow = input.rows.find((row) => row.figures !== null);
  const lines = ['## How these numbers are calculated', ''];

  FLOW_AUDIT_METRICS.forEach((metric) => {
    lines.push(`### ${metric.label}`, '', metric.meaning, '', `**Formula:** \`${metric.formula}\``, '');
    if (exampleRow?.figures) {
      lines.push(renderMetricExplanation(metric, {
        personDisplayName: exampleRow.personDisplayName,
        windowDays: input.envelope.windowDays,
        values: {
          issueCount: exampleRow.figures.issueCount,
          storyPoints: exampleRow.figures.totalStoryPoints,
          averageCycleDays: exampleRow.figures.cycleTime.averageDays,
          medianCycleDays: exampleRow.figures.cycleTime.medianDays,
        },
      }), '');
    }
  });

  return lines.join('\n');
}

function renderWorkedExampleSection(input: FlowAuditInput): string {
  const rowWithExample = input.rows.find((row) => row.figures?.workedExample);
  if (!rowWithExample?.figures?.workedExample) {
    return ['## Worked example', '',
      '_No credited issue in this run had measurable hands-on time, so there is nothing to demonstrate._',
    ].join('\n');
  }

  return ['## Worked example', '',
    'Cycle time is reconstructed from issue history, so no Jira search reproduces it. Here is one '
      + 'issue in full, so you can open it in Jira and confirm the method — then apply the same '
      + 'method to any other issue in the per-issue table.',
    '',
    renderWorkedExample(
      rowWithExample.figures.workedExample,
      rowWithExample.personDisplayName,
      input.statusNamesById,
    ),
  ].join('\n');
}

/** The `fetched = credited + excluded` accounting, per person, each row separately checkable. */
function renderReconciliation(input: FlowAuditInput): string {
  const lines = ['## What was counted and what was not', ''];

  input.rows.forEach((row) => {
    if (!row.figures) {
      return;
    }
    lines.push(`### ${row.personDisplayName}`, '');

    const creditedKeys = row.figures.perIssue.map((issue) => issue.key);
    const fetchedLink = buildFetchedIssuesLink(
      row.personDisplayName, input.envelope.windowDays, input.envelope.jiraBaseUrl,
    );
    lines.push('| What | Count | Why | In Jira |', '|---|---|---|---|');
    lines.push(`| Fetched | ${row.fetchedIssueCount} | Everything the search returned before windowing `
      + `| ${renderLink('Open', fetchedLink)} |`);
    lines.push(`| Credited | ${row.figures.issueCount} | Completed under them, inside the window `
      + `| ${renderLink('Open', buildCreditedIssuesLink(creditedKeys, input.envelope.jiraBaseUrl))} |`);

    const reasons = [...new Set(row.figures.excludedIssues.map((issue) => issue.reason))];
    let excludedTotal = 0;
    reasons.forEach((reason) => {
      const keys = row.figures!.excludedIssues.filter((issue) => issue.reason === reason).map((issue) => issue.key);
      excludedTotal += keys.length;
      lines.push(`| Excluded — ${reason} | ${keys.length} | ${EXCLUSION_EXPLANATIONS[reason]} `
        + `| ${renderLink('Open', buildExcludedIssuesLink(keys, input.envelope.jiraBaseUrl))} |`);
    });

    lines.push('');
    const accountedFor = row.figures.issueCount + excludedTotal;
    lines.push(accountedFor === row.fetchedIssueCount
      ? `${row.figures.issueCount} credited + ${excludedTotal} excluded = ${row.fetchedIssueCount} fetched. ✅`
      : `⚠️ **This does not balance**: ${row.figures.issueCount} credited + ${excludedTotal} excluded `
        + `= ${accountedFor}, but ${row.fetchedIssueCount} were fetched.`);
    lines.push('');
  });

  return lines.join('\n');
}

/** Every credited issue with its total and link — last, so it supports rather than buries. */
function renderPerIssueDetail(input: FlowAuditInput): string {
  const lines = ['## Per-issue detail', '',
    'Every credited issue and the hands-on time it contributed. Apply the worked example\'s method to '
      + 'any row here to check it yourself.', ''];

  input.rows.forEach((row) => {
    if (!row.figures || row.figures.perIssue.length === 0) {
      return;
    }
    lines.push(`### ${row.personDisplayName}`, '', '| Issue | Summary | Points | Cycle time (working days) |',
      '|---|---|---|---|');
    row.figures.perIssue.forEach((issue) => {
      lines.push(`| ${issue.key} | ${issue.summary} | ${issue.storyPoints ?? '—'} `
        + `| ${issue.cycleTimeDays === null ? 'not applicable — no measurable hands-on time' : formatValue(issue.cycleTimeDays)} |`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Renders the whole audit document.
 *
 * Pure: the same input always produces the same string, the input is never mutated, and the clock is
 * never read (the timestamp comes from `envelope.generatedAtIso`).
 */
export function buildFlowAuditDocument(input: FlowAuditInput): string {
  return [
    renderHeader(input.envelope),
    renderCompletenessNotice(input.envelope),
    '',
    renderTeamFigures(input),
    '',
    renderMetricExplanations(input),
    '',
    renderWorkedExampleSection(input),
    '',
    renderReconciliation(input),
    '',
    renderPerIssueDetail(input),
  ].join('\n');
}
