// test/unit/sprintReleaseConfig.test.js — Unit tests for the Sprint–Release config CRUD endpoints.
//
// Tests the GET and POST /api/sprint-release/config handlers in isolation.
// All outbound Jira calls (project key validation, boardId validation) are mocked.

'use strict';

jest.mock('../../src/utils/httpClient', () => ({
  makeJiraApiRequest: jest.fn(),
  triggerWebhook:     jest.fn(),
}));

jest.mock('../../src/config/loader', () => ({
  saveConfigToDisk: jest.fn(),
}));

jest.mock('../../src/services/sprintReleaseOrchestrator', () => ({
  findSprintByName:       jest.fn(),
  findDorViolations:      jest.fn().mockReturnValue([]),
  postDorViolationComment: jest.fn(),
}));

jest.mock('../../src/services/sprintReleaseScheduler', () => ({
  triggerPollCycleNow:    jest.fn().mockResolvedValue(undefined),
  getSprintReleaseStatus: jest.fn().mockReturnValue({}),
}));

const express = require('express');
const request = require('supertest');
const { makeJiraApiRequest } = require('../../src/utils/httpClient');
const { saveConfigToDisk } = require('../../src/config/loader');
const createSprintReleaseRouter = require('../../src/routes/sprintRelease');

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildTestConfiguration(sprintReleaseOverrides) {
  return {
    jira:       { baseUrl: 'https://jira.example.com', pat: 'test-pat' },
    sslVerify:  true,
    sprintRelease: {
      teamProfiles: [
        {
          teamProfileId:            'default',
          isEnabled:                true,
          featureProjectKey:        'DENP',
          devProjectKey:            'ENFCT',
          qeProjectKey:             'INTTEST',
          btProjectKey:             'UEFT',
          boardId:                  42,
          subStatusFieldId:         'customfield_10201',
          qeHandoffSubStatusValue:  'Ready for System Integration Test',
          btHandoffSubStatusValue:  'Ready for UAT',
          configOnlyLabel:          'no-testing-required',
          defectIntakeLabel:        'defect-intake',
          freezeWindowBusinessDays: 13,
          doneTransitionName:       'Done',
          dorQeFieldId:             '',
          dorBtFieldId:             '',
          handoffDelivery:          { webhookUrl: '', webhookSecret: 'secret-value' },
          pollIntervalMinutes:      5,
          ...(sprintReleaseOverrides || {}),
        },
      ],
    },
  };
}

function buildTestApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createSprintReleaseRouter(configuration));
  return app;
}

// ── GET /api/sprint-release/config ────────────────────────────────────────────

describe('GET /api/sprint-release/config', () => {
  it('returns the first team profile with webhook secret masked', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    const response = await request(testApp).get('/api/sprint-release/config');

    expect(response.status).toBe(200);
    expect(response.body.teamProfileId).toBe('default');
    expect(response.body.devProjectKey).toBe('ENFCT');
    expect(response.body.boardId).toBe(42);
    // Secret must never appear in GET responses.
    expect(response.body.handoffDelivery.webhookSecret).toBe('***');
  });

  it('returns the default profile shape when no config has been saved', async () => {
    const configuration = { jira: {}, sslVerify: true, sprintRelease: { teamProfiles: [] } };
    const testApp = buildTestApp(configuration);

    const response = await request(testApp).get('/api/sprint-release/config');

    expect(response.status).toBe(200);
    expect(response.body.teamProfileId).toBe('default');
    expect(response.body.isEnabled).toBe(true);
    expect(response.body.pollIntervalMinutes).toBe(5);
  });
});

// ── POST /api/sprint-release/config — valid save ──────────────────────────────

describe('POST /api/sprint-release/config — valid profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock all four project key validations and board validation to succeed.
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: {} });
  });

  it('returns 200 with saved:true and validatedProjects list', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    const response = await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCT',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           42,
      });

    expect(response.status).toBe(200);
    expect(response.body.saved).toBe(true);
    expect(response.body.validatedProjects).toEqual(['DENP', 'ENFCT', 'INTTEST', 'UEFT']);
  });

  it('calls saveConfigToDisk once on successful save', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCT',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           42,
      });

    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
  });

  it('preserves existing webhookSecret when submitted value is the masked placeholder', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCT',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           42,
        handoffDelivery:   { webhookUrl: 'https://example.com/hook', webhookSecret: '***' },
      });

    // The saved profile should retain the original secret value, not '***'.
    const savedConfiguration = configuration;
    expect(savedConfiguration.sprintRelease.teamProfiles[0].handoffDelivery.webhookSecret)
      .toBe('secret-value');
  });
});

// ── POST /api/sprint-release/config — invalid project key ─────────────────────

describe('POST /api/sprint-release/config — invalid project key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when featureProjectKey is missing', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    const response = await request(testApp)
      .post('/api/sprint-release/config')
      .send({ devProjectKey: 'ENFCT', qeProjectKey: 'INTTEST', btProjectKey: 'UEFT', boardId: 42 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('featureProjectKey');
  });

  it('returns 400 when a project key is not found in Jira', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    // First call returns 200 (DENP found), second returns 404 (ENFCTX not found).
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: {} })
      .mockResolvedValueOnce({ status: 404, body: {} });

    const response = await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCTX',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           42,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('ENFCTX');
    expect(saveConfigToDisk).not.toHaveBeenCalled();
  });
});

// ── POST /api/sprint-release/config — invalid boardId ─────────────────────────

describe('POST /api/sprint-release/config — invalid boardId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when boardId is zero', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    const response = await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCT',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           0,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('boardId');
  });

  it('returns 400 when boardId is not found in Jira Agile API', async () => {
    const configuration = buildTestConfiguration();
    const testApp = buildTestApp(configuration);

    // All four project key calls succeed; board validation call returns 404.
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: {} })  // DENP
      .mockResolvedValueOnce({ status: 200, body: {} })  // ENFCT
      .mockResolvedValueOnce({ status: 200, body: {} })  // INTTEST
      .mockResolvedValueOnce({ status: 200, body: {} })  // UEFT
      .mockResolvedValueOnce({ status: 404, body: {} }); // boardId not found

    const response = await request(testApp)
      .post('/api/sprint-release/config')
      .send({
        featureProjectKey: 'DENP',
        devProjectKey:     'ENFCT',
        qeProjectKey:      'INTTEST',
        btProjectKey:      'UEFT',
        boardId:           999,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('999');
    expect(saveConfigToDisk).not.toHaveBeenCalled();
  });
});
