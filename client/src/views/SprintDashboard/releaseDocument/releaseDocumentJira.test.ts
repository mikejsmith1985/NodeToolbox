// releaseDocumentJira.test.ts — The live Jira reads behind a release document, with the network faked.

import { describe, expect, it, vi } from 'vitest';

import {
  buildReleaseIssueFields,
  createReleaseGatherDeps,
  fetchUnreleasedVersions,
} from './releaseDocumentJira.ts';

/** A fake Jira search returning `total` issues, a page at a time. */
function buildPagedSearch(total: number) {
  return vi.fn(async (path: string) => {
    const startAt = Number(/startAt=(\d+)/.exec(path)?.[1] ?? 0);
    const maxResults = Number(/maxResults=(\d+)/.exec(path)?.[1] ?? 50);
    const pageCount = Math.max(0, Math.min(maxResults, total - startAt));
    return { total, issues: Array.from({ length: pageCount }, (_, index) => ({ key: `ENCUC-${startAt + index + 1}`, fields: {} })) };
  });
}

describe('buildReleaseIssueFields', () => {
  it('asks for everything the document shows and every way an issue can name its Epic', () => {
    const fields = buildReleaseIssueFields('customfield_90001').split(',');

    ['summary', 'issuetype', 'status', 'assignee', 'fixVersions', 'project', 'parent', 'customfield_90001']
      .forEach((fieldName) => expect(fields).toContain(fieldName));
  });
});

describe('createReleaseGatherDeps', () => {
  it('reads every page of a search, so a large release is never cut short', async () => {
    const request = buildPagedSearch(230);
    const deps = createReleaseGatherDeps('customfield_90001', request);

    const issues = await deps.searchAll('project = "ENCUC"');

    expect(issues).toHaveLength(230);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][0]).toContain(`jql=${encodeURIComponent('project = "ENCUC"')}`);
  });

  it('fetches issues by key in batches', async () => {
    const request = vi.fn(async (path: string) => ({ total: 0, issues: [], path }));
    const deps = createReleaseGatherDeps('customfield_90001', request);

    await deps.fetchByKeys(Array.from({ length: 120 }, (_, index) => `DENP-${index + 1}`));

    expect(request).toHaveBeenCalledTimes(3);
    expect(decodeURIComponent(request.mock.calls[0][0])).toContain('key in (DENP-1,');
  });

  it('asks for nothing when there are no keys', async () => {
    const request = vi.fn();
    const deps = createReleaseGatherDeps('customfield_90001', request);

    expect(await deps.fetchByKeys([])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('fetchUnreleasedVersions', () => {
  it('keeps unreleased, unarchived versions, soonest first, undated last', async () => {
    const request = vi.fn(async () => [
      { id: '1', name: '11/11/2026', released: false, archived: false, releaseDate: '2026-11-11' },
      { id: '2', name: '9/1/2026', released: true, archived: false, releaseDate: '2026-09-01' },
      { id: '3', name: 'Someday', released: false, archived: false, releaseDate: null },
      { id: '4', name: 'Old', released: false, archived: true, releaseDate: '2026-01-01' },
      { id: '5', name: '10/14/2026', released: false, archived: false, releaseDate: '2026-10-14' },
    ]);

    const versions = await fetchUnreleasedVersions('ENCUC', request);

    expect(request).toHaveBeenCalledWith('/rest/api/2/project/ENCUC/versions');
    expect(versions.map((version) => version.name)).toEqual(['10/14/2026', '11/11/2026', 'Someday']);
    expect(versions[0].pageTitle).toBe('2026Oct14');
    expect(versions[2].pageTitle).toBeNull();
  });
});
