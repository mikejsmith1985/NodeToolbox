// flowAnalysisDocument.ts — Renders the issue-centric Flow Analysis as an auditable Markdown document.
//
// The on-screen tab shows these figures, but a figure on a screen cannot be pasted into a funding
// paper. This generator is what makes the analysis shareable: the flow totals, where the time goes,
// how each status was classified, the per-issue breakdown, and — the reason this exists at all — who
// actually performed the team's internal testing.
//
// It is deliberately SEPARATE from the Personal Workflow audit document. That report answers "how is
// each person performing"; this one answers "where did each issue's time go, and who held it". Mixing
// them into one generator was the original mistake — the flow sections were wired to an optional field
// nothing ever supplied, so they only ever rendered in tests.
//
// Pure: the timestamp is injected and nothing is fetched, so the whole document is unit-testable.

import {
  FLOW_ANALYSIS_METRICS,
  WAITING_TIME_NOTICE,
} from './flowAuditMetrics.ts';
import type { IssueFlow } from './issueFlow.ts';
import type { DeliveryTotals, StageRollup } from './issueFlowRollup.ts';
import type { StatusFlowClass } from './issueFlowStatusClass.ts';
import type { InternalTestingCoverage } from './internalTestingCoverage.ts';

/** A horizontal rule between sections, so the reader can tell where one figure's story ends. */
const SECTION_RULE = '\n---\n';

/** How each flow class reads in prose, rather than as a bare enum value. */
const FLOW_CLASS_LABELS: Record<StatusFlowClass, string> = {
  'not-started': 'not started',
  active: 'active work',
  waiting: 'waiting',
  completed: 'completed',
  unclassified: 'unclassified',
};

/** The facts about the run, so the document stands alone once copied out of the tool. */
export interface FlowAnalysisEnvelope {
  rosterLabel: string;
  windowDays: number;
  generatedAtIso: string;
  toolVersion: string;
  countsSubTasks: boolean;
  /** The single project the figures were narrowed to, or null when every project is included. */
  projectScope: string | null;
}

/** Everything the Flow Analysis document renders. */
export interface FlowAnalysisDocumentInput {
  envelope: FlowAnalysisEnvelope;
  issueFlows: IssueFlow[];
  rollups: StageRollup[];
  deliveryTotals: DeliveryTotals;
  /** The classification each status actually received during the run, keyed by status NAME. */
  statusClassByStatusName: Readonly<Record<string, StatusFlowClass>>;
  /** Who did the internal testing — the evidence for a testing-resource case. */
  internalTestingCoverage: InternalTestingCoverage;
}

/** Formats a number: integers stay whole, everything else gets two decimals. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Makes a value safe for a Markdown table cell. Jira summaries routinely contain "|", which would
 * otherwise end the cell early and grow phantom columns; newlines break the row outright.
 */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** The header: what this is, and the run facts that let it be trusted without the tool. */
function renderHeader(envelope: FlowAnalysisEnvelope): string {
  return [
    `# Flow Analysis — ${envelope.rosterLabel}`,
    '',
    '| | |',
    '|---|---|',
    `| Roster | ${envelope.rosterLabel} |`,
    `| Window | ${envelope.windowDays} days |`,
    `| Generated | ${envelope.generatedAtIso} |`,
    `| Tool version | ${envelope.toolVersion} |`,
    `| Counted issues | ${envelope.countsSubTasks
      ? 'All issue types, INCLUDING sub-tasks'
      : 'Stories, Tasks and Defects — sub-tasks excluded'} |`,
    `| Project scope | ${envelope.projectScope === null
      ? 'All projects the roster worked in'
      : `${envelope.projectScope} only`} |`,
    '',
    '> **What this is.** For every issue this roster delivered in the window, where its time went and '
      + 'who was holding it at each point — including time it spent in nobody\'s hands. Every duration '
      + 'is in **working days** (Monday–Friday), and every total is summed from the stages, so the '
      + 'figures reconcile by construction.',
  ].join('\n');
}

/** The three totals, always together, each labelled as working days. */
function renderFlowSummary(input: FlowAnalysisDocumentInput): string {
  const averageOf = (read: (issueFlow: IssueFlow) => number) =>
    input.issueFlows.reduce((total, issueFlow) => total + read(issueFlow), 0) / input.issueFlows.length;

  const explanationLines = FLOW_ANALYSIS_METRICS.flatMap((metric) => [
    `**${metric.label}** — ${metric.meaning}`,
    '',
    `*Formula:* ${metric.formula}`,
    '',
  ]);

  return ['## 🔁 Flow summary — where each delivered issue\'s time went', '',
    `Over ${input.issueFlows.length} delivered issues. Every figure below is in **working days** `
      + '(Monday–Friday); weekends are never counted.', '',
    '| Delivered issues | Story points | Avg lead time | Avg cycle time | Avg pre-work wait |',
    '|---|---|---|---|---|',
    `| ${input.deliveryTotals.deliveredIssueCount} `
      + `| ${formatValue(input.deliveryTotals.deliveredStoryPoints)} `
      + `| ${formatValue(averageOf((issueFlow) => issueFlow.leadTimeWorkingDays))} `
      + `| ${formatValue(averageOf((issueFlow) => issueFlow.cycleTimeWorkingDays))} `
      + `| ${formatValue(averageOf((issueFlow) => issueFlow.preWorkWaitWorkingDays))} |`,
    '',
    ...explanationLines,
  ].join('\n');
}

/** Where the time accumulated, largest first, waiting kept separate from active work. */
function renderStageRollups(input: FlowAnalysisDocumentInput): string {
  const rows = input.rollups.map((rollup) =>
    `| ${escapeTableCell(rollup.statusName)} | ${FLOW_CLASS_LABELS[rollup.flowClass]} `
    + `| ${formatValue(rollup.totalWorkingDays)} | ${formatValue(rollup.medianWorkingDays)} `
    + `| ${formatValue(rollup.p85WorkingDays)} | ${rollup.issueCount} |`);

  const largest = input.rollups[0];
  return ['## ⏳ Where the time goes', '',
    'Largest contributor first, in **working days**. The median is the typical case; p85 is the tail — '
      + '85% of issues cleared the status in that time or less. A mean is deliberately not shown: one '
      + 'issue stuck for months would describe a healthy stage as broken.', '',
    largest === undefined
      ? ''
      : `**Largest single contributor: ${escapeTableCell(largest.statusName)}** `
        + `(${FLOW_CLASS_LABELS[largest.flowClass]}) — ${formatValue(largest.totalWorkingDays)} working `
        + `days across ${largest.issueCount} issues.`,
    '',
    '| Status | Class | Total (working days) | Median | p85 | Issues |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    WAITING_TIME_NOTICE,
  ].join('\n');
}

/** The classification actually used, so a wrong guess is visible rather than buried. */
function renderClassification(input: FlowAnalysisDocumentInput): string {
  const rows = Object.entries(input.statusClassByStatusName)
    .map(([statusName, flowClass]) => `| ${escapeTableCell(statusName)} | ${FLOW_CLASS_LABELS[flowClass]} |`);

  return ['## 🔍 How statuses were classified', '',
    'Jira files every in-flight status under one category, so separating work from waiting is a '
      + 'judgement rather than a fact read from the data. It is printed here so it can be argued with. '
      + 'Anything genuinely ambiguous is left **unclassified** and its time still counts toward every '
      + 'total — guessing would move real work into the queue bucket and blame a delay that never '
      + 'happened.', '',
    '| Status | Classified as |',
    '|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * Who performed the internal testing — the section this whole document was missing.
 *
 * The headline is a COUNT OF ISSUES and a share, never a day total: elapsed holding time is not effort
 * (one tester holding several issues accrues elapsed days on all of them at once), so a reader must
 * not convert it to headcount. Every off-roster person is named, so anyone who is really on the team
 * but absent from the roster is spotted rather than published as a finding.
 */
function renderInternalTestingCoverage(coverage: InternalTestingCoverage): string {
  if (!coverage.isConfigured) {
    return ['## 🧪 Who did the internal testing', '',
      'Not calculated: no internal-testing statuses were configured for this run. Choose them in the '
        + 'Internal Testing Bottleneck panel and re-run. They are never guessed — a wrong guess here '
        + 'would become a staffing claim that is not true.',
    ].join('\n');
  }

  if (coverage.issuesWithInternalTestingCount === 0) {
    return ['## 🧪 Who did the internal testing', '',
      'None of the delivered issues in this window passed through a configured internal-testing status.',
    ].join('\n');
  }

  const peopleRows = coverage.offRosterTesters.map((tester) =>
    `| ${escapeTableCell(tester.holderName)} | ${tester.issueCount} `
    + `| ${formatValue(tester.elapsedWorkingDays)} | ${tester.issueKeys.join(', ')} |`);

  const lines = ['## 🧪 Who did the internal testing', '',
    `**${coverage.issuesTestedOffRosterCount} of ${coverage.issuesWithInternalTestingCount} internally `
      + `tested issues (${formatValue(coverage.offRosterSharePercent ?? 0)}%) had internal testing done by `
      + `someone outside this roster**, across ${coverage.offRosterTesters.length} `
      + `${coverage.offRosterTesters.length === 1 ? 'person' : 'people'}. Of those, `
      + `${coverage.issuesHandedOffRosterCount} started with this team\'s own tester and were then handed `
      + 'to someone off-roster to finish.',
    '',
    '| Measure | Issues |',
    '|---|---|',
    `| Internally tested in this window | ${coverage.issuesWithInternalTestingCount} |`,
    `| Tested by this roster\'s internal tester(s) | ${coverage.issuesTestedByRosterTesterCount} |`,
    `| Tested by someone off-roster | ${coverage.issuesTestedOffRosterCount} |`,
    `| Started by our tester, finished off-roster | ${coverage.issuesHandedOffRosterCount} |`,
    `| Sat unassigned while in an internal-testing status | ${coverage.issuesUnassignedInTestingCount} |`,
  ];

  if (coverage.offRosterTesters.length > 0) {
    lines.push('',
      'Everyone outside the roster who did internal testing, by name. **Check this list.** If somebody '
        + 'here is actually on your team, they are missing from the roster — fix that before quoting the '
        + 'figures above, rather than publishing a roster gap as a finding.',
      '',
      '| Person | Issues | Elapsed working days held | Issue keys |',
      '|---|---|---|---|',
      ...peopleRows);
  }

  lines.push('',
    '⚠️ **Elapsed working days is not effort.** It is how long each person held an issue in an '
      + 'internal-testing status; someone holding several issues at once accrues elapsed days on all of '
      + 'them simultaneously. Do not read it as person-days or convert it to a headcount — the issue '
      + 'counts above are the figures that support that argument.');

  return lines.join('\n');
}

/** One row per delivered issue with its three totals, so any of them can be checked in Jira. */
function renderPerIssueFlow(input: FlowAnalysisDocumentInput): string {
  const rows = input.issueFlows.map((issueFlow) =>
    `| ${issueFlow.issueKey} | ${escapeTableCell(issueFlow.issueSummary)} `
    + `| ${formatValue(issueFlow.leadTimeWorkingDays)} | ${formatValue(issueFlow.cycleTimeWorkingDays)} `
    + `| ${formatValue(issueFlow.preWorkWaitWorkingDays)} | ${issueFlow.stages.length} |`);

  return ['## 📋 Per-issue flow', '',
    'Each delivered issue with its three totals in **working days**. Open any issue\'s history in Jira '
      + 'and its stage durations will add up to the lead time shown here — the totals are summed from '
      + 'the stages, never computed separately.', '',
    '| Issue | Summary | Lead time | Cycle time | Pre-work wait | Stages |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * Renders the whole Flow Analysis document.
 *
 * Pure: identical input always produces identical output, the input is never mutated, and the clock is
 * never read (the timestamp comes from the envelope).
 */
export function buildFlowAnalysisDocument(input: FlowAnalysisDocumentInput): string {
  return [
    renderHeader(input.envelope),
    SECTION_RULE,
    renderFlowSummary(input),
    SECTION_RULE,
    renderStageRollups(input),
    SECTION_RULE,
    renderInternalTestingCoverage(input.internalTestingCoverage),
    SECTION_RULE,
    renderClassification(input),
    SECTION_RULE,
    renderPerIssueFlow(input),
  ].join('\n');
}
