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
