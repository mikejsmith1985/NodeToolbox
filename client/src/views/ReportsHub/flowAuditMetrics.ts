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

/**
 * Attached to every per-person column that credits the same issue to more than one person.
 *
 * One issue passing through a developer and then a PO is credited as one issue — and its full story
 * points — to EACH of them. Adding such a column down the team therefore counts hand-offs, not
 * issues: an 8-point story touched by four people reads as 32 points of team output. Hands-on time
 * is unaffected; it partitions correctly across holders.
 */
const NOT_SUMMABLE_NOTE = 'This column **cannot be summed** across the team — the same issue is '
  + 'credited to everyone who advanced it, so a total would count hand-offs rather than issues. Use '
  + 'the team delivered totals, which count each issue once.';

/** Every column the team comparison table renders, in the order it renders them. */
export const FLOW_AUDIT_METRICS: readonly MetricDefinition[] = [
  {
    label: 'Issues',
    meaning: 'How many issues this person **advanced** within the window — work they completed themselves OR '
      + 'handed on to someone else. It is deliberately not limited to issues they personally closed: where a PO '
      + 'accepts the work, the person who built it would otherwise score nothing. Note that an issue handed on and '
      + `never finished is still counted, so this measures work advanced rather than work delivered. ${NOT_SUMMABLE_NOTE}`,
    formula: 'count of credited issues',
    linkKind: 'credited',
    isHistoryDerived: false,
  },
  {
    label: 'Points',
    meaning: 'The **issue\'s size** in story points, credited in full to **each person** who advanced it — not a '
      + 'measure of that person\'s personal output. An 8-point story worked by four people credits 8 points to every '
      + `one of them. Issues with no points count as zero. ${NOT_SUMMABLE_NOTE}`,
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

/**
 * The notice that must accompany any figure naming individuals against WAITING time.
 *
 * Feature 025's redistribution notice covers throughput, and reusing it here would leave the more
 * sensitive figures less well explained than the less sensitive ones. Waiting time is nearly always a
 * property of the system — a review queue, an approval gate, a handover that nobody owns — rather than
 * of whoever happened to be holding the issue. Named beside a person without that said plainly, it
 * reads as an accusation.
 */
export const WAITING_TIME_NOTICE =
  '⚖️ **Reading the waiting figures.** Waiting time is a property of the **system**, not of the person '
  + 'holding the issue: a queue forms because of how work is routed, reviewed and approved. Nobody named '
  + 'against a waiting figure chose to wait. Reallocating people will not shorten a queue that exists '
  + 'because of a gate — changing the gate will. Treat these figures as a map of where the process '
  + 'stalls, never as a measure of individual effort.';

/** The columns the issue-centric flow analysis reports, explained once for the whole document. */
export const FLOW_ANALYSIS_METRICS: readonly MetricDefinition[] = [
  {
    label: 'Lead time',
    meaning: 'The whole life of the issue in **working days** — from creation to the moment it last '
      + 'reached a done status. It includes the time it sat in the backlog before anyone started, which '
      + 'is why it is always shown beside cycle time rather than instead of it.',
    formula: 'sum of every stage\'s working days',
    linkKind: 'credited',
    isHistoryDerived: true,
  },
  {
    label: 'Cycle time',
    meaning: 'How long the work took **once it started**, in working days — the stages from the first '
      + 'started stage to completion. Shown alongside lead time deliberately: cycle time alone hides a '
      + 'backlog that sat for weeks, and lead time alone lets backlog age mask a slow delivery system.',
    formula: 'sum of the stages from the first started stage onward',
    linkKind: 'credited',
    isHistoryDerived: true,
  },
  {
    label: 'Pre-work wait',
    meaning: 'How long the issue waited before anyone began, in working days. Reported as its own '
      + 'figure rather than left for the reader to subtract, because it is frequently the largest single '
      + 'component and the easiest one to act on.',
    formula: 'lead time − cycle time',
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
