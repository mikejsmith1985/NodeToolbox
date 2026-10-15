// ctaskParentDefaults.test.ts — What a CTASK inherits from its change: the CI, and a planned window inside the change's.

import { describe, expect, it } from 'vitest';

import { EMPTY_CHANGE_TASK_DEFAULTS, resolveCtaskPlannedWindow } from './ctaskParentDefaults.ts';

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
