// test/unit/sharePointFolderUrl.test.js — Server-side SharePoint folder URL normalization (the same
// forgiveness the client pull has): share links, full URLs, and bare paths all reduce to the clean
// server-relative folder. Used to self-heal configs where a SharePoint link was saved as the drop folder.

'use strict';

const { normalizeSharePointFolderUrl, isHttpUrl } = require('../../src/utils/sharePointFolderUrl');

describe('normalizeSharePointFolderUrl', () => {
  it('reduces a full SharePoint SHARE link (the :f:/r form with encoding and query) to the folder path', () => {
    // The exact production paste that poisoned a config's drop folder.
    const shareLink = 'https://myfyi.sharepoint.com/:f:/r/sites/Transformers-Playground/Shared%20Documents/gh_emails?d=w887bc2fb1973464baa4b7666c752fe59&csf=1&web=1&e=8KbtNn';
    expect(normalizeSharePointFolderUrl(shareLink)).toBe('/sites/Transformers-Playground/Shared Documents/gh_emails');
  });

  it('reduces a plain full URL to its decoded path and keeps a bare server-relative path as-is', () => {
    expect(normalizeSharePointFolderUrl('https://tenant.sharepoint.com/sites/Team/Shared%20Documents/GitHubEmails'))
      .toBe('/sites/Team/Shared Documents/GitHubEmails');
    expect(normalizeSharePointFolderUrl('/sites/Team/Shared Documents/GitHubEmails'))
      .toBe('/sites/Team/Shared Documents/GitHubEmails');
  });

  it('trims whitespace and trailing slashes, and passes blank through unchanged', () => {
    expect(normalizeSharePointFolderUrl('  /sites/Team/Lib/  ')).toBe('/sites/Team/Lib');
    expect(normalizeSharePointFolderUrl('')).toBe('');
  });
});

describe('isHttpUrl', () => {
  it('detects http(s) values (the ones that can never be a local drop folder)', () => {
    expect(isHttpUrl('https://myfyi.sharepoint.com/:f:/r/sites/x')).toBe(true);
    expect(isHttpUrl('HTTP://example.com')).toBe(true);
    expect(isHttpUrl('C:\\Users\\me\\GitHubEmails')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
