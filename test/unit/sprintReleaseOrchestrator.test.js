// test/unit/sprintReleaseOrchestrator.test.js — Unit tests for Sprint–Release orchestrator logic.
//
// All Jira HTTP calls are mocked. Tests validate pure business logic functions:
// sub-status change detection, handoff comment building, code-freeze date calculation,
// fixVersion date change detection, defect intake detection, and DoR violation scanning.

'use strict';

jest.mock('../../src/utils/httpClient', () => ({
  makeJiraApiRequest: jest.fn(),
  triggerWebhook:     jest.fn(),
}));

const { makeJiraApiRequest, triggerWebhook } = require('../../src/utils/httpClient');
const {
  detectSubStatusChanges,
  buildHandoffComment,
  calculateCodeFreezeDate,
  detectFixVersionDateChange,
  detectDefectIntakeLabels,
  isSprintInFreezeWindow,
  buildDefectIssueSummary,
  findDorViolations,
  executeDevIssueDone,
  postHandoffComment,
  updateSprintEndDate,
  createDefectIssue,
} = require('../../src/services/sprintReleaseOrchestrator');

// ── Test fixtures ─────────────────────────────────────────────────────────────

function buildTeamProfile(overrides) {
  return Object.assign({
    teamProfileId:            'default',
    subStatusFieldId:         'customfield_10201',
    qeHandoffSubStatusValue:  'Ready for System Integration Test',
    btHandoffSubStatusValue:  'Ready for UAT',
    configOnlyLabel:          'no-testing-required',
    defectIntakeLabel:        'defect-intake',
    devProjectKey:            'ENFCT',
    doneTransitionName:       'Done',
    dorQeFieldId:             'customfield_20101',
    dorBtFieldId:             'customfield_20102',
    handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
    freezeWindowBusinessDays: 13,
  }, overrides);
}

/**
 * Builds a minimal Jira issue object with a changelog entry for the sub-status field.
 */
function buildIssueWithSubStatusChange(issueKey, newSubStatusValue, changedAt, extraFields) {
  return {
    key:       issueKey,
    fields:    Object.assign({ labels: [] }, extraFields),
    changelog: {
      histories: [
        {
          created: changedAt,
          items:   [
            { field: 'customfield_10201', toString: newSubStatusValue },
          ],
        },
      ],
    },
  };
}

// ── detectSubStatusChanges ────────────────────────────────────────────────────

describe('detectSubStatusChanges', () => {
  it('returns a QE handoff event when an issue transitions to the QE sub-status', () => {
    const issue = buildIssueWithSubStatusChange(
      'ENFCT-100', 'Ready for System Integration Test', '2026-06-01T10:00:00Z'
    );
    const profile = buildTeamProfile();
    const lastHandoffByIssue = new Map();

    const events = detectSubStatusChanges([issue], lastHandoffByIssue, profile);

    expect(events).toHaveLength(1);
    expect(events[0].issueKey).toBe('ENFCT-100');
    expect(events[0].handoffType).toBe('QE');
  });

  it('returns a BT handoff event when an issue transitions to the BT sub-status', () => {
    const issue = buildIssueWithSubStatusChange(
      'ENFCT-101', 'Ready for UAT', '2026-06-02T10:00:00Z'
    );
    const profile = buildTeamProfile();
    const lastHandoffByIssue = new Map();

    const events = detectSubStatusChanges([issue], lastHandoffByIssue, profile);

    expect(events).toHaveLength(1);
    expect(events[0].handoffType).toBe('BT');
  });

  it('returns a BYPASS event when a config-only issue transitions to QE sub-status', () => {
    const issue = buildIssueWithSubStatusChange(
      'ENFCT-102', 'Ready for System Integration Test', '2026-06-01T10:00:00Z',
      { labels: ['no-testing-required'] }
    );
    const profile = buildTeamProfile();
    const lastHandoffByIssue = new Map();

    const events = detectSubStatusChanges([issue], lastHandoffByIssue, profile);

    expect(events[0].handoffType).toBe('BYPASS');
  });

  it('does not return a QE event when that handoff was already recorded', () => {
    const issue = buildIssueWithSubStatusChange(
      'ENFCT-103', 'Ready for System Integration Test', '2026-06-01T10:00:00Z'
    );
    const profile = buildTeamProfile();
    const lastHandoffByIssue = new Map([
      ['default:ENFCT-103', { qeHandoffAt: '2026-06-01T11:00:00Z', btHandoffAt: null }],
    ]);

    const events = detectSubStatusChanges([issue], lastHandoffByIssue, profile);

    expect(events).toHaveLength(0);
  });

  it('returns no events when an issue has no changelog', () => {
    const issueWithNoChangelog = { key: 'ENFCT-104', fields: { labels: [] }, changelog: { histories: [] } };
    const profile = buildTeamProfile();
    const lastHandoffByIssue = new Map();

    const events = detectSubStatusChanges([issueWithNoChangelog], lastHandoffByIssue, profile);

    expect(events).toHaveLength(0);
  });
});

// ── buildHandoffComment ───────────────────────────────────────────────────────

describe('buildHandoffComment', () => {
  it('includes the issue key, environment name, and team name in a QE handoff', () => {
    const comment = buildHandoffComment('ENFCT-200', 'QE', 'DENP-50', 'Feature: Login Flow');

    expect(comment).toContain('ENFCT-200');
    expect(comment).toContain('QE');
    expect(comment).toContain('INT');
    expect(comment).toContain('DENP-50');
    expect(comment).toContain('Feature: Login Flow');
  });

  it('includes REL environment and BT team in a BT handoff', () => {
    const comment = buildHandoffComment('ENFCT-201', 'BT', 'DENP-51', 'Feature: Checkout Flow');

    expect(comment).toContain('BT');
    expect(comment).toContain('REL');
  });
});

// ── calculateCodeFreezeDate ───────────────────────────────────────────────────

describe('calculateCodeFreezeDate', () => {
  it('counts back exactly 13 business days from a Monday release date', () => {
    // 2026-06-22 is a Monday; 13 business days earlier = 2026-06-03 (also a Wednesday).
    // Let's verify: Jun 22 back 1 = Jun 19 (Fri), 2=18(Thu), 3=17(Wed), 4=16(Tue),
    // 5=15(Mon), 6=12(Fri), 7=11(Thu), 8=10(Wed), 9=9(Tue), 10=8(Mon),
    // 11=5(Fri), 12=4(Thu), 13=3(Wed).
    const result = calculateCodeFreezeDate('2026-06-22', 13);
    expect(result).toBe('2026-06-03');
  });

  it('skips weekends when counting backward', () => {
    // 2026-06-15 is a Monday; 1 business day earlier should skip Sat/Sun = Jun 12 (Fri).
    const result = calculateCodeFreezeDate('2026-06-15', 1);
    expect(result).toBe('2026-06-12');
  });

  it('returns the correct date for a 0-business-day offset (same day)', () => {
    const result = calculateCodeFreezeDate('2026-06-17', 0);
    expect(result).toBe('2026-06-17');
  });
});

// ── detectFixVersionDateChange ────────────────────────────────────────────────

describe('detectFixVersionDateChange', () => {
  it('returns no events on the first call (seeds the map)', () => {
    const fixVersions = [{ id: 'fv-1', name: '6/18', releaseDate: '2026-06-18' }];
    const lastSeenDatesMap = new Map();
    const profile = buildTeamProfile();

    const events = detectFixVersionDateChange(fixVersions, lastSeenDatesMap, profile);

    expect(events).toHaveLength(0);
    expect(lastSeenDatesMap.get('default:fv-1')).toBe('2026-06-18');
  });

  it('returns a change event when the release date differs from the last seen value', () => {
    const lastSeenDatesMap = new Map([['default:fv-1', '2026-06-18']]);
    const fixVersions = [{ id: 'fv-1', name: '6/18', releaseDate: '2026-06-25' }];
    const profile = buildTeamProfile();

    const events = detectFixVersionDateChange(fixVersions, lastSeenDatesMap, profile);

    expect(events).toHaveLength(1);
    expect(events[0].previousReleaseDate).toBe('2026-06-18');
    expect(events[0].newReleaseDate).toBe('2026-06-25');
    expect(events[0].fixVersionName).toBe('6/18');
  });

  it('returns no event when the release date is unchanged', () => {
    const lastSeenDatesMap = new Map([['default:fv-1', '2026-06-18']]);
    const fixVersions = [{ id: 'fv-1', name: '6/18', releaseDate: '2026-06-18' }];
    const profile = buildTeamProfile();

    const events = detectFixVersionDateChange(fixVersions, lastSeenDatesMap, profile);

    expect(events).toHaveLength(0);
  });

  it('skips fix versions with no release date', () => {
    const lastSeenDatesMap = new Map();
    const fixVersions = [{ id: 'fv-unreleased', name: 'backlog' }];
    const profile = buildTeamProfile();

    const events = detectFixVersionDateChange(fixVersions, lastSeenDatesMap, profile);

    expect(events).toHaveLength(0);
  });
});

// ── detectDefectIntakeLabels ──────────────────────────────────────────────────

describe('detectDefectIntakeLabels', () => {
  it('detects a new intake when a QE issue has the defect-intake label and a linked dev issue', () => {
    const qeBtIssue = {
      key:    'INTTEST-50',
      fields: {
        labels:     ['defect-intake'],
        issueLinks: [
          { outwardIssue: { key: 'ENFCT-300' } },
        ],
      },
    };
    const profile = buildTeamProfile();
    const processedSet = new Set();

    const intakes = detectDefectIntakeLabels([qeBtIssue], processedSet, profile);

    expect(intakes).toHaveLength(1);
    expect(intakes[0].triggerIssueKey).toBe('INTTEST-50');
    expect(intakes[0].linkedDevIssueKey).toBe('ENFCT-300');
  });

  it('skips issues that have already been processed', () => {
    const qeBtIssue = {
      key:    'INTTEST-51',
      fields: {
        labels:     ['defect-intake'],
        issueLinks: [{ outwardIssue: { key: 'ENFCT-301' } }],
      },
    };
    const profile = buildTeamProfile();
    const processedSet = new Set(['default:INTTEST-51']);

    const intakes = detectDefectIntakeLabels([qeBtIssue], processedSet, profile);

    expect(intakes).toHaveLength(0);
  });

  it('skips issues that do not have the defect-intake label', () => {
    const qeBtIssue = {
      key:    'INTTEST-52',
      fields: { labels: ['some-other-label'], issueLinks: [] },
    };
    const profile = buildTeamProfile();
    const processedSet = new Set();

    const intakes = detectDefectIntakeLabels([qeBtIssue], processedSet, profile);

    expect(intakes).toHaveLength(0);
  });

  it('skips issues with the defect-intake label but no linked dev issue', () => {
    const qeBtIssue = {
      key:    'INTTEST-53',
      fields: { labels: ['defect-intake'], issueLinks: [] },
    };
    const profile = buildTeamProfile();
    const processedSet = new Set();

    const intakes = detectDefectIntakeLabels([qeBtIssue], processedSet, profile);

    expect(intakes).toHaveLength(0);
  });
});

// ── isSprintInFreezeWindow ────────────────────────────────────────────────────

describe('isSprintInFreezeWindow', () => {
  it('returns true when current date equals sprint end date', () => {
    expect(isSprintInFreezeWindow('2026-06-18', '2026-06-18')).toBe(true);
  });

  it('returns true when current date is after sprint end date', () => {
    expect(isSprintInFreezeWindow('2026-06-18', '2026-06-20')).toBe(true);
  });

  it('returns false when current date is before sprint end date', () => {
    expect(isSprintInFreezeWindow('2026-06-18', '2026-06-10')).toBe(false);
  });
});

// ── buildDefectIssueSummary ───────────────────────────────────────────────────

describe('buildDefectIssueSummary', () => {
  it('prepends [DEFECT] to the original summary', () => {
    const result = buildDefectIssueSummary('User cannot log in after password reset');
    expect(result).toBe('[DEFECT] User cannot log in after password reset');
  });
});

// ── findDorViolations ─────────────────────────────────────────────────────────

describe('findDorViolations', () => {
  it('reports a violation when dorQeFieldId is present in config but empty on the issue', () => {
    const sprintIssues = [
      { key: 'ENFCT-400', fields: { summary: 'Build login', assignee: null, customfield_20101: null, customfield_20102: 'Some BT criteria' } },
    ];
    const profile = buildTeamProfile();

    const violations = findDorViolations(sprintIssues, profile);

    expect(violations).toHaveLength(1);
    expect(violations[0].issueKey).toBe('ENFCT-400');
    expect(violations[0].missingFields).toContain('dorQeFieldId');
    expect(violations[0].missingFields).not.toContain('dorBtFieldId');
  });

  it('reports no violations when all DoR fields are populated', () => {
    const sprintIssues = [
      { key: 'ENFCT-401', fields: { summary: 'Build registration', assignee: null, customfield_20101: 'QE criteria', customfield_20102: 'BT scenarios' } },
    ];
    const profile = buildTeamProfile();

    const violations = findDorViolations(sprintIssues, profile);

    expect(violations).toHaveLength(0);
  });

  it('skips DoR checks for fields with empty fieldId in config (team has not configured them)', () => {
    const sprintIssues = [
      { key: 'ENFCT-402', fields: { summary: 'Build reports', assignee: null } },
    ];
    const profile = buildTeamProfile({ dorQeFieldId: '', dorBtFieldId: '' });

    const violations = findDorViolations(sprintIssues, profile);

    expect(violations).toHaveLength(0);
  });
});

// ── executeDevIssueDone ───────────────────────────────────────────────────────

describe('executeDevIssueDone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches available transitions and posts the Done transition', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({
        status: 200,
        body: { transitions: [{ id: '51', name: 'Done' }, { id: '11', name: 'In Progress' }] },
      })
      .mockResolvedValueOnce({ status: 204, body: null }); // transition POST

    const profile = buildTeamProfile();
    const result = await executeDevIssueDone('ENFCT-500', {}, profile, true);

    expect(result.wasTransitioned).toBe(true);
    expect(makeJiraApiRequest).toHaveBeenCalledTimes(2);
    const transitionPostCall = makeJiraApiRequest.mock.calls[1];
    expect(transitionPostCall[1]).toContain('ENFCT-500');
    expect(transitionPostCall[2]).toEqual({ transition: { id: '51' } });
  });

  it('returns wasTransitioned false when the Done transition is not available', async () => {
    makeJiraApiRequest.mockResolvedValueOnce({
      status: 200,
      body: { transitions: [{ id: '11', name: 'In Progress' }] },
    });
    const profile = buildTeamProfile();

    const result = await executeDevIssueDone('ENFCT-501', {}, profile, true);

    expect(result.wasTransitioned).toBe(false);
    expect(result.reason).toContain('not available');
  });
});

// ── postHandoffComment ────────────────────────────────────────────────────────

describe('postHandoffComment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts a Jira comment on the dev issue', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 201, body: {} });

    const profile = buildTeamProfile({ handoffDelivery: { webhookUrl: '', webhookSecret: '' } });
    await postHandoffComment('ENFCT-600', 'QE', 'DENP-60', 'My Feature', {}, profile, true);

    expect(makeJiraApiRequest).toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('ENFCT-600'),
      expect.objectContaining({ body: expect.stringContaining('QE') }),
      {},
      true
    );
  });

  it('calls triggerWebhook when a webhook URL is configured', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 201, body: {} });
    triggerWebhook.mockResolvedValue({});

    const profile = buildTeamProfile({ handoffDelivery: { webhookUrl: 'https://example.com/hook', webhookSecret: 'secret' } });
    await postHandoffComment('ENFCT-601', 'BT', 'DENP-61', 'Another Feature', {}, profile, true);

    expect(triggerWebhook).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ issueKey: 'ENFCT-601', handoffType: 'BT' }),
      true,
      'secret'
    );
  });

  it('does not call triggerWebhook when no webhook URL is set', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 201, body: {} });
    triggerWebhook.mockResolvedValue({});

    const profile = buildTeamProfile({ handoffDelivery: { webhookUrl: '', webhookSecret: '' } });
    await postHandoffComment('ENFCT-602', 'QE', 'DENP-62', 'Some Feature', {}, profile, true);

    expect(triggerWebhook).not.toHaveBeenCalled();
  });
});

// ── updateSprintEndDate ───────────────────────────────────────────────────────

describe('updateSprintEndDate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls the Agile sprint API with the new end date', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: {} });

    const activeSprint = { id: 42, name: '6/18', state: 'active' };
    const result = await updateSprintEndDate(activeSprint, '2099-12-01', {}, true);

    expect(result.wasUpdated).toBe(true);
    expect(makeJiraApiRequest).toHaveBeenCalledWith(
      'POST',
      '/rest/agile/1.0/sprint/42',
      { endDate: '2099-12-01' },
      {},
      true
    );
  });

  it('returns wasUpdated false for a closed sprint without calling the API', async () => {
    const closedSprint = { id: 99, name: '5/18', state: 'closed' };
    const result = await updateSprintEndDate(closedSprint, '2026-06-20', {}, true);

    expect(result.wasUpdated).toBe(false);
    expect(result.warning).toContain('closed');
    expect(makeJiraApiRequest).not.toHaveBeenCalled();
  });

  it('returns wasUpdated false when the new end date is in the past', async () => {
    const activeSprint = { id: 100, name: 'old', state: 'active' };
    const result = await updateSprintEndDate(activeSprint, '2020-01-01', {}, true);

    expect(result.wasUpdated).toBe(false);
    expect(result.warning).toContain('past');
    expect(makeJiraApiRequest).not.toHaveBeenCalled();
  });
});

// ── createDefectIssue (T034) ──────────────────────────────────────────────────

describe('createDefectIssue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildOriginalDevIssue(overrides) {
    return Object.assign({
      key:    'ENFCT-700',
      fields: {
        summary:     'User cannot log in',
        assignee:    { accountId: 'user-123', displayName: 'Alice Dev' },
        fixVersions: [{ id: 'fv-1', name: '6/18' }],
      },
    }, overrides);
  }

  function buildTriggerIssue() {
    return {
      key:    'INTTEST-80',
      fields: { labels: ['defect-intake'], summary: 'Login fails on mobile' },
    };
  }

  it('creates a defect issue with [DEFECT] prefix and inherits the original assignee', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 201, body: { key: 'ENFCT-800' } }) // issue creation
      .mockResolvedValueOnce({ status: 201, body: {} })                    // link to original
      .mockResolvedValueOnce({ status: 201, body: {} });                   // link to trigger

    const profile = buildTeamProfile();
    const originalIssue = buildOriginalDevIssue();
    const triggerIssue = buildTriggerIssue();

    const result = await createDefectIssue(originalIssue, triggerIssue, null, profile, {}, true);

    expect(result.createdIssueKey).toBe('ENFCT-800');
    const issueCreateCall = makeJiraApiRequest.mock.calls[0];
    const createdFields = issueCreateCall[2].fields;
    expect(createdFields.summary).toBe('[DEFECT] User cannot log in');
    expect(createdFields.assignee).toEqual({ accountId: 'user-123' });
    expect(createdFields.labels).toContain('defect-from-testing');
  });

  it('adds TRIAGE REQUIRED label and clears fixVersions when sprint is in freeze window', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 201, body: { key: 'ENFCT-801' } })
      .mockResolvedValue({ status: 201, body: {} });

    const profile = buildTeamProfile();
    const originalIssue = buildOriginalDevIssue();
    const triggerIssue = buildTriggerIssue();
    // Pass a past sprint end date so isSprintInFreezeWindow returns true.
    const pastSprintEndDate = '2020-01-01';

    const result = await createDefectIssue(originalIssue, triggerIssue, pastSprintEndDate, profile, {}, true);

    expect(result.createdIssueKey).toBe('ENFCT-801');
    const issueCreateCall = makeJiraApiRequest.mock.calls[0];
    const createdFields = issueCreateCall[2].fields;
    expect(createdFields.labels).toContain('TRIAGE REQUIRED');
    expect(createdFields.fixVersions).toEqual([]);
  });

  it('includes fixVersions when sprint is not in freeze window', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 201, body: { key: 'ENFCT-802' } })
      .mockResolvedValue({ status: 201, body: {} });

    const profile = buildTeamProfile();
    const originalIssue = buildOriginalDevIssue();
    const triggerIssue = buildTriggerIssue();
    // Pass a far-future sprint end date so freeze window is NOT active.
    const futureSprintEndDate = '2099-12-31';

    const result = await createDefectIssue(originalIssue, triggerIssue, futureSprintEndDate, profile, {}, true);

    const issueCreateCall = makeJiraApiRequest.mock.calls[0];
    const createdFields = issueCreateCall[2].fields;
    expect(createdFields.fixVersions).toEqual([{ id: 'fv-1', name: '6/18' }]);
    expect(createdFields.labels).not.toContain('TRIAGE REQUIRED');
  });

  it('returns createdIssueKey null when the Jira issue creation call fails', async () => {
    makeJiraApiRequest.mockRejectedValue(new Error('Jira down'));

    const profile = buildTeamProfile();
    const result = await createDefectIssue(buildOriginalDevIssue(), buildTriggerIssue(), null, profile, {}, true);

    expect(result.createdIssueKey).toBeNull();
  });
});
