// hygieneScan.test.ts — Unit tests for the shared hygiene scan pipeline.
//
// The scan is the single computation behind every hygiene surface (the Hygiene tab, the Today
// dashboard's team cards). These tests pin its externally observable behaviour: the search it
// issues, the findings it returns, and the rollup-failure degrade path.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';
import { buildHygieneSearchPath, loadHygieneEvaluationSetup, runHygieneScan } from './hygieneScan.ts';

const mockJiraGet = vi.mocked(jiraGet);

// Field metadata returned for the /rest/api/2/field discovery call the scan performs.
const FIELD_METADATA = [
  { id: 'customfield_10200', name: 'Acceptance Criteria' },
  { id: 'customfield_10108', name: 'Feature Link' },
  { id: 'customfield_10301', name: 'Program Increment' },
  { id: 'customfield_10101', name: 'Target Start' },
  { id: 'customfield_10102', name: 'Target End' },
];

const LONG_PAST_ISO = '2020-01-01T00:00:00.000Z';

function buildIssue(key: string, fields: Record<string, unknown>) {
  return { id: key, key, fields: { summary: `Summary ${key}`, ...fields } };
}

/** A Story that is in progress and freshly updated, healthy except for the given overrides. */
function buildHealthyStoryFields(): Record<string, unknown> {
  return {
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    issuetype: { name: 'Story' },
    assignee: { displayName: 'Pat Owner' },
    updated: new Date().toISOString(),
    description: 'Given/When/Then',
    customfield_10028: 5,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('buildHygieneSearchPath', () => {
  it('scopes to the project, excludes Done, and appends the extra JQL clause', () => {
    const searchPath = buildHygieneSearchPath('encuc', 'AND cf[10301] = "PI 26.3"', ['summary'], null);
    const decodedPath = decodeURIComponent(searchPath);

    expect(decodedPath).toContain('project=ENCUC AND statusCategory != Done AND cf[10301] = "PI 26.3"');
    expect(decodedPath).not.toContain('assignee');
  });

  it('drops the project clause for the all-projects personal scope and keeps the assignee clause', () => {
    const decodedPath = decodeURIComponent(buildHygieneSearchPath('', '', ['summary'], 'assignee = currentUser()'));
    expect(decodedPath).toContain('statusCategory != Done AND assignee = currentUser()');
    expect(decodedPath).not.toContain('project=');
  });
});

describe('runHygieneScan', () => {
  it('returns findings evaluated with the scanned issues and reports the scanned count', async () => {
    const staleIssue = buildIssue('TBX-1', { ...buildHealthyStoryFields(), updated: LONG_PAST_ISO });
    const healthyIssue = buildIssue('TBX-2', buildHealthyStoryFields());
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      return Promise.resolve({ issues: [staleIssue, healthyIssue] });
    });

    const scanOutcome = await runHygieneScan({
      projectKey: 'TBX',
      extraJql: '',
      assigneeClause: null,
      activeTeamProfileId: '',
    });

    expect(scanOutcome.scannedIssueCount).toBe(2);
    const staleFinding = scanOutcome.findings.find((finding) => finding.issue.key === 'TBX-1');
    expect(staleFinding?.flags.map((flag) => flag.checkId)).toContain('stale');
    // The freshly updated issue must not be flagged stale (it may raise other, unrelated checks).
    const freshFinding = scanOutcome.findings.find((finding) => finding.issue.key === 'TBX-2');
    expect(freshFinding?.flags.map((flag) => flag.checkId) ?? []).not.toContain('stale');
  });

  it('issues the team search with the project scope, no assignee clause, and the extra JQL', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      return Promise.resolve({ issues: [] });
    });

    await runHygieneScan({
      projectKey: 'ENCUC',
      extraJql: 'AND cf[10301] = "PI 26.3"',
      assigneeClause: null,
      activeTeamProfileId: '',
    });

    const issueSearchCall = mockJiraGet.mock.calls
      .map(([path]) => decodeURIComponent(String(path)))
      .find((path) => path.includes('/rest/api/2/search'));
    // Only the JQL matters here — the fields list legitimately requests the assignee FIELD.
    const jqlClause = issueSearchCall?.split('jql=')[1]?.split('&fields')[0] ?? '';
    expect(jqlClause).toBe('project=ENCUC AND statusCategory != Done AND cf[10301] = "PI 26.3"');
  });

  it('requests issuelinks and labels so findings carry their decision context (spec 019 US2)', async () => {
    // The detail panel shows linked issues (with THEIR statuses) and label chips straight off the
    // finding's payload — a field missing here silently omits that context everywhere downstream.
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      return Promise.resolve({ issues: [] });
    });

    await runHygieneScan({ projectKey: 'TBX', extraJql: '', assigneeClause: null, activeTeamProfileId: '' });

    const requestedFieldList = mockJiraGet.mock.calls
      .map(([path]) => decodeURIComponent(String(path)))
      .find((path) => path.includes('/rest/api/2/search'))
      ?.split('fields=')[1]?.split('&')[0] ?? '';
    expect(requestedFieldList.split(',')).toEqual(expect.arrayContaining(['issuelinks', 'labels']));
  });

  it('drops only the child-story check when the rollup query fails, instead of failing the run (GH #167)', async () => {
    const unpointedFeature = buildIssue('TBX-F', {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Feature' },
      assignee: { displayName: 'Pat Owner' },
      updated: new Date().toISOString(),
    });
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      const decodedPath = decodeURIComponent(path);
      // The child-story rollup query is recognisable by its parent-in clause.
      if (decodedPath.includes('parent in')) return Promise.reject(new Error('rollup 400'));
      return Promise.resolve({ issues: [unpointedFeature] });
    });

    const scanOutcome = await runHygieneScan({
      projectKey: 'TBX',
      extraJql: '',
      assigneeClause: null,
      activeTeamProfileId: '',
    });

    const featureFinding = scanOutcome.findings.find((finding) => finding.issue.key === 'TBX-F');
    // The run survived, and the un-runnable check said nothing rather than flagging everything.
    expect(featureFinding?.flags.map((flag) => flag.checkId) ?? []).not.toContain('missing-child-story-points');
  });
});

describe('loadHygieneEvaluationSetup', () => {
  it('resolves the instance field ids, the enabled checks, and the fields a scan must request', async () => {
    // This is the setup BOTH halves of the Today "Due / overdue" card must share. They used to
    // diverge: the team half resolved Target End by name discovery while the personal half read a
    // hard-coded customfield id and ignored the admin's enabled-check toggles entirely.
    mockJiraGet.mockResolvedValueOnce(FIELD_METADATA);

    const setup = await loadHygieneEvaluationSetup('team-1');

    expect(setup.evaluationContext.fieldConfig?.targetEndFieldIds).toContain('customfield_10102');
    expect(setup.evaluationContext.enabledBuiltInCheckIds?.has('due-date-overdue')).toBe(true);
    expect(setup.requestedFields).toContain('duedate');
    expect(setup.requestedFields).toContain('customfield_10102');
  });

  it('carries the admin’s disabled checks through, so a silenced rule is silent everywhere', async () => {
    window.localStorage.setItem(
      'tbxEnterpriseStandards',
      JSON.stringify([{ id: 'due-date-overdue', isEnabled: false }]),
    );
    mockJiraGet.mockResolvedValueOnce(FIELD_METADATA);

    const setup = await loadHygieneEvaluationSetup('team-1');

    expect(setup.evaluationContext.enabledBuiltInCheckIds?.has('due-date-overdue')).toBe(false);
  });
});

describe('runHygieneScan — completeness is reported, never assumed', () => {
  it('pages past the old single-request cap instead of stopping at it', async () => {
    // Before this, one search with maxResults=200 WAS the scan: a project with more open issues
    // than that had the remainder silently excluded from every count on every hygiene surface.
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (String(requestPath).includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      const startAt = Number(/startAt=(\d+)/.exec(String(requestPath))?.[1] ?? '0');
      const totalIssues = 250;
      return Promise.resolve({
        total: totalIssues,
        issues: Array.from(
          { length: Math.max(0, Math.min(200, totalIssues - startAt)) },
          (_unused, indexInPage) => buildIssue(`SCAN-${startAt + indexInPage}`, buildHealthyStoryFields()),
        ),
      });
    });

    const outcome = await runHygieneScan({
      projectKey: 'ENCUC', extraJql: '', assigneeClause: null, activeTeamProfileId: 'team-1',
    });

    expect(outcome.scannedIssueCount).toBe(250);
    expect(outcome.isTruncated).toBe(false);
    expect(outcome.totalMatchingCount).toBe(250);
  });

  it('says so when even the ceiling could not cover the scope', async () => {
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (String(requestPath).includes('/rest/api/2/field')) return Promise.resolve(FIELD_METADATA);
      const startAt = Number(/startAt=(\d+)/.exec(String(requestPath))?.[1] ?? '0');
      // More than any ceiling this scan will accept, so the run genuinely leaves issues unread.
      return Promise.resolve({
        total: 100_000,
        issues: Array.from({ length: 200 }, (_unused, indexInPage) =>
          buildIssue(`SCAN-${startAt + indexInPage}`, buildHealthyStoryFields())),
      });
    });

    const outcome = await runHygieneScan({
      projectKey: 'ENCUC', extraJql: '', assigneeClause: null, activeTeamProfileId: 'team-1',
    });

    expect(outcome.isTruncated).toBe(true);
    expect(outcome.totalMatchingCount).toBe(100_000);
    expect(outcome.scannedIssueCount).toBeLessThan(outcome.totalMatchingCount);
  });
});
