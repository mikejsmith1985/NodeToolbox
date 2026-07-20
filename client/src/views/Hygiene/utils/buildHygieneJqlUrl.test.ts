// buildHygieneJqlUrl.test.ts — Unit tests for the Hygiene JQL URL builder utilities.

import { describe, expect, it } from 'vitest';

import type { HygieneCheckId, HygieneFinding, HygieneFieldConfig } from '../checks/hygieneChecks.ts';
import { FIX_VERSION_ISSUE_TYPE_NAMES } from '../checks/hygieneChecks.ts';
import {
  buildCheckIssueKeys,
  buildHygieneCheckClause,
  buildHygieneCheckJql,
  buildJiraIssueNavigatorUrl,
  buildJiraSearchUrl,
} from './buildHygieneJqlUrl.ts';

// A minimal field config with the two configured ids the US2 tests exercise.
const US2_FIELD_CONFIG = {
  productOwnerFieldIds: ['customfield_10062'],
  programIncrementFieldIds: [],
} as unknown as HygieneFieldConfig;

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

describe('buildHygieneCheckClause (US2 — semantic per-family JQL)', () => {
  it('builds the fix-version clause from the SAME exported type constant (agree by construction, N1)', () => {
    const clause = buildHygieneCheckClause('missing-fix-version', US2_FIELD_CONFIG);
    expect(clause).toContain('fixVersions is EMPTY');
    for (const issueTypeName of FIX_VERSION_ISSUE_TYPE_NAMES) {
      expect(clause).toContain(issueTypeName);
    }
    expect(clause).not.toContain('sub-task');
  });

  it('builds native-field EMPTY clauses', () => {
    expect(buildHygieneCheckClause('missing-summary', US2_FIELD_CONFIG)).toBe('summary is EMPTY');
    expect(buildHygieneCheckClause('no-assignee', US2_FIELD_CONFIG)).toBe('assignee is EMPTY');
    expect(buildHygieneCheckClause('missing-due-date', US2_FIELD_CONFIG)).toBe('duedate is EMPTY');
  });

  it('builds a configured-field EMPTY clause using the scan field id', () => {
    expect(buildHygieneCheckClause('missing-product-owner', US2_FIELD_CONFIG)).toBe('cf[10062] is EMPTY');
  });

  it('returns null when the configured field has no id, and for unmapped families', () => {
    expect(buildHygieneCheckClause('missing-pi', US2_FIELD_CONFIG)).toBeNull();
    expect(buildHygieneCheckClause('some-custom-check', US2_FIELD_CONFIG)).toBeNull();
  });
});

describe('buildHygieneCheckJql', () => {
  it('composes scope AND family clause', () => {
    const jql = buildHygieneCheckJql('no-assignee', 'project=ABC AND statusCategory != Done', US2_FIELD_CONFIG);
    expect(jql).toBe('(project=ABC AND statusCategory != Done) AND (assignee is EMPTY)');
  });

  it('returns null when the family has no clause', () => {
    expect(buildHygieneCheckJql('some-custom-check', 'project=ABC', US2_FIELD_CONFIG)).toBeNull();
  });
});

describe('buildJiraSearchUrl', () => {
  it('encodes a raw JQL into an issue-navigator URL', () => {
    expect(buildJiraSearchUrl('assignee is EMPTY', 'https://jira.example.com/')).toBe(
      `https://jira.example.com/issues/?jql=${encodeURIComponent('assignee is EMPTY')}`,
    );
  });

  it('falls back to the raw JQL when no base URL is configured', () => {
    expect(buildJiraSearchUrl('assignee is EMPTY', null)).toBe('assignee is EMPTY');
  });
});
