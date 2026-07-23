// flowAuditMetrics.ts — What each column of the Personal Flow report MEANS, and how it is derived.
//
// Every figure the report states is a claim about how someone is performing, so every figure has to
// show its working. These definitions carry the plain-English meaning, the formula a reader can
// apply by hand, and — for the two metrics reconstructed from issue history — an honest statement
// that no Jira search reproduces them.
//
// They are stated ONCE for the whole team. The derivation is identical for every person, so
// repeating it per row would bury the figures it exists to explain.

import type { PersonalFlowWorkedExample } from './personalFlow.ts';

/** Which of the three evidence links makes a metric checkable. */
export type MetricLinkKind = 'credited' | 'fetched' | 'excluded' | 'none';

/** One column of the team table, with everything needed to explain it. */
export interface MetricDefinition {
  label: string;
  meaning: string;
  formula: string;
  linkKind: MetricLinkKind;
  /** True when the value is reconstructed from issue history and NO Jira search can reproduce it. */
  isHistoryDerived: boolean;
}

/** The figures a metric's formula consumes for one person. */
export interface MetricValues {
  issueCount: number;
  storyPoints: number;
  averageCycleDays: number | null;
  medianCycleDays: number | null;
}

/** The context a worked explanation needs: whose figures, over what window. */
export interface MetricExplanationContext {
  personDisplayName: string;
  windowDays: number;
  values: MetricValues;
}

const HISTORY_DERIVED_NOTE =
  'This is reconstructed from each issue\'s history, so NO Jira search can reproduce the number — '
  + 'a query returns the issues, never the derivation. See the worked example below.';

const DAYS_PER_WEEK = 7;

/** Every column the team comparison table renders, in the order it renders them. */
export const FLOW_AUDIT_METRICS: readonly MetricDefinition[] = [
  {
    label: 'Issues',
    meaning: 'How many issues this person moved to done within the reporting window.',
    formula: 'count of credited issues',
    linkKind: 'credited',
    isHistoryDerived: false,
  },
  {
    label: 'Points',
    meaning: 'The story points on those credited issues. Issues with no points count as zero.',
    formula: 'sum of story points across credited issues',
    linkKind: 'credited',
    isHistoryDerived: false,
  },
  {
    label: 'Issues / Week',
    meaning: 'The rate at which they completed issues, expressed per calendar week.',
    formula: 'credited issues ÷ (window days ÷ 7)',
    linkKind: 'credited',
    isHistoryDerived: false,
  },
  {
    label: 'Points / Week',
    meaning: 'The same rate expressed in story points rather than issue count.',
    formula: 'sum of story points ÷ (window days ÷ 7)',
    linkKind: 'credited',
    isHistoryDerived: false,
  },
  {
    label: 'Avg Cycle Time',
    meaning: `The mean hands-on working days per issue — Monday-to-Friday time an issue spent in an `
      + `in-progress status WHILE assigned to this person. Time it sat with someone else never counts. `
      + HISTORY_DERIVED_NOTE,
    formula: 'sum of hands-on working days ÷ number of issues with measurable hands-on time',
    linkKind: 'credited',
    isHistoryDerived: true,
  },
  {
    label: 'Median Cycle Time',
    meaning: `The middle hands-on duration, which is less distorted by one unusually long issue than `
      + `the average is. ${HISTORY_DERIVED_NOTE}`,
    formula: 'middle value of the hands-on working days, sorted',
    linkKind: 'credited',
    isHistoryDerived: true,
  },
];

/** Formats a number for the document: integers stay whole, everything else gets two decimals. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Renders one metric's formula with this run's real values substituted in, so the arithmetic can be
 * followed to the stated result.
 *
 * A metric that is undefined for this person is reported as explicitly not applicable, with the
 * reason. Rendering it as `0` would read as "instant delivery" — a false statement about a real
 * person, and exactly the kind of thing this report exists to prevent.
 */
export function renderMetricExplanation(
  metric: MetricDefinition,
  context: MetricExplanationContext,
): string {
  const { personDisplayName, windowDays, values } = context;
  const weeks = windowDays / DAYS_PER_WEEK;

  switch (metric.label) {
    case 'Issues':
      return `For ${personDisplayName}: ${values.issueCount} credited issues over ${windowDays} days.`;
    case 'Points':
      return `For ${personDisplayName}: ${formatValue(values.storyPoints)} points across `
        + `${values.issueCount} credited issues.`;
    case 'Issues / Week':
      return `For ${personDisplayName}: ${values.issueCount} ÷ (${windowDays} ÷ ${DAYS_PER_WEEK}) = `
        + `${formatValue(values.issueCount / weeks)} issues per week.`;
    case 'Points / Week':
      return `For ${personDisplayName}: ${formatValue(values.storyPoints)} ÷ (${windowDays} ÷ `
        + `${DAYS_PER_WEEK}) = ${formatValue(values.storyPoints / weeks)} points per week.`;
    case 'Avg Cycle Time':
      return values.averageCycleDays === null
        ? `For ${personDisplayName}: not applicable, because none of their credited issues had `
          + `measurable hands-on time in this window.`
        : `For ${personDisplayName}: ${formatValue(values.averageCycleDays)} working days on average.`;
    case 'Median Cycle Time':
      return values.medianCycleDays === null
        ? `For ${personDisplayName}: not applicable, because none of their credited issues had `
          + `measurable hands-on time in this window.`
        : `For ${personDisplayName}: ${formatValue(values.medianCycleDays)} working days at the median.`;
    default:
      return `For ${personDisplayName}: ${metric.formula}.`;
  }
}

/**
 * Renders the working behind one issue's cycle time, so a reader can open that issue in Jira,
 * confirm the method by hand, and then apply it to any other issue in the report.
 *
 * Status names are supplied by the caller: the engine deals in status ids only, and an id means
 * nothing to a reader trying to match the derivation against Jira's history view.
 */
export function renderWorkedExample(
  workedExample: PersonalFlowWorkedExample,
  personDisplayName: string,
  statusNamesById: Readonly<Record<string, string>>,
): string {
  const stintLines = workedExample.ownershipStints
    .map((stint) => `- Held by ${personDisplayName} from ${stint.fromIso} to ${stint.toIso}`)
    .join('\n');

  const spanLines = workedExample.qualifyingSpans
    .map((span) => `| ${span.fromIso} | ${span.toIso} | ${statusNamesById[span.statusId] ?? span.statusId} `
      + `| ${formatValue(span.workingDays)} |`)
    .join('\n');

  return [
    `**Worked example — ${workedExample.issueKey}: ${workedExample.issueSummary}** `
      + `(${personDisplayName})`,
    '',
    'Ownership stints evaluated:',
    stintLines,
    '',
    'Qualifying in-progress spans (Monday–Friday time only):',
    '',
    '| From | To | Status | Working days |',
    '|------|----|--------|--------------|',
    spanLines,
    '',
    `**Total: ${formatValue(workedExample.totalWorkingDays)} working days** — which is this issue's `
      + `cycle time in the per-issue table below.`,
  ].join('\n');
}
