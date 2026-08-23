// issuePlanningDates.test.ts — The three dates every date flag on the Hygiene page is about.

import { describe, expect, it } from 'vitest';

import { readIssuePlanningDates, readPlanningDateValue } from './issuePlanningDates.ts';
import { resolveHygieneFieldConfig, type JiraIssue } from './checks/hygieneChecks.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();
const TARGET_START_FIELD = FIELD_CONFIG.targetStartFieldIds[0];
const TARGET_END_FIELD = FIELD_CONFIG.targetEndFieldIds[0];

function issueWithDates(fields: Record<string, unknown>): JiraIssue {
  return { key: 'TBX-1', fields: { summary: 'A story', ...fields } } as unknown as JiraIssue;
}

describe('readPlanningDateValue', () => {
  it('reads a plain calendar day', () => {
    expect(readPlanningDateValue('2026-09-10')).toBe('2026-09-10');
  });

  it('takes the day written on the face of a datetime, not the local day', () => {
    // Jira returns some date fields as a datetime at UTC midnight. Converting that to a local day
    // yields the day BEFORE for everyone west of Greenwich, which silently shifts every date west.
    expect(readPlanningDateValue('2026-09-10T00:00:00.000+0000')).toBe('2026-09-10');
  });

  it('reads an absent or unusable value as no date rather than as a blank one', () => {
    expect(readPlanningDateValue(null)).toBeNull();
    expect(readPlanningDateValue(undefined)).toBeNull();
    expect(readPlanningDateValue('not a date')).toBeNull();
    expect(readPlanningDateValue(20260910)).toBeNull();
  });
});

describe('readIssuePlanningDates', () => {
  it('returns the three dates in the order the work happens', () => {
    // Start, due, end. A reader scanning left to right is reading a timeline, which is the only
    // ordering that makes a wrong date obvious at a glance.
    const dates = readIssuePlanningDates(issueWithDates({}), FIELD_CONFIG);

    expect(dates.map((planningDate) => planningDate.id)).toEqual(['targetStart', 'dueDate', 'targetEnd']);
  });

  it('reads each date from its configured field', () => {
    const dates = readIssuePlanningDates(issueWithDates({
      [TARGET_START_FIELD]: '2026-08-01',
      duedate: '2026-09-10',
      [TARGET_END_FIELD]: '2026-08-20',
    }), FIELD_CONFIG);

    expect(dates.map((planningDate) => planningDate.value)).toEqual(['2026-08-01', '2026-09-10', '2026-08-20']);
  });

  it('names the Jira field each date writes to', () => {
    const dates = readIssuePlanningDates(issueWithDates({}), FIELD_CONFIG);

    expect(dates[0].fieldId).toBe(TARGET_START_FIELD);
    // A system field, so it needs no configuration and is never absent.
    expect(dates[1].fieldId).toBe('duedate');
    expect(dates[2].fieldId).toBe(TARGET_END_FIELD);
  });

  it('still lists a date whose field this instance has not configured, marked unwritable', () => {
    // Omitting it would let the card show two dates and look complete. Showing it without a field
    // says what is actually true: nobody has told Toolbox where that date lives.
    // Built directly rather than through the resolver: the resolver deliberately back-fills these
    // two from its defaults, so it cannot express "this instance has no such field".
    const unconfigured = { ...FIELD_CONFIG, targetStartFieldIds: [], targetEndFieldIds: [] };

    const dates = readIssuePlanningDates(issueWithDates({}), unconfigured);

    expect(dates).toHaveLength(3);
    expect(dates[0].fieldId).toBeNull();
    expect(dates[2].fieldId).toBeNull();
  });

  it('reports an empty date as no value rather than an empty string', () => {
    const dates = readIssuePlanningDates(issueWithDates({ duedate: '' }), FIELD_CONFIG);

    expect(dates[1].value).toBeNull();
  });
});
