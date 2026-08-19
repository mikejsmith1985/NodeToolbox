// issueDateRules.test.ts — The team's date policy, stated once and asserted here.

import { describe, expect, it } from 'vitest';

import {
  deriveIssueDates,
  READY_TO_WORK_STATUS_NAME,
  readDrivingFixVersion,
  type IssueDateInput,
} from './issueDateRules.ts';

const BASE_INPUT: IssueDateInput = {
  fixVersions: [{ name: '10/08/2026', releaseDate: '2026-10-08', released: false }],
  readyToWorkEnteredIso: null,
  currentDueDate: null,
  currentTargetStart: null,
  currentTargetEnd: null,
};

describe('readDrivingFixVersion', () => {
  it('drives from the EARLIEST unreleased version when an issue carries several', () => {
    // An issue tagged for two releases is committed to the first one; dating it from the later one
    // would quietly hand the team three extra weeks they were never given.
    const driving = readDrivingFixVersion([
      { name: 'Nov', releaseDate: '2026-11-12', released: false },
      { name: 'Oct', releaseDate: '2026-10-08', released: false },
    ]);
    expect(driving?.name).toBe('Oct');
  });

  it('ignores a released version — its date is history, not a commitment', () => {
    const driving = readDrivingFixVersion([
      { name: 'Shipped', releaseDate: '2026-05-01', released: true },
      { name: 'Oct', releaseDate: '2026-10-08', released: false },
    ]);
    expect(driving?.name).toBe('Oct');
  });

  it('ignores a version with no release date, which cannot date anything', () => {
    expect(readDrivingFixVersion([{ name: 'Someday', released: false }])).toBeNull();
  });
});

describe('deriveIssueDates', () => {
  it('sets the due date to the release date', () => {
    expect(deriveIssueDates(BASE_INPUT).dueDate).toBe('2026-10-08');
  });

  it('sets target end three weeks before the release date', () => {
    // 21 calendar days: the buffer is a stretch of calendar the release has to clear, not workload.
    expect(deriveIssueDates(BASE_INPUT).targetEnd).toBe('2026-09-17');
  });

  it('sets target start two WORKING days after Ready to Work, so a Friday lands on Tuesday', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, readyToWorkEnteredIso: '2026-09-04T15:00:00.000Z' });
    expect(derived.targetStart).toBe('2026-09-08');
  });

  it('leaves target start underivable until the issue has actually reached Ready to Work', () => {
    const derived = deriveIssueDates(BASE_INPUT);
    expect(derived.targetStart).toBeNull();
    expect(derived.undecidedReasons).toContain(`not yet in ${READY_TO_WORK_STATUS_NAME}`);
  });

  it('says it cannot date anything without a usable fix version, rather than inventing dates', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, fixVersions: [] });
    expect(derived.dueDate).toBeNull();
    expect(derived.targetEnd).toBeNull();
    expect(derived.undecidedReasons).toContain('no unreleased fix version with a release date');
  });

  it('reports which dates disagree with the policy, and only those', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      currentDueDate: '2026-10-08',
      currentTargetEnd: '2026-12-01',
    });
    expect(derived.mismatchedFieldNames).toEqual(['Target End']);
  });

  it('counts an absent date as a mismatch, because the policy says what it should be', () => {
    expect(deriveIssueDates(BASE_INPUT).mismatchedFieldNames).toEqual(['Due Date', 'Target End']);
  });

  it('reports nothing to change when every derivable date already agrees', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      readyToWorkEnteredIso: '2026-09-04T15:00:00.000Z',
      currentDueDate: '2026-10-08',
      currentTargetEnd: '2026-09-17',
      currentTargetStart: '2026-09-08',
    });
    expect(derived.mismatchedFieldNames).toEqual([]);
  });

  it('tolerates a Jira datetime in a date field rather than calling it a mismatch', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, currentDueDate: '2026-10-08T00:00:00.000+0000' });
    expect(derived.mismatchedFieldNames).not.toContain('Due Date');
  });
});
