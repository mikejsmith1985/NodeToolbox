// ctaskParentDefaults.test.ts — What a CTASK inherits from its change: the CI, and a planned window inside the change's.

import { describe, expect, it } from 'vitest';

import { describeCtaskTiming, EMPTY_CHANGE_TASK_DEFAULTS, resolveCtaskPlannedWindow } from './ctaskParentDefaults.ts';

const CHANGE_DEFAULTS = {
  configItemSysId: 'ci-sys-1',
  plannedStartDate: '2026-10-16T19:00',
  plannedEndDate: '2026-10-16T23:00',
};

describe('resolveCtaskPlannedWindow', () => {
  it('gives a CTASK with no dates the change\'s own window', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '', plannedEndDate: '' }, CHANGE_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-10-16T19:00', plannedEndDate: '2026-10-16T23:00' });
  });

  it('keeps a CTASK\'s own dates when they sit inside the change\'s window', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '2026-10-16T20:00', plannedEndDate: '2026-10-16T21:00' }, CHANGE_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-10-16T20:00', plannedEndDate: '2026-10-16T21:00' });
  });

  it('replaces stale template dates outside the change\'s window with the change\'s window', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00' }, CHANGE_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-10-16T19:00', plannedEndDate: '2026-10-16T23:00' });
  });

  it('replaces a half-filled window rather than sending a start with no end', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '2026-10-16T20:00', plannedEndDate: '' }, CHANGE_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-10-16T19:00', plannedEndDate: '2026-10-16T23:00' });
  });

  it('keeps the CTASK\'s own dates when the change\'s window is not known', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00' }, EMPTY_CHANGE_TASK_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-01-01T10:00', plannedEndDate: '2026-01-01T11:00' });
  });
});

describe('resolveCtaskPlannedWindow with template timing', () => {
  it('places a timed template inside the change: starts after the offset and runs for its duration', () => {
    expect(resolveCtaskPlannedWindow(
      { plannedStartDate: '', plannedEndDate: '', startOffsetMinutes: '30', durationMinutes: '60' },
      CHANGE_DEFAULTS,
    )).toEqual({ plannedStartDate: '2026-10-16T19:30', plannedEndDate: '2026-10-16T20:30' });
  });

  it('runs to the end of the change when only an offset is given, and never past it', () => {
    expect(resolveCtaskPlannedWindow({ plannedStartDate: '', plannedEndDate: '', startOffsetMinutes: '120' }, CHANGE_DEFAULTS))
      .toEqual({ plannedStartDate: '2026-10-16T21:00', plannedEndDate: '2026-10-16T23:00' });
    expect(resolveCtaskPlannedWindow(
      { plannedStartDate: '', plannedEndDate: '', startOffsetMinutes: '180', durationMinutes: '240' },
      CHANGE_DEFAULTS,
    )).toEqual({ plannedStartDate: '2026-10-16T22:00', plannedEndDate: '2026-10-16T23:00' });
  });

  it('prefers dates set on the staged task itself over the template timing, when they fit the change', () => {
    expect(resolveCtaskPlannedWindow(
      { plannedStartDate: '2026-10-16T22:00', plannedEndDate: '2026-10-16T22:30', startOffsetMinutes: '30', durationMinutes: '60' },
      CHANGE_DEFAULTS,
    )).toEqual({ plannedStartDate: '2026-10-16T22:00', plannedEndDate: '2026-10-16T22:30' });
  });
});

describe('describeCtaskTiming', () => {
  it('words a template\'s timing for the template list', () => {
    expect(describeCtaskTiming({ startOffsetMinutes: '30', durationMinutes: '60' })).toBe('Starts 30 minutes after the change starts · runs 1 hour');
    expect(describeCtaskTiming({ startOffsetMinutes: '', durationMinutes: '45' })).toBe('Starts with the change · runs 45 minutes');
    expect(describeCtaskTiming({})).toBe('Spans the change\'s full window');
  });
});
