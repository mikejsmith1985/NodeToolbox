// forecastCompose.test.ts — One entry point, one result, one set of numbers.
//
// The property this file protects is not any single figure: it is that there IS only one figure.
// Every surface reads a slice of what computeForecast returns, so two screens showing the same
// number cannot disagree — there is nothing for them to disagree about.
//
// The completeness record is tested as hard as the totals. A number that omits what it could not
// see is not a smaller number; it is a wrong one, presented confidently.

import { describe, expect, it } from 'vitest';

import { buildForecastConfig } from './forecastSettings.ts';
import { computeForecast, type ForecastInput } from './forecastCompose.ts';
import type { RollupBoardItem } from '../rollupBoard/rollupBoardTypes.ts';

const TODAY_ISO = '2026-08-20';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  TODAY_ISO,
).config;

/** A board item with everything the forecast reads, so each test varies only what it cares about. */
function boardItem(overrides: Partial<RollupBoardItem> = {}): RollupBoardItem {
  return {
    issue: { key: 'ENC-1', fields: { status: { name: 'Working', statusCategory: { name: 'In Progress' } } } } as never,
    key: 'ENC-1',
    summary: '[DEV] Build the thing',
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], notes: [] } as never,
    featureKey: 'DENP-1',
    columnId: 'col-1',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 3,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
    ...overrides,
  };
}

/** The smallest input that still exercises every section. */
function forecastInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    items: [boardItem()],
    masterCards: [],
    orderedColumnIds: ['col-1', 'col-2', 'col-3', 'col-4', 'col-5'],
    fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }],
    people: [],
    piEndDate: '2026-11-06',
    hasSubStatusField: true,
    teamProfileId: 'team-a',
    ...overrides,
  };
}

describe('computeForecast', () => {
  it('carries the config and any refused settings through, so a surface can show both', () => {
    const result = computeForecast(forecastInput(), CONFIG);
    expect(result.config.pointsPerWorkingDay).toBe(1);
    expect(result.rejectedSettings).toEqual([]);
  });

  it('builds a release clock for every version that has a date', () => {
    const result = computeForecast(forecastInput(), CONFIG);
    expect(Object.keys(result.releaseClocksByVersionName)).toEqual(['Release 10/02/2026']);
    expect(result.releaseClocksByVersionName['Release 10/02/2026'].codeFreezeIso).toBe('2026-09-11');
  });

  it('builds no clock for a version nothing can date, and counts it as undated', () => {
    const result = computeForecast(
      forecastInput({ fixVersions: [{ name: 'Sprint 5' }] }),
      CONFIG,
    );
    expect(Object.keys(result.releaseClocksByVersionName)).toEqual([]);
    expect(result.completeness.undatedVersionCount).toBe(1);
  });

  it('builds the PI clock when the ART has configured one', () => {
    const result = computeForecast(forecastInput(), CONFIG);
    expect(result.piClock.isConfigured).toBe(true);
    expect(result.piClock.piEndIso).toBe('2026-11-06');
  });

  it('reports the PI clock as unconfigured rather than guessing a deadline', () => {
    const result = computeForecast(forecastInput({ piEndDate: '' }), CONFIG);
    expect(result.piClock.isConfigured).toBe(false);
    // The release clock is unaffected — one clock being unset does not silence the other.
    expect(Object.keys(result.releaseClocksByVersionName)).toHaveLength(1);
  });

  it('resolves every version, including the ones it could not date', () => {
    const result = computeForecast(
      forecastInput({ fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }, { name: 'Sprint 5' }] }),
      CONFIG,
    );
    expect(result.releaseDateResolutions.map((resolution) => resolution.source)).toEqual(['field', 'none']);
  });

  describe('the completeness record', () => {
    it('counts every issue it was given', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ key: 'ENC-1' }), boardItem({ key: 'ENC-2' })] }),
        CONFIG,
      );
      expect(result.completeness.totalIssueCount).toBe(2);
    });

    it('counts unsized work separately from work it could measure', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ key: 'ENC-1', storyPoints: null }), boardItem({ key: 'ENC-2' })] }),
        CONFIG,
      );
      expect(result.completeness.unsizedIssueCount).toBe(1);
    });

    it('counts work nobody owns', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ assigneeAccountId: null, assigneeDisplayName: null })] }),
        CONFIG,
      );
      expect(result.completeness.unassignedIssueCount).toBe(1);
    });

    it('counts cancelled work rather than dropping it out of sight', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ statusName: 'Cancelled' })] }),
        CONFIG,
      );
      expect(result.completeness.cancelledIssueCount).toBe(1);
    });

    it('says when INT readiness could not be evaluated at all', () => {
      const result = computeForecast(forecastInput({ hasSubStatusField: false }), CONFIG);
      expect(result.completeness.hasSubStatusField).toBe(false);
    });

    it('says when no column order was available, so every credit is zero and the reader knows why', () => {
      const result = computeForecast(forecastInput({ orderedColumnIds: [] }), CONFIG);
      expect(result.completeness.hasBoardVocabulary).toBe(false);
    });
  });

  describe('the per-issue verdicts', () => {
    it('returns one verdict per forecastable issue', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ key: 'ENC-1' }), boardItem({ key: 'ENC-2' })] }),
        CONFIG,
      );
      expect(result.issueForecasts.map((forecast) => forecast.issueKey)).toEqual(['ENC-1', 'ENC-2']);
    });

    it('leaves cancelled work out of the verdicts while still counting it', () => {
      // Dropping it silently would make a Feature look finished because its remaining work was
      // killed; giving it a verdict would put dead work on a list of things to start.
      const result = computeForecast(
        forecastInput({ items: [boardItem({ key: 'ENC-1' }), boardItem({ key: 'ENC-2', statusName: 'Cancelled' })] }),
        CONFIG,
      );
      expect(result.issueForecasts.map((forecast) => forecast.issueKey)).toEqual(['ENC-1']);
      expect(result.completeness.cancelledIssueCount).toBe(1);
    });

    it('dates an issue from the EARLIEST of its fix versions', () => {
      // An issue tagged for two releases is committed to the first. Dating it from the later one
      // would hand the team weeks nobody granted.
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Release 12/01/2026', 'Release 10/02/2026'] })],
          fixVersions: [
            { name: 'Release 12/01/2026', releaseDate: '2026-12-01' },
            { name: 'Release 10/02/2026', releaseDate: '2026-10-02' },
          ],
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].releaseDeadlineIso).toBe('2026-09-11');
    });

    it('gives an issue on an undated version no release deadline', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Sprint 5'] })],
          fixVersions: [{ name: 'Sprint 5' }],
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].releaseDeadlineIso).toBeNull();
      // The PI clock still applies, so it is forecastable — just on one clock rather than two.
      expect(result.issueForecasts[0].drivingClock).toBe('pi');
    });

    it('reports an issue with no clock at all as unforecastable, never as on track', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: [] })],
          fixVersions: [],
          piEndDate: '',
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].state).toBe('unforecastable');
    });

    it('attributes every verdict to the team the scan came from', () => {
      const result = computeForecast(forecastInput({ teamProfileId: 'team-b' }), CONFIG);
      expect(result.issueForecasts[0].teamProfileId).toBe('team-b');
    });
  });

  it('survives an empty board without throwing', () => {
    const result = computeForecast(forecastInput({ items: [], fixVersions: [] }), CONFIG);
    expect(result.completeness.totalIssueCount).toBe(0);
    expect(result.issueForecasts).toEqual([]);
  });
});
