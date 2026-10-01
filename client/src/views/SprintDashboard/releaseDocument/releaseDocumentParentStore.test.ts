// releaseDocumentParentStore.test.ts — Remembering each team's release-document parent page.

import { beforeEach, describe, expect, it } from 'vitest';

import { readReleaseDocumentParent, writeReleaseDocumentParent } from './releaseDocumentParentStore.ts';

const PARENT_PAGE_URL = 'https://wiki.example.com/pages/viewpage.action?pageId=555';

describe('release document parent page memory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('remembers one parent page per team', () => {
    writeReleaseDocumentParent('team-cuc', PARENT_PAGE_URL);
    writeReleaseDocumentParent('team-transformers', 'https://wiki.example.com/pages/9');

    expect(readReleaseDocumentParent('team-cuc')).toBe(PARENT_PAGE_URL);
    expect(readReleaseDocumentParent('team-transformers')).toBe('https://wiki.example.com/pages/9');
    expect(readReleaseDocumentParent('team-none')).toBe('');
  });

  it('is kept under a Settings Backup key, apart from the release notes parent', () => {
    writeReleaseDocumentParent('team-cuc', PARENT_PAGE_URL);

    expect(window.localStorage.getItem('tbxReleaseDocumentParents')).toContain('pageId=555');
    expect(window.localStorage.getItem('tbxReleaseNotesConfluenceParents')).toBeNull();
  });

  it('forgets a team\'s parent when cleared', () => {
    writeReleaseDocumentParent('team-cuc', PARENT_PAGE_URL);
    writeReleaseDocumentParent('team-cuc', '  ');

    expect(readReleaseDocumentParent('team-cuc')).toBe('');
  });

  it('treats a corrupted stored value as nothing remembered', () => {
    window.localStorage.setItem('tbxReleaseDocumentParents', '{not json');

    expect(readReleaseDocumentParent('team-cuc')).toBe('');
  });
});
