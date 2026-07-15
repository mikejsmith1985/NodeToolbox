// loadSourceFeature.test.ts — Proves the Splitter loads the original's OWN type and project in one
// request, and that a connection problem is never dressed up as an empty Feature (A11, R4).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { resolveHygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks';
import { loadIssueLinkTypeNames, loadSourceFeature, SourceFeatureLoadError } from './loadSourceFeature';

const FIELD_CONFIG = resolveHygieneFieldConfig({ acceptanceCriteriaFieldIds: ['customfield_10200'] });
const NOW_ISO = '2026-07-15T09:00:00.000Z';

function buildJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    key: 'ABC-1',
    fields: {
      project: { key: 'ABC' },
      issuetype: { id: '10001', name: 'Feature' },
      summary: 'Claims platform',
      description: 'Everything about claims.',
      customfield_10200: 'Given a claim…',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue(buildJiraIssue());
});

describe('loadSourceFeature — one request, both facts', () => {
  it('asks for project and issuetype together, so no second round-trip is needed', async () => {
    await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    const requestedPath = decodeURIComponent(mockJiraGet.mock.calls[0][0] as string);
    expect(requestedPath).toContain('project');
    expect(requestedPath).toContain('issuetype');
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('captures the original\'s OWN issue type id, so increments echo it rather than a guess', async () => {
    const snapshot = await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(snapshot.issueTypeId).toBe('10001');
    expect(snapshot.issueTypeName).toBe('Feature');
  });

  it('captures the project key, which required-field discovery is keyed by', async () => {
    const snapshot = await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(snapshot.projectKey).toBe('ABC');
  });

  it('requests the hygiene fields too, so the draft can be graded without another call', async () => {
    await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(decodeURIComponent(mockJiraGet.mock.calls[0][0] as string)).toContain('customfield_10200');
  });

  it('normalises the key the PO typed', async () => {
    await loadSourceFeature('  abc-1  ', FIELD_CONFIG, NOW_ISO);

    expect(mockJiraGet.mock.calls[0][0]).toContain('ABC-1');
  });

  it('stamps the injected time rather than reading the clock itself', async () => {
    const snapshot = await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(snapshot.loadedAtIso).toBe(NOW_ISO);
  });
});

describe('loadSourceFeature — acceptance criteria', () => {
  it('reads them from the field this instance uses', async () => {
    const snapshot = await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(snapshot.acceptanceCriteria).toBe('Given a claim…');
  });

  it('never falls back to the description, which would show the same text in two boxes', async () => {
    mockJiraGet.mockResolvedValue(buildJiraIssue({ customfield_10200: '' }));

    const snapshot = await loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO);

    expect(snapshot.acceptanceCriteria).toBe('');
    expect(snapshot.description).toBe('Everything about claims.');
  });
});

describe('loadSourceFeature — failures a PO can act on', () => {
  it('asks for a key when none was given, instead of calling Jira', async () => {
    await expect(loadSourceFeature('   ', FIELD_CONFIG, NOW_ISO)).rejects.toThrow(SourceFeatureLoadError);
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('surfaces Jira\'s real reason when the read is rejected', async () => {
    mockJiraGet.mockRejectedValue(new Error('Issue does not exist or you do not have permission to see it.'));

    await expect(loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO)).rejects.toThrow(/do not have permission/);
  });

  it('calls an empty response a CONNECTION problem, never an empty Feature (A11)', async () => {
    // This is the lesson the codebase already learned: off-VPN reads come back empty, and telling the
    // PO their Feature has no content sends them hunting a Jira problem that does not exist.
    mockJiraGet.mockResolvedValue({ key: 'ABC-1', fields: {} });

    await expect(loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO)).rejects.toThrow(/VPN|connection/i);
  });

  it('treats a missing issue type as an unusable read rather than proceeding', async () => {
    mockJiraGet.mockResolvedValue(buildJiraIssue({ issuetype: undefined }));

    await expect(loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO)).rejects.toThrow(SourceFeatureLoadError);
  });

  it('explains that a Feature with no project cannot seed new Features', async () => {
    mockJiraGet.mockResolvedValue(buildJiraIssue({ project: undefined }));

    await expect(loadSourceFeature('ABC-1', FIELD_CONFIG, NOW_ISO)).rejects.toThrow(/which project/i);
  });
});

describe('loadIssueLinkTypeNames', () => {
  it('offers the link types this instance defines (FR-037)', async () => {
    mockJiraGet.mockResolvedValue({
      issueLinkTypes: [{ name: 'relates to' }, { name: 'blocks' }],
    });

    expect(await loadIssueLinkTypeNames()).toEqual(['relates to', 'blocks']);
  });

  it('de-duplicates repeated names', async () => {
    mockJiraGet.mockResolvedValue({
      issueLinkTypes: [{ name: 'relates to' }, { name: 'relates to' }],
    });

    expect(await loadIssueLinkTypeNames()).toEqual(['relates to']);
  });

  it('copes with an instance that reports no link types', async () => {
    mockJiraGet.mockResolvedValue({});

    expect(await loadIssueLinkTypeNames()).toEqual([]);
  });
});
