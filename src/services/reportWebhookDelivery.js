// src/services/reportWebhookDelivery.js — Server-mediated delivery of a report to
// a team's Atlassian Automation webhook.
//
// Orchestrates the full secure pipeline: resolve the team's stored destination,
// enforce the Atlassian host allow-list, redact credential-looking values, wrap
// the content in the documented `payloadContext` envelope, and reuse the existing
// triggerWebhook helper to POST it. Every outcome is returned as a structured
// result — the caller never has to catch, and a failure never throws past here.

'use strict';

const { getSurface } = require('./reportSurfaceRegistry');
const { evaluateHost } = require('../utils/webhookHostPolicy');
const { redactDeep } = require('../utils/secretRedactor');
const { triggerWebhook } = require('../utils/httpClient');

// Returns true when a report has no deliverable content.
function isEmptyReport(report) {
  if (report == null) return true;
  if (typeof report === 'string') return report.trim() === '';
  if (Array.isArray(report)) return report.length === 0;
  if (typeof report === 'object') return Object.keys(report).length === 0;
  return false;
}

/**
 * Delivers a report to its team's Automation webhook.
 *
 * @param {object} configuration - Live server config (holds scheduler sections + sslVerify).
 * @param {{ surface: string, teamId: string, report: * }} request
 * @param {{ triggerWebhook?: Function, now?: () => string, version?: string }} [deps] - Test seams.
 * @returns {Promise<object>} Structured result: { ok, httpStatus, webhookStatus?, code, redactionApplied, redactionCount, message }
 */
async function deliverReport(configuration, request, deps = {}) {
  const { surface, teamId, report } = request || {};
  const sendWebhook = deps.triggerWebhook || triggerWebhook;
  const nowIso = (deps.now || (() => new Date().toISOString()))();
  const nodeToolboxVersion = deps.version || (configuration && configuration.version) || '';

  const surfaceDef = getSurface(surface);
  if (!surfaceDef) {
    return { ok: false, code: 'unknown-surface', httpStatus: 400, message: `Unknown surface '${surface}'.` };
  }
  if (isEmptyReport(report)) {
    return { ok: false, code: 'empty-report', httpStatus: 400, message: 'Report content is empty; nothing to send.' };
  }

  const destination = surfaceDef.resolveDestination(configuration, teamId);
  if (!destination) {
    return { ok: false, code: 'no-destination', httpStatus: 409, message: 'No Automation webhook configured for this team.' };
  }

  // Security boundary — refuse non-Atlassian hosts BEFORE any bytes are sent.
  const hostCheck = evaluateHost(destination.triggerUrl);
  if (!hostCheck.allowed) {
    return { ok: false, code: 'host-not-allowed', httpStatus: 422, message: hostCheck.reason };
  }

  // Redact credential-looking values, then wrap in the documented envelope.
  const redacted = redactDeep(report);
  const redactionApplied = redacted.redactionCount > 0;
  const payload = {
    payloadContext: {
      source: surfaceDef.id,
      team: { name: destination.teamName || '', projectKey: destination.projectKey || '' },
      generatedAt: nowIso,
      report: redacted.value,
      meta: { redactionApplied, nodeToolboxVersion },
    },
  };

  const shouldVerifyTls = !configuration || configuration.sslVerify !== false;

  try {
    const result = await sendWebhook(
      destination.triggerUrl,
      payload,
      shouldVerifyTls,
      destination.triggerSecret || undefined,
    );
    const webhookStatus = result && result.status;
    const isSuccess = webhookStatus >= 200 && webhookStatus < 300;

    if (isSuccess) {
      return {
        ok: true,
        code: 'delivered',
        httpStatus: 200,
        webhookStatus,
        redactionApplied,
        redactionCount: redacted.redactionCount,
        message: redactionApplied
          ? `Delivered. ${redacted.redactionCount} value(s) redacted before sending.`
          : `Delivered to Automation webhook (HTTP ${webhookStatus}).`,
      };
    }

    // Reached the webhook but it rejected the request — report as an upstream failure.
    return {
      ok: false,
      code: 'webhook-rejected',
      httpStatus: 502,
      webhookStatus,
      redactionApplied,
      redactionCount: redacted.redactionCount,
      message: `Webhook rejected the request (HTTP ${webhookStatus}).`,
    };
  } catch (deliveryError) {
    const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
    return { ok: false, code: 'delivery-failed', httpStatus: 502, message: `Webhook delivery failed: ${errorMessage}` };
  }
}

module.exports = { deliverReport };
