// changeMoveScheduler.test.js — Running booked moves, against a real temp file and a stub relay.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BOOKINGS_PATH = path.join(os.tmpdir(), 'ntbx-change-move-bookings-test.json');
process.env.TBX_CHANGE_MOVE_BOOKINGS_PATH = BOOKINGS_PATH;

const {
  runDueChangeMoves,
  checkAndRunDueChangeMoves,
  readBookings,
  addBooking,
  removeBooking,
} = require('./changeMoveScheduler');

const NINE_AM_MS = Date.parse('2026-08-31T09:00:00Z');

/** A relay stub: resolves any change number to a sys_id and records every PATCH. */
function buildRelayStub() {
  const patchedBodies = [];
  const submitRelayRequest = jest.fn(async (_system, request) => {
    if (request.method === 'PATCH') {
      patchedBodies.push({ url: request.url, body: request.body });
      return {};
    }
    return { result: [{ sys_id: 'chg-sys-1' }] };
  });
  return { submitRelayRequest, patchedBodies };
}

beforeEach(() => {
  try { fs.unlinkSync(BOOKINGS_PATH); } catch (_ignored) { /* absent is the clean state */ }
});

describe('addBooking / removeBooking', () => {
  it('stores a booking and hands it back', () => {
    const booking = addBooking(
      { changeNumber: 'chg0046897', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00Z' },
      { nowIso: '2026-08-31T08:00:00.000Z', generateId: () => 'booking-1' },
    );

    expect(booking.changeNumber).toBe('CHG0046897');
    expect(readBookings()).toHaveLength(1);
  });

  it('refuses an unusable booking and stores nothing', () => {
    expect(addBooking({ changeNumber: '', targetState: '1', dueAtIso: '2026-08-31T09:00:00Z' })).toBeNull();
    expect(readBookings()).toEqual([]);
  });

  it('cancels a pending booking so it never runs', async () => {
    const booking = addBooking(
      { changeNumber: 'CHG1', targetState: '1', dueAtIso: '2026-08-31T09:00:00Z' },
      { generateId: () => 'booking-1' },
    );
    removeBooking(booking.id);
    const relay = buildRelayStub();

    const summary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(summary.dueCount).toBe(0);
    expect(relay.patchedBodies).toEqual([]);
  });
});

describe('runDueChangeMoves', () => {
  /** Books one move due at 09:00. */
  function bookDueMove(overrides = {}) {
    return addBooking(
      Object.assign({
        changeNumber: 'CHG0046897', targetState: '1', targetStateLabel: 'Implement',
        dueAtIso: '2026-08-31T09:00:00Z',
      }, overrides),
      { generateId: () => 'booking-' + Math.random().toString(36).slice(2) },
    );
  }

  it('performs exactly the move that was booked', async () => {
    bookDueMove();
    const relay = buildRelayStub();

    const summary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(summary.movedChangeNumbers).toEqual(['CHG0046897']);
    expect(relay.patchedBodies).toEqual([{ url: '/api/now/v2/table/change_request/chg-sys-1', body: { state: '1' } }]);
    expect(readBookings()[0].status).toBe('done');
  });

  it('writes whatever target state was booked, not a state of its own choosing', async () => {
    bookDueMove({ targetState: '-2', targetStateLabel: 'Scheduled' });
    const relay = buildRelayStub();

    await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(relay.patchedBodies[0].body).toEqual({ state: '-2' });
  });

  it('leaves a booking alone until its moment', async () => {
    bookDueMove();
    const relay = buildRelayStub();

    const summary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS - 60_000,
    });

    expect(summary.dueCount).toBe(0);
    expect(relay.patchedBodies).toEqual([]);
    expect(readBookings()[0].status).toBe('pending');
  });

  it('keeps a due booking PENDING when the relay is closed — late, not lost', async () => {
    bookDueMove();
    const relay = buildRelayStub();

    const summary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => false, currentTimeMs: NINE_AM_MS,
    });

    expect(summary.skipReason).toMatch(/not registered/i);
    expect(relay.submitRelayRequest).not.toHaveBeenCalled();
    expect(readBookings()[0].status).toBe('pending');
  });

  it('runs the booking as soon as the relay is back', async () => {
    bookDueMove();
    const relay = buildRelayStub();
    await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => false, currentTimeMs: NINE_AM_MS,
    });

    const summary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS + 60_000,
    });

    expect(summary.movedChangeNumbers).toEqual(['CHG0046897']);
  });

  it('marks a booking failed, with the reason, when ServiceNow does not know the change', async () => {
    bookDueMove({ changeNumber: 'CHG-NOPE' });
    const submitRelayRequest = jest.fn(async () => ({ result: [] }));

    const summary = await runDueChangeMoves({
      submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(summary.failures[0].message).toMatch(/does not know change CHG-NOPE/);
    expect(readBookings()[0].status).toBe('failed');
  });

  it('carries on down the list when one move is refused', async () => {
    bookDueMove({ changeNumber: 'CHG1' });
    bookDueMove({ changeNumber: 'CHG2' });
    const submitRelayRequest = jest.fn(async (_system, request) => {
      if (request.method === 'PATCH') return {};
      const isFirstChange = request.url.includes('CHG1');
      if (isFirstChange) throw new Error('ServiceNow said no');
      return { result: [{ sys_id: 'chg-sys-2' }] };
    });

    const summary = await runDueChangeMoves({
      submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(summary.movedChangeNumbers).toEqual(['CHG2']);
    expect(summary.failures).toEqual([{ changeNumber: 'CHG1', message: 'ServiceNow said no' }]);
  });

  it('never runs the same booking twice', async () => {
    bookDueMove();
    const relay = buildRelayStub();

    await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });
    const secondSummary = await runDueChangeMoves({
      submitRelayRequest: relay.submitRelayRequest, isRelayConnected: () => true, currentTimeMs: NINE_AM_MS,
    });

    expect(secondSummary.dueCount).toBe(0);
    expect(relay.patchedBodies).toHaveLength(1);
  });
});

describe('checkAndRunDueChangeMoves', () => {
  it('does not start a second run on top of one still going', () => {
    const runDue = jest.fn(() => new Promise(() => {}));
    const inFlightState = { isRunInFlight: false };

    checkAndRunDueChangeMoves({ runDue, inFlightState });
    const didRunAgain = checkAndRunDueChangeMoves({ runDue, inFlightState });

    expect(didRunAgain).toBe(false);
    expect(runDue).toHaveBeenCalledTimes(1);
  });
});
