// browseUrl.test.ts — Unit tests for the open-in-Jira link builder.

import { describe, expect, it } from 'vitest';

import { buildBrowseUrl } from './browseUrl.ts';

describe('buildBrowseUrl', () => {
  it('builds a browse URL from the issue self link', () => {
    expect(buildBrowseUrl('https://jira.example.com/rest/api/2/issue/10000', 'ABC-1'))
      .toBe('https://jira.example.com/browse/ABC-1');
  });

  it('falls back to a relative path when self is not a valid URL', () => {
    expect(buildBrowseUrl('not-a-url', 'ABC-1')).toBe('/browse/ABC-1');
  });
});
