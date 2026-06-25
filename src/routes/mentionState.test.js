// mentionState.test.js — Route tests for the addressed-mentions API.
// The underlying store is mocked so these tests verify HTTP behaviour only.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/mentionStateStore', () => ({
  getAddressedMentions: jest.fn(),
  setMentionAddressed: jest.fn(),
}));

const { getAddressedMentions, setMentionAddressed } = require('../services/mentionStateStore');
const createMentionStateRouter = require('./mentionState');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createMentionStateRouter());
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/mention-state', () => {
  it('returns 400 when the user query param is missing', async () => {
    const response = await request(buildApp()).get('/api/mention-state');
    expect(response.status).toBe(400);
    expect(getAddressedMentions).not.toHaveBeenCalled();
  });

  it('returns the addressed map for the requested user', async () => {
    getAddressedMentions.mockReturnValue({ 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } });

    const response = await request(buildApp()).get('/api/mention-state?user=jsmith');

    expect(response.status).toBe(200);
    expect(getAddressedMentions).toHaveBeenCalledWith('jsmith');
    expect(response.body.addressed).toHaveProperty('TBX-1#101');
  });
});

describe('POST /api/mention-state', () => {
  it('returns 400 when required fields are missing', async () => {
    const response = await request(buildApp()).post('/api/mention-state').send({ userKey: 'jsmith' });
    expect(response.status).toBe(400);
    expect(setMentionAddressed).not.toHaveBeenCalled();
  });

  it('marks a mention addressed and returns the updated map', async () => {
    setMentionAddressed.mockReturnValue({ 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } });

    const response = await request(buildApp()).post('/api/mention-state').send({
      userKey: 'jsmith',
      mentionKey: 'TBX-1#101',
      issueKey: 'TBX-1',
      isAddressed: true,
    });

    expect(response.status).toBe(200);
    expect(setMentionAddressed).toHaveBeenCalledWith({
      userKey: 'jsmith',
      mentionKey: 'TBX-1#101',
      issueKey: 'TBX-1',
      isAddressed: true,
    });
    expect(response.body.addressed).toHaveProperty('TBX-1#101');
  });

  it('passes isAddressed=false through for undo', async () => {
    setMentionAddressed.mockReturnValue({});

    const response = await request(buildApp()).post('/api/mention-state').send({
      userKey: 'jsmith',
      mentionKey: 'TBX-1#101',
      issueKey: 'TBX-1',
      isAddressed: false,
    });

    expect(response.status).toBe(200);
    expect(setMentionAddressed).toHaveBeenCalledWith(expect.objectContaining({ isAddressed: false }));
  });
});
