// src/services/reportDeliveryStatus.js — Records and persists the outcome of each report
// delivery so the Admin Hub can show whether the last run (scheduled or manual) actually
// DELIVERED, SKIPPED because there were no changes, or ERRORED.
//
// The problem this solves: scheduled deliveries log their outcome to the server console and
// then forget it. When a Confluence page silently stops updating, an operator has no way to
// tell "nothing changed, so we skipped" from "the Confluence update failed". This store keeps
// the last outcome per report on disk (alongside the other NodeToolbox state in AppData) and
// exposes it for the Admin Hub to display.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Constants ──

/** Valid delivery outcome states. */
const DELIVERY_STATUS_DELIVERED = 'delivered';
const DELIVERY_STATUS_SKIPPED   = 'skipped';
const DELIVERY_STATUS_ERROR     = 'error';

/**
 * Persistent status file location — kept beside toolbox-proxy.json in AppData so it
 * survives restarts and upgrades. Overridable via TBX_DELIVERY_STATUS_PATH for tests.
 */
const DEFAULT_STATUS_DIR  = path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox');
const DEFAULT_STATUS_FILE = path.join(DEFAULT_STATUS_DIR, 'report-delivery-status.json');

// ── Path resolution ──

/**
 * Returns the absolute path of the status file, honouring the test override.
 * @returns {string}
 */
function getStatusFilePath() {
  return process.env.TBX_DELIVERY_STATUS_PATH || DEFAULT_STATUS_FILE;
}

// ── File I/O ──

/**
 * Reads and parses the whole status file. Never throws — any read/parse failure yields an
 * empty object so a damaged file cannot break a delivery or the status endpoint.
 * @returns {object}
 */
function readStatusObject() {
  const statusFilePath = getStatusFilePath();
  if (!fs.existsSync(statusFilePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_readError) {
    return {};
  }
}

/**
 * Writes the full status object to disk, creating the directory if needed.
 * Failures are logged but non-fatal — recording a status must never break a delivery.
 * @param {object} statusObject
 */
function writeStatusObject(statusObject) {
  const statusFilePath = getStatusFilePath();
  try {
    fs.mkdirSync(path.dirname(statusFilePath), { recursive: true });
    fs.writeFileSync(statusFilePath, JSON.stringify(statusObject, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist report delivery status: ' + writeError.message);
  }
}

// ── Public API ──

/**
 * Records the outcome of one report delivery, stamped with the current time. The latest
 * outcome replaces any previous one for that report so the Admin Hub always shows "last run".
 *
 * @param {string} schedulerName - 'scopeChange' or 'featureChange'.
 * @param {string} reportKey     - Stable per-report key (matches the scheduler's fired-state key).
 * @param {{ status: string, message?: string, postUrl?: string, label?: string, trigger?: string }} outcome
 */
function recordDeliveryStatus(schedulerName, reportKey, outcome) {
  const statusObject = readStatusObject();
  if (!statusObject[schedulerName] || typeof statusObject[schedulerName] !== 'object') {
    statusObject[schedulerName] = {};
  }
  statusObject[schedulerName][reportKey] = {
    status:  outcome.status,
    message: outcome.message || '',
    postUrl: outcome.postUrl || '',
    label:   outcome.label   || reportKey,
    trigger: outcome.trigger || 'scheduled',
    ranAt:   new Date().toISOString(),
  };
  writeStatusObject(statusObject);
}

/**
 * Wraps a delivery call so its outcome is recorded whether it resolves (delivered/skipped)
 * or rejects (error). Re-throws on failure so existing error handling/logging is unchanged.
 *
 * @param {string} schedulerName
 * @param {string} reportKey
 * @param {string} label   - Human-readable report label for display.
 * @param {string} trigger - 'scheduled' or 'manual'.
 * @param {() => Promise<{ skipped?: boolean, message?: string, postUrl?: string }>} deliveryThunk
 * @returns {Promise<object>} The delivery result.
 */
async function recordDeliveryOutcome(schedulerName, reportKey, label, trigger, deliveryThunk) {
  try {
    const result = await deliveryThunk();
    recordDeliveryStatus(schedulerName, reportKey, {
      status:  (result && result.skipped) ? DELIVERY_STATUS_SKIPPED : DELIVERY_STATUS_DELIVERED,
      message: result && result.message,
      postUrl: result && result.postUrl,
      label,
      trigger,
    });
    return result;
  } catch (deliveryError) {
    const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
    recordDeliveryStatus(schedulerName, reportKey, { status: DELIVERY_STATUS_ERROR, message: errorMessage, label, trigger });
    throw deliveryError;
  }
}

/**
 * Returns the full persisted status object: { schedulerName: { reportKey: outcome } }.
 * Used by the Admin Hub status endpoint.
 * @returns {object}
 */
function loadDeliveryStatuses() {
  return readStatusObject();
}

module.exports = {
  recordDeliveryStatus,
  recordDeliveryOutcome,
  loadDeliveryStatuses,
  getStatusFilePath,
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_SKIPPED,
  DELIVERY_STATUS_ERROR,
};
