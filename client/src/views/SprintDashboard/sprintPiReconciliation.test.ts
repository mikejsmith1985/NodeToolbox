// sprintPiReconciliation.test.ts — Proves the board can find work that its own PI query cannot see.
//
// This exists because of a real production miss: ENCUC-2208 sat in Sprint 26.4.1 with its PI field
// blank, so the PI-scoped query never returned it, its Feature (DENP-1387) had nothing to roll up, and
// the whole Feature vanished from the board without a word.

import { describe, expect, it } from 'vitest';

import {
  buildMistaggedSprintIssueJql,
  describeReconciliation,
  selectSprintsInPiWindow,
  toMismatch,
  type SprintPiMismatch,
} from './sprintPiReconciliation.ts';
import type { BoardSprint } from '../../services/jiraApi.ts';

const PI_NAME = 'PI 26.4 (07/30/26 - 10/07/26)';

/** Builds a sprint the way the Agile API returns one. */
function makeSprint(id: number, name: string, startDate?: string, endDate?: string): BoardSprint {
  return { id, name, state: 'active', startDate, endDate };
}

describe('selectSprintsInPiWindow — dates decide, not sprint names', () => {
  it('includes a sprint sitting wholly inside the PI', () => {
    const sprint = makeSprint(1, 'ENCUC Sprint 26.4.1', '2026-08-03T00:00:00Z', '2026-08-17T00:00:00Z');
    const selection = selectSprintsInPiWindow([sprint], PI_NAME);

    expect(selection.sprintsInPi.map((entry) => entry.id)).toEqual([1]);
  });

  it('excludes a sprint that finishes before the PI begins', () => {
    const sprint = makeSprint(2, 'ENCUC Sprint 26.3.6', '2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z');
    expect(selectSprintsInPiWindow([sprint], PI_NAME).sprintsInPi).toEqual([]);
  });

  it('excludes a sprint that starts after the PI ends', () => {
    const sprint = makeSprint(3, 'ENCUC Sprint 27.1.1', '2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z');
    expect(selectSprintsInPiWindow([sprint], PI_NAME).sprintsInPi).toEqual([]);
  });

  it('includes a sprint that straddles the PI boundary, since its work still belongs to the PI', () => {
    const sprint = makeSprint(4, 'ENCUC Sprint 26.4.0', '2026-07-20T00:00:00Z', '2026-08-03T00:00:00Z');
    expect(selectSprintsInPiWindow([sprint], PI_NAME).sprintsInPi.map((entry) => entry.id)).toEqual([4]);
  });

  it('matches on dates even when the sprint name says nothing about the PI', () => {
    const sprint = makeSprint(5, 'Cleanup Crew — hardening', '2026-08-03T00:00:00Z', '2026-08-17T00:00:00Z');
    expect(selectSprintsInPiWindow([sprint], PI_NAME).sprintsInPi.map((entry) => entry.id)).toEqual([5]);
  });

  it('reports a sprint with no dates instead of guessing whether it belongs', () => {
    const selection = selectSprintsInPiWindow([makeSprint(6, 'Undated sprint')], PI_NAME);

    expect(selection.sprintsInPi).toEqual([]);
    expect(selection.undatedSprintNames).toEqual(['Undated sprint']);
  });

  it('finds nothing when the PI label carries no parseable date range', () => {
    const sprint = makeSprint(1, 'S1', '2026-08-03T00:00:00Z', '2026-08-17T00:00:00Z');
    expect(selectSprintsInPiWindow([sprint], 'PI 26.4').sprintsInPi).toEqual([]);
  });

  it('survives an empty sprint list', () => {
    expect(selectSprintsInPiWindow([], PI_NAME).sprintsInPi).toEqual([]);
  });
});

describe('buildMistaggedSprintIssueJql — ask only for the real defect', () => {
  it('asks for issues in those sprints whose PI field is empty', () => {
    expect(buildMistaggedSprintIssueJql([11, 12], 'cf[10301]'))
      .toBe('sprint in (11, 12) AND cf[10301] is EMPTY ORDER BY key ASC');
  });

  it('returns null with no sprints, so no query can sweep the whole project', () => {
    expect(buildMistaggedSprintIssueJql([], 'cf[10301]')).toBeNull();
  });

  it('returns null when the instance has no PI field configured', () => {
    expect(buildMistaggedSprintIssueJql([11], '')).toBeNull();
  });

  it('does not flag an issue tagged to a different PI, which is a legitimate carry-over', () => {
    // The query only ever asks for `is EMPTY`; a "!=" clause would turn normal practice into a warning.
    expect(buildMistaggedSprintIssueJql([11], 'cf[10301]')).not.toContain('!=');
  });
});

describe('toMismatch — reading the issue', () => {
  it('takes the key, summary and status', () => {
    const mismatch = toMismatch({
      key: 'ENCUC-2208',
      fields: { summary: '[DENP-1387] Enhance IPM Duplicate Matching', status: { name: 'To Do' } },
    });

    expect(mismatch).toEqual({
      issueKey: 'ENCUC-2208',
      summary: '[DENP-1387] Enhance IPM Duplicate Matching',
      statusName: 'To Do',
    });
  });

  it('does not throw on an issue Jira returned without fields', () => {
    expect(toMismatch({ key: 'ENCUC-1' }).issueKey).toBe('ENCUC-1');
  });
});

describe('describeReconciliation — name them, do not just count them', () => {
  /** Builds N mismatches so the naming limit can be exercised. */
  function makeMismatches(count: number): SprintPiMismatch[] {
    return Array.from({ length: count }, (_unused, index) => ({
      issueKey: `ENCUC-${2200 + index}`, summary: 's', statusName: 'To Do',
    }));
  }

  it('says nothing at all when everything is tagged correctly', () => {
    expect(describeReconciliation({ mismatches: [], searchedSprintNames: [], undatedSprintNames: [] }))
      .toBe('');
  });

  it('names the issue so it can be fixed without hunting for it', () => {
    const sentence = describeReconciliation({
      mismatches: makeMismatches(1), searchedSprintNames: ['S1'], undatedSprintNames: [],
    });

    expect(sentence).toContain('1 issue is');
    expect(sentence).toContain('ENCUC-2200');
    expect(sentence).toContain('every PI-scoped tab is missing them');
  });

  it('uses plural wording for more than one', () => {
    expect(describeReconciliation({
      mismatches: makeMismatches(2), searchedSprintNames: [], undatedSprintNames: [],
    })).toContain('2 issues are');
  });

  it('caps how many it names, and says how many it did not', () => {
    const sentence = describeReconciliation({
      mismatches: makeMismatches(13), searchedSprintNames: [], undatedSprintNames: [],
    });

    expect(sentence).toContain('ENCUC-2209');
    expect(sentence).not.toContain('ENCUC-2210');
    expect(sentence).toContain('and 3 more');
  });
});
