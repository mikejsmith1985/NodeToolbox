// Unit tests for the shared scheduler fired-state store.
//
// The pure helpers (isScheduledTimeReached, parseStateJson) are tested without I/O.
// The persistence round-trip is tested against an isolated temp file pointed to by
// TBX_FIRED_STATE_PATH so the real user-profile state is never touched.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const {
  isScheduledTimeReached,
  parseStateJson,
  loadFiredDates,
  recordFiredDate,
  getStateFilePath,
} = require('./schedulerFiredState');

// Each test run gets its own throwaway state file so runs never collide.
const TEMP_STATE_FILE = path.join(
  os.tmpdir(),
  'nodetoolbox-fired-state-test',
  'fired-state.json',
);

beforeAll(() => {
  process.env.TBX_FIRED_STATE_PATH = TEMP_STATE_FILE;
});

afterAll(() => {
  delete process.env.TBX_FIRED_STATE_PATH;
});

beforeEach(() => {
  // Start every test from a clean slate so assertions are independent.
  try { fs.rmSync(path.dirname(TEMP_STATE_FILE), { recursive: true, force: true }); } catch (_ignored) { /* nothing to clean */ }
});

describe('isScheduledTimeReached', () => {
  it('returns true when the current time is exactly the scheduled time', () => {
    expect(isScheduledTimeReached('09:00', '09:00')).toBe(true);
  });

  it('returns true when the current time is after the scheduled time (catch-up case)', () => {
    expect(isScheduledTimeReached('09:00', '09:03')).toBe(true);
    expect(isScheduledTimeReached('09:00', '23:59')).toBe(true);
  });

  it('returns false when the scheduled time has not yet arrived', () => {
    expect(isScheduledTimeReached('09:00', '08:59')).toBe(false);
    expect(isScheduledTimeReached('09:00', '00:00')).toBe(false);
  });

  it('returns false for malformed or non-string input', () => {
    expect(isScheduledTimeReached('9:00', '09:00')).toBe(false);
    expect(isScheduledTimeReached(null, '09:00')).toBe(false);
    expect(isScheduledTimeReached('09:00', undefined)).toBe(false);
  });
});

describe('parseStateJson', () => {
  it('returns an empty object for empty, null, or corrupt input', () => {
    expect(parseStateJson('')).toEqual({});
    expect(parseStateJson(null)).toEqual({});
    expect(parseStateJson('{not valid json')).toEqual({});
  });

  it('parses a valid state object', () => {
    expect(parseStateJson('{"scopeChange":{"team-0-ABC":"2026-06-26"}}'))
      .toEqual({ scopeChange: { 'team-0-ABC': '2026-06-26' } });
  });
});

describe('getStateFilePath', () => {
  it('honours the TBX_FIRED_STATE_PATH override', () => {
    expect(getStateFilePath()).toBe(TEMP_STATE_FILE);
  });
});

describe('loadFiredDates / recordFiredDate round-trip', () => {
  it('returns an empty Map when no state file exists yet', () => {
    expect(loadFiredDates('scopeChange').size).toBe(0);
  });

  it('persists a fired date and reads it back for the same scheduler', () => {
    recordFiredDate('scopeChange', 'team-0-ABC', '2026-06-26');

    const firedDates = loadFiredDates('scopeChange');
    expect(firedDates.get('team-0-ABC')).toBe('2026-06-26');
  });

  it('keeps separate schedulers isolated within one state file', () => {
    recordFiredDate('scopeChange', 'team-0-ABC', '2026-06-26');
    recordFiredDate('featureChange', 'feature-0-XYZ', '2026-06-26');

    expect(loadFiredDates('scopeChange').get('team-0-ABC')).toBe('2026-06-26');
    expect(loadFiredDates('featureChange').get('feature-0-XYZ')).toBe('2026-06-26');
    expect(loadFiredDates('scopeChange').has('feature-0-XYZ')).toBe(false);
  });

  it('overwrites a key with the most recent fire date rather than duplicating it', () => {
    recordFiredDate('scopeChange', 'team-0-ABC', '2026-06-25');
    recordFiredDate('scopeChange', 'team-0-ABC', '2026-06-26');

    const firedDates = loadFiredDates('scopeChange');
    expect(firedDates.size).toBe(1);
    expect(firedDates.get('team-0-ABC')).toBe('2026-06-26');
  });

  it('survives a simulated restart — a freshly loaded Map sees prior writes', () => {
    recordFiredDate('standupBriefing', 'standup-art-rollup', '2026-06-26');

    // A "restart" is just a brand-new load from the same on-disk file.
    const afterRestart = loadFiredDates('standupBriefing');
    expect(afterRestart.get('standup-art-rollup')).toBe('2026-06-26');
  });
});
