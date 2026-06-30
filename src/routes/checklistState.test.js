// checklistState.test.js — Route tests for the daily-checklist API.
// The underlying store is mocked so these tests verify HTTP behaviour only.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/dailyChecklistStore', () => ({
  getDailyChecklist: jest.fn(),
  setCategoryComplete: jest.fn(),
}));

const { getDailyChecklist, setCategoryComplete } = require('../services/dailyChecklistStore');
const createChecklistStateRouter = require('./checklistState');

const TODAY_KEY = '2026-06-30';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createChecklistStateRouter());
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/sm-checklist-state', () => {
  it('returns 400 when the user query param is missing', async () => {
    const response = await request(buildApp()).get(`/api/sm-checklist-state?day=${TODAY_KEY}`);
    expect(response.status).toBe(400);
    expect(getDailyChecklist).not.toHaveBeenCalled();
  });

  it('returns 400 when the day query param is missing', async () => {
    const response = await request(buildApp()).get('/api/sm-checklist-state?user=jsmith');
    expect(response.status).toBe(400);
    expect(getDailyChecklist).not.toHaveBeenCalled();
  });

  it('returns the completed map for the requested user and day', async () => {
    getDailyChecklist.mockReturnValue({ standup: { completedAt: 'x' } });

    const response = await request(buildApp()).get(`/api/sm-checklist-state?user=jsmith&day=${TODAY_KEY}`);

    expect(response.status).toBe(200);
    expect(getDailyChecklist).toHaveBeenCalledWith('jsmith', TODAY_KEY);
    expect(response.body.completed).toHaveProperty('standup');
  });
});

describe('POST /api/sm-checklist-state', () => {
  it('returns 400 when required fields are missing', async () => {
    const response = await request(buildApp()).post('/api/sm-checklist-state').send({ userKey: 'jsmith' });
    expect(response.status).toBe(400);
    expect(setCategoryComplete).not.toHaveBeenCalled();
  });

  it('returns 400 when isComplete is not a boolean', async () => {
    const response = await request(buildApp()).post('/api/sm-checklist-state').send({
      userKey: 'jsmith',
      day: TODAY_KEY,
      categoryId: 'standup',
      isComplete: 'yes',
    });
    expect(response.status).toBe(400);
    expect(setCategoryComplete).not.toHaveBeenCalled();
  });

  it('marks a category complete and returns the updated map', async () => {
    setCategoryComplete.mockReturnValue({ standup: { completedAt: 'x' } });

    const response = await request(buildApp()).post('/api/sm-checklist-state').send({
      userKey: 'jsmith',
      day: TODAY_KEY,
      categoryId: 'standup',
      isComplete: true,
    });

    expect(response.status).toBe(200);
    expect(setCategoryComplete).toHaveBeenCalledWith({
      userKey: 'jsmith',
      dayKey: TODAY_KEY,
      categoryId: 'standup',
      isComplete: true,
    });
    expect(response.body.completed).toHaveProperty('standup');
  });

  it('passes isComplete=false through to clear a category', async () => {
    setCategoryComplete.mockReturnValue({});

    const response = await request(buildApp()).post('/api/sm-checklist-state').send({
      userKey: 'jsmith',
      day: TODAY_KEY,
      categoryId: 'standup',
      isComplete: false,
    });

    expect(response.status).toBe(200);
    expect(setCategoryComplete).toHaveBeenCalledWith(expect.objectContaining({ isComplete: false }));
    expect(response.body.completed).toEqual({});
  });
});
