// normalizeIssueKey.test.ts — Unit tests for canonicalizing raw lookup input into a Jira issue key.

import { describe, expect, it } from 'vitest';

import { normalizeIssueKey } from './normalizeIssueKey.ts';

describe('normalizeIssueKey', () => {
  it('trims surrounding whitespace and upper-cases a plain key', () => {
    expect(normalizeIssueKey(' encuc-1234 ')).toEqual({ key: 'ENCUC-1234' });
  });

  it('passes an already-canonical key through unchanged', () => {
    expect(normalizeIssueKey('ENCUC-1234')).toEqual({ key: 'ENCUC-1234' });
  });

  it('extracts the key from a pasted Jira browse URL', () => {
    expect(normalizeIssueKey('https://jira.example.com/browse/ENCUC-1234')).toEqual({ key: 'ENCUC-1234' });
  });

  it('extracts and upper-cases from a browse URL carrying a query string', () => {
    expect(normalizeIssueKey('https://jira.example.com/browse/encuc-1234?filter=99')).toEqual({ key: 'ENCUC-1234' });
  });

  it('accepts alphanumeric project codes', () => {
    expect(normalizeIssueKey('ab12-9')).toEqual({ key: 'AB12-9' });
  });

  it('returns null for free text that is not a key', () => {
    expect(normalizeIssueKey('hello world')).toEqual({ key: null });
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(normalizeIssueKey('   ')).toEqual({ key: null });
  });
});
