// monthlyDeliveryReport.test.js — Unit tests for the Monthly Delivery Report data layer (feature 018):
// bucket classification per data-model.md, Feature grouping, Jira fetch dedupe/pagination, and the
// prompt builder per contracts/prompt-format.md. All I/O is mocked.

'use strict';

const {
  classifyIssueDelivery,
  buildDeliveryRecord,
  groupRecordsByFeature,
  selectReleasedVersionsInWindow,
  fetchTeamDeliveryData,
  buildMonthlyDeliveryPrompt,
} = require('./monthlyDeliveryReport');
const { buildCoveredMonthWindow } = require('./monthlyDeliveryScheduler');

const JUNE_WINDOW = buildCoveredMonthWindow('2026-06');
const NO_RELEASED_VERSIONS = new Map();

/** Builds a minimal Jira issue with a current status and optional status-transition history. */
function buildIssue(issueKey, statusName, statusCategoryKey, statusMoves, extraFields = {}) {
  return {
    key: issueKey,
    ...(statusMoves === undefined ? {} : {
      changelog: {
        histories: statusMoves.map((statusMove, moveIndex) => ({
          id: String(moveIndex + 1),
          created: statusMove.atIso,
          items: [{ field: 'status', toString: statusMove.toStatusName }],
        })),
      },
    }),
    fields: {
      summary: 'Work item ' + issueKey,
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      issuetype: { name: 'Story' },
      created: '2026-04-01T00:00:00.000Z',
      fixVersions: [],
      ...extraFields,
    },
  };
}

// ── Classification (data-model.md rules 1–4) ──

describe('classifyIssueDelivery', () => {
  it('classifies Production when the issue entered its done run inside the covered month', () => {
    const issue = buildIssue('TRFM-1', 'Accepted', 'done', [
      { toStatusName: 'Ready for QA', atIso: '2026-05-20T10:00:00.000Z' },
      { toStatusName: 'Accepted', atIso: '2026-06-11T10:00:00.000Z' },
    ]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, NO_RELEASED_VERSIONS)).toEqual({
      bucket: 'production',
      qualifyingDateIso: '2026-06-11T10:00:00.000Z',
    });
  });

  it('classifies External Test when the delivered run began in-month and production does not apply', () => {
    // Entered Ready for QA in June, reached done in July: June's report shows External Test.
    const issue = buildIssue('TRFM-2', 'Accepted', 'done', [
      { toStatusName: 'Ready for QA', atIso: '2026-06-05T10:00:00.000Z' },
      { toStatusName: 'Accepted', atIso: '2026-07-03T10:00:00.000Z' },
    ]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, NO_RELEASED_VERSIONS)).toEqual({
      bucket: 'externalTest',
      qualifyingDateIso: '2026-06-05T10:00:00.000Z',
    });
  });

  it('classifies Production via a fix version released in-month even with no in-month transition', () => {
    const issue = buildIssue(
      'TRFM-3', 'Ready to Accept', 'indeterminate',
      [{ toStatusName: 'Ready for QA', atIso: '2026-04-10T10:00:00.000Z' }],
      { fixVersions: [{ name: 'v2.5' }] },
    );
    const releasedVersions = new Map([['v2.5', '2026-06-20']]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, releasedVersions)).toEqual({
      bucket: 'production',
      qualifyingDateIso: '2026-06-20',
    });
  });

  it('prefers the done-entry date when both production paths qualify (issue appears once)', () => {
    const issue = buildIssue(
      'TRFM-4', 'Accepted', 'done',
      [{ toStatusName: 'Accepted', atIso: '2026-06-02T10:00:00.000Z' }],
      { fixVersions: [{ name: 'v2.5' }] },
    );
    const releasedVersions = new Map([['v2.5', '2026-06-20']]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, releasedVersions)).toEqual({
      bucket: 'production',
      qualifyingDateIso: '2026-06-02T10:00:00.000Z',
    });
  });

  it('does not re-report an issue that entered External Test in an earlier month', () => {
    const issue = buildIssue('TRFM-5', 'Ready for QA', 'indeterminate', [
      { toStatusName: 'Ready for QA', atIso: '2026-05-15T10:00:00.000Z' },
    ]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, NO_RELEASED_VERSIONS)).toBeNull();
  });

  it('excludes issues whose changelog is missing — attribution unknown is never guessed', () => {
    const issue = buildIssue('TRFM-6', 'Accepted', 'done');
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, NO_RELEASED_VERSIONS)).toBeNull();
  });

  it('returns null for work that never reached the delivered threshold', () => {
    const issue = buildIssue('TRFM-7', 'Working', 'indeterminate', [
      { toStatusName: 'Working', atIso: '2026-06-10T10:00:00.000Z' },
    ]);
    expect(classifyIssueDelivery(issue, JUNE_WINDOW, NO_RELEASED_VERSIONS)).toBeNull();
  });
});

// ── Feature grouping ──

describe('buildDeliveryRecord + groupRecordsByFeature', () => {
  const CLASSIFICATION = { bucket: 'production', qualifyingDateIso: '2026-06-11T10:00:00.000Z' };

  it('resolves the parent Feature via the configured link field with native parent fallback', () => {
    const linkedIssue = buildIssue('TRFM-1', 'Accepted', 'done', [], { customfield_10108: 'FEAT-9' });
    const parentIssue = buildIssue('TRFM-2', 'Accepted', 'done', [], { parent: { key: 'FEAT-3' } });
    const orphanIssue = buildIssue('TRFM-3', 'Accepted', 'done', []);

    expect(buildDeliveryRecord(linkedIssue, CLASSIFICATION, 'customfield_10108').featureKey).toBe('FEAT-9');
    expect(buildDeliveryRecord(parentIssue, CLASSIFICATION, 'customfield_10108').featureKey).toBe('FEAT-3');
    expect(buildDeliveryRecord(orphanIssue, CLASSIFICATION, 'customfield_10108').featureKey).toBeNull();
  });

  it('groups records by Feature key, sorted, with the "No Feature" group last', () => {
    const records = [
      { issueKey: 'TRFM-9', summary: 'c', bucket: 'production', qualifyingDateIso: 'x', featureKey: null },
      { issueKey: 'TRFM-2', summary: 'a', bucket: 'production', qualifyingDateIso: 'x', featureKey: 'FEAT-9' },
      { issueKey: 'TRFM-1', summary: 'b', bucket: 'production', qualifyingDateIso: 'x', featureKey: 'FEAT-2' },
      { issueKey: 'TRFM-5', summary: 'd', bucket: 'production', qualifyingDateIso: 'x', featureKey: 'FEAT-2' },
    ];
    const groups = groupRecordsByFeature(records);
    expect(groups.map((group) => group.featureKey)).toEqual(['FEAT-2', 'FEAT-9', null]);
    expect(groups[0].records.map((record) => record.issueKey)).toEqual(['TRFM-1', 'TRFM-5']);
  });
});

// ── Released-version selection ──

describe('selectReleasedVersionsInWindow', () => {
  it('keeps only released versions whose release date falls inside the covered month', () => {
    const projectVersions = [
      { name: 'v2.5', released: true, releaseDate: '2026-06-20' },
      { name: 'v2.4', released: true, releaseDate: '2026-05-30' },   // out of window
      { name: 'v2.6', released: false, releaseDate: '2026-06-25' },  // not released
      { name: 'v2.7', released: true, releaseDate: null },           // no date — unattributable
    ];
    const selectedVersions = selectReleasedVersionsInWindow(projectVersions, JUNE_WINDOW);
    expect(Array.from(selectedVersions.entries())).toEqual([['v2.5', '2026-06-20']]);
  });
});

// ── Jira fetch layer (mocked transport) ──

describe('fetchTeamDeliveryData', () => {
  const TEAM = { teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' };

  it('merges the status-change and released-version queries, deduped by issue key', async () => {
    const sharedIssue = buildIssue('TRFM-1', 'Accepted', 'done', []);
    const statusOnlyIssue = buildIssue('TRFM-2', 'Accepted', 'done', []);
    const versionOnlyIssue = buildIssue('TRFM-3', 'Ready to Accept', 'indeterminate', []);
    const requestJira = jest.fn(async (path) => {
      if (path.includes('/versions')) {
        return { status: 200, body: [{ name: 'v2.5', released: true, releaseDate: '2026-06-20' }] };
      }
      if (path.includes('CHANGED')) {
        return { status: 200, body: { total: 2, issues: [sharedIssue, statusOnlyIssue] } };
      }
      return { status: 200, body: { total: 2, issues: [sharedIssue, versionOnlyIssue] } };
    });

    const teamData = await fetchTeamDeliveryData(TEAM, JUNE_WINDOW, 'customfield_10108', { requestJira });

    expect(teamData.issues.map((issue) => issue.key).sort()).toEqual(['TRFM-1', 'TRFM-2', 'TRFM-3']);
    expect(Array.from(teamData.releasedVersionsInWindow.keys())).toEqual(['v2.5']);
  });

  it('paginates the search until every issue is fetched', async () => {
    const firstPage = Array.from({ length: 200 }, (_unused, index) => buildIssue('TRFM-' + (index + 1), 'Accepted', 'done', []));
    const secondPage = [buildIssue('TRFM-201', 'Accepted', 'done', [])];
    const requestJira = jest.fn(async (path) => {
      if (path.includes('/versions')) return { status: 200, body: [] };
      const startAtMatch = /startAt=(\d+)/.exec(path);
      const startAt = Number(startAtMatch ? startAtMatch[1] : 0);
      return { status: 200, body: { total: 201, issues: startAt === 0 ? firstPage : secondPage } };
    });

    const teamData = await fetchTeamDeliveryData(TEAM, JUNE_WINDOW, 'customfield_10108', { requestJira });

    expect(teamData.issues).toHaveLength(201);
    const searchCalls = requestJira.mock.calls.filter(([path]) => path.includes('/search'));
    expect(searchCalls.some(([path]) => path.includes('startAt=200'))).toBe(true);
  });

  it('skips the released-version query entirely when no version released in-month', async () => {
    const requestJira = jest.fn(async (path) => {
      if (path.includes('/versions')) return { status: 200, body: [{ name: 'v9', released: false, releaseDate: null }] };
      return { status: 200, body: { total: 0, issues: [] } };
    });

    await fetchTeamDeliveryData(TEAM, JUNE_WINDOW, 'customfield_10108', { requestJira });

    const fixVersionQueries = requestJira.mock.calls
      .filter(([path]) => decodeURIComponent(path).includes('fixVersion in ('));
    expect(fixVersionQueries).toHaveLength(0);
  });
});

// ── Prompt builder (contracts/prompt-format.md) ──

describe('buildMonthlyDeliveryPrompt', () => {
  const RUN_CONTEXT = { coveredMonth: '2026-06', ranAtIso: '2026-07-14T08:00:00.000Z', trigger: 'manual' };

  function sampleTeamSections() {
    return [
      {
        teamName: 'Transformers',
        status: 'ok',
        message: '',
        production: [
          {
            featureKey: 'FEAT-2',
            featureSummary: 'Payments revamp',
            records: [
              { issueKey: 'TRFM-1', summary: 'Ship payment retries', qualifyingDateIso: '2026-06-11T10:00:00.000Z' },
            ],
          },
          {
            featureKey: null,
            featureSummary: '',
            records: [
              { issueKey: 'TRFM-9', summary: 'Patch logging', qualifyingDateIso: '2026-06-20' },
            ],
          },
        ],
        externalTest: [
          {
            featureKey: 'FEAT-2',
            featureSummary: 'Payments revamp',
            records: [
              { issueKey: 'TRFM-4', summary: 'Refund flow', qualifyingDateIso: '2026-06-25T09:00:00.000Z' },
            ],
          },
        ],
      },
      { teamName: 'Cleanup Crew', status: 'empty', message: '', production: [], externalTest: [] },
      { teamName: 'Broken Team', status: 'error', message: 'Jira search failed: 401', production: [], externalTest: [] },
    ];
  }

  it('leads with the agent instructions containing the exact accomplishment question', () => {
    const promptText = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());
    const bannerIndex = promptText.indexOf('MONTHLY DELIVERY DATA');
    expect(bannerIndex).toBeGreaterThan(0);
    const instructions = promptText.slice(0, bannerIndex);
    expect(instructions).toContain('What was accomplished? Provide a summary of the achievement focusing on what was');
    expect(instructions).toContain('delivered that benefited the business or major technical improvement.');
    expect(instructions).toContain('bulleted');
  });

  it('renders the metadata banner with month label, covered month, and trigger', () => {
    const promptText = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());
    expect(promptText).toContain('MONTHLY DELIVERY DATA — June 2026 (covered month: 2026-06)');
    expect(promptText).toContain('Generated: 2026-07-14T08:00:00.000Z · Trigger: manual');
  });

  it('renders every team in order with fixed bucket order and exact issue line format', () => {
    const promptText = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());

    const transformersIndex = promptText.indexOf('=== Team: Transformers ===');
    const cleanupIndex = promptText.indexOf('=== Team: Cleanup Crew ===');
    const brokenIndex = promptText.indexOf('=== Team: Broken Team ===');
    expect(transformersIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(transformersIndex);
    expect(brokenIndex).toBeGreaterThan(cleanupIndex);

    expect(promptText.indexOf('-- Delivered to Production --')).toBeLessThan(promptText.indexOf('-- Delivered to External Test --'));
    expect(promptText).toContain('Feature FEAT-2 — Payments revamp:');
    expect(promptText).toContain('- TRFM-1: Ship payment retries (reached production 2026-06-11)');
    expect(promptText).toContain('- TRFM-9: Patch logging (reached production 2026-06-20)');
    expect(promptText).toContain('- TRFM-4: Refund flow (reached external test 2026-06-25)');
    expect(promptText).toContain('No Feature:');
  });

  it('renders the explicit empty and DATA UNAVAILABLE team lines', () => {
    const promptText = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());
    expect(promptText).toContain('No recorded deliveries this month.');
    expect(promptText).toContain('DATA UNAVAILABLE: Jira search failed: 401');
  });

  it('is deterministic: identical input produces identical text', () => {
    const firstRender = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());
    const secondRender = buildMonthlyDeliveryPrompt(RUN_CONTEXT, sampleTeamSections());
    expect(firstRender).toBe(secondRender);
  });
});
