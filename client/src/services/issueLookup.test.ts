// issueLookup.test.ts — Unit tests for the single-issue-by-key fetch path.

import { describe, expect, it } from 'vitest';

import { buildIssueLookupPath, extractHttpStatus } from './issueLookup.ts';

describe('buildIssueLookupPath', () => {
  it('requests the issue resource by key with a fields query', () => {
    expect(buildIssueLookupPath('ENCUC-1234').startsWith('/rest/api/2/issue/ENCUC-1234?fields=')).toBe(true);
  });

  it('includes the core fields the detail panel renders', () => {
    const path = buildIssueLookupPath('ENCUC-1234');
    for (const field of [
      'summary', 'status', 'priority', 'assignee', 'issuetype', 'description',
      'issuelinks', 'labels', 'fixVersions', 'comment',
    ]) {
      expect(path).toContain(field);
    }
  });

  it('requests both story-point custom fields (instances differ)', () => {
    const path = buildIssueLookupPath('ENCUC-1234');
    expect(path).toContain('customfield_10028');
    expect(path).toContain('customfield_10016');
  });

  it('does not request an expand', () => {
    expect(buildIssueLookupPath('ENCUC-1234')).not.toContain('expand=');
  });

  it('url-encodes the issue key', () => {
    expect(buildIssueLookupPath('AB C-1')).toContain('AB%20C-1');
  });
});

describe('extractHttpStatus', () => {
  it('reads a bare status code from a jiraGet error', () => {
    expect(extractHttpStatus(new Error('Jira GET /x failed: 404'))).toBe(404);
  });

  it('reads a status code that is followed by Jira error detail', () => {
    expect(extractHttpStatus(new Error('Jira GET /x failed: 403 — Forbidden'))).toBe(403);
  });

  it('returns null when there is no recognizable status', () => {
    expect(extractHttpStatus(new Error('network down'))).toBeNull();
  });

  it('returns null for non-Error input', () => {
    expect(extractHttpStatus('boom')).toBeNull();
  });
});
