// Integration-style tests for POST /api/reports/deliver using supertest.

'use strict';

const express = require('express');
const request = require('supertest');
const createReportDeliveryRouter = require('./reportDelivery');

// Mock the delivery service so the route is tested in isolation.
jest.mock('../services/reportWebhookDelivery', () => ({ deliverReport: jest.fn() }));
const { deliverReport } = require('../services/reportWebhookDelivery');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createReportDeliveryRouter({ scheduler: {} }));
  return app;
}

describe('POST /api/reports/deliver', () => {
  beforeEach(() => deliverReport.mockReset());

  test('200 on success and never echoes a secret', async () => {
    deliverReport.mockResolvedValue({ ok: true, code: 'delivered', httpStatus: 200, webhookStatus: 200, redactionApplied: false, redactionCount: 0, message: 'Delivered to Automation webhook (HTTP 200).' });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'standup-briefing', teamId: 'ALPHA', report: 'x' });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|triggerSecret/i);
  });

  test('200 surfaces the redaction flag and count', async () => {
    deliverReport.mockResolvedValue({ ok: true, code: 'delivered', httpStatus: 200, webhookStatus: 200, redactionApplied: true, redactionCount: 2, message: 'Delivered. 2 value(s) redacted before sending.' });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'scope-change', teamId: 'ALPHA', report: {} });
    expect(response.status).toBe(200);
    expect(response.body.redactionApplied).toBe(true);
    expect(response.body.redactionCount).toBe(2);
  });

  test('400 for an unknown surface', async () => {
    deliverReport.mockResolvedValue({ ok: false, code: 'unknown-surface', httpStatus: 400, message: "Unknown surface 'x'." });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'x', teamId: 'ALPHA', report: 'y' });
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
  });

  test('409 when no destination is configured', async () => {
    deliverReport.mockResolvedValue({ ok: false, code: 'no-destination', httpStatus: 409, message: 'No Automation webhook configured for this team.' });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'standup-briefing', teamId: 'Nope', report: 'y' });
    expect(response.status).toBe(409);
  });

  test('422 when the destination host is not allowed', async () => {
    deliverReport.mockResolvedValue({ ok: false, code: 'host-not-allowed', httpStatus: 422, message: 'Destination host is not an allowed Atlassian host; nothing was sent.' });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'standup-briefing', teamId: 'ALPHA', report: 'y' });
    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/not an allowed Atlassian host/);
  });

  test('502 when delivery fails', async () => {
    deliverReport.mockResolvedValue({ ok: false, code: 'webhook-rejected', httpStatus: 502, webhookStatus: 401, message: 'Webhook rejected the request (HTTP 401).' });
    const response = await request(buildApp()).post('/api/reports/deliver').send({ surface: 'standup-briefing', teamId: 'ALPHA', report: 'y' });
    expect(response.status).toBe(502);
    expect(response.body.status).toBe(401);
  });
});
