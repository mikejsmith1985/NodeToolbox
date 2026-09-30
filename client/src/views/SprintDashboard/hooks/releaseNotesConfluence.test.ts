// releaseNotesConfluence.test.ts — Unit tests for posting a release's notes to its own Confluence page.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReleaseAiAssistTableDocument } from './releaseAiAssistNotes.ts';
import {
  buildReleaseNotesConfluenceStorage,
  publishReleaseNotesToConfluence,
  readReleaseNotesParentPageReference,
  writeReleaseNotesParentPageReference,
  type ReleaseNotesConfluenceApi,
} from './releaseNotesConfluence.ts';
import type { ReleaseNotesGroup } from './releaseNotesGrouping.ts';

const SAMPLE_RELEASE_DOCUMENT: ReleaseAiAssistTableDocument = {
  releaseName: '10/14/2026',
  releaseSummary: 'Improves data accuracy across the Team Dashboard.',
  items: [
    {
      issueKey: 'ENFCT-1696',
      title: 'Fix duplicate SBEL eligibility records',
      releaseNote: 'Resolved duplicate eligibility records.',
      customerImpact: 'Prevents duplicate data downstream.',
      technicalDetails: 'Updated SBEL void handling logic.',
      risks: 'None.',
      validation: 'Validated via query checks.',
    },
  ],
};

const PAGE_TITLE = 'Transformers 10/14/2026 Release Notes';
const PARENT_PAGE_URL = 'https://wiki.example.com/pages/viewpage.action?pageId=555';

/** A fake Confluence whose every call can be inspected, with the parent page living in space TEAM. */
function buildFakeConfluenceApi(existingPage: { id: string; webUrl: string } | null = null): ReleaseNotesConfluenceApi {
  return {
    fetchPageSpaceKey: vi.fn().mockResolvedValue('TEAM'),
    findPageByTitle: vi.fn().mockResolvedValue(existingPage),
    fetchPageVersionNumber: vi.fn().mockResolvedValue(4),
    createPage: vi.fn().mockResolvedValue({ id: '999', title: PAGE_TITLE, webUrl: 'https://wiki.example.com/x/999' }),
    updatePage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('buildReleaseNotesConfluenceStorage', () => {
  it('writes the summary and a six-column table in Confluence storage markup', () => {
    const storage = buildReleaseNotesConfluenceStorage(SAMPLE_RELEASE_DOCUMENT);

    expect(storage).toContain('<p>Improves data accuracy across the Team Dashboard.</p>');
    for (const columnLabel of ['Release Item', 'Release Note', 'Customer Impact', 'Technical Details', 'Risks', 'Validation']) {
      expect(storage).toContain(`<th>${columnLabel}</th>`);
    }
    expect(storage).toContain('<strong>ENFCT-1696</strong><br/>Fix duplicate SBEL eligibility records');
    // Confluence restyles tables itself; email-client inline styles would only fight its theme.
    expect(storage).not.toContain('style=');
  });

  it('escapes content so a value cannot break the page markup', () => {
    const storage = buildReleaseNotesConfluenceStorage({
      ...SAMPLE_RELEASE_DOCUMENT,
      items: [{ ...SAMPLE_RELEASE_DOCUMENT.items[0], title: 'Handle <script> & "quoted" tags' }],
    });

    expect(storage).toContain('Handle &lt;script&gt; &amp; &quot;quoted&quot; tags');
    expect(storage).not.toContain('<script>');
  });

  it('files the rows under their Feature headings when grouping is worth showing', () => {
    const groups: ReleaseNotesGroup[] = [
      { featureKey: 'TBX-1', featureSummary: 'Eligibility', narrative: 'Eligibility is now clean.', rows: SAMPLE_RELEASE_DOCUMENT.items },
      { featureKey: null, featureSummary: '', narrative: '', rows: [{ ...SAMPLE_RELEASE_DOCUMENT.items[0], issueKey: 'ENFCT-2' }] },
    ];

    const storage = buildReleaseNotesConfluenceStorage(SAMPLE_RELEASE_DOCUMENT, groups);

    expect(storage).toContain('<td colspan="6"><strong>TBX-1 — Eligibility</strong><br/>Eligibility is now clean.</td>');
    expect(storage).toContain('<td colspan="6"><strong>No Feature</strong></td>');
    expect(storage.indexOf('TBX-1 — Eligibility')).toBeLessThan(storage.indexOf('ENFCT-1696'));
  });
});

describe('publishReleaseNotesToConfluence', () => {
  it('creates the release page under the chosen parent, in the parent\'s own space', async () => {
    const confluenceApi = buildFakeConfluenceApi();

    const outcome = await publishReleaseNotesToConfluence(
      { parentPageReference: PARENT_PAGE_URL, pageTitle: PAGE_TITLE, storageValue: '<p>Notes</p>' },
      confluenceApi,
    );

    expect(confluenceApi.fetchPageSpaceKey).toHaveBeenCalledWith('555');
    expect(confluenceApi.findPageByTitle).toHaveBeenCalledWith('TEAM', PAGE_TITLE);
    expect(confluenceApi.createPage).toHaveBeenCalledWith({
      spaceKey: 'TEAM',
      parentPageId: '555',
      pageTitle: PAGE_TITLE,
      storageValue: '<p>Notes</p>',
    });
    expect(confluenceApi.updatePage).not.toHaveBeenCalled();
    expect(outcome).toEqual({ pageUrl: 'https://wiki.example.com/x/999', wasCreated: true });
  });

  it('updates the existing page when this release was already posted, instead of duplicating it', async () => {
    const confluenceApi = buildFakeConfluenceApi({ id: '777', webUrl: 'https://wiki.example.com/x/777' });

    const outcome = await publishReleaseNotesToConfluence(
      { parentPageReference: PARENT_PAGE_URL, pageTitle: PAGE_TITLE, storageValue: '<p>Revised</p>' },
      confluenceApi,
    );

    expect(confluenceApi.createPage).not.toHaveBeenCalled();
    expect(confluenceApi.updatePage).toHaveBeenCalledWith({
      pageId: '777',
      pageTitle: PAGE_TITLE,
      storageValue: '<p>Revised</p>',
      nextVersionNumber: 5,
    });
    expect(outcome).toEqual({ pageUrl: 'https://wiki.example.com/x/777', wasCreated: false });
  });

  it('refuses an unreadable parent link before touching Confluence', async () => {
    const confluenceApi = buildFakeConfluenceApi();

    await expect(publishReleaseNotesToConfluence(
      { parentPageReference: 'not a page link', pageTitle: PAGE_TITLE, storageValue: '<p>Notes</p>' },
      confluenceApi,
    )).rejects.toThrow(/parent page/i);
    expect(confluenceApi.fetchPageSpaceKey).not.toHaveBeenCalled();
  });
});

describe('release-notes parent page memory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers the parent page per project, so each team posts under its own page', () => {
    writeReleaseNotesParentPageReference('ENFCT', PARENT_PAGE_URL);
    writeReleaseNotesParentPageReference('OTHER', 'https://wiki.example.com/pages/1');

    expect(readReleaseNotesParentPageReference('ENFCT')).toBe(PARENT_PAGE_URL);
    expect(readReleaseNotesParentPageReference('OTHER')).toBe('https://wiki.example.com/pages/1');
    expect(readReleaseNotesParentPageReference('NONE')).toBe('');
  });

  it('forgets a project\'s parent page when it is cleared', () => {
    writeReleaseNotesParentPageReference('ENFCT', PARENT_PAGE_URL);
    writeReleaseNotesParentPageReference('ENFCT', '   ');

    expect(readReleaseNotesParentPageReference('ENFCT')).toBe('');
  });

  it('treats a corrupted stored value as nothing remembered', () => {
    window.localStorage.setItem('tbxReleaseNotesConfluenceParents', '{not json');

    expect(readReleaseNotesParentPageReference('ENFCT')).toBe('');
  });
});
