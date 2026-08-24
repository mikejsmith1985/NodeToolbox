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

  describe('the capacity assessments', () => {
    const PEOPLE = [
      { personKey: 'acct-1', displayName: 'Smith, Jane (CTR)', isOnRoster: true, canDevelop: true, canInternalTest: false },
      { personKey: 'acct-2', displayName: 'Doe, John (CTR)', isOnRoster: true, canDevelop: false, canInternalTest: true },
    ];

    it('assesses dev capacity against the window that ends at code freeze', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ summary: '[DEV] Build it', storyPoints: 3 })],
          people: PEOPLE,
        }),
        CONFIG,
      );
      const assessment = result.codeFreezeCapacityByVersionName['Release 10/02/2026'];
      expect(assessment.window.kind).toBe('to-code-freeze');
      expect(assessment.personLoads[0].displayName).toBe('Smith, Jane (CTR)');
    });

    it('assesses test capacity against the fortnight after code freeze', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ key: 'S-1', summary: '[SL] Test it', assigneeAccountId: 'acct-2', storyPoints: 2 })],
          people: PEOPLE,
        }),
        CONFIG,
      );
      const assessment = result.externalTestCapacityByVersionName['Release 10/02/2026'];
      expect(assessment.window.kind).toBe('external-test');
      expect(assessment.personLoads[0].displayName).toBe('Doe, John (CTR)');
    });

    it('never assesses the deploy buffer, which carries no test capacity by definition', () => {
      const result = computeForecast(forecastInput({ people: PEOPLE }), CONFIG);
      const everyWindow = [
        ...Object.values(result.codeFreezeCapacityByVersionName),
        ...Object.values(result.externalTestCapacityByVersionName),
      ];
      expect(everyWindow.map((assessment) => assessment.window.kind)).not.toContain('deploy-buffer');
    });

    it('counts other work toward a total but not toward this release', () => {
      const result = computeForecast(
        forecastInput({
          items: [
            boardItem({ key: 'ENC-1', summary: '[DEV] This release', storyPoints: 3 }),
            boardItem({ key: 'ENC-2', summary: '[DEV] Another release', storyPoints: 9, fixVersionNames: ['Release 12/01/2026'] }),
          ],
          fixVersions: [
            { name: 'Release 10/02/2026', releaseDate: '2026-10-02' },
            { name: 'Release 12/01/2026', releaseDate: '2026-12-01' },
          ],
          people: PEOPLE,
        }),
        CONFIG,
      );
      const load = result.codeFreezeCapacityByVersionName['Release 10/02/2026'].personLoads[0];
      expect(load.inScopeWorkingDays).toBe(3);
      expect(load.totalAssignedWorkingDays).toBe(12);
    });

    it('builds no assessment for a release nothing can date', () => {
      const result = computeForecast(
        forecastInput({ items: [boardItem({ fixVersionNames: ['Sprint 5'] })], fixVersions: [{ name: 'Sprint 5' }] }),
        CONFIG,
      );
      expect(result.codeFreezeCapacityByVersionName).toEqual({});
    });

    it('carries the undated count into every assessment', () => {
      const result = computeForecast(
        forecastInput({
          fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }, { name: 'Sprint 5' }],
          people: PEOPLE,
        }),
        CONFIG,
      );
      expect(result.codeFreezeCapacityByVersionName['Release 10/02/2026'].undatedIssueCount).toBe(1);
    });

    it('leaves cancelled work out of the capacity sum', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ summary: '[DEV] Killed', statusName: 'Cancelled', storyPoints: 40 })],
          people: PEOPLE,
        }),
        CONFIG,
      );
      expect(result.codeFreezeCapacityByVersionName['Release 10/02/2026'].totalRemainingWorkingDays).toBe(0);
    });
  });

  describe('the sizing flags', () => {
    it('flags a Feature whose children have outgrown its estimate', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ key: 'ENC-1', storyPoints: 34 })],
          featurePointsByKey: { 'DENP-1': 20 },
        }),
        CONFIG,
      );
      expect(result.sizingFlags[0].state).toBe('over');
      expect(result.sizingFlags[0].overagePoints).toBe(14);
    });

    it('reports NOT SIZED when no Feature estimate was supplied at all', () => {
      // The honest answer. Comparing against nothing and calling the result "within" would report a
      // Feature nobody sized as healthy.
      const result = computeForecast(forecastInput({ items: [boardItem({ storyPoints: 40 })] }), CONFIG);
      expect(result.sizingFlags[0].state).toBe('not-sized');
    });

    it('honours the configured tolerance', () => {
      const tolerantConfig = buildForecastConfig(
        { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 50 },
        TODAY_ISO,
      ).config;
      const result = computeForecast(
        forecastInput({ items: [boardItem({ storyPoints: 26 })], featurePointsByKey: { 'DENP-1': 20 } }),
        tolerantConfig,
      );
      expect(result.sizingFlags[0].state).toBe('within');
    });

    it('produces no flag for work nothing attributes to a Feature', () => {
      const result = computeForecast(forecastInput({ items: [boardItem({ featureKey: null })] }), CONFIG);
      expect(result.sizingFlags).toEqual([]);
    });
  });

  describe('a fix version nothing can date, end to end', () => {
    it('reads the date out of the version NAME when its field is blank', () => {
      // Without this, every release whose date lives only in its name drops silently out of the
      // forecast — which reads as "nothing to forecast" rather than "the field is empty".
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Release 10/02/2026'] })],
          fixVersions: [{ name: 'Release 10/02/2026' }],
        }),
        CONFIG,
      );
      expect(result.releaseDateResolutions[0].source).toBe('name');
      expect(result.issueForecasts[0].releaseDeadlineIso).toBe('2026-09-11');
    });

    it('reports its work as UNFORECASTABLE, never as on track', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Sprint 5'] })],
          fixVersions: [{ name: 'Sprint 5' }],
          piEndDate: '',
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].state).toBe('unforecastable');
      expect(result.completeness.undatedVersionCount).toBe(1);
    });

    it('lets the field win over the name and reports the disagreement', () => {
      const result = computeForecast(
        forecastInput({ fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-11-02' }] }),
        CONFIG,
      );
      const resolution = result.releaseDateResolutions[0];
      expect(resolution.hasDisagreement).toBe(true);
      expect(resolution.resolvedDateIso).toBe('2026-11-02');
    });
  });

  describe('released fix versions', () => {
    it('does not date work against a release that already shipped', () => {
      // A shipped version's date is history, not a commitment. Measuring open work against it
      // reports the work as hopelessly late for a deadline nobody is still working to — which is
      // most of what a long-lived project's version list contains.
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Release 01/05/2026'] })],
          fixVersions: [{ name: 'Release 01/05/2026', releaseDate: '2026-01-05', released: true }],
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].releaseDeadlineIso).toBeNull();
    });

    it('dates work against the earliest UNRELEASED version when it carries both', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Release 01/05/2026', 'Release 10/02/2026'] })],
          fixVersions: [
            { name: 'Release 01/05/2026', releaseDate: '2026-01-05', released: true },
            { name: 'Release 10/02/2026', releaseDate: '2026-10-02', released: false },
          ],
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].releaseDeadlineIso).toBe('2026-09-11');
    });

    it('still falls back to the PI clock when every version has shipped', () => {
      const result = computeForecast(
        forecastInput({
          items: [boardItem({ fixVersionNames: ['Release 01/05/2026'] })],
          fixVersions: [{ name: 'Release 01/05/2026', releaseDate: '2026-01-05', released: true }],
        }),
        CONFIG,
      );
      expect(result.issueForecasts[0].drivingClock).toBe('pi');
    });
  });

  it('survives an empty board without throwing', () => {
    const result = computeForecast(forecastInput({ items: [], fixVersions: [] }), CONFIG);
    expect(result.completeness.totalIssueCount).toBe(0);
    expect(result.issueForecasts).toEqual([]);
  });
});

describe('computeForecast — the PI clock, which spans every release at once', () => {
  const ROSTER = [
    { personKey: 'acct-1', displayName: 'Smith, Jane (CTR)', isOnRoster: true, canDevelop: true, canInternalTest: false },
    { personKey: 'acct-2', displayName: 'Doe, Alex', isOnRoster: true, canDevelop: true, canInternalTest: true },
  ];

  it('counts work from EVERY fix version, not just one', () => {
    // The whole point of the second clock: "can this team reach INT by the end of the PI" is a
    // question about all the work at once, and no per-version figure can answer it.
    const result = computeForecast(forecastInput({
      items: [
        boardItem({ key: 'ENC-1', fixVersionNames: ['Release 10/02/2026'] }),
        boardItem({ key: 'ENC-2', fixVersionNames: ['Release 11/06/2026'] }),
        boardItem({ key: 'ENC-3', fixVersionNames: [] }),
      ],
      fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }],
      people: ROSTER,
    }), CONFIG);

    const inScopeKeys = result.piCapacity?.personLoads.flatMap((load) => load.inScopeIssueKeys) ?? [];
    expect(inScopeKeys).toEqual(expect.arrayContaining(['ENC-1', 'ENC-2', 'ENC-3']));
  });

  it('measures against the days left in the PI, not against a release date', () => {
    const result = computeForecast(forecastInput({ people: ROSTER }), CONFIG);

    expect(result.piCapacity?.window.endIso).toBe(result.piClock.toPiEnd?.endIso);
    expect(result.piCapacity?.window.endIso).toBe('2026-11-06');
  });

  it('assesses the WHOLE roster — reaching INT needs the dev work and the test behind it', () => {
    // Splitting dev from test here would let a team look fine on each half and miss on both.
    const result = computeForecast(forecastInput({
      items: [boardItem({ key: 'ENC-1' }), boardItem({ key: 'ENC-9', summary: '[SL] Test the thing', assigneeAccountId: 'acct-2' })],
      people: ROSTER,
    }), CONFIG);

    expect(result.piCapacity?.personLoads.map((load) => load.personKey).sort()).toEqual(['acct-1', 'acct-2']);
  });

  it('names who is over capacity and who has room, which is the question people actually ask', () => {
    const result = computeForecast(forecastInput({
      // 200 points at one point per working day is far more than the PI has left.
      items: [boardItem({ key: 'ENC-1', storyPoints: 200, assigneeAccountId: 'acct-1' })],
      people: ROSTER,
    }), CONFIG);

    const overloaded = result.piCapacity?.personLoads.find((load) => load.personKey === 'acct-1');
    const light = result.piCapacity?.personLoads.find((load) => load.personKey === 'acct-2');
    expect(overloaded?.isOverCapacity).toBe(true);
    expect(overloaded?.overCapacityWorkingDays).toBeGreaterThan(0);
    expect(light?.isOverCapacity).toBe(false);
    expect(light?.availableWorkingDays).toBeGreaterThan(0);
  });

  it('reports no PI capacity at all rather than a zero when the PI is not configured', () => {
    // A zero reads as "no work and no time"; null reads as "nobody told us when the PI ends".
    const result = computeForecast(forecastInput({ piEndDate: '', piName: '', people: ROSTER }), CONFIG);

    expect(result.piCapacity).toBeNull();
    // The release clock is unaffected — one clock being unset never silences the other.
    expect(Object.keys(result.codeFreezeCapacityByVersionName)).toHaveLength(1);
  });
});
