// derivedDateForecastContext.test.ts — The bridge between the forecast and the bulk date fix.
//
// Two things matter here. Every issue is charged at full size, because these surfaces have no board
// columns — conservative by design, since it can only pull a Target Start earlier. And an issue
// nobody sized gets null rather than a number, so the policy falls back to its old rule instead of
// working back from an effort figure somebody invented.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildDerivedDateForecastContext,
  describeTargetStartBases,
} from './derivedDateForecastContext.ts';
import { ART_SETTINGS_STORAGE_KEY } from '../../../services/artSettingsStore.ts';
import type { JiraIssueLike, TodayAdapterFieldIds } from './forecastAdapters.ts';

const FIELD_IDS: TodayAdapterFieldIds = {
  storyPointsFieldIds: ['customfield_points'],
  subStatusFieldIds: [],
  targetStartFieldIds: ['customfield_targetstart'],
};

const NOW = new Date('2026-08-20T12:00:00.000Z');

function issue(key: string, fields: Record<string, unknown> = {}): JiraIssueLike {
  return { key, fields: { summary: 'A story', status: { name: 'Working' }, ...fields } };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('buildDerivedDateForecastContext', () => {
  it('turns points into working days at the configured rate', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ pointsPerWorkingDay: 2 }));

    const context = buildDerivedDateForecastContext([issue('ENC-1', { customfield_points: 8 })], FIELD_IDS, NOW);

    expect(context.remainingEffortWorkingDaysByKey['ENC-1']).toBe(4);
  });

  it('charges every issue at full size, because these surfaces have no board columns', () => {
    const context = buildDerivedDateForecastContext([issue('ENC-1', { customfield_points: 5 })], FIELD_IDS, NOW);

    expect(context.remainingEffortWorkingDaysByKey['ENC-1']).toBe(5);
  });

  it('leaves an unsized issue null, so the policy falls back rather than guessing', () => {
    const context = buildDerivedDateForecastContext([issue('ENC-1')], FIELD_IDS, NOW);

    expect(context.remainingEffortWorkingDaysByKey['ENC-1']).toBeNull();
  });

  it('charges a finished issue nothing', () => {
    const context = buildDerivedDateForecastContext(
      [issue('ENC-1', { customfield_points: 5, status: { name: 'Accepted', statusCategory: { name: 'Done' } } })],
      FIELD_IDS,
      NOW,
    );

    expect(context.remainingEffortWorkingDaysByKey['ENC-1']).toBe(0);
  });

  it('passes the PI deadline through when the ART has configured one', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ piEndDate: '2026-11-06' }));

    expect(buildDerivedDateForecastContext([], FIELD_IDS, NOW).piDodDeadlineIso).toBe('2026-11-06');
  });

  it('reports no PI deadline rather than inventing one', () => {
    expect(buildDerivedDateForecastContext([], FIELD_IDS, NOW).piDodDeadlineIso).toBeNull();
  });

  it('carries the configured holidays into the calendar the policy will use', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ holidayIsoDates: ['2026-12-25'] }));

    expect(buildDerivedDateForecastContext([], FIELD_IDS, NOW).workingCalendar.holidayIsoDates)
      .toEqual(['2026-12-25']);
  });

  it('survives an empty issue list', () => {
    expect(buildDerivedDateForecastContext([], FIELD_IDS, NOW).remainingEffortWorkingDaysByKey).toEqual({});
  });
});

describe('describeTargetStartBases', () => {
  it('says nothing when no Target Start was written', () => {
    expect(describeTargetStartBases({})).toBe('');
  });

  it('distinguishes a date worked back from effort from one merely three days on', () => {
    // The distinction the whole message exists for: one of those is a plan, the other a placeholder.
    const described = describeTargetStartBases({ 'back-calculated': 12, 'ready-to-work-lead': 4 });
    expect(described).toContain('12 worked back from the effort left');
    expect(described).toContain('4 from the day it became workable');
  });

  it('names the day work actually began as its own basis', () => {
    expect(describeTargetStartBases({ 'actual-working': 3 })).toContain('3 from the day work began');
  });

  it('ignores a basis that produced nothing', () => {
    expect(describeTargetStartBases({ 'back-calculated': 2, 'ready-to-work-lead': 0 }))
      .not.toContain('became workable');
  });
});

describe('the DEV → SL chain start', () => {
  /** Field ids that include the Feature link, which is what makes a chain visible at all. */
  const CHAIN_FIELD_IDS: TodayAdapterFieldIds = {
    ...FIELD_IDS,
    featureLinkFieldIds: ['customfield_featurelink'],
  };

  /** A story on a Feature, with a fix version whose release date drives the code-freeze deadline. */
  function chainIssue(key: string, summary: string, points: number | null): JiraIssueLike {
    return {
      key,
      fields: {
        summary,
        status: { name: 'Working' },
        customfield_featurelink: 'DENP-1',
        customfield_points: points,
        // Release 2026-10-16 → code freeze 21 days earlier, 2026-09-25, a Friday.
        fixVersions: [{ name: 'Release 10/16/2026', releaseDate: '2026-10-16', released: false }],
      },
    };
  }

  it('works each issue start back through the SL story and both handover buffers', () => {
    // SL needs 2 days ending Fri 25: Thu 24, Fri 25. SL queue Wed 23, code review Tue 22 — so dev
    // must be complete Tue 22, and its 3 days run Fri 18, Mon 21, Tue 22.
    const context = buildDerivedDateForecastContext(
      [chainIssue('ENC-1', '[DEV] Build it', 3), chainIssue('ENC-2', '[SL] Test it', 2)],
      CHAIN_FIELD_IDS,
      NOW,
    );

    expect(context.chainTargetStartByKey['ENC-1']).toBe('2026-09-18');
    expect(context.chainTargetStartByKey['ENC-2']).toBe('2026-09-24');
  });

  it('gives an issue on no Feature no chain date, because it has no chain', () => {
    const context = buildDerivedDateForecastContext(
      [issue('ENC-1', { summary: '[DEV] Build it', customfield_points: 3 })],
      CHAIN_FIELD_IDS,
      NOW,
    );

    expect(context.chainTargetStartByKey['ENC-1']).toBeUndefined();
  });

  it('dates no issue in a Feature that holds unsized work', () => {
    // One unmeasured story makes the whole chain a guess, and a guessed date reads like a real one.
    const context = buildDerivedDateForecastContext(
      [chainIssue('ENC-1', '[DEV] Build it', 3), chainIssue('ENC-2', '[SL] Test it', null)],
      CHAIN_FIELD_IDS,
      NOW,
    );

    expect(context.chainTargetStartByKey).toEqual({});
  });

  it('gives nothing when no fix version supplies a deadline to work back from', () => {
    const context = buildDerivedDateForecastContext(
      [issue('ENC-1', { summary: '[DEV] Build it', customfield_points: 3, customfield_featurelink: 'DENP-1' })],
      CHAIN_FIELD_IDS,
      NOW,
    );

    expect(context.chainTargetStartByKey).toEqual({});
  });

  it('produces no chain at all for a caller that does not resolve Feature links', () => {
    // Byte-identical behaviour for every surface that predates this: no Feature link, no chain.
    const context = buildDerivedDateForecastContext(
      [chainIssue('ENC-1', '[DEV] Build it', 3), chainIssue('ENC-2', '[SL] Test it', 2)],
      FIELD_IDS,
      NOW,
    );

    expect(context.chainTargetStartByKey).toEqual({});
  });
});
