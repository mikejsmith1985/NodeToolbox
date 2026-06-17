// src/routes/sprintRelease.test.js — Route tests for the Sprint–Release Workflow API.
//
// Covers the workflow-topology endpoint: project reachability, sub-status field option
// discovery, dev-project transition enumeration, and config validation results.
// All Jira API calls are mocked — these tests verify HTTP status codes, response
// shapes, and that the validation flags correctly reflect what Jira returns.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../utils/httpClient', () => ({ makeJiraApiRequest: jest.fn() }));
jest.mock('../services/sprintReleaseOrchestrator', () => ({
  findSprintByName:       jest.fn(),
  findDorViolations:      jest.fn().mockReturnValue([]),
  postDorViolationComment: jest.fn(),
}));
jest.mock('../services/sprintReleaseScheduler', () => ({
  triggerPollCycleNow:     jest.fn(),
  getSprintReleaseStatus:  jest.fn().mockReturnValue({ recentHandoffs: [], sprintSyncWarnings: [] }),
}));

const { makeJiraApiRequest } = require('../utils/httpClient');
const createSprintReleaseRouter = require('./sprintRelease');

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal team profile that satisfies all four required project key fields. */
const CONFIGURED_PROFILE = {
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
  handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
  pollIntervalMinutes:      5,
};

/** Jira /project/{key}/statuses body — one issue type with three statuses. */
const PROJECT_STATUSES_BODY = [
  {
    name:     'Story',
    subtask:  false,
    statuses: [{ name: 'To Do' }, { name: 'In Progress' }, { name: 'Done' }],
  },
];

/** Jira /issue/createmeta body for the dev project with sub-status field options. */
function buildCreatmetaBody(projectKey, subStatusFieldId, allowedValues) {
  return {
    projects: [{
      key: projectKey,
      issuetypes: [{
        name:   'Story',
        fields: {
          [subStatusFieldId]: {
            name:          'Sub-Status',
            allowedValues,
          },
        },
      }],
    }],
  };
}

/** Jira /issue/{key}/transitions body with two transitions. */
const TRANSITIONS_BODY = {
  transitions: [
    { id: '11', name: 'In Progress', to: { name: 'In Progress' } },
    { id: '31', name: 'Done',        to: { name: 'Done' } },
  ],
};

/**
 * Configures makeJiraApiRequest to return realistic responses for every
 * path the workflow-topology endpoint calls. Override specific paths by
 * providing a partialOverrides map of { pathFragment: mockedResponse }.
 */
function mockTopologyApis(partialOverrides = {}) {
  makeJiraApiRequest.mockImplementation(async (_method, apiPath) => {
    // Check caller-supplied overrides first (allows per-test customisation).
    for (const [pathFragment, overrideResponse] of Object.entries(partialOverrides)) {
      if (apiPath.includes(pathFragment)) return overrideResponse;
    }
    if (apiPath.includes('/statuses'))    return { status: 200, body: PROJECT_STATUSES_BODY };
    if (apiPath.includes('/createmeta'))  return {
      status: 200,
      body: buildCreatmetaBody('ENFCT', 'customfield_10201', [
        { value: 'In Development' },
        { value: 'Ready for System Integration Test' },
        { value: 'Ready for UAT' },
      ]),
    };
    if (apiPath.includes('/search'))      return { status: 200, body: { issues: [{ key: 'ENFCT-1', fields: { summary: 'Test Story' } }] } };
    if (apiPath.includes('/transitions')) return { status: 200, body: TRANSITIONS_BODY };
    return { status: 404, body: {} };
  });
}

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(configuration = {}) {
  const app = express();
  app.use(express.json());
  app.use(createSprintReleaseRouter(configuration));
  return app;
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/sprint-release/workflow-topology ─────────────────────────────────

describe('GET /api/sprint-release/workflow-topology', () => {

  it('returns 400 when no team profile is configured', async () => {
    const response = await request(buildApp({})).get('/api/sprint-release/workflow-topology');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not configured/i);
  });

  it('returns 400 when project keys are missing from the profile', async () => {
    const incompleteProfile = { ...CONFIGURED_PROFILE, devProjectKey: '' };
    const configuration = { sprintRelease: { teamProfiles: [incompleteProfile] } };

    const response = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/project keys/i);
  });

  it('returns 200 with all four project topology blocks when Jira responds', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const response = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(response.status).toBe(200);

    const { projects } = response.body;
    expect(projects).toHaveProperty('DENP');
    expect(projects).toHaveProperty('ENFCT');
    expect(projects).toHaveProperty('INTTEST');
    expect(projects).toHaveProperty('UEFT');
  });

  it('marks project roles correctly (feature / dev / qe / bt)', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.projects.DENP.role).toBe('feature');
    expect(body.projects.ENFCT.role).toBe('dev');
    expect(body.projects.INTTEST.role).toBe('qe');
    expect(body.projects.UEFT.role).toBe('bt');
  });

  it('populates issueTypes and allStatuses for reachable projects', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    const devProject = body.projects.ENFCT;

    expect(devProject.isReachable).toBe(true);
    expect(devProject.issueTypes).toEqual([{ name: 'Story', isSubtask: false }]);
    expect(devProject.allStatuses).toContain('Done');
    expect(devProject.allStatuses).toContain('In Progress');
  });

  it('marks a project isReachable=false when Jira returns non-200 for /statuses', async () => {
    mockTopologyApis({ 'INTTEST/statuses': { status: 403, body: {} } });
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.projects.INTTEST.isReachable).toBe(false);
  });

  it('returns subStatusFieldOptions from Jira createmeta', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.subStatusFieldOptions).toContain('Ready for System Integration Test');
    expect(body.subStatusFieldOptions).toContain('Ready for UAT');
    expect(body.subStatusFieldOptions).toContain('In Development');
  });

  it('returns devTransitions from the sample issue', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    const transitionNames = body.devTransitions.map((trans) => trans.transitionName);
    expect(transitionNames).toContain('Done');
    expect(transitionNames).toContain('In Progress');
  });

  it('sets validation.qeHandoffSubStatusValue.isFound=true when the value is in the options list', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.validation.qeHandoffSubStatusValue.isFound).toBe(true);
    expect(body.validation.qeHandoffSubStatusValue.configuredValue).toBe('Ready for System Integration Test');
  });

  it('sets validation.qeHandoffSubStatusValue.isFound=false when the value is absent from the options list', async () => {
    const profileWithBadQeTrigger = { ...CONFIGURED_PROFILE, qeHandoffSubStatusValue: 'Nonexistent QE Value' };
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [profileWithBadQeTrigger] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.validation.qeHandoffSubStatusValue.isFound).toBe(false);
  });

  it('sets validation.btHandoffSubStatusValue.isFound=true when the value is in the options list', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.validation.btHandoffSubStatusValue.isFound).toBe(true);
  });

  it('sets validation.doneTransitionName.isFound=true when the transition exists in the dev project', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.validation.doneTransitionName.isFound).toBe(true);
    expect(body.validation.doneTransitionName.configuredValue).toBe('Done');
  });

  it('sets validation.doneTransitionName.isFound=false when the transition name is not in Jira', async () => {
    const profileWithBadTransition = { ...CONFIGURED_PROFILE, doneTransitionName: 'Finish' };
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [profileWithBadTransition] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(body.validation.doneTransitionName.isFound).toBe(false);
  });

  it('returns empty subStatusFieldOptions gracefully when createmeta returns no matching field', async () => {
    mockTopologyApis({ '/createmeta': { status: 200, body: { projects: [] } } });
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(Array.isArray(body.subStatusFieldOptions)).toBe(true);
    expect(body.subStatusFieldOptions.length).toBe(0);
  });

  it('returns empty devTransitions gracefully when the dev project has no issues', async () => {
    mockTopologyApis({ '/search': { status: 200, body: { issues: [] } } });
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(Array.isArray(body.devTransitions)).toBe(true);
    expect(body.devTransitions.length).toBe(0);
  });

  it('includes a fetchedAt ISO timestamp in the response', async () => {
    mockTopologyApis();
    const configuration = { sprintRelease: { teamProfiles: [CONFIGURED_PROFILE] } };

    const { body } = await request(buildApp(configuration)).get('/api/sprint-release/workflow-topology');
    expect(typeof body.fetchedAt).toBe('string');
    expect(() => new Date(body.fetchedAt)).not.toThrow();
  });
});

// ── GET /api/sprint-release/config ───────────────────────────────────────────

describe('GET /api/sprint-release/config', () => {
  it('returns 200 with default profile shape when no config is set', async () => {
    const response = await request(buildApp({})).get('/api/sprint-release/config');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('teamProfileId');
    expect(response.body).toHaveProperty('subStatusFieldId');
  });

  it('strips the handoffDelivery.webhookSecret from the response', async () => {
    const configuration = {
      sprintRelease: {
        teamProfiles: [{ ...CONFIGURED_PROFILE, handoffDelivery: { webhookUrl: '', webhookSecret: 'real-secret' } }],
      },
    };
    const response = await request(buildApp(configuration)).get('/api/sprint-release/config');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('real-secret');
    expect(response.body.handoffDelivery.webhookSecret).toBe('***');
  });
});

// ── POST /api/sprint-release/run-now ─────────────────────────────────────────

describe('POST /api/sprint-release/run-now', () => {
  it('returns 200 with triggered=true and fires the poll cycle', async () => {
    const { triggerPollCycleNow } = require('../services/sprintReleaseScheduler');
    triggerPollCycleNow.mockResolvedValue();

    const response = await request(buildApp({})).post('/api/sprint-release/run-now');
    expect(response.status).toBe(200);
    expect(response.body.triggered).toBe(true);
  });
});
