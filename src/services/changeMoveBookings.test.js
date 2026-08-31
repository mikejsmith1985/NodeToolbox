// changeMoveBookings.test.js — The booked-move model: what is due, what runs, what is refused.

const {
  BOOKING_STATUS_PENDING,
  BOOKING_STATUS_DONE,
  BOOKING_STATUS_FAILED,
  BOOKING_STATUS_CANCELLED,
  normaliseBooking,
  listDueBookings,
  applyBookingOutcome,
  cancelBooking,
} = require('./changeMoveBookings');

const CREATED_AT = '2026-08-31T08:00:00.000Z';
const NINE_AM_MS = Date.parse('2026-08-31T09:00:00Z');

/** A generator that hands out predictable ids so assertions can name them. */
function buildIdGenerator() {
  let nextIdNumber = 0;
  return () => { nextIdNumber += 1; return 'booking-' + nextIdNumber; };
}

/** A stored booking, pending unless overridden. */
function buildBooking(overrides = {}) {
  return {
    id: 'booking-1',
    changeNumber: 'CHG0046897',
    targetState: '1',
    targetStateLabel: 'Implement',
    dueAtIso: '2026-08-31T09:00:00.000Z',
    status: BOOKING_STATUS_PENDING,
    createdAtIso: CREATED_AT,
    completedAtIso: '',
    message: '',
    ...overrides,
  };
}

describe('normaliseBooking — an unusable booking is refused, not stored', () => {
  it('stores what was asked for, upper-casing the change number', () => {
    const booking = normaliseBooking(
      { changeNumber: 'chg0046897', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00Z' },
      CREATED_AT, buildIdGenerator(),
    );

    expect(booking.changeNumber).toBe('CHG0046897');
    expect(booking.targetState).toBe('1');
    expect(booking.dueAtIso).toBe('2026-08-31T09:00:00.000Z');
    expect(booking.status).toBe(BOOKING_STATUS_PENDING);
  });

  it('refuses a booking with no change number', () => {
    expect(normaliseBooking({ targetState: '1', dueAtIso: '2026-08-31T09:00:00Z' }, CREATED_AT, buildIdGenerator()))
      .toBeNull();
  });

  it('refuses a booking with no target state', () => {
    expect(normaliseBooking({ changeNumber: 'CHG1', dueAtIso: '2026-08-31T09:00:00Z' }, CREATED_AT, buildIdGenerator()))
      .toBeNull();
  });

  it('refuses a booking whose moment cannot be read, rather than storing one that never runs', () => {
    expect(normaliseBooking({ changeNumber: 'CHG1', targetState: '1', dueAtIso: 'soon' }, CREATED_AT, buildIdGenerator()))
      .toBeNull();
  });

  it('falls back to the raw state value when no label was supplied', () => {
    const booking = normaliseBooking(
      { changeNumber: 'CHG1', targetState: '1', dueAtIso: '2026-08-31T09:00:00Z' }, CREATED_AT, buildIdGenerator(),
    );

    expect(booking.targetStateLabel).toBe('1');
  });
});

describe('listDueBookings — only what was booked, only when it is time', () => {
  it('returns a booking whose moment has arrived', () => {
    expect(listDueBookings([buildBooking()], NINE_AM_MS).map((booking) => booking.id)).toEqual(['booking-1']);
  });

  it('leaves a booking alone until its moment', () => {
    expect(listDueBookings([buildBooking()], NINE_AM_MS - 60_000)).toEqual([]);
  });

  it('runs a late pair in the order they were meant to happen', () => {
    const bookings = [
      buildBooking({ id: 'later', dueAtIso: '2026-08-31T08:30:00.000Z' }),
      buildBooking({ id: 'earlier', dueAtIso: '2026-08-31T08:00:00.000Z' }),
    ];

    expect(listDueBookings(bookings, NINE_AM_MS).map((booking) => booking.id)).toEqual(['earlier', 'later']);
  });

  it('never re-runs a booking that already ran, failed or was cancelled', () => {
    const bookings = [
      buildBooking({ id: 'done', status: BOOKING_STATUS_DONE }),
      buildBooking({ id: 'failed', status: BOOKING_STATUS_FAILED }),
      buildBooking({ id: 'cancelled', status: BOOKING_STATUS_CANCELLED }),
    ];

    expect(listDueBookings(bookings, NINE_AM_MS)).toEqual([]);
  });

  it('survives a malformed store without throwing', () => {
    expect(listDueBookings(null, NINE_AM_MS)).toEqual([]);
    expect(listDueBookings([null, undefined], NINE_AM_MS)).toEqual([]);
  });
});

describe('applyBookingOutcome', () => {
  it('records a completed move without touching the others', () => {
    const bookings = [buildBooking({ id: 'a' }), buildBooking({ id: 'b' })];

    const updated = applyBookingOutcome(bookings, 'a', {
      status: BOOKING_STATUS_DONE, completedAtIso: '2026-08-31T09:00:01.000Z',
    });

    expect(updated[0].status).toBe(BOOKING_STATUS_DONE);
    expect(updated[1].status).toBe(BOOKING_STATUS_PENDING);
  });

  it('keeps a failed booking visible, carrying the reason it failed', () => {
    // A move that did not happen is the thing somebody most needs to see.
    const updated = applyBookingOutcome([buildBooking()], 'booking-1', {
      status: BOOKING_STATUS_FAILED, message: 'ServiceNow refused the transition',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].message).toBe('ServiceNow refused the transition');
  });

  it('does not mutate the list it was given', () => {
    const bookings = [buildBooking()];

    applyBookingOutcome(bookings, 'booking-1', { status: BOOKING_STATUS_DONE });

    expect(bookings[0].status).toBe(BOOKING_STATUS_PENDING);
  });
});

describe('cancelBooking', () => {
  it('cancels a pending booking', () => {
    expect(cancelBooking([buildBooking()], 'booking-1')[0].status).toBe(BOOKING_STATUS_CANCELLED);
  });

  it('leaves a booking that already ran exactly as it was', () => {
    const bookings = [buildBooking({ status: BOOKING_STATUS_DONE })];

    expect(cancelBooking(bookings, 'booking-1')[0].status).toBe(BOOKING_STATUS_DONE);
  });
});
