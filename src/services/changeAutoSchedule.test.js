// changeAutoSchedule.test.js — The decision core: which changes may move to Scheduled, and why not.

const {
  SCHEDULED_STATE_VALUE,
  IMPLEMENT_STATE_VALUE,
  parseServiceNowDateTime,
  decideChangeScheduleAction,
  listChangeScheduleDecisions,
} = require('./changeAutoSchedule');

/** A change record in the shape the ServiceNow table API returns it. */
function buildChange(overrides = {}) {
  return {
    number:     'CHG0046897',
    sys_id:     'chg-sys-001',
    state:      SCHEDULED_STATE_VALUE,
    start_date: '2026-08-31 09:00:00',
    ...overrides,
  };
}

const NINE_AM_MS = Date.parse('2026-08-31T09:00:00Z');

describe('parseServiceNowDateTime', () => {
  it('reads the space-separated form ServiceNow returns', () => {
    expect(parseServiceNowDateTime('2026-08-31 09:00:00')).toBe(Date.parse('2026-08-31T09:00:00Z'));
  });

  it('reads an ISO form unchanged', () => {
    expect(parseServiceNowDateTime('2026-08-31T09:00:00Z')).toBe(Date.parse('2026-08-31T09:00:00Z'));
  });

  it('returns null for a blank or unreadable value rather than a wrong number', () => {
    expect(parseServiceNowDateTime('')).toBeNull();
    expect(parseServiceNowDateTime('not a date')).toBeNull();
    expect(parseServiceNowDateTime(undefined)).toBeNull();
  });
});

describe('decideChangeScheduleAction — what may move, and what may not', () => {
  it('implements a scheduled change whose planned start has arrived', () => {
    const decision = decideChangeScheduleAction(buildChange(), NINE_AM_MS, 0);

    expect(decision.shouldSchedule).toBe(true);
    expect(decision.changeNumber).toBe('CHG0046897');
    expect(decision.changeSysId).toBe('chg-sys-001');
  });

  it('leaves a scheduled change alone until its planned start', () => {
    const decision = decideChangeScheduleAction(buildChange(), NINE_AM_MS - 60_000, 0);

    expect(decision.shouldSchedule).toBe(false);
    expect(decision.reason).toMatch(/planned start/i);
  });

  it('moves early by the configured lead time', () => {
    const decision = decideChangeScheduleAction(buildChange(), NINE_AM_MS - 10 * 60_000, 15);

    expect(decision.shouldSchedule).toBe(true);
  });

  it('refuses a change that has not reached Scheduled, and says why', () => {
    // ServiceNow's own transition map allows Scheduled → Implement. A Submitted change has not been
    // through what precedes Scheduled, so advancing it here would skip that.
    const decision = decideChangeScheduleAction(buildChange({ state: '-4' }), NINE_AM_MS, 0);

    expect(decision.shouldSchedule).toBe(false);
    expect(decision.reason).toMatch(/not awaiting implementation/i);
  });

  it('leaves a change that is already in Implement', () => {
    const decision = decideChangeScheduleAction(buildChange({ state: IMPLEMENT_STATE_VALUE }), NINE_AM_MS, 0);

    expect(decision.shouldSchedule).toBe(false);
  });

  it('refuses a change with no planned start rather than guessing one', () => {
    const decision = decideChangeScheduleAction(buildChange({ start_date: '' }), NINE_AM_MS, 0);

    expect(decision.shouldSchedule).toBe(false);
    expect(decision.reason).toMatch(/no planned start/i);
  });

  it('refuses a change with no sys_id, which cannot be written to', () => {
    const decision = decideChangeScheduleAction(buildChange({ sys_id: '' }), NINE_AM_MS, 0);

    expect(decision.shouldSchedule).toBe(false);
  });

  it('reads a field ServiceNow returned as a display-value object', () => {
    const change = buildChange({
      state:      { value: SCHEDULED_STATE_VALUE, display_value: 'Scheduled' },
      start_date: { value: '2026-08-31 09:00:00', display_value: '31/08/2026 09:00:00' },
    });

    expect(decideChangeScheduleAction(change, NINE_AM_MS, 0).shouldSchedule).toBe(true);
  });
});

describe('listChangeScheduleDecisions — every change gets a verdict', () => {
  it('returns one decision per change, due ones included', () => {
    const changes = [
      buildChange({ number: 'CHG1', sys_id: 'a' }),
      buildChange({ number: 'CHG2', sys_id: 'b', state: '-4' }),
      buildChange({ number: 'CHG3', sys_id: 'c', start_date: '2026-09-30 09:00:00' }),
    ];

    const decisions = listChangeScheduleDecisions(changes, NINE_AM_MS, 0);

    expect(decisions).toHaveLength(3);
    expect(decisions.filter((decision) => decision.shouldSchedule).map((decision) => decision.changeNumber))
      .toEqual(['CHG1']);
  });

  it('survives a malformed response without throwing', () => {
    expect(listChangeScheduleDecisions(null, NINE_AM_MS, 0)).toEqual([]);
    expect(listChangeScheduleDecisions([null, undefined], NINE_AM_MS, 0)).toHaveLength(0);
  });
});
