// src/routes/reportDelivery.js — Internal endpoint for server-mediated delivery of
// a report to a team's Atlassian Automation webhook.
//
// The browser posts the already-generated report content plus the target surface
// and team id; the server resolves the team's stored webhook (url + secret),
// validates the host, redacts secrets, and delivers. The secret never reaches the
// client and never appears in a log line — only the surface, team, and HTTP status
// are logged.

'use strict';

const express = require('express');
const { deliverReport } = require('../services/reportWebhookDelivery');

/**
 * Creates and returns the report-delivery router.
 *
 * @param {object} configuration - Live server config reference.
 * @returns {import('express').Router}
 */
function createReportDeliveryRouter(configuration) {
  const router = express.Router();

  /**
   * POST /api/reports/deliver
   * Body: { surface: string, teamId: string, report: object | string }
   */
  router.post('/api/reports/deliver', async (req, res) => {
    const { surface, teamId, report } = req.body || {};

    const result = await deliverReport(configuration, { surface, teamId, report });

    // Log the outcome with status only — never the secret or the payload body.
    const loggedStatus = result.webhookStatus || result.httpStatus;
    console.log(`  [ReportDeliver] surface=${surface || '?'} team=${teamId || '?'} → ${result.code} (HTTP ${loggedStatus})`);

    return res.status(result.httpStatus).json({
      ok: result.ok,
      status: result.webhookStatus,
      redactionApplied: result.redactionApplied || false,
      redactionCount: result.redactionCount || 0,
      message: result.message,
    });
  });

  return router;
}

module.exports = createReportDeliveryRouter;
