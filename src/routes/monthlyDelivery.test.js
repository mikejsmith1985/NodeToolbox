// src/routes/monthlyDelivery.test.js — Admin Hub endpoints for the Monthly Delivery Report
// scheduler (feature 018). Config save and the run/report services are mocked, so this runs in Jest
// without disk I/O or Jira.

'use strict';

jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { saveConfigToDisk } = require('../config/loader');
const createMonthlyDeliveryRouter = require('./monthlyDelivery');

function makeApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createMonthlyDeliveryRouter(configuration));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/monthly-delivery/config', () => {
  it('returns the configured block', async () => {
    const configuration = {
      scheduler: {
        monthlyDelivery: {
          isEnabled: true,
          scheduleTime: '09:15',
          featureLinkFieldId: 'customfield_10999',
          teams: [{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }],
        },
      },
    };
    const response = await request(makeApp(configuration)).get('/api/monthly-delivery/config');
    expect(response.status).toBe(200);
    expect(response.body.isEnabled).toBe(true);
    expect(response.body.scheduleTime).toBe('09:15');
    expect(response.body.featureLinkFieldId).toBe('customfield_10999');
    expect(response.body.teams).toHaveLength(1);
  });

  it('returns safe defaults when nothing is configured', async () => {
    const response = await request(makeApp({})).get('/api/monthly-delivery/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isEnabled: false,
      scheduleTime: '08:00',
      featureLinkFieldId: 'customfield_10108',
      teams: [],
    });
  });
});

describe('POST /api/monthly-delivery/config', () => {
  it('sanitises, persists in place, and drops unexpected fields', async () => {
    const configuration = {};
    const response = await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({
        isEnabled: true,
        scheduleTime: '07:45',
        featureLinkFieldId: '  customfield_10108  ',
        teams: [
          { teamName: '  Transformers  ', projectKey: ' TRFM ', boardId: '42', apiToken: 'DROP ME' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.teams).toBe(1);
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
    const savedBlock = configuration.scheduler.monthlyDelivery;
    expect(savedBlock.teams[0]).toEqual({ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' });
    expect(savedBlock.scheduleTime).toBe('07:45');
  });

  it('falls back to 08:00 for an invalid schedule time and drops teams without a project key', async () => {
    const configuration = {};
    await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({
        scheduleTime: '99:99',
        teams: [
          { teamName: 'No Project', projectKey: '   ', boardId: '1' },
          { teamName: 'Keeper', projectKey: 'KEEP', boardId: '2' },
        ],
      });

    const savedBlock = configuration.scheduler.monthlyDelivery;
    expect(savedBlock.scheduleTime).toBe('08:00');
    expect(savedBlock.teams).toHaveLength(1);
    expect(savedBlock.teams[0].teamName).toBe('Keeper');
  });

  it('defaults an empty featureLinkFieldId to customfield_10108', async () => {
    const configuration = {};
    await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({ featureLinkFieldId: '  ', teams: [] });
    expect(configuration.scheduler.monthlyDelivery.featureLinkFieldId).toBe('customfield_10108');
  });
});
