// issueDateRules.test.ts — The team's date policy, stated once and asserted here.

import { describe, expect, it } from 'vitest';

import {
  deriveIssueDates,
  explainMissingDrivingFixVersion,
  READY_TO_WORK_STATUS_NAME,
  WORKING_STATUS_NAME,
  readDrivingFixVersion,
  type IssueDateInput,
} from './issueDateRules.ts';

const BASE_INPUT: IssueDateInput = {
  fixVersions: [{ name: '10/08/2026', releaseDate: '2026-10-08', released: false }],
  readyToWorkEnteredIso: null,
  workingEnteredIso: null,
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

  it('predicts target start as three days after Ready to Work while work has not started', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, readyToWorkEnteredIso: '2026-09-04T15:00:00.000Z' });
    expect(derived.targetStart).toBe('2026-09-07');
  });

  it('uses the day work ACTUALLY started once the issue reaches Working', () => {
    // A prediction is only worth having until the fact arrives. Entering Working is the fact, so it
    // replaces the Ready-to-Work estimate rather than sitting alongside it.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      readyToWorkEnteredIso: '2026-09-04T15:00:00.000Z',
      workingEnteredIso: '2026-09-09T09:00:00.000Z',
    });
    expect(derived.targetStart).toBe('2026-09-09');
  });

  it('uses the Working date even when the issue never passed through Ready to Work', () => {
    // The case that made this rule necessary: work that jumped straight in has no Ready-to-Work
    // stamp at all, and was therefore left permanently undated by the old rule.
    const derived = deriveIssueDates({ ...BASE_INPUT, workingEnteredIso: '2026-09-09T09:00:00.000Z' });
    expect(derived.targetStart).toBe('2026-09-09');
  });

  it('leaves target start underivable until the issue has reached either status', () => {
    const derived = deriveIssueDates(BASE_INPUT);
    expect(derived.targetStart).toBeNull();
    expect(derived.undecidedReasons).toContain(`not yet in ${READY_TO_WORK_STATUS_NAME} or ${WORKING_STATUS_NAME}`);
  });

  it('says it cannot date anything without a usable fix version, rather than inventing dates', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, fixVersions: [] });
    expect(derived.dueDate).toBeNull();
    expect(derived.targetEnd).toBeNull();
    expect(derived.undecidedReasons).toContain('no fix version set on the issue');
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
      currentTargetStart: '2026-09-07',
    });
    expect(derived.mismatchedFieldNames).toEqual([]);
  });

  it('tolerates a Jira datetime in a date field rather than calling it a mismatch', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, currentDueDate: '2026-10-08T00:00:00.000+0000' });
    expect(derived.mismatchedFieldNames).not.toContain('Due Date');
  });
});

describe('Target Start, back-calculated from the effort left', () => {
  // APPENDED, never edited. Every case above must keep passing untouched: the three new inputs are
  // optional precisely so that no caller predating the forecast sees a different date.

  /** Weekends off, no holidays. Target End for the base input is 2026-09-17. */
  const PLAIN_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };

  it('changes nothing when no effort is supplied', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT, readyToWorkEnteredIso: '2026-08-10T09:00:00.000Z' });
    expect(derived.targetStart).toBe('2026-08-13');
    expect(derived.targetStartBasis).toBe('ready-to-work-lead');
  });

  it('works back from code freeze when the effort is known', () => {
    // Target End (code freeze) is 2026-09-17, a Thursday. Three days of work: Tue 15, Wed 16, Thu 17.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStart).toBe('2026-09-15');
    expect(derived.targetStartBasis).toBe('back-calculated');
  });

  it('lets the day work actually began win over any calculation', () => {
    // A fact beats a prediction. This is also the case where the issue skipped Ready to Work
    // entirely and previously had no Target Start at all.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      workingEnteredIso: '2026-08-03T09:00:00.000Z',
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStart).toBe('2026-08-03');
    expect(derived.targetStartBasis).toBe('actual-working');
  });

  it('measures against the PI deadline when that is the earlier of the two', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      piDodDeadlineIso: '2026-08-27',
      workingCalendar: PLAIN_CALENDAR,
    });
    // Thu 2026-08-27 back three working days: Tue 25, Wed 26, Thu 27.
    expect(derived.targetStart).toBe('2026-08-25');
  });

  it('measures against code freeze when that is the earlier of the two', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      piDodDeadlineIso: '2026-12-01',
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStart).toBe('2026-09-15');
  });

  it('steps back over a weekend', () => {
    // Five days back from Thursday 2026-09-17 reaches the previous Friday.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 5,
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStart).toBe('2026-09-11');
  });

  it('steps back over a holiday', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: { weekendDays: [0, 6], holidayIsoDates: ['2026-09-16'] },
    });
    expect(derived.targetStart).toBe('2026-09-14');
  });

  it('falls back to the old rule when effort is supplied without a calendar', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      readyToWorkEnteredIso: '2026-08-10T09:00:00.000Z',
      remainingEffortWorkingDays: 3,
    });
    expect(derived.targetStartBasis).toBe('ready-to-work-lead');
  });

  it('falls back to the old rule when the effort is unknown', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      readyToWorkEnteredIso: '2026-08-10T09:00:00.000Z',
      remainingEffortWorkingDays: null,
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStartBasis).toBe('ready-to-work-lead');
  });

  it('dates work that never reached Ready to Work, which previously had no date at all', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      readyToWorkEnteredIso: null,
      remainingEffortWorkingDays: 2,
      workingCalendar: PLAIN_CALENDAR,
    });
    expect(derived.targetStart).toBe('2026-09-16');
    expect(derived.targetStartBasis).toBe('back-calculated');
  });

  it('names Target Start as a mismatch when Jira holds a different day', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
      currentTargetStart: '2026-07-01',
    });
    expect(derived.mismatchedFieldNames).toContain('Target Start');
  });

  it('leaves Target Start out of the mismatch list when Jira already holds the derived day', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
      currentTargetStart: '2026-09-15',
    });
    expect(derived.mismatchedFieldNames).not.toContain('Target Start');
  });

  it('reports no basis at all when nothing can date the issue', () => {
    const derived = deriveIssueDates({ ...BASE_INPUT });
    expect(derived.targetStart).toBeNull();
    expect(derived.targetStartBasis).toBe('none');
  });
});

describe('Target Start, worked back through the whole DEV → SL chain', () => {
  const PLAIN_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };

  it('prefers a chain date over the issue own effort, because the chain is the longer truth', () => {
    // The issue's own effort says it could start on the 15th. The chain says the 9th, because a week
    // of SL testing has to follow it and two days of handover sit between the two. The chain wins:
    // the earlier date is the one that makes the Feature's deadline, not just this issue's.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
      chainTargetStartIso: '2026-09-09',
    });

    expect(derived.targetStart).toBe('2026-09-09');
    expect(derived.targetStartBasis).toBe('chain-back-calculated');
  });

  it('still yields to the day work ACTUALLY began, which is a fact rather than a plan', () => {
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      workingEnteredIso: '2026-08-20T09:00:00.000+0000',
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
      chainTargetStartIso: '2026-09-09',
    });

    expect(derived.targetStart).toBe('2026-08-20');
    expect(derived.targetStartBasis).toBe('actual-working');
  });

  it('falls back to the issue own effort when no chain date could be worked out', () => {
    // An unsized SL story leaves the chain undatable. The old rule is still better than no date.
    const derived = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
      chainTargetStartIso: null,
    });

    expect(derived.targetStart).toBe('2026-09-15');
    expect(derived.targetStartBasis).toBe('back-calculated');
  });

  it('changes nothing for a caller that supplies no chain date at all', () => {
    const withoutChain = deriveIssueDates({
      ...BASE_INPUT,
      remainingEffortWorkingDays: 3,
      workingCalendar: PLAIN_CALENDAR,
    });

    expect(withoutChain.targetStart).toBe('2026-09-15');
    expect(withoutChain.targetStartBasis).toBe('back-calculated');
  });
});

describe('explainMissingDrivingFixVersion', () => {
  it('says nothing when a version can date the issue', () => {
    expect(explainMissingDrivingFixVersion([{ name: '2026.09', releaseDate: '2026-09-30' }])).toBeNull();
  });

  it('distinguishes no version at all — a fix made on the issue', () => {
    expect(explainMissingDrivingFixVersion([])).toBe('no fix version set on the issue');
  });

  it('distinguishes a version with no release date, and NAMES it', () => {
    // This one is fixed ONCE in Jira's release admin and unblocks every issue on that version. The
    // name is the only thing that says which release to open.
    expect(explainMissingDrivingFixVersion([{ name: '2026.09' }]))
      .toBe('fix version has no release date in Jira (2026.09)');
  });

  it('names every undated unreleased version, not just the first', () => {
    expect(explainMissingDrivingFixVersion([{ name: '2026.09' }, { name: '2026.10' }]))
      .toBe('fix version has no release date in Jira (2026.09, 2026.10)');
  });

  it('distinguishes a set that is entirely released — the work was never moved forward', () => {
    expect(explainMissingDrivingFixVersion([{ name: '2026.06', releaseDate: '2026-06-30', released: true }]))
      .toBe('every fix version on the issue is already released');
  });

  it('still explains a nameless undated version rather than printing empty brackets', () => {
    expect(explainMissingDrivingFixVersion([{}])).toBe('fix version has no release date in Jira');
  });
});
