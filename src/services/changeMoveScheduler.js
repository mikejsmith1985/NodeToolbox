// changeMoveScheduler.js — Runs the moves you booked, at the moment you booked them for.
//
// This replaced a polling sweep that read everybody's changes and decided for itself which were due.
// It could only ever act on what it could infer, and every bug it had came from that inference. A
// booking says the change, the target state and the moment outright, so there is nothing to infer:
// the runner opens the list, finds what is due, and does exactly that.
//
// The tick is the 60-second one every NodeToolbox scheduler uses. Bookings live in a file rather
// than the browser, so a move happens whether or not anybody has the page open.
//
// The one external constraint: ServiceNow writes go through the relay bookmarklet, which needs a
// live browser session. A booking that comes due while the relay is closed is NOT failed — it stays
// pending and runs as soon as the relay is back. A move is late, not lost.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const relayBridge = require('../routes/relayBridge');
const {
  BOOKING_STATUS_DONE,
  BOOKING_STATUS_FAILED,
  normaliseBooking,
  listDueBookings,
  applyBookingOutcome,
  cancelBooking,
} = require('./changeMoveBookings');

// ── Constants ──

/** How often (ms) the runner wakes to look for bookings that have come due. */
const BOOKING_CHECK_INTERVAL_MS = 60 * 1000;

/** How long to wait for the relay to answer one request. Matches the other relay callers. */
const RELAY_TIMEOUT_MS = 30 * 1000;

/** Most bookings kept in the file. Older completed ones fall off the end. */
const MAX_STORED_BOOKINGS = 200;

// ── Module state ──

let runnerIntervalHandle = null;
let isRunInFlight = false;

// ── Persistence ──

/** Path of the bookings file; overridable via env so tests never touch the real profile. */
function getBookingsFilePath() {
  return process.env.TBX_CHANGE_MOVE_BOOKINGS_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'change-move-bookings.json');
}

/** Reads the booked moves; an absent or corrupt file reads as none rather than throwing. */
function readBookings() {
  try {
    const parsedBookings = JSON.parse(fs.readFileSync(getBookingsFilePath(), 'utf8'));
    return Array.isArray(parsedBookings) ? parsedBookings : [];
  } catch (_readError) {
    return [];
  }
}

/** Writes the booked moves, newest first and bounded so the file cannot grow forever. */
function writeBookings(bookings) {
  const boundedBookings = bookings.slice(0, MAX_STORED_BOOKINGS);
  try {
    fs.mkdirSync(path.dirname(getBookingsFilePath()), { recursive: true });
    fs.writeFileSync(getBookingsFilePath(), JSON.stringify(boundedBookings, null, 2) + '\n', 'utf8');
    return true;
  } catch (writeError) {
    console.error('  ⚠ Could not save booked change moves: ' + writeError.message);
    return false;
  }
}

// ── Booking management (what the routes call) ──

/**
 * Books one move. Returns the stored booking, or null when what was posted could not be used.
 *
 * Newest first, so the panel shows the move somebody just booked at the top of the list.
 */
function addBooking(rawBooking, deps = {}) {
  const nowIso = deps.nowIso || new Date().toISOString();
  const generateId = deps.generateId || (() => crypto.randomUUID());
  const booking = normaliseBooking(rawBooking, nowIso, generateId);
  if (booking === null) {
    return null;
  }
  writeBookings([booking].concat(readBookings()));
  return booking;
}

/** Withdraws a pending booking. Returns the updated list. */
function removeBooking(bookingId) {
  const updatedBookings = cancelBooking(readBookings(), bookingId);
  writeBookings(updatedBookings);
  return updatedBookings;
}

// ── ServiceNow access (every call goes through the relay) ──

/** Resolves a change's sys_id from its number, or '' when ServiceNow does not know the number. */
async function fetchChangeSysId(submitRelayRequest, changeNumber) {
  const lookupResponse = await submitRelayRequest('snow', {
    method: 'GET',
    url: '/api/now/v2/table/change_request'
      + '?sysparm_query=' + encodeURIComponent('number=' + changeNumber)
      + '&sysparm_fields=sys_id&sysparm_limit=1',
  }, RELAY_TIMEOUT_MS);
  const firstResult = lookupResponse && lookupResponse.result && lookupResponse.result[0];
  return (firstResult && firstResult.sys_id) || '';
}

/** Writes one change into the booked target state. */
async function writeChangeState(submitRelayRequest, changeSysId, targetState) {
  await submitRelayRequest('snow', {
    method: 'PATCH',
    url: '/api/now/v2/table/change_request/' + changeSysId,
    body: { state: String(targetState) },
  }, RELAY_TIMEOUT_MS);
}

// ── Running the due bookings ──

/**
 * Runs every booking that has come due, and records what happened to each.
 *
 * Returns a summary the panel renders verbatim. A closed relay is reported and nothing is marked
 * failed, because the booking is still going to happen; anything ServiceNow actually refuses is
 * marked failed with its reason, and the rest of the list still runs.
 */
async function runDueChangeMoves(deps = {}) {
  const submitRelayRequest = deps.submitRelayRequest || relayBridge.submitRelayRequest;
  const isRelayConnected = deps.isRelayConnected || (() => relayBridge.getBridgeStatus('snow'));
  const currentTimeMs = deps.currentTimeMs !== undefined ? deps.currentTimeMs : Date.now();

  const dueBookings = listDueBookings(readBookings(), currentTimeMs);
  const runSummary = { movedChangeNumbers: [], failures: [], skipReason: '', dueCount: dueBookings.length };

  if (dueBookings.length === 0) {
    return runSummary;
  }

  // The relay is a live browser session, not a credential. A booking that comes due without it is
  // late, not lost — it stays pending so the next run does it.
  if (!isRelayConnected()) {
    runSummary.skipReason = 'The ServiceNow relay bookmarklet is not registered, so '
      + dueBookings.length + ' due move(s) are still waiting.';
    return runSummary;
  }

  for (const booking of dueBookings) {
    const completedAtIso = new Date(currentTimeMs).toISOString();
    try {
      // eslint-disable-next-line no-await-in-loop -- moves run one at a time to bound relay load
      const changeSysId = await fetchChangeSysId(submitRelayRequest, booking.changeNumber);
      if (!changeSysId) {
        throw new Error('ServiceNow does not know change ' + booking.changeNumber + '.');
      }
      // eslint-disable-next-line no-await-in-loop -- as above
      await writeChangeState(submitRelayRequest, changeSysId, booking.targetState);
      writeBookings(applyBookingOutcome(readBookings(), booking.id, {
        status: BOOKING_STATUS_DONE, completedAtIso,
      }));
      runSummary.movedChangeNumbers.push(booking.changeNumber);
      console.log('  🗓  ' + booking.changeNumber + ' moved to ' + booking.targetStateLabel + ' as booked');
    } catch (moveError) {
      // One refusal must not abandon the rest — the other bookings are still due.
      writeBookings(applyBookingOutcome(readBookings(), booking.id, {
        status: BOOKING_STATUS_FAILED, completedAtIso, message: moveError.message,
      }));
      runSummary.failures.push({ changeNumber: booking.changeNumber, message: moveError.message });
    }
  }

  return runSummary;
}

// ── The tick ──

/**
 * One tick: runs the due bookings unless a previous run is still going.
 *
 * A slow run with another started on top of it would try to move the same change twice, and the
 * second attempt would be recorded as a failure that never really happened.
 * Returns true when a run was started.
 */
function checkAndRunDueChangeMoves(options = {}) {
  const inFlightState = options.inFlightState || { isRunInFlight };
  if (inFlightState.isRunInFlight) {
    return false;
  }

  inFlightState.isRunInFlight = true;
  if (options.inFlightState === undefined) isRunInFlight = true;

  const runDue = options.runDue || (() => runDueChangeMoves());
  Promise.resolve(runDue())
    .catch((runError) => console.error('  ⚠ Booked change move error: ' + runError.message))
    .then(() => {
      inFlightState.isRunInFlight = false;
      if (options.inFlightState === undefined) isRunInFlight = false;
    });

  return true;
}

// ── Entry point ──

/**
 * Starts the booked-move runner: a 60-second tick that performs whatever has come due.
 * @returns {Function} stop function that clears the interval
 */
function startChangeMoveScheduler() {
  if (runnerIntervalHandle) {
    clearInterval(runnerIntervalHandle);
  }
  console.log('  🗓  Booked change moves runner started — checking every minute');
  runnerIntervalHandle = setInterval(() => {
    checkAndRunDueChangeMoves();
  }, BOOKING_CHECK_INTERVAL_MS);
  return () => clearInterval(runnerIntervalHandle);
}

module.exports = {
  startChangeMoveScheduler,
  checkAndRunDueChangeMoves,
  runDueChangeMoves,
  readBookings,
  addBooking,
  removeBooking,
};
