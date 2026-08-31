// changeAutoSchedule.js — Decides which ServiceNow change requests are due to move to "Implement".
//
// A change sits in Scheduled until its planned start arrives and somebody remembers to start it.
// That is a clerical act on a clock, which is what a scheduler is for. This module is the decision
// half and is deliberately pure: it takes change records and a timestamp and returns a verdict per
// change, so every rule below is testable without ServiceNow, a relay, or a clock.
//
// The one rule worth stating out loud: only a SCHEDULED change is advanced. ServiceNow's own
// transition map allows Scheduled → Implement, so a change that has not reached Scheduled has not
// been through what precedes it. Such a change at its planned start is reported, never moved.

'use strict';

/** ServiceNow's raw `state` value for a Scheduled change — the only state advanced from. */
const SCHEDULED_STATE_VALUE = '-2';

/** ServiceNow's raw `state` value for Implement — where a change whose start has arrived is moved. */
const IMPLEMENT_STATE_VALUE = '1';

/**
 * Reads a ServiceNow field that may arrive as a plain string or as a `{value, display_value}` pair.
 *
 * The raw `value` is always preferred: a display value is formatted for the reader's profile
 * (`31/08/2026`), and parsing that as a date is how a change lands four hours adrift.
 */
function readFieldValue(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) {
    return '';
  }
  if (typeof fieldValue === 'object') {
    return String(fieldValue.value !== undefined && fieldValue.value !== null ? fieldValue.value : '');
  }
  return String(fieldValue);
}

/**
 * Parses a ServiceNow date-time into epoch milliseconds, or null when it cannot be read.
 *
 * ServiceNow returns `YYYY-MM-DD HH:MM:SS` in UTC. Null rather than NaN or a fallback, because a
 * guessed start time would schedule a change at the wrong moment — the exact failure this exists to
 * prevent.
 */
function parseServiceNowDateTime(dateTimeText) {
  const trimmedDateTime = String(dateTimeText === null || dateTimeText === undefined ? '' : dateTimeText).trim();
  if (trimmedDateTime === '') {
    return null;
  }
  const isoCandidate = trimmedDateTime.includes('T')
    ? trimmedDateTime
    : trimmedDateTime.replace(' ', 'T') + 'Z';
  const parsedMilliseconds = Date.parse(isoCandidate);
  return Number.isNaN(parsedMilliseconds) ? null : parsedMilliseconds;
}

/**
 * Decides whether one change should be moved to Implement now, and says why when it should not.
 *
 * `leadTimeMinutes` moves the action that many minutes ahead of the planned start, for teams who
 * want the change scheduled before the window rather than exactly on it.
 */
function decideChangeScheduleAction(changeRecord, currentTimeMs, leadTimeMinutes) {
  const record = changeRecord || {};
  const changeNumber = readFieldValue(record.number);
  const changeSysId = readFieldValue(record.sys_id);
  const baseDecision = { changeNumber, changeSysId, shouldSchedule: false, reason: '' };

  if (changeSysId === '') {
    return Object.assign({}, baseDecision, { reason: 'No sys_id on the record, so it cannot be updated.' });
  }

  const currentStateValue = readFieldValue(record.state);
  if (currentStateValue !== SCHEDULED_STATE_VALUE) {
    return Object.assign({}, baseDecision, {
      reason: 'State ' + currentStateValue + ' is not awaiting implementation — only a Scheduled change is advanced.',
    });
  }

  const plannedStartMs = parseServiceNowDateTime(readFieldValue(record.start_date));
  if (plannedStartMs === null) {
    return Object.assign({}, baseDecision, { reason: 'No planned start date to act on.' });
  }

  const leadTimeMs = Math.max(0, Number(leadTimeMinutes) || 0) * 60 * 1000;
  if (currentTimeMs + leadTimeMs < plannedStartMs) {
    return Object.assign({}, baseDecision, { reason: 'Its planned start has not arrived yet.' });
  }

  return Object.assign({}, baseDecision, { shouldSchedule: true, plannedStartMs });
}

/** Returns a verdict for every change in the list, so a skip is reportable rather than invisible. */
function listChangeScheduleDecisions(changeRecords, currentTimeMs, leadTimeMinutes) {
  if (!Array.isArray(changeRecords)) {
    return [];
  }
  return changeRecords
    .filter((changeRecord) => changeRecord !== null && changeRecord !== undefined)
    .map((changeRecord) => decideChangeScheduleAction(changeRecord, currentTimeMs, leadTimeMinutes));
}

module.exports = {
  SCHEDULED_STATE_VALUE,
  IMPLEMENT_STATE_VALUE,
  readFieldValue,
  parseServiceNowDateTime,
  decideChangeScheduleAction,
  listChangeScheduleDecisions,
};
