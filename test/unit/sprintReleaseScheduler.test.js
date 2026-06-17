// test/unit/sprintReleaseScheduler.test.js — Unit tests for the Sprint–Release scheduler.
//
// Tests the poll cycle wiring: that the scheduler calls the right orchestrator
// functions for each scan type, handles errors gracefully, and that in-memory
// state is populated correctly after a cycle. All orchestrator calls and httpClient
// calls are mocked to keep tests fast (<10ms each).

'use strict';

jest.mock('../../src/utils/httpClient', () => ({
  makeJiraApiRequest: jest.fn(),
  triggerWebhook:     jest.fn(),
}));

jest.mock('../../src/services/sprintReleaseOrchestrator', () => ({
  detectSubStatusChanges:   jest.fn().mockReturnValue([]),
  executeDevIssueDone:      jest.fn().mockResolvedValue({ wasTransitioned: true }),
  postHandoffComment:       jest.fn().mockResolvedValue(undefined),
  detectFixVersionDateChange: jest.fn().mockReturnValue([]),
  calculateCodeFreezeDate:  jest.fn().mockReturnValue('2026-06-05'),
  findSprintByName:         jest.fn().mockResolvedValue(null),
  updateSprintEndDate:      jest.fn().mockResolvedValue({ wasUpdated: true }),
  detectDefectIntakeLabels: jest.fn().mockReturnValue([]),
  createDefectIssue:        jest.fn().mockResolvedValue({ createdIssueKey: null }),
  removeDefectIntakeLabel:  jest.fn().mockResolvedValue(undefined),
  findDorViolations:        jest.fn().mockReturnValue([]),
  postDorViolationComment:  jest.fn().mockResolvedValue(undefined),
}));

const { makeJiraApiRequest } = require('../../src/utils/httpClient');
const {
  detectSubStatusChanges,
  detectFixVersionDateChange,
  detectDefectIntakeLabels,
  findDorViolations,
} = require('../../src/services/sprintReleaseOrchestrator');

const {
  startSprintReleaseScheduler,
  triggerPollCycleNow,
  getSprintReleaseStatus,
} = require('../../src/services/sprintReleaseScheduler');

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildTestConfiguration(sprintReleaseOverrides) {
  return {
    jira:      { baseUrl: 'https://jira.example.com', pat: 'test-pat' },
    sslVerify: true,
    sprintRelease: {
      teamProfiles: [
        Object.assign({
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
        }, sprintReleaseOverrides || {}),
      ],
    },
  };
}

// ── startSprintReleaseScheduler ───────────────────────────────────────────────

describe('startSprintReleaseScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts a setInterval and does not fire immediately', () => {
    const configuration = buildTestConfiguration();
    startSprintReleaseScheduler(configuration);

    // Mocked Jira calls should not have been made yet — scheduler fires first after the interval.
    expect(makeJiraApiRequest).not.toHaveBeenCalled();
  });

  it('does not throw when called multiple times (clears prior interval)', () => {
    const configuration = buildTestConfiguration();

    expect(() => {
      startSprintReleaseScheduler(configuration);
      startSprintReleaseScheduler(configuration);
    }).not.toThrow();
  });
});

// ── triggerPollCycleNow ───────────────────────────────────────────────────────

describe('triggerPollCycleNow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Jira search returns empty issue lists.
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: { issues: [], values: [] } });
  });

  it('calls detectSubStatusChanges for the enabled team profile', async () => {
    const configuration = buildTestConfiguration();
    await triggerPollCycleNow(configuration);

    expect(detectSubStatusChanges).toHaveBeenCalled();
  });

  it('calls detectFixVersionDateChange for the enabled team profile', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 200, body: { issues: [] } })    // sub-status search
      .mockResolvedValueOnce({ status: 200, body: [] });               // fixVersion list

    const configuration = buildTestConfiguration();
    await triggerPollCycleNow(configuration);

    expect(detectFixVersionDateChange).toHaveBeenCalled();
  });

  it('calls detectDefectIntakeLabels for the enabled team profile', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: { issues: [], values: [] } });

    const configuration = buildTestConfiguration();
    await triggerPollCycleNow(configuration);

    expect(detectDefectIntakeLabels).toHaveBeenCalled();
  });

  it('skips a disabled team profile without calling orchestrator functions', async () => {
    const configuration = buildTestConfiguration({ isEnabled: false });
    await triggerPollCycleNow(configuration);

    expect(detectSubStatusChanges).not.toHaveBeenCalled();
  });

  it('does not throw when a sub-status scan fails (errors are caught and logged)', async () => {
    makeJiraApiRequest.mockRejectedValue(new Error('Jira unavailable'));

    const configuration = buildTestConfiguration();
    // Should resolve without throwing.
    await expect(triggerPollCycleNow(configuration)).resolves.toBeUndefined();
  });
});

// ── getSprintReleaseStatus ────────────────────────────────────────────────────

describe('getSprintReleaseStatus', () => {
  it('returns a status object with the teamProfileId and isEnabled flag', () => {
    const configuration = buildTestConfiguration();
    const status = getSprintReleaseStatus(configuration);

    expect(status.teamProfileId).toBe('default');
    expect(status.isEnabled).toBe(true);
  });

  it('includes recentHandoffs and recentDefectIntakes arrays', () => {
    const configuration = buildTestConfiguration();
    const status = getSprintReleaseStatus(configuration);

    expect(Array.isArray(status.recentHandoffs)).toBe(true);
    expect(Array.isArray(status.recentDefectIntakes)).toBe(true);
  });

  it('returns a sprintSyncWarnings array', () => {
    const configuration = buildTestConfiguration();
    const status = getSprintReleaseStatus(configuration);

    expect(Array.isArray(status.sprintSyncWarnings)).toBe(true);
  });
});
