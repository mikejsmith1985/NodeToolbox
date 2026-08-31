// jiraIssueTypes.test.ts — Proves a Feature search only ever names issue types the instance has.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./jiraApi.ts', () => ({ jiraGet: vi.fn() }));

import { jiraGet } from './jiraApi.ts';
import {
  buildIssueTypeClause,
  clearFeatureIssueTypeCache,
  loadFeatureIssueTypeNames,
  pickAvailableIssueTypeNames,
} from './jiraIssueTypes.ts';

const mockJiraGet = vi.mocked(jiraGet);

describe('pickAvailableIssueTypeNames — only names the instance actually has', () => {
  it('drops a candidate the instance does not define', () => {
    // The reported defect: this instance has no "Epic" issue type at all, so naming it in an
    // `in (...)` list made Jira reject the WHOLE query with a 400 — every Feature search returned
    // nothing, whatever was typed (GH #376).
    expect(pickAvailableIssueTypeNames(['Feature', 'Epic'], ['Story', 'Feature', 'Sub-task']))
      .toEqual(['Feature']);
  });

  it('matches case-insensitively but returns the instance-s own spelling', () => {
    expect(pickAvailableIssueTypeNames(['feature', 'epic'], ['FEATURE', 'Epic'])).toEqual(['FEATURE', 'Epic']);
  });

  it('returns nothing when the instance has none of them', () => {
    expect(pickAvailableIssueTypeNames(['Feature', 'Epic'], ['Story', 'Task'])).toEqual([]);
  });
});

describe('buildIssueTypeClause — a list of one is not a list', () => {
  it('omits the clause entirely when there is no type to restrict to', () => {
    // A broad search that returns issues beats a precise one Jira refuses.
    expect(buildIssueTypeClause([])).toBe('');
  });

  it('uses equals for a single type', () => {
    expect(buildIssueTypeClause(['Feature'])).toBe('issuetype = "Feature"');
  });

  it('uses in for several, quoting each so a hyphenated name survives', () => {
    expect(buildIssueTypeClause(['Feature', 'Sub-task'])).toBe('issuetype in ("Feature", "Sub-task")');
  });
});

describe('loadFeatureIssueTypeNames — asks the instance, once', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
    clearFeatureIssueTypeCache();
  });

  it('keeps only the feature-like types the instance defines', async () => {
    mockJiraGet.mockResolvedValue([
      { id: '1', name: 'Story', subtask: false },
      { id: '2', name: 'Feature', subtask: false },
    ]);

    expect(await loadFeatureIssueTypeNames()).toEqual(['Feature']);
  });

  it('asks Jira once and reuses the answer', async () => {
    mockJiraGet.mockResolvedValue([{ id: '2', name: 'Feature', subtask: false }]);

    await loadFeatureIssueTypeNames();
    await loadFeatureIssueTypeNames();

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('falls back to Feature alone when the instance cannot be asked', async () => {
    // Feature is the one name proven to exist here — the PI Review and Readiness queries both ship
    // `issuetype = Feature` against this instance and work. Guessing wider would 400 again.
    mockJiraGet.mockRejectedValue(new Error('Jira unreachable'));

    expect(await loadFeatureIssueTypeNames()).toEqual(['Feature']);
  });

  it('does not cache a failure, so a later attempt can still succeed', async () => {
    mockJiraGet.mockRejectedValueOnce(new Error('Jira unreachable'));
    mockJiraGet.mockResolvedValueOnce([
      { id: '2', name: 'Feature', subtask: false },
      { id: '3', name: 'Epic', subtask: false },
    ]);

    expect(await loadFeatureIssueTypeNames()).toEqual(['Feature']);
    expect(await loadFeatureIssueTypeNames()).toEqual(['Feature', 'Epic']);
  });
});
