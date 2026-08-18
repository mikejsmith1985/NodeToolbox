// dateComparatorParity.test.ts — Hygiene and Readiness must answer "overdue?" identically.
//
// They used to disagree for several hours every evening west of Greenwich, because one compared
// calendar days and the other compared instants. This sweeps a full 48 hours of clock positions
// against a spread of dates and asserts the two surfaces never differ — a property, so it holds in
// whatever timezone the suite runs in rather than only in the one it was written in.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runReadinessScan } from '../../ArtView/readiness/readinessScan.ts';
import { checkDueDateOverdue, type JiraIssue } from './hygieneChecks.ts';

const SWEEP_START_ISO = '2026-07-15T00:00:00.000Z';
const HOURS_SWEPT = 48;
const DAY_OFFSETS_TESTED = [-2, -1, 0, 1, 2];

function calendarDayFor(instantMs: number): string {
  const instant = new Date(instantMs);
  return [
    String(instant.getFullYear()),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-');
}

function buildFeature(dueDate: string): JiraIssue {
  return {
    key: 'PAR-1',
    fields: {
      summary: 'A feature with a due date',
      issuetype: { name: 'Feature' },
      status: { name: 'Implementing', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      created: '2026-01-01', updated: '2026-01-01',
      duedate: dueDate,
    },
  } as unknown as JiraIssue;
}

/** Readiness reports its due-date verdict as an alert on the scanned Feature. */
function readinessSaysPast(dueDate: string): boolean {
  const scan = runReadinessScan({
    piFieldId: 'customfield_10301',
    currentPiName: 'PI 26.3',
    upcomingPiName: null,
    carryoverPiNames: [],
    currentFeatures: [buildFeature(dueDate)],
    carryoverFeatures: [],
    upcomingFeatures: [],
    loadError: null,
    scopeDescription: 'parity sweep',
    fieldConfig: {
      productOwnerFieldIds: [], estimateFieldIds: [], pcodeFieldIds: [],
      targetEndFieldIds: ['customfield_10102'],
    },
  } as never);
  return scan.lenses.current.features[0].alerts.includes('due-date-missing-or-past');
}

function hygieneSaysPast(dueDate: string): boolean {
  return checkDueDateOverdue(buildFeature(dueDate)) !== null;
}

describe('the overdue question has one answer across surfaces', () => {
  afterEach(() => vi.useRealTimers());

  it('agrees at every hour of a 48-hour sweep, including the evenings UTC has already left behind', () => {
    const sweepStartMs = new Date(SWEEP_START_ISO).getTime();
    const disagreements: string[] = [];

    for (let hourOffset = 0; hourOffset < HOURS_SWEPT; hourOffset += 1) {
      const nowMs = sweepStartMs + hourOffset * 3_600_000;
      vi.useFakeTimers();
      vi.setSystemTime(new Date(nowMs));

      DAY_OFFSETS_TESTED.forEach((dayOffset) => {
        const dueDate = calendarDayFor(nowMs + dayOffset * 86_400_000);
        const hygieneVerdict = hygieneSaysPast(dueDate);
        const readinessVerdict = readinessSaysPast(dueDate);
        if (hygieneVerdict !== readinessVerdict) {
          disagreements.push(`${new Date(nowMs).toISOString()} vs ${dueDate}: hygiene=${hygieneVerdict} readiness=${readinessVerdict}`);
        }
      });

      vi.useRealTimers();
    }

    expect(disagreements).toEqual([]);
  });
});
