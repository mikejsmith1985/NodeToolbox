// flowAuditMetrics.test.ts — Unit tests for what each column MEANS and how it is derived.
//
// These definitions are stated once for the whole team, never per person, because the derivation is
// identical for everyone — repeating it per row would bury the figures it exists to explain.

import { describe, expect, it } from 'vitest';

import {
  FLOW_AUDIT_METRICS,
  renderMetricExplanation,
  renderWorkedExample,
} from './flowAuditMetrics.ts';
import type { PersonalFlowWorkedExample } from './personalFlow.ts';

const WINDOW_DAYS = 90;

describe('FLOW_AUDIT_METRICS', () => {
  it('defines every column the team comparison table renders', () => {
    const definedLabels = FLOW_AUDIT_METRICS.map((metric) => metric.label);

    expect(definedLabels).toEqual(expect.arrayContaining([
      'Issues', 'Points', 'Issues / Week', 'Points / Week', 'Avg Cycle Time', 'Median Cycle Time',
    ]));
  });

  it('gives every metric a plain-English meaning and a formula', () => {
    FLOW_AUDIT_METRICS.forEach((metric) => {
      expect(metric.meaning.length).toBeGreaterThan(0);
      expect(metric.formula.length).toBeGreaterThan(0);
    });
  });

  it('flags the cycle-time metrics as reconstructed from history, not queryable', () => {
    const cycleMetrics = FLOW_AUDIT_METRICS
      .filter((metric) => metric.label.includes('Cycle Time'));

    expect(cycleMetrics.length).toBe(2);
    cycleMetrics.forEach((metric) => expect(metric.isHistoryDerived).toBe(true));
  });

  it('does not flag count-based metrics as history-derived — a Jira search reproduces those', () => {
    const issuesMetric = FLOW_AUDIT_METRICS.find((metric) => metric.label === 'Issues');

    expect(issuesMetric?.isHistoryDerived).toBe(false);
  });

  it('states, for every history-derived metric, that no Jira search reproduces it', () => {
    FLOW_AUDIT_METRICS
      .filter((metric) => metric.isHistoryDerived)
      .forEach((metric) => expect(metric.meaning.toLowerCase()).toContain('no jira search'));
  });
});

describe('renderMetricExplanation', () => {
  const issuesPerWeek = FLOW_AUDIT_METRICS.find((metric) => metric.label === 'Issues / Week')!;

  it('substitutes real values and names whose figures were used', () => {
    const explanation = renderMetricExplanation(issuesPerWeek, {
      personDisplayName: 'Jane Smith',
      windowDays: WINDOW_DAYS,
      values: { issueCount: 12, storyPoints: 0, averageCycleDays: null, medianCycleDays: null },
    });

    expect(explanation).toContain('Jane Smith');
    expect(explanation).toContain('12');
    expect(explanation).toContain('90');
  });

  it('reports an undefined metric as not applicable, never as zero', () => {
    const averageCycle = FLOW_AUDIT_METRICS.find((metric) => metric.label === 'Avg Cycle Time')!;

    const explanation = renderMetricExplanation(averageCycle, {
      personDisplayName: 'Jane Smith',
      windowDays: WINDOW_DAYS,
      values: { issueCount: 3, storyPoints: 0, averageCycleDays: null, medianCycleDays: null },
    });

    // A zero here would read as "instant delivery" — a false statement about a real person.
    expect(explanation.toLowerCase()).toContain('not applicable');
    expect(explanation).not.toMatch(/=\s*0\b/);
  });
});

describe('renderWorkedExample', () => {
  const workedExample: PersonalFlowWorkedExample = {
    issueKey: 'FLOW-1',
    issueSummary: 'Enrollment support',
    ownershipStints: [{ fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-07-03T00:00:00.000Z' }],
    qualifyingSpans: [
      { fromIso: '2026-07-01T00:00:00.000Z', toIso: '2026-07-02T00:00:00.000Z', statusId: '11', workingDays: 1 },
      { fromIso: '2026-07-02T00:00:00.000Z', toIso: '2026-07-03T00:00:00.000Z', statusId: '11', workingDays: 1 },
    ],
    totalWorkingDays: 2,
  };
  const statusNamesById = { '11': 'In Progress' };

  it('names the issue and the person it belongs to, so the reader can find it', () => {
    const rendered = renderWorkedExample(workedExample, 'Jane Smith', statusNamesById);

    expect(rendered).toContain('FLOW-1');
    expect(rendered).toContain('Jane Smith');
  });

  it('shows each qualifying span with a readable status name, not a raw status id', () => {
    const rendered = renderWorkedExample(workedExample, 'Jane Smith', statusNamesById);

    expect(rendered).toContain('In Progress');
  });

  it('shows the total the spans add up to', () => {
    const rendered = renderWorkedExample(workedExample, 'Jane Smith', statusNamesById);

    expect(rendered).toContain('2');
  });

  it('falls back to the status id when no name is known, rather than showing nothing', () => {
    const rendered = renderWorkedExample(workedExample, 'Jane Smith', {});

    expect(rendered).toContain('11');
  });
});
