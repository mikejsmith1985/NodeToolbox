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
import type { FlowFetchCeiling } from './flowAuditFetch.ts';
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
  /** Whether sub-tasks were counted. Stated because it changes every count on the page. */
  countsSubTasks: boolean;
  ceilingReached: { kind: FlowFetchCeiling; affectedPeople: string[] } | null;
  /** Null when unconfigured; links then degrade to query text rather than breaking. */
  jiraBaseUrl: string | null;
}

/** One person's row: their figures, or an honest reason there are none. */
export interface PersonAuditRow {
  personDisplayName: string;
  /**
   * The machine id the search actually queried by — an account id, username or user key.
   *
   * Jira rejects a display name in the `assignee` field ("The value 'Sokol, Mark (CTR)' does not
   * exist for the field 'assignee'"), so the fetched-issues link must be built from this, never from
   * the display name. Null when the person never resolved to a queryable id, in which case no link
   * is offered at all — a link that is known to error looks checkable and is not.
   */
  personQueryValue: string | null;
  roleLabels: string;
  figures: PersonalFlowResult | null;
  errorMessage: string | null;
  /** How many issues were fetched before the engine's windowing — the reconciliation's top line. */
  fetchedIssueCount: number;
  ceilingReached: FlowFetchCeiling | null;
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
  'sub-task': 'A sub-task of another issue. Sub-tasks are part of a story\'s delivery rather than '
    + 'deliverables of their own, so counting them would credit one piece of work twice — and, because '
    + 'they are short-lived, would pull the cycle-time average down and make delivery look faster than '
    + 'it was.',
  'wip-open': 'Still open and still assigned to them — work in progress, not yet completed.',
  'completed-out-of-window': 'They finished it, but before this reporting window began.',
};

/**
 * A horizontal rule between sections. Without it the sections run together into one wall of text and
 * a reader cannot tell where the figures stop and the explanations start.
 */
const SECTION_RULE = '\n---\n';

/**
 * Makes a value safe to drop into a Markdown table cell.
 *
 * Jira summaries routinely contain "|" (for example "DEV | sf-preprocessor | Postgres Changes").
 * Left alone it ends the cell early, so the row grows extra columns and the renderer widens the whole
 * table with empty ones. Newlines break the row outright.
 */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

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
    `| Counted issues | ${envelope.countsSubTasks
      ? 'All issue types, INCLUDING sub-tasks'
      : 'Stories, Tasks and Defects — sub-tasks excluded'} |`,
    '',
    '> **What this is.** Delivery figures for **named individuals**, with the working shown for each '
      + 'number and links to the exact Jira issues behind it. Anyone who can read this page can read '
      + 'these figures and the issue summaries they quote.',
    '',
    '### How to read this',
    '',
    '| | |',
    '|---|---|',
    '| \u{1F4CA} | **Team figures** — the numbers themselves, one row per person |',
    '| \u{1F9EE} | **How these are calculated** — what each column means, and the formula behind it |',
    '| \u{1F50D} | **Worked example** — one issue shown in full, proving how cycle time is derived |',
    '| ⚖️ | **What was counted** — every fetched issue accounted for, and why |',
    '| \u{1F4CB} | **Per-issue detail** — the underlying rows, one table per person, at the end |',
    '',
    'Every **Open** link goes to the exact issues behind the number beside it — click one and count '
      + 'them yourself. Metrics marked ⚠️ are reconstructed from issue history and cannot be '
      + 'reproduced by a Jira search; the worked example is how you check those.',
  ].join('\n');
}

/** The completeness notice — only when a ceiling stopped the analysis seeing everything. */
function renderCompletenessNotice(envelope: RunEnvelope): string {
  if (!envelope.ceilingReached) {
    return '';
  }
  // The fetcher's ceiling is named neutrally because two reports share it; in THIS document the unit
  // of analysis is always a person, so it is named for the reader as the per-person ceiling.
  const ceilingLabel = envelope.ceilingReached.kind === 'per-unit'
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
    '## \u{1F4CA} Team figures',
    '',
    '| Person | Role(s) | Issues | Points | Issues/Wk | Points/Wk | Avg Cycle | Median Cycle | Their issues in Jira |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  const bodyRows = input.rows.map((row) => {
    if (!row.figures) {
      return `| ${escapeTableCell(row.personDisplayName)} | ${escapeTableCell(row.roleLabels)} | — | — | — | — | — | — | `
        + `_Not reported: ${escapeTableCell(row.errorMessage ?? 'analysis failed')}_ |`;
    }
    const creditedKeys = row.figures.perIssue.map((issue) => issue.key);
    const link = buildCreditedIssuesLink(creditedKeys, input.envelope.jiraBaseUrl);
    const incompleteMark = row.ceilingReached ? ' ⚠️' : '';
    return `| ${escapeTableCell(row.personDisplayName)}${incompleteMark} | ${escapeTableCell(row.roleLabels)} `
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
  const lines = ['## \u{1F9EE} How these numbers are calculated', ''];

  FLOW_AUDIT_METRICS.forEach((metric) => {
    // A history-derived metric is flagged in its own heading, so a reader scanning the document can
    // see at a glance which numbers a Jira search can check and which it cannot.
    lines.push(`### ${metric.label}${metric.isHistoryDerived ? ' ⚠️' : ''}`, '', metric.meaning, '');
    if (metric.isHistoryDerived) {
      lines.push('> ⚠️ **Cannot be reproduced by a Jira search.** Use the worked example below to '
        + 'check this one instead.', '');
    }
    lines.push(`**Formula:** \`${metric.formula}\``, '');
    if (exampleRow?.figures) {
      // Quoted, so the arithmetic sits apart from the prose explaining it — the two are doing
      // different jobs and running them together is what makes the report hard to scan.
      lines.push(`> **Worked example:** ${renderMetricExplanation(metric, {
        personDisplayName: exampleRow.personDisplayName,
        windowDays: input.envelope.windowDays,
        values: {
          issueCount: exampleRow.figures.issueCount,
          storyPoints: exampleRow.figures.totalStoryPoints,
          averageCycleDays: exampleRow.figures.cycleTime.averageDays,
          medianCycleDays: exampleRow.figures.cycleTime.medianDays,
        },
      })}`, '');
    }
  });

  return lines.join('\n');
}

function renderWorkedExampleSection(input: FlowAuditInput): string {
  const rowWithExample = input.rows.find((row) => row.figures?.workedExample);
  if (!rowWithExample?.figures?.workedExample) {
    return ['## \u{1F50D} Worked example', '',
      '_No credited issue in this run had measurable hands-on time, so there is nothing to demonstrate._',
    ].join('\n');
  }

  return ['## \u{1F50D} Worked example', '',
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
  const lines = ['## ⚖️ What was counted and what was not', ''];

  input.rows.forEach((row) => {
    if (!row.figures) {
      return;
    }
    lines.push(`### ${row.personDisplayName}`, '');

    const creditedKeys = row.figures.perIssue.map((issue) => issue.key);
    lines.push('| What | Count | Why | In Jira |', '|---|---|---|---|');
    // Built from the machine id, because Jira will not accept a display name in the assignee field.
    const fetchedCell = row.personQueryValue === null
      ? '_No queryable Jira id for this person_'
      : renderLink('Open', buildFetchedIssuesLink(
        row.personQueryValue, input.envelope.windowDays, input.envelope.jiraBaseUrl,
      ));
    lines.push(`| Fetched | ${row.fetchedIssueCount} | Everything the search returned before windowing `
      + `| ${fetchedCell} |`);
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
    // The query itself, not just a link to it: a reader must be able to inspect, adapt or re-run it
    // without reverse-engineering a URL — and to see that it queries by machine id, not by name.
    if (row.personQueryValue !== null) {
      lines.push(`**Fetch query:** \`${buildFetchedIssuesLink(
        row.personQueryValue, input.envelope.windowDays, input.envelope.jiraBaseUrl,
      ).queryText}\``, '');
    }

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
  const lines = ['## \u{1F4CB} Per-issue detail', '',
    'Every credited issue and the hands-on time it contributed. Apply the worked example\'s method to '
      + 'any row here to check it yourself.', ''];

  input.rows.forEach((row) => {
    if (!row.figures || row.figures.perIssue.length === 0) {
      return;
    }
    // A plain heading, NOT a <details> block. Confluence does not support collapsible HTML: it prints
    // the raw tags as text and the stray markup breaks the columns of the table beneath it. The issue
    // count in the heading gives back what the collapsed summary used to show, and this section
    // already sits last so a long table cannot bury the figures above it.
    lines.push(`### ${row.personDisplayName} — ${row.figures.perIssue.length} issues`, '',
      '| Issue | Summary | Points | Cycle time (working days) |', '|---|---|---|---|');
    row.figures.perIssue.forEach((issue) => {
      lines.push(`| ${issue.key} | ${escapeTableCell(issue.summary)} | ${issue.storyPoints ?? '—'} `
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
    SECTION_RULE,
    renderTeamFigures(input),
    SECTION_RULE,
    renderMetricExplanations(input),
    SECTION_RULE,
    renderWorkedExampleSection(input),
    SECTION_RULE,
    renderReconciliation(input),
    SECTION_RULE,
    renderPerIssueDetail(input),
  ].join('\n');
}
