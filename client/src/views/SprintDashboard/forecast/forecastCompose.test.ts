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
import type { ForecastIssue } from './forecastTypes.ts';

const TODAY_ISO = '2026-08-20';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  TODAY_ISO,
).config;

/** One issue with everything the forecast reads, so each test varies only what it cares about. */
function boardItem(overrides: Partial<ForecastIssue> = {}): ForecastIssue {
  return {
    key: 'ENC-1',
    summary: '[DEV] Build the thing',
    typeBucket: 'story',
    featureKey: 'DENP-1',
    columnId: 'col-1',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 3,
    isComplete: false,
    actualStartIso: null,
    storedTargetStartIso: null,
    ...overrides,
  };
}

/** The smallest input that still exercises every section. */
function forecastInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    items: [boardItem()],
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

  describe('the Feature assessments', () => {
    const INT_READY = { statusName: 'Ready for Testing', subStatusValue: 'Integration Test' };

    it('reports a Feature whose every child is at Integration Test as INT-ready', () => {
      const result = computeForecast(
        forecastInput({
          items: [
            boardItem({ key: 'ENC-1', ...INT_READY }),
            boardItem({ key: 'ENC-2', ...INT_READY }),
          ],
        }),
        CONFIG,
      );
      expect(result.featureAssessments[0].intReadyState).toBe('int-ready');
    });

    it('names the child holding a Feature back', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ key: 'ENC-1', ...INT_READY }), boardItem({ key: 'ENC-2' })],
        }),
        CONFIG,
      );
      expect(result.featureAssessments[0].blockingIssueKeys).toEqual(['ENC-2']);
    });

    it('says NOT CONFIGURED rather than judging a Feature against a PI end nobody set', () => {
      const result = computeForecast(forecastInput({ piEndDate: '' }), CONFIG);
      expect(result.featureAssessments[0].piVerdict).toBe('not-configured');
    });

    it('blames the dev work when dev alone overruns the increment', () => {
      // Checked first deliberately: telling this team to find more testers would be wrong advice.
      const result = computeForecast(
        forecastInput({
          items: [
            boardItem({ key: 'ENC-1', summary: '[DEV] Enormous', storyPoints: 400 }),
            boardItem({ key: 'ENC-2', summary: '[SL] Test it', storyPoints: 1 }),
          ],
          piEndDate: '2026-09-30',
        }),
        CONFIG,
      );
      expect(result.featureAssessments[0].riskCause).toBe('dev-too-large');
    });

    it('blames the test squeeze when dev fits and the Feature still does not', () => {
      // 20 dev days from 2026-08-20 lands 2026-09-16; 10 more SL days push DoD past 2026-09-18.
      const result = computeForecast(
        forecastInput({
          items: [
            boardItem({ key: 'ENC-1', summary: '[DEV] Build it', storyPoints: 20 }),
            boardItem({ key: 'ENC-2', summary: '[SL] Test it', storyPoints: 10 }),
          ],
          piEndDate: '2026-09-18',
        }),
        CONFIG,
      );
      const assessment = result.featureAssessments[0];
      expect(assessment.riskCause).toBe('test-squeeze');
      expect(assessment.piVerdict).toBe('at-risk');
    });

    it('reports a Feature that fits as meeting the commitment, with no cause to name', () => {
      const result = computeForecast(
        forecastInput({
          items: [
            boardItem({ key: 'ENC-1', summary: '[DEV] Build it', storyPoints: 2 }),
            boardItem({ key: 'ENC-2', summary: '[SL] Test it', storyPoints: 1 }),
          ],
        }),
        CONFIG,
      );
      expect(result.featureAssessments[0].piVerdict).toBe('meets');
      expect(result.featureAssessments[0].riskCause).toBeNull();
    });

    it('reports a Feature with no SL story rather than dating it as though testing were free', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ summary: '[DEV] Build it' })] }),
        CONFIG,
      );
      expect(result.featureAssessments[0].hasNoSlStory).toBe(true);
    });

    it('names work it could not classify', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ key: 'ENC-7', summary: 'Do the work' })] }),
        CONFIG,
      );
      expect(result.featureAssessments[0].unclassifiedIssueKeys).toEqual(['ENC-7']);
    });

    it('produces no Feature assessment for work nothing attributes', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ featureKey: null })] }),
        CONFIG,
      );
      expect(result.featureAssessments).toEqual([]);
    });

    it('says INT readiness was NOT CHECKED when the instance has no sub-status field', () => {
      const result = computeForecast(forecastInput({ hasSubStatusField: false }), CONFIG);
      expect(result.featureAssessments[0].intReadyState).toBe('unknown-sub-status');
    });
  });

  it('survives an empty board without throwing', () => {
    const result = computeForecast(forecastInput({ items: [], fixVersions: [] }), CONFIG);
    expect(result.completeness.totalIssueCount).toBe(0);
    expect(result.issueForecasts).toEqual([]);
  });
});
