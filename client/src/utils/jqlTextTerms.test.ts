// jqlTextTerms.test.ts — Proves free text becomes terms Jira's `~` operator accepts and matches.

import { describe, expect, it } from 'vitest';

import { buildIssueTextMatchTerms, JIRA_TEXT_RESERVED_PATTERN } from './jqlTextTerms.ts';

describe('buildIssueTextMatchTerms', () => {
  it('strips reserved characters so a key-and-colon summary cannot produce a 400', () => {
    expect(buildIssueTextMatchTerms('ENCUC-1972: Critical')).toBe('ENCUC 1972 Critical*');
  });

  it('wildcards only the last term by default, because that is the word still being typed', () => {
    expect(buildIssueTextMatchTerms('critical vuln')).toBe('critical vuln*');
  });

  it('leaves a single-character last term whole, since one letter plus a wildcard matches nearly everything', () => {
    expect(buildIssueTextMatchTerms('critical v')).toBe('critical v');
  });

  it('adds no wildcard when the caller has finished phrases rather than live typing', () => {
    expect(buildIssueTextMatchTerms('ENCUC-1972: Critical', { shouldWildcardLastTerm: false })).toBe('ENCUC 1972 Critical');
  });

  it('returns null when nothing usable survives the reserved characters', () => {
    expect(buildIssueTextMatchTerms(' ":-* ')).toBeNull();
    expect(buildIssueTextMatchTerms('', { shouldWildcardLastTerm: false })).toBeNull();
  });

  it('exposes the reserved pattern as a global expression covering quotes and wildcards', () => {
    expect('a"b*c'.replace(JIRA_TEXT_RESERVED_PATTERN, ' ')).toBe('a b c');
  });
});
