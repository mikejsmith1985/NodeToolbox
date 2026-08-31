// src/routes/changeMoves.js — Endpoints for booked change moves: list your active changes to pick
// from, book a move, withdraw one, list what is booked, and run whatever is due right now.
//
// No credentials are accepted or returned — every ServiceNow call rides the relay bookmarklet under
// the signed-in user's own session.

'use strict';

const express = require('express');
const relayBridge = require('./relayBridge');
const {
  readBookings,
  addBooking,
  removeBooking,
  runDueChangeMoves,
} = require('../services/changeMoveScheduler');

/** How long to wait for the relay to answer the change-list request. */
const RELAY_TIMEOUT_MS = 30 * 1000;

/** The active changes assigned to whoever is signed in — evaluated by ServiceNow, not looked up. */
const MY_ACTIVE_CHANGE_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';

/** Fields the picker needs to show a change and its current position. */
const CHANGE_PICKER_FIELDS = 'sys_id,number,short_description,state,start_date';

/** Most changes offered in the picker. Far above any one person's active list. */
const CHANGE_PICKER_LIMIT = 50;

/**
 * Creates the booked-change-moves router.
 * @returns {import('express').Router}
 */
function createChangeMovesRouter() {
  const router = express.Router();

  // GET my-changes — the list the picker offers, so a change is chosen from ServiceNow's own
  // records rather than typed. A typo saves cleanly and then silently does nothing.
  router.get('/api/change-moves/my-changes', async (req, res) => {
    if (!relayBridge.getBridgeStatus('snow')) {
      return res.json({ changes: [], message: 'The ServiceNow relay bookmarklet is not registered, so your changes could not be listed.' });
    }
    try {
      const changesResponse = await relayBridge.submitRelayRequest('snow', {
        method: 'GET',
        url: '/api/now/v2/table/change_request'
          + '?sysparm_query=' + encodeURIComponent(MY_ACTIVE_CHANGE_QUERY)
          + '&sysparm_fields=' + CHANGE_PICKER_FIELDS
          + '&sysparm_limit=' + CHANGE_PICKER_LIMIT
          + '&sysparm_display_value=all',
      }, RELAY_TIMEOUT_MS);
      const changeRecords = (changesResponse && changesResponse.result) || [];
      return res.json({ changes: changeRecords.map(toPickerChange), message: '' });
    } catch (listError) {
      const errorMessage = listError instanceof Error ? listError.message : String(listError);
      return res.json({ changes: [], message: 'Could not list your changes: ' + errorMessage });
    }
  });

  // GET bookings — everything booked, newest first.
  router.get('/api/change-moves/bookings', (req, res) => {
    return res.json({ bookings: readBookings() });
  });

  // POST bookings — book one move. A booking that could never run is refused rather than stored.
  router.post('/api/change-moves/bookings', (req, res) => {
    const booking = addBooking(req.body || {});
    if (booking === null) {
      return res.status(400).json({
        ok: false,
        message: 'A booking needs a change, a target state and a date and time.',
      });
    }
    return res.json({ ok: true, booking, bookings: readBookings() });
  });

  // DELETE bookings/:bookingId — withdraw a pending booking. One that already ran is left as it is.
  router.delete('/api/change-moves/bookings/:bookingId', (req, res) => {
    const updatedBookings = removeBooking((req.params.bookingId || '').trim());
    return res.json({ ok: true, bookings: updatedBookings });
  });

  // POST run-now — perform whatever is due this instant, without waiting for the next tick. A run
  // that could not act answers 200 carrying its reason: a closed relay is an outcome, not an error.
  router.post('/api/change-moves/run-now', async (req, res) => {
    try {
      const runSummary = await runDueChangeMoves();
      return res.json({ ok: true, run: runSummary, bookings: readBookings() });
    } catch (runError) {
      const errorMessage = runError instanceof Error ? runError.message : String(runError);
      return res.status(500).json({ ok: false, message: 'Run failed: ' + errorMessage });
    }
  });

  return router;
}

/** Reads a ServiceNow field that may arrive as a plain string or a `{value, display_value}` pair. */
function readFieldPair(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) {
    return { value: '', label: '' };
  }
  if (typeof fieldValue === 'object') {
    return {
      value: String(fieldValue.value ?? ''),
      label: String(fieldValue.display_value ?? fieldValue.value ?? ''),
    };
  }
  return { value: String(fieldValue), label: String(fieldValue) };
}

/** Flattens one ServiceNow change record into the shape the picker renders. */
function toPickerChange(changeRecord) {
  const state = readFieldPair(changeRecord.state);
  return {
    number: readFieldPair(changeRecord.number).value,
    shortDescription: readFieldPair(changeRecord.short_description).label,
    stateValue: state.value,
    stateLabel: state.label,
    plannedStart: readFieldPair(changeRecord.start_date).label,
  };
}

module.exports = createChangeMovesRouter;
