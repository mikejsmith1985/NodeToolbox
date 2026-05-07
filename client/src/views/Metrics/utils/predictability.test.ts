// predictability.test.ts — Unit coverage for Metrics sprint-report parsing helpers.

import { describe, expect, it } from 'vitest';

import {
  averagePct,
  computeCompletionPct,
  parseSprintReport,
  type GreenhopperIssue,
  type PredictabilityPoint,
  type SprintReportResponse,
} from './predictability.ts';

function buildIssue(issueKey: string, currentPoints?: number | string | null, fallbackPoints?: number | string | null): GreenhopperIssue {
  return {
    key: issueKey,
    currentEstimateStatistic: { statFieldValue: { value: currentPoints } },
    estimateStatistic: { statFieldValue: { value: fallbackPoints } },
  };
}

function buildPoint(completionPct: number): PredictabilityPoint {
  return {
    sprintId: completionPct,
    sprintName: `Sprint ${completionPct}`,
    committedPoints: completionPct,
    completedPoints: completionPct,
    completedItems: 1,
    committedItems: 1,
    completionPct,
  };
}

describe('parseSprintReport', () => {
  it('excludes issues added during the sprint from committed and completed totals', () => {
    const sprintReport: SprintReportResponse = {
      contents: {
        completedIssues: [buildIssue('TBX-1', 5), buildIssue('TBX-2', 8)],
        incompletedIssues: [buildIssue('TBX-3', 3)],
        puntedIssues: [buildIssue('TBX-4', 2)],
        issueKeysAddedDuringSprint: { 'TBX-2': true },
      },
    };

    const predictabilityPoint = parseSprintReport(sprintReport, { id: 10, name: 'Sprint 10' });

    expect(predictabilityPoint).toMatchObject({
      sprintId: 10,
      sprintName: 'Sprint 10',
      committedPoints: 10,
      completedPoints: 5,
      committedItems: 3,
      completedItems: 1,
      completionPct: 50,
    });
  });

  it('uses estimateStatistic when currentEstimateStatistic is unavailable', () => {
    const sprintReport: SprintReportResponse = {
      contents: {
        completedIssues: [buildIssue('TBX-1', null, '3.5')],
        incompletedIssues: [buildIssue('TBX-2', undefined, 2)],
        puntedIssues: [],
        issueKeysAddedDuringSprint: {},
      },
    };

    const predictabilityPoint = parseSprintReport(sprintReport, { id: 11, name: 'Sprint 11' });

    expect(predictabilityPoint.committedPoints).toBe(5.5);
    expect(predictabilityPoint.completedPoints).toBe(3.5);
  });

  it('returns an empty point when Greenhopper omits report contents', () => {
    const predictabilityPoint = parseSprintReport({}, { id: 12, name: 'Sprint 12' });

    expect(predictabilityPoint).toEqual({
      sprintId: 12,
      sprintName: 'Sprint 12',
      committedPoints: 0,
      completedPoints: 0,
      completedItems: 0,
      committedItems: 0,
      completionPct: 0,
    });
  });

  it('accepts array-shaped added issue keys for defensive compatibility', () => {
    const sprintReport: SprintReportResponse = {
      contents: {
        completedIssues: [buildIssue('TBX-1', 5), buildIssue('TBX-2', 3)],
        issueKeysAddedDuringSprint: ['TBX-2'],
      },
    };

    const predictabilityPoint = parseSprintReport(sprintReport, { id: 13, name: 'Sprint 13' });

    expect(predictabilityPoint.committedPoints).toBe(5);
    expect(predictabilityPoint.completedItems).toBe(1);
  });
});

describe('computeCompletionPct', () => {
  it('returns zero when committed points are zero', () => {
    expect(computeCompletionPct(0, 8)).toBe(0);
  });

  it('rounds completion percentages to the nearest whole number', () => {
    expect(computeCompletionPct(13, 8)).toBe(62);
  });
});

describe('averagePct', () => {
  it('returns zero for an empty point list', () => {
    expect(averagePct([])).toBe(0);
  });

  it('averages mixed sprint percentages equally', () => {
    expect(averagePct([buildPoint(50), buildPoint(75), buildPoint(100)])).toBe(75);
  });
});
