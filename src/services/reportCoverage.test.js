// Unit tests for the per-report coverage watermark — the pure cutoff resolver (no I/O) and
// the persistent watermark store (isolated temp file).

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const {
  resolveCoverageCutoff,
  getCoverageWatermark,
  setCoverageWatermark,
  getCoverageFilePath,
} = require('./reportCoverage');

const TEMP_COVERAGE_FILE = path.join(os.tmpdir(), 'nodetoolbox-report-coverage-test', 'coverage.json');

beforeAll(() => { process.env.TBX_REPORT_COVERAGE_PATH = TEMP_COVERAGE_FILE; });
afterAll(() => { delete process.env.TBX_REPORT_COVERAGE_PATH; });
beforeEach(() => {
  try { fs.rmSync(path.dirname(TEMP_COVERAGE_FILE), { recursive: true, force: true }); } catch (_ignored) { /* nothing to clean */ }
});

describe('resolveCoverageCutoff', () => {
  // Friday 2026-06-26 12:00 local; prior business day cutoff = Thursday midnight.
  const now = new Date('2026-06-26T12:00:00');
  const businessDayCutoff = new Date('2026-06-25T00:00:00');

  it('falls back to the prior business day when there is no watermark', () => {
    expect(resolveCoverageCutoff(null, businessDayCutoff, now).getTime()).toBe(businessDayCutoff.getTime());
  });

  it('uses the prior business day in normal operation (watermark is recent)', () => {
    // Watermark ~yesterday afternoon: more recent than the prior-business-day midnight, so the
    // window stays exactly the prior business day — unchanged from today's behaviour.
    const recentWatermark = '2026-06-25T09:00:00';
    expect(resolveCoverageCutoff(recentWatermark, businessDayCutoff, now).getTime())
      .toBe(businessDayCutoff.getTime());
  });

  it('reaches back to the last run when days were missed (self-heal)', () => {
    // Last confirmed coverage 11 days ago (downtime) → window extends back to it.
    const staleWatermark = '2026-06-15T09:00:00';
    expect(resolveCoverageCutoff(staleWatermark, businessDayCutoff, now).toISOString())
      .toBe(new Date('2026-06-15T09:00:00').toISOString());
  });

  it('never reaches back further than the max lookback cap', () => {
    const veryOldWatermark = '2026-01-01T00:00:00';
    const cutoff = resolveCoverageCutoff(veryOldWatermark, businessDayCutoff, now, 30);
    const expectedFloor = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(cutoff.getTime()).toBe(expectedFloor.getTime());
  });

  it('ignores a malformed watermark and uses the prior business day', () => {
    expect(resolveCoverageCutoff('not-a-date', businessDayCutoff, now).getTime()).toBe(businessDayCutoff.getTime());
  });
});

describe('coverage watermark store', () => {
  it('returns null when a report has never run', () => {
    expect(getCoverageWatermark('scope-team-ENFCT')).toBeNull();
  });

  it('persists and reads back a watermark, surviving a simulated restart', () => {
    setCoverageWatermark('scope-team-ENFCT', '2026-06-26T12:00:00.000Z');
    expect(getCoverageWatermark('scope-team-ENFCT')).toBe('2026-06-26T12:00:00.000Z');
  });

  it('advances (overwrites) the watermark on a later run', () => {
    setCoverageWatermark('feature-team-a', '2026-06-25T09:00:00.000Z');
    setCoverageWatermark('feature-team-a', '2026-06-26T09:00:00.000Z');
    expect(getCoverageWatermark('feature-team-a')).toBe('2026-06-26T09:00:00.000Z');
  });

  it('honours the TBX_REPORT_COVERAGE_PATH override', () => {
    expect(getCoverageFilePath()).toBe(TEMP_COVERAGE_FILE);
  });
});
