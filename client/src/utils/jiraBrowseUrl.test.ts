// jiraBrowseUrl.test.ts — Unit tests for building a Jira issue browse link.

import { describe, expect, it } from 'vitest';

import { buildJiraBrowseUrl } from './jiraBrowseUrl.ts';

describe('buildJiraBrowseUrl', () => {
  it('builds an absolute browse URL from the configured base URL', () => {
    expect(buildJiraBrowseUrl('TBX-101', 'https://jira.example.com')).toBe(
      'https://jira.example.com/browse/TBX-101',
    );
  });

  it('strips a trailing slash from the base URL', () => {
    expect(buildJiraBrowseUrl('TBX-101', 'https://jira.example.com/')).toBe(
      'https://jira.example.com/browse/TBX-101',
    );
  });

  it('encodes the issue key', () => {
    expect(buildJiraBrowseUrl('TBX 101', 'https://jira.example.com')).toBe(
      'https://jira.example.com/browse/TBX%20101',
    );
  });

  it('falls back to a relative path when no base URL is configured', () => {
    expect(buildJiraBrowseUrl('TBX-101', '')).toBe('/browse/TBX-101');
    expect(buildJiraBrowseUrl('TBX-101', '   ')).toBe('/browse/TBX-101');
  });
});
