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
import { buildHygieneSearchPath, runHygieneScan } from './hygieneScan.ts';

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
