// changeAutoScheduleScheduler.test.js — The sweep and the tick, with no relay, clock or disk.

const {
  checkAndSweepDueChanges,
  runChangeAutoScheduleSweep,
  readSchedulerConfig,
  DEFAULT_SWEEP_INTERVAL_MINUTES,
} = require('./changeAutoScheduleScheduler');

const NINE_AM_MS = Date.parse('2026-08-31T09:00:00Z');

/** Config with this scheduler enabled and every other block absent. */
function buildConfiguration(overrides = {}) {
  return { scheduler: { changeAutoSchedule: Object.assign({ isEnabled: true }, overrides) } };
}

/** A relay stub: answers the change query, and records every PATCH. */
function buildRelayStub(changeRecords) {
  const patchedUrls = [];
  const submitRelayRequest = jest.fn(async (_system, request) => {
    if (request.method === 'PATCH') {
      patchedUrls.push(request.url);
      return {};
    }
    return { result: changeRecords };
  });
  return { submitRelayRequest, patchedUrls };
}

/** One submitted change due at 09:00. */
function buildDueChange(overrides = {}) {
  return Object.assign({
    sys_id: 'chg-sys-1', number: 'CHG0046897', state: '-4', start_date: '2026-08-31 09:00:00',
  }, overrides);
}

describe('readSchedulerConfig', () => {
  it('applies every default when nothing is configured', () => {
    const config = readSchedulerConfig({});

    expect(config.isEnabled).toBe(false);
    expect(config.intervalMin).toBe(DEFAULT_SWEEP_INTERVAL_MINUTES);
    expect(config.leadTimeMinutes).toBe(0);
  });

  it('refuses a zero or negative interval, which would sweep every minute or never', () => {
    expect(readSchedulerConfig(buildConfiguration({ intervalMin: 0 })).intervalMin)
      .toBe(DEFAULT_SWEEP_INTERVAL_MINUTES);
    expect(readSchedulerConfig(buildConfiguration({ intervalMin: -5 })).intervalMin)
      .toBe(DEFAULT_SWEEP_INTERVAL_MINUTES);
  });
});

describe('runChangeAutoScheduleSweep', () => {
  it('moves a change whose planned start has arrived', async () => {
    const relay = buildRelayStub([buildDueChange()]);

    const summary = await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(summary.scheduledChangeNumbers).toEqual(['CHG0046897']);
    expect(relay.patchedUrls).toEqual(['/api/now/v2/table/change_request/chg-sys-1']);
  });

  it('scopes to the signed-in user with the clause the shipped surfaces already use', async () => {
    // The reported defect: this asked sys_user for `user_name=javascript:gs.getUserID()`, but
    // gs.getUserID() returns a sys_id, not a user name — so nothing matched and every sweep gave up
    // with "Could not identify the signed-in ServiceNow user". Release Management, Modify CHG and My
    // Issues all scope the change query itself with assigned_to, and never look a user up at all.
    const relay = buildRelayStub([buildDueChange()]);

    await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    const readRequests = relay.submitRelayRequest.mock.calls.filter(([, request]) => request.method === 'GET');
    expect(readRequests).toHaveLength(1);
    expect(readRequests[0][1].url).toContain(encodeURIComponent('assigned_to=javascript:gs.getUserID()'));
    expect(readRequests[0][1].url).not.toContain('sys_user');
  });

  it('never asks for changes without an assignee clause, which would sweep the whole instance', async () => {
    const relay = buildRelayStub([buildDueChange()]);

    await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    const readRequests = relay.submitRelayRequest.mock.calls.filter(([, request]) => request.method === 'GET');
    expect(readRequests[0][1].url).toContain(encodeURIComponent('assigned_to='));
  });

  it('writes nothing and says why when the relay bookmarklet is not registered', async () => {
    // The work is still due. Reporting it as done, or as failed, would both be wrong.
    const relay = buildRelayStub([buildDueChange()]);

    const summary = await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => false,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(relay.submitRelayRequest).not.toHaveBeenCalled();
    expect(summary.scheduledChangeNumbers).toEqual([]);
    expect(summary.skipReason).toMatch(/bookmarklet is not registered/i);
  });

  it('names the change it would move without writing, in dry run', async () => {
    const relay = buildRelayStub([buildDueChange()]);

    const summary = await runChangeAutoScheduleSweep(buildConfiguration({ isDryRun: true }), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(summary.scheduledChangeNumbers).toEqual(['CHG0046897']);
    expect(relay.patchedUrls).toEqual([]);
  });

  it('leaves a change whose planned start has not arrived', async () => {
    const relay = buildRelayStub([buildDueChange({ start_date: '2026-09-30 09:00:00' })]);

    const summary = await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(summary.scheduledChangeNumbers).toEqual([]);
    expect(relay.patchedUrls).toEqual([]);
  });

  it('carries on down the list when one change is refused', async () => {
    const relay = buildRelayStub([
      buildDueChange({ sys_id: 'chg-sys-1', number: 'CHG1' }),
      buildDueChange({ sys_id: 'chg-sys-2', number: 'CHG2' }),
    ]);
    relay.submitRelayRequest.mockImplementation(async (_system, request) => {
      if (request.method === 'PATCH') {
        if (request.url.endsWith('chg-sys-1')) throw new Error('ServiceNow said no');
        return {};
      }
      return {
        result: [
          buildDueChange({ sys_id: 'chg-sys-1', number: 'CHG1' }),
          buildDueChange({ sys_id: 'chg-sys-2', number: 'CHG2' }),
        ],
      };
    });

    const summary = await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest: relay.submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(summary.scheduledChangeNumbers).toEqual(['CHG2']);
    expect(summary.failures).toEqual([{ changeNumber: 'CHG1', message: 'ServiceNow said no' }]);
  });

  it('reports a failed read instead of throwing out of the tick', async () => {
    const submitRelayRequest = jest.fn(async () => { throw new Error('Relay request timed out'); });

    const summary = await runChangeAutoScheduleSweep(buildConfiguration(), {
      submitRelayRequest,
      isRelayConnected: () => true,
      currentTimeMs: NINE_AM_MS,
      recordRun: () => {},
    });

    expect(summary.skipReason).toMatch(/Relay request timed out/);
  });
});

describe('checkAndSweepDueChanges — when a tick sweeps', () => {
  /** Fresh per-test state so one test's slot never suppresses another's sweep. */
  function buildTickState() {
    return { slotState: { lastSweptMinuteSlot: '' }, inFlightState: { isSweepInFlight: false } };
  }

  it('does nothing at all while disabled', () => {
    const runSweep = jest.fn();

    const didSweep = checkAndSweepDueChanges({ scheduler: { changeAutoSchedule: { isEnabled: false } } },
      Object.assign({ now: new Date('2026-08-31T09:00:00'), runSweep }, buildTickState()));

    expect(didSweep).toBe(false);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('sweeps on a clock-aligned boundary of the interval', () => {
    const runSweep = jest.fn(async () => ({}));

    const didSweep = checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }),
      Object.assign({ now: new Date('2026-08-31T09:05:00'), runSweep }, buildTickState()));

    expect(didSweep).toBe(true);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on a minute that is not a boundary', () => {
    const runSweep = jest.fn(async () => ({}));

    const didSweep = checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }),
      Object.assign({ now: new Date('2026-08-31T09:03:00'), runSweep }, buildTickState()));

    expect(didSweep).toBe(false);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('sweeps a given minute once, however many ticks land in it', () => {
    const runSweep = jest.fn(async () => ({}));
    const tickState = buildTickState();
    const options = Object.assign({ now: new Date('2026-08-31T09:05:00'), runSweep }, tickState);

    checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }), options);
    const didSweepAgain = checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }), options);

    expect(didSweepAgain).toBe(false);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });

  it('does not start a second sweep on top of one still running', () => {
    // A slow sweep with another started over it would try to move the same change twice, and the
    // second attempt would be recorded as a failure that never really happened.
    const runSweep = jest.fn(() => new Promise(() => {}));
    const tickState = buildTickState();

    checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }),
      Object.assign({ now: new Date('2026-08-31T09:05:00'), runSweep }, tickState));
    const didSweepAgain = checkAndSweepDueChanges(buildConfiguration({ intervalMin: 5 }),
      Object.assign({ now: new Date('2026-08-31T09:10:00'), runSweep }, tickState));

    expect(didSweepAgain).toBe(false);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });
});
