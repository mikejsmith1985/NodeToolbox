// releasePageSync.test.ts — Saving a release page without ever losing what people typed (GH #395).

import { describe, expect, it, vi } from 'vitest';

import type { EpicGroup } from './releaseGather.ts';
import { readReleasePage, saveReleasePage, syncAllReleases, type ReleasePageConfluenceApi } from './releasePageSync.ts';

const PARENT_PAGE_URL = 'https://wiki.example.com/pages/viewpage.action?pageId=555';
const EXISTING_STORAGE = '<table><tbody><tr><th>PR</th><th>Log level</th></tr><tr><td>TBD</td><td>ERROR</td></tr></tbody></table>';

/** A fake Confluence holding, optionally, an existing page "2026Oct14" under parent 555 in space TEAM. */
function buildApi(options: { hasExistingPage?: boolean } = {}): ReleasePageConfluenceApi {
  return {
    fetchPageSpaceKey: vi.fn().mockResolvedValue('TEAM'),
    findPageByTitle: vi.fn().mockResolvedValue(options.hasExistingPage ? { id: '777', webUrl: 'https://wiki.example.com/x/777' } : null),
    fetchPage: vi.fn().mockResolvedValue({ version: { number: 4 }, body: { storage: { value: EXISTING_STORAGE } } }),
    createPage: vi.fn().mockResolvedValue({ id: '999', webUrl: 'https://wiki.example.com/x/999' }),
    updatePage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('saveReleasePage', () => {
  it('creates the release page under the parent when it does not exist yet', async () => {
    const api = buildApi();
    const buildStorage = vi.fn().mockReturnValue('<p>new</p>');

    const outcome = await saveReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14', buildStorage }, api);

    expect(api.createPage).toHaveBeenCalledWith({ spaceKey: 'TEAM', parentPageId: '555', pageTitle: '2026Oct14', storageValue: '<p>new</p>' });
    expect(buildStorage).toHaveBeenCalledWith({ deploymentSteps: [], notesByKey: new Map() });
    expect(outcome).toEqual({ pageUrl: 'https://wiki.example.com/x/999', wasCreated: true });
  });

  it('reads an existing page first and hands its typed content to the build, then updates it', async () => {
    const api = buildApi({ hasExistingPage: true });
    const buildStorage = vi.fn().mockReturnValue('<p>merged</p>');

    const outcome = await saveReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14', buildStorage }, api);

    expect(buildStorage.mock.calls[0][0].deploymentSteps).toEqual([expect.objectContaining({ pr: 'TBD', logLevel: 'ERROR' })]);
    expect(api.updatePage).toHaveBeenCalledWith({ pageId: '777', pageTitle: '2026Oct14', storageValue: '<p>merged</p>', nextVersionNumber: 5 });
    expect(outcome).toEqual({ pageUrl: 'https://wiki.example.com/x/777', wasCreated: false });
  });

  it('when someone saved the page meanwhile, re-reads, rebuilds and retries once', async () => {
    const api = buildApi({ hasExistingPage: true });
    vi.mocked(api.updatePage)
      .mockRejectedValueOnce(new Error('Confluence PUT page 777 failed: Version must be incremented on update.'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(api.fetchPage).mockResolvedValueOnce({ version: { number: 4 }, body: { storage: { value: '' } } })
      .mockResolvedValueOnce({ version: { number: 6 }, body: { storage: { value: EXISTING_STORAGE } } });
    const buildStorage = vi.fn().mockReturnValue('<p>merged</p>');

    await saveReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14', buildStorage }, api);

    expect(buildStorage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.updatePage).mock.calls[1][0].nextVersionNumber).toBe(7);
  });

  it('gives up after one retry and reports the failure', async () => {
    const api = buildApi({ hasExistingPage: true });
    vi.mocked(api.updatePage).mockRejectedValue(new Error('Version must be incremented on update'));

    await expect(saveReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14', buildStorage: () => '' }, api))
      .rejects.toThrow(/Version must be incremented/);
    expect(api.updatePage).toHaveBeenCalledTimes(2);
  });

  it('refuses an unreadable parent link before touching Confluence', async () => {
    const api = buildApi();

    await expect(saveReleasePage({ parentPageReference: 'not a link', title: '2026Oct14', buildStorage: () => '' }, api))
      .rejects.toThrow(/parent page/i);
    expect(api.fetchPageSpaceKey).not.toHaveBeenCalled();
  });
});

describe('readReleasePage', () => {
  it('returns the page\'s typed content and link, or nothing when the page does not exist', async () => {
    const existing = await readReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14' }, buildApi({ hasExistingPage: true }));
    const missing = await readReleasePage({ parentPageReference: PARENT_PAGE_URL, title: '2026Oct14' }, buildApi());

    expect(existing?.pageUrl).toBe('https://wiki.example.com/x/777');
    expect(existing?.parsed.deploymentSteps).toHaveLength(1);
    expect(missing).toBeNull();
  });
});

describe('syncAllReleases', () => {
  /** A group holding the given child keys under DENP-20. */
  function buildGroups(childKeys: string[]): EpicGroup[] {
    if (childKeys.length === 0) return [];
    return [{
      epicKey: 'DENP-20',
      epic: null,
      items: childKeys.map((key) => ({
        key, summary: key, issueTypeName: 'Story', statusName: 'Done', assigneeName: 'A', fixVersionNames: [], epicKey: 'DENP-20', notes: '',
      })),
      outsideItems: [],
      misalignments: [],
    }];
  }

  /** Confluence with one existing page, 2026Oct14, whose Notes put "Waiting on QA" against ENCUC-2. */
  function buildSyncApi(): ReleasePageConfluenceApi {
    const octoberStorage = '<table><tbody><tr><th>Key</th><th>Notes</th></tr><tr><td>ENCUC-2</td><td>Waiting on QA</td></tr></tbody></table>'
      + '<table><tbody><tr><th>PR</th><th>Log level</th></tr><tr><td>TBD</td><td>ERROR</td></tr></tbody></table>';
    return {
      fetchPageSpaceKey: vi.fn().mockResolvedValue('TEAM'),
      findPageByTitle: vi.fn(async (_spaceKey: string, title: string) => (title === '2026Oct14' ? { id: '777', webUrl: 'https://wiki/x/777' } : null)),
      fetchPage: vi.fn().mockResolvedValue({ version: { number: 4 }, body: { storage: { value: octoberStorage } } }),
      createPage: vi.fn(async ({ pageTitle }: { pageTitle: string }) => ({ id: '999', webUrl: `https://wiki/x/${pageTitle}` })),
      updatePage: vi.fn().mockResolvedValue(undefined),
    };
  }

  const VERSIONS = [
    { id: '1', name: '10/14/2026', releaseDate: '2026-10-14', pageTitle: '2026Oct14' },
    { id: '2', name: '11/11/2026', releaseDate: '2026-11-11', pageTitle: '2026Nov11' },
    { id: '3', name: 'Someday', releaseDate: null, pageTitle: null },
    { id: '4', name: '12/1/2026', releaseDate: '2026-12-01', pageTitle: '2026Dec01' },
  ];

  it('updates existing pages, creates missing ones, and skips releases with no work or no date', async () => {
    const api = buildSyncApi();
    // ENCUC-2 moved from October to November; December has no work.
    const gatherVersion = vi.fn(async (versionName: string) => ({
      groups: buildGroups(versionName === '11/11/2026' ? ['ENCUC-2'] : versionName === '10/14/2026' ? ['ENCUC-1'] : []),
      warnings: [],
    }));

    const report = await syncAllReleases(
      { versions: VERSIONS, parentPageReference: PARENT_PAGE_URL, gatherVersion, buildIssueUrl: (key) => key, lastSyncedLabel: 'now' },
      api,
    );

    expect(report.map((row) => [row.pageTitle ?? row.versionName, row.outcome])).toEqual([
      ['2026Oct14', 'updated'],
      ['2026Nov11', 'created'],
      ['Someday', 'skipped-no-date'],
      ['2026Dec01', 'skipped-empty'],
    ]);
  });

  it('moves an item\'s note to the page the item now belongs to, and keeps each page\'s deployment steps', async () => {
    const api = buildSyncApi();
    const gatherVersion = vi.fn(async (versionName: string) => ({
      groups: buildGroups(versionName === '11/11/2026' ? ['ENCUC-2'] : versionName === '10/14/2026' ? ['ENCUC-1'] : []),
      warnings: [],
    }));

    await syncAllReleases(
      { versions: VERSIONS.slice(0, 2), parentPageReference: PARENT_PAGE_URL, gatherVersion, buildIssueUrl: (key) => key, lastSyncedLabel: 'now' },
      api,
    );

    const novemberStorage = vi.mocked(api.createPage).mock.calls[0][0].storageValue;
    const octoberStorage = vi.mocked(api.updatePage).mock.calls[0][0].storageValue;
    expect(novemberStorage).toContain('Waiting on QA');
    expect(octoberStorage).not.toContain('ENCUC-2');
    expect(octoberStorage).toContain('<td>TBD</td>');
  });

  it('reports a release that fails and still syncs the others', async () => {
    const api = buildSyncApi();
    const gatherVersion = vi.fn(async (versionName: string) => {
      if (versionName === '10/14/2026') throw new Error('Jira timed out');
      return { groups: buildGroups(['ENCUC-5']), warnings: [] };
    });

    const report = await syncAllReleases(
      { versions: VERSIONS.slice(0, 2), parentPageReference: PARENT_PAGE_URL, gatherVersion, buildIssueUrl: (key) => key, lastSyncedLabel: 'now' },
      api,
    );

    expect(report[0]).toEqual(expect.objectContaining({ outcome: 'failed', detail: 'Jira timed out' }));
    expect(report[1].outcome).toBe('created');
  });
});
