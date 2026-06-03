// buildHygieneJqlUrl.test.ts — Unit tests for the Hygiene JQL URL builder utilities.

import { describe, expect, it } from 'vitest';

import type { HygieneCheckId, HygieneFinding } from '../checks/hygieneChecks.ts';
import { buildCheckIssueKeys, buildJiraIssueNavigatorUrl } from './buildHygieneJqlUrl.ts';

function buildFinding(issueKey: string, checkIds: string[]): HygieneFinding {
  return {
    issue: { key: issueKey, fields: {} },
    flags: checkIds.map((checkId) => ({ checkId: checkId as HygieneCheckId, label: checkId, severity: 'warn' as const })),
  };
}

describe('buildCheckIssueKeys', () => {
  it('returns keys of findings flagged with the given check', () => {
    const findings = [
      buildFinding('TBX-1', ['missing-sp']),
      buildFinding('TBX-2', ['no-assignee']),
      buildFinding('TBX-3', ['missing-sp', 'no-ac']),
    ];

    expect(buildCheckIssueKeys('missing-sp', findings)).toEqual(['TBX-1', 'TBX-3']);
  });

  it('returns an empty array when no findings carry the check', () => {
    const findings = [buildFinding('TBX-1', ['missing-sp'])];

    expect(buildCheckIssueKeys('no-assignee', findings)).toEqual([]);
  });

  it('returns an empty array for empty findings input', () => {
    expect(buildCheckIssueKeys('missing-sp', [])).toEqual([]);
  });

  it('returns all keys when every finding carries the check', () => {
    const findings = [
      buildFinding('PROJ-10', ['stale']),
      buildFinding('PROJ-11', ['stale']),
    ];

    expect(buildCheckIssueKeys('stale', findings)).toEqual(['PROJ-10', 'PROJ-11']);
  });

  it('works with custom rule check IDs', () => {
    const findings = [buildFinding('TBX-99', ['custom-required-field-abc'])];

    expect(buildCheckIssueKeys('custom-required-field-abc', findings)).toEqual(['TBX-99']);
  });
});

describe('buildJiraIssueNavigatorUrl', () => {
  it('builds a full navigator URL when a jiraBaseUrl is provided', () => {
    const url = buildJiraIssueNavigatorUrl(['TBX-1', 'TBX-2'], 'https://myorg.atlassian.net');

    expect(url).toBe(
      'https://myorg.atlassian.net/issues/?jql=issueKey%20in%20(TBX-1%2C%20TBX-2)',
    );
  });

  it('strips a trailing slash from the jiraBaseUrl before appending the path', () => {
    const url = buildJiraIssueNavigatorUrl(['TBX-1'], 'https://myorg.atlassian.net/');

    expect(url).toMatch(/^https:\/\/myorg\.atlassian\.net\/issues\//);
    expect(url).not.toContain('//issues/');
  });

  it('returns raw JQL when jiraBaseUrl is null', () => {
    expect(buildJiraIssueNavigatorUrl(['TBX-1', 'TBX-2'], null)).toBe(
      'issueKey in (TBX-1, TBX-2)',
    );
  });

  it('returns raw JQL for a single issue key without a base URL', () => {
    expect(buildJiraIssueNavigatorUrl(['PROJ-42'], null)).toBe('issueKey in (PROJ-42)');
  });

  it('returns raw JQL for an empty key list regardless of base URL', () => {
    expect(buildJiraIssueNavigatorUrl([], 'https://myorg.atlassian.net')).toBe('issueKey in ()');
  });
});
