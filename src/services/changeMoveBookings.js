// changeMoveBookings.js — The booked moves: one named change, one target state, one moment.
//
// This replaces a polling sweep that decided for itself which changes were due. A booking is an
// explicit instruction — "move CHG0046897 to Implement at 14:00" — so nothing is inferred from a
// change's state, nobody's list is swept, and a move that was never asked for cannot happen.
//
// Pure: every rule here is a function of the bookings and a timestamp, so the whole model is
// testable without ServiceNow, a relay, a clock or a disk.

'use strict';

/** A booking that has not run yet. */
const BOOKING_STATUS_PENDING = 'pending';
/** A booking whose move ServiceNow accepted. */
const BOOKING_STATUS_DONE = 'done';
/** A booking whose move ServiceNow refused; the reason is kept on the booking. */
const BOOKING_STATUS_FAILED = 'failed';
/** A booking withdrawn before it ran. */
const BOOKING_STATUS_CANCELLED = 'cancelled';

/** Trims a value to a string, or '' when it is not a string. */
function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds a stored booking from what the panel posted, or null when it is unusable.
 *
 * A booking with no change number, no target state or no readable moment is refused outright rather
 * than stored: a booking that can never run is worse than no booking, because it looks like cover.
 */
function normaliseBooking(rawBooking, createdAtIso, generateId) {
  const changeNumber = toTrimmedString(rawBooking && rawBooking.changeNumber).toUpperCase();
  const targetState = toTrimmedString(rawBooking && rawBooking.targetState);
  const dueAtIso = toTrimmedString(rawBooking && rawBooking.dueAtIso);

  if (changeNumber === '' || targetState === '' || Number.isNaN(Date.parse(dueAtIso))) {
    return null;
  }

  return {
    id: generateId(),
    changeNumber,
    targetState,
    targetStateLabel: toTrimmedString(rawBooking && rawBooking.targetStateLabel) || targetState,
    dueAtIso: new Date(Date.parse(dueAtIso)).toISOString(),
    status: BOOKING_STATUS_PENDING,
    createdAtIso,
    completedAtIso: '',
    message: '',
  };
}

/**
 * Returns the pending bookings whose moment has arrived, oldest first.
 *
 * Oldest first matters: two bookings for one change run in the order they were meant to, so a pair
 * that was late does not land back to front.
 */
function listDueBookings(bookings, currentTimeMs) {
  if (!Array.isArray(bookings)) {
    return [];
  }
  return bookings
    .filter((booking) => booking && booking.status === BOOKING_STATUS_PENDING)
    .filter((booking) => {
      const dueAtMs = Date.parse(booking.dueAtIso);
      return !Number.isNaN(dueAtMs) && dueAtMs <= currentTimeMs;
    })
    .sort((first, second) => Date.parse(first.dueAtIso) - Date.parse(second.dueAtIso));
}

/**
 * Returns the booking list with one booking's outcome recorded. Never mutates the input.
 *
 * A booking that failed stays visible with its reason rather than disappearing, because a move that
 * did not happen is the thing somebody most needs to see.
 */
function applyBookingOutcome(bookings, bookingId, outcome) {
  if (!Array.isArray(bookings)) {
    return [];
  }
  return bookings.map((booking) => {
    if (!booking || booking.id !== bookingId) {
      return booking;
    }
    return Object.assign({}, booking, {
      status: outcome.status,
      completedAtIso: outcome.completedAtIso || '',
      message: outcome.message || '',
    });
  });
}

/** Returns the booking list with one pending booking cancelled. A booking that ran is left alone. */
function cancelBooking(bookings, bookingId) {
  if (!Array.isArray(bookings)) {
    return [];
  }
  return bookings.map((booking) => {
    if (!booking || booking.id !== bookingId || booking.status !== BOOKING_STATUS_PENDING) {
      return booking;
    }
    return Object.assign({}, booking, { status: BOOKING_STATUS_CANCELLED });
  });
}

module.exports = {
  BOOKING_STATUS_PENDING,
  BOOKING_STATUS_DONE,
  BOOKING_STATUS_FAILED,
  BOOKING_STATUS_CANCELLED,
  normaliseBooking,
  listDueBookings,
  applyBookingOutcome,
  cancelBooking,
};
