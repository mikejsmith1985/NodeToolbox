// sharePointSiteUrl.test.ts — Covers the localStorage bridge for the SharePoint site URL.

import { afterEach, describe, expect, it } from 'vitest';

import { readSharePointSiteUrl, saveSharePointSiteUrl } from './sharePointSiteUrl.ts';

afterEach(() => { localStorage.clear(); });

describe('sharePointSiteUrl', () => {
  it('stores and reads a full http(s) URL', () => {
    saveSharePointSiteUrl('https://contoso.sharepoint.com/sites/CUCIntake');
    expect(readSharePointSiteUrl()).toBe('https://contoso.sharepoint.com/sites/CUCIntake');
  });

  it('does not store a bare site-relative path (no host to open)', () => {
    saveSharePointSiteUrl('/sites/CUCIntake');
    expect(readSharePointSiteUrl()).toBeNull();
  });

  it('clears the stored URL when given empty/undefined', () => {
    saveSharePointSiteUrl('https://contoso.sharepoint.com/sites/CUCIntake');
    saveSharePointSiteUrl(undefined);
    expect(readSharePointSiteUrl()).toBeNull();
  });
});
