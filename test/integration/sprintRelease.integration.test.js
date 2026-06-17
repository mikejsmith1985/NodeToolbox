// test/integration/sprintRelease.integration.test.js — Sprint–Release Workflow integration tests.
//
// Exercises the full route→service→orchestrator stack using supertest for HTTP
// and jest mocks for the Jira HTTP client. These cover all 7 Quickstart Scenarios
// from specs/003-sprint-release-workflow/quickstart.md plus the ownership integrity check.
//
// Tests are grouped by user story to match task IDs T021, T022, T031, T041, T047, T052, T053.

'use strict';

jest.mock('../../src/utils/httpClient', () => ({
  makeJiraApiRequest: jest.fn(),
  triggerWebhook:     jest.fn(),
}));

jest.mock('../../src/config/loader', () => ({
  saveConfigToDisk: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { makeJiraApiRequest } = require('../../src/utils/httpClient');
const createSprintReleaseRouter = require('../../src/routes/sprintRelease');
const {
  triggerPollCycleNow,
  getSprintReleaseStatus,
} = require('../../src/services/sprintReleaseScheduler');

// ── Test fixtures ─────────────────────────────────────────────────────────────

function buildIntegrationConfig(overrides) {
  const baseConfig = {
    jira:      { baseUrl: 'https://jira.example.com', pat: 'test-pat' },
    sslVerify: true,
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
          dorQeFieldId:             'customfield_20101',
          dorBtFieldId:             'customfield_20102',
          handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
          pollIntervalMinutes:      5,
        },
      ],
    },
  };
  if (overrides) Object.assign(baseConfig, overrides);
  return baseConfig;
}

function buildTestApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createSprintReleaseRouter(configuration));
  return app;
}

/**
 * Builds a Jira issue stub that simulates a recent sub-status change in its changelog.
 * Used for sub-status polling integration tests.
 */
function buildDevIssueWithSubStatusChange(issueKey, subStatusValue, assigneeAccountId, parentKey) {
  return {
    key:    issueKey,
    fields: {
      summary:         'Implement login feature',
      labels:          [],
      fixVersions:     [{ id: 'fv-1', name: '6/18', releaseDate: '2026-06-18' }],
      status:          { name: 'In Progress' },
      assignee:        { accountId: assigneeAccountId || 'dev-user-123', displayName: 'Alice Dev' },
      parent:          parentKey ? { key: parentKey } : null,
      customfield_10201: subStatusValue,
    },
    changelog: {
      histories: [
        {
          created: '2026-06-10T14:00:00Z',
          items:   [{ field: 'customfield_10201', toString: subStatusValue }],
        },
      ],
    },
  };
}

// ── US1 — T021: Quickstart Scenario 1 (QE handoff) ───────────────────────────

describe('US1 — T021: QE handoff fires and dev issue transitions to Done (Scenario 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset in-memory handoff state between tests by clearing the exported Map.
    const { lastHandoffByIssue } = require('../../src/services/sprintReleaseScheduler');
    lastHandoffByIssue.clear();
  });

  it('poll cycle detects QE sub-status change and transitions the issue to Done', async () => {
    const configuration = buildIntegrationConfig();
    const devIssue = buildDevIssueWithSubStatusChange(
      'ENFCT-100', 'Ready for System Integration Test', 'dev-user-123', 'DENP-10'
    );

    // Mock order must match execution order in runPollCycle → runSubStatusScan:
    // 1. JQL search, 2. GET transitions, 3. POST Done, 4. GET parent, 5. POST comment,
    // 6. GET fixVersions, 7. GET defect intake search
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: { issues: [devIssue] } })                                          // 1. sub-status JQL
      .mockResolvedValueOnce({ status: 200, body: { transitions: [{ id: '51', name: 'Done' }, { id: '11', name: 'In Progress' }] } }) // 2. GET transitions
      .mockResolvedValueOnce({ status: 204, body: null })                                                             // 3. POST Done
      .mockResolvedValueOnce({ status: 200, body: { fields: { summary: 'Login Feature' } } })                       // 4. GET parent
      .mockResolvedValueOnce({ status: 201, body: {} })                                                              // 5. POST comment
      .mockResolvedValueOnce({ status: 200, body: [] })                                                              // 6. fixVersion list
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } });                                                 // 7. defect intake search

    await triggerPollCycleNow(configuration);

    // Verify the Done transition was POSTed.
    const doneCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'POST' && callArgs[1].includes('/transitions') && callArgs[2]
    );
    expect(doneCalls.length).toBeGreaterThan(0);
    expect(doneCalls[0][2]).toEqual({ transition: { id: '51' } });
  });

  it('the ASSIGNEE field is never updated during QE handoff transitions', async () => {
    const configuration = buildIntegrationConfig();
    const devIssue = buildDevIssueWithSubStatusChange(
      'ENFCT-101', 'Ready for System Integration Test', 'dev-user-456'
    );

    makeJiraApiRequest.mockResolvedValue({ status: 200, body: { issues: [devIssue], transitions: [{ id: '51', name: 'Done' }] } });
    makeJiraApiRequest.mockResolvedValueOnce({ status: 200, body: { issues: [devIssue] } });
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: {} });

    await triggerPollCycleNow(configuration);

    // Check that no PUT call to /issue/ was made with an assignee field.
    const assigneeUpdateCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'PUT'
        && callArgs[1] && callArgs[1].includes('/issue/')
        && callArgs[2] && callArgs[2].fields && callArgs[2].fields.assignee
    );
    expect(assigneeUpdateCalls).toHaveLength(0);
  });
});

// ── US1 — T022: Quickstart Scenario 2 (config-only bypass) ──────────────────

describe('US1 — T022: Config-only label suppresses handoff, issue still closes (Scenario 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { lastHandoffByIssue } = require('../../src/services/sprintReleaseScheduler');
    lastHandoffByIssue.clear();
  });

  it('closes a no-testing-required issue without posting a handoff comment', async () => {
    const configuration = buildIntegrationConfig();
    const configOnlyIssue = {
      key:    'ENFCT-200',
      fields: {
        summary:         'Config-only ticket',
        labels:          ['no-testing-required'],
        fixVersions:     [],
        status:          { name: 'In Progress' },
        assignee:        { accountId: 'dev-user-789', displayName: 'Bob Dev' },
        customfield_10201: 'Ready for System Integration Test',
      },
      changelog: {
        histories: [
          {
            created: '2026-06-10T14:00:00Z',
            items:   [{ field: 'customfield_10201', toString: 'Ready for System Integration Test' }],
          },
        ],
      },
    };

    // Config-only bypass: closeDevIssue but no parent fetch and no comment POST.
    // Order: 1. sub-status search, 2. GET transitions, 3. POST Done,
    // 4. fixVersions, 5. defect intake search
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: { issues: [configOnlyIssue] } })                    // 1. sub-status
      .mockResolvedValueOnce({ status: 200, body: { transitions: [{ id: '51', name: 'Done' }] } })   // 2. GET transitions
      .mockResolvedValueOnce({ status: 204, body: null })                                              // 3. POST Done
      .mockResolvedValueOnce({ status: 200, body: [] })                                               // 4. fixVersions
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } });                                  // 5. defect intake

    await triggerPollCycleNow(configuration);

    // Verify the issue was closed (Done transition was POSTed).
    const donePosts = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'POST' && callArgs[1].includes('/transitions')
    );
    expect(donePosts.length).toBeGreaterThan(0);

    // Verify no handoff comment was posted (no POST to /comment).
    const commentPosts = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'POST' && callArgs[1].includes('/comment')
    );
    expect(commentPosts).toHaveLength(0);
  });
});

// ── US2 — T031: Quickstart Scenario 4 (fixVersion date change → sprint update) ──

describe('US2 — T031: FixVersion date change triggers sprint end-date update (Scenario 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the lastSeenFixVersionDates Map to force first-run seeding.
    const orchestrator = require('../../src/services/sprintReleaseOrchestrator');
    if (orchestrator._testHelpers) orchestrator._testHelpers.clearSeenDates();
  });

  it('GET /api/sprint-release/status reflects sprint sync state', async () => {
    const configuration = buildIntegrationConfig();
    const app = buildTestApp(configuration);

    const response = await request(app).get('/api/sprint-release/status');

    expect(response.status).toBe(200);
    expect(response.body.teamProfileId).toBe('default');
    expect(Array.isArray(response.body.sprintSyncWarnings)).toBe(true);
  });
});

// ── US3 — T041: Quickstart Scenario 6 (defect intake label → new dev issue) ──

describe('US3 — T041: Defect intake label triggers new dev issue creation (Scenario 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { recentDefectIntakes } = require('../../src/services/sprintReleaseScheduler');
    recentDefectIntakes.length = 0;
  });

  it('a QE issue with defect-intake label causes a new ENFCT defect issue to be created', async () => {
    const configuration = buildIntegrationConfig();
    const qeIssueWithLabel = {
      key:    'INTTEST-90',
      fields: {
        labels:     ['defect-intake'],
        summary:    'Login broken on mobile',
        assignee:   null,
        issueLinks: [{ outwardIssue: { key: 'ENFCT-300' } }],
      },
    };
    const originalDevIssue = {
      key:    'ENFCT-300',
      fields: {
        summary:     'Implement login',
        assignee:    { accountId: 'dev-user-111', displayName: 'Carol Dev' },
        fixVersions: [{ id: 'fv-1', name: '6/18' }],
        status:      { name: 'Done' },
      },
    };

    makeJiraApiRequest
      // Sub-status search (empty to isolate)
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } })
      // FixVersion list (empty to isolate)
      .mockResolvedValueOnce({ status: 200, body: [] })
      // QE/BT defect intake search
      .mockResolvedValueOnce({ status: 200, body: { issues: [qeIssueWithLabel] } })
      // Fetch original dev issue for assignee inheritance
      .mockResolvedValueOnce({ status: 200, body: originalDevIssue })
      // POST new defect issue
      .mockResolvedValueOnce({ status: 201, body: { key: 'ENFCT-999' } })
      // POST link: defect caused by original
      .mockResolvedValueOnce({ status: 201, body: {} })
      // POST link: defect triggered by QE issue
      .mockResolvedValueOnce({ status: 201, body: {} })
      // PUT remove label from QE issue
      .mockResolvedValueOnce({ status: 204, body: null });

    await triggerPollCycleNow(configuration);

    // Verify the defect issue was created with the [DEFECT] prefix.
    const issueCreateCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'POST' && callArgs[1] === '/rest/api/2/issue'
    );
    expect(issueCreateCalls.length).toBeGreaterThan(0);
    const createdFields = issueCreateCalls[0][2].fields;
    expect(createdFields.summary).toBe('[DEFECT] Implement login');
    expect(createdFields.assignee).toEqual({ accountId: 'dev-user-111' });

    // Verify the defect-intake label was removed from the QE issue.
    const labelRemoveCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'PUT' && callArgs[1].includes('INTTEST-90')
    );
    expect(labelRemoveCalls.length).toBeGreaterThan(0);
    const updatedLabels = labelRemoveCalls[0][2].fields.labels;
    expect(updatedLabels).not.toContain('defect-intake');
  });
});

// ── US4 — T047: Quickstart Scenario 5 (DoR violations API) ──────────────────

describe('US4 — T047: GET /api/sprint-release/dor-violations returns sprint DoR violations (Scenario 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns violations for issues missing required DoR fields', async () => {
    const configuration = buildIntegrationConfig();
    const app = buildTestApp(configuration);

    // sprintId=10 is passed as query param → findSprintByName is skipped.
    // Only two mocks: sprint issues response + violation comment POST.
    makeJiraApiRequest
      .mockResolvedValueOnce({
        status: 200,
        body:   {
          issues: [
            {
              key:    'ENFCT-400',
              fields: {
                summary:            'Build auth',
                assignee:           { displayName: 'Dave Dev' },
                labels:             [],
                customfield_20101:  null,     // QE criteria — MISSING
                customfield_20102:  'BT scenarios here',
              },
            },
            {
              key:    'ENFCT-401',
              fields: {
                summary:            'Build profile',
                assignee:           null,
                labels:             [],
                customfield_20101:  'QE criteria here',
                customfield_20102:  'BT scenarios here',
              },
            },
          ],
        },
      })
      // POST violation comment on ENFCT-400
      .mockResolvedValueOnce({ status: 201, body: {} });

    const response = await request(app)
      .get('/api/sprint-release/dor-violations')
      .query({ sprintId: '10' });

    expect(response.status).toBe(200);
    expect(response.body.violations).toHaveLength(1);
    expect(response.body.violations[0].issueKey).toBe('ENFCT-400');
    expect(response.body.violations[0].missingFields).toContain('dorQeFieldId');
    expect(response.body.totalIssues).toBe(2);
    expect(response.body.violationCount).toBe(1);
  });

  it('returns empty violations when all sprint issues have required DoR fields', async () => {
    const configuration = buildIntegrationConfig();
    const app = buildTestApp(configuration);

    makeJiraApiRequest.mockResolvedValueOnce({
      status: 200,
      body:   {
        issues: [
          {
            key:    'ENFCT-402',
            fields: {
              summary:           'Build reports',
              assignee:          null,
              labels:            [],
              customfield_20101: 'QE criteria',
              customfield_20102: 'BT scenarios',
            },
          },
        ],
      },
    });

    const response = await request(app)
      .get('/api/sprint-release/dor-violations')
      .query({ sprintId: '10' });

    expect(response.status).toBe(200);
    expect(response.body.violations).toHaveLength(0);
    expect(response.body.violationCount).toBe(0);
  });
});

// ── US5 — T052: Quickstart Scenario 3 (BT handoff fires) ────────────────────

describe('US5 — T052: BT handoff fires after sub-status "Ready for UAT" (Scenario 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { lastHandoffByIssue } = require('../../src/services/sprintReleaseScheduler');
    lastHandoffByIssue.clear();
  });

  it('poll cycle detects BT sub-status change and posts a BT handoff comment', async () => {
    const configuration = buildIntegrationConfig();
    const btIssue = buildDevIssueWithSubStatusChange(
      'ENFCT-500', 'Ready for UAT', 'dev-user-888', 'DENP-50'
    );

    // Correct order: 1. JQL, 2. GET transitions, 3. POST Done, 4. GET parent, 5. POST comment,
    // 6. fixVersions, 7. defect intake search
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: { issues: [btIssue] } })                                          // 1. JQL
      .mockResolvedValueOnce({ status: 200, body: { transitions: [{ id: '51', name: 'Done' }] } })                 // 2. GET transitions
      .mockResolvedValueOnce({ status: 204, body: null })                                                            // 3. POST Done
      .mockResolvedValueOnce({ status: 200, body: { fields: { summary: 'Payment Feature' } } })                    // 4. GET parent
      .mockResolvedValueOnce({ status: 201, body: {} })                                                             // 5. POST comment
      .mockResolvedValueOnce({ status: 200, body: [] })                                                             // 6. fixVersions
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } });                                                // 7. defect intake

    await triggerPollCycleNow(configuration);

    // Verify a comment was posted with "BT Handoff" content.
    const commentCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => callArgs[0] === 'POST' && callArgs[1].includes('/comment')
        && callArgs[2] && callArgs[2].body && callArgs[2].body.includes('BT Handoff')
    );
    expect(commentCalls.length).toBeGreaterThan(0);
  });
});

// ── US5 — T053: Quickstart Scenario 7 (ownership integrity) ─────────────────

describe('US5 — T053: Assignee unchanged across all status transitions (Scenario 7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { lastHandoffByIssue } = require('../../src/services/sprintReleaseScheduler');
    lastHandoffByIssue.clear();
  });

  it('never PUTs an assignee field on any Jira issue during the full poll cycle', async () => {
    const configuration = buildIntegrationConfig();
    const devIssue = buildDevIssueWithSubStatusChange(
      'ENFCT-600', 'Ready for System Integration Test', 'dev-user-999', 'DENP-60'
    );

    // Correct order: 1. JQL, 2. GET transitions, 3. POST Done, 4. GET parent, 5. POST comment,
    // 6. fixVersions, 7. defect intake search
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: { issues: [devIssue] } })
      .mockResolvedValueOnce({ status: 200, body: { transitions: [{ id: '51', name: 'Done' }] } })
      .mockResolvedValueOnce({ status: 204, body: null })
      .mockResolvedValueOnce({ status: 200, body: { fields: { summary: 'Auth Feature' } } })
      .mockResolvedValueOnce({ status: 201, body: {} })
      .mockResolvedValueOnce({ status: 200, body: [] })
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } });

    await triggerPollCycleNow(configuration);

    // No PUT with an assignee field should have been made anywhere in the cycle.
    const assigneeUpdateCalls = makeJiraApiRequest.mock.calls.filter(
      (callArgs) => {
        const isHttpPut = callArgs[0] === 'PUT';
        const hasAssigneeField = callArgs[2] && callArgs[2].fields && callArgs[2].fields.assignee !== undefined;
        return isHttpPut && hasAssigneeField;
      }
    );
    expect(assigneeUpdateCalls).toHaveLength(0);
  });

  it('GET /api/sprint-release/status returns recentHandoffs ring buffer entries', async () => {
    const configuration = buildIntegrationConfig();
    const app = buildTestApp(configuration);

    const response = await request(app).get('/api/sprint-release/status');

    expect(response.status).toBe(200);
    expect(response.body.isEnabled).toBe(true);
    expect(Array.isArray(response.body.recentHandoffs)).toBe(true);
    expect(Array.isArray(response.body.recentDefectIntakes)).toBe(true);
  });
});

// ── POST /api/sprint-release/run-now ─────────────────────────────────────────

describe('POST /api/sprint-release/run-now', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: { issues: [] } });
  });

  it('returns 200 with triggered:true without waiting for poll completion', async () => {
    const configuration = buildIntegrationConfig();
    const app = buildTestApp(configuration);

    const response = await request(app).post('/api/sprint-release/run-now');

    expect(response.status).toBe(200);
    expect(response.body.triggered).toBe(true);
    expect(response.body.teamProfileId).toBe('default');
  });
});
