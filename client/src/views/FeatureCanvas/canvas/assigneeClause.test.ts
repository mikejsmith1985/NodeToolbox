// assigneeClause.test.ts — Verifies JQL assignee identifier resolution across Cloud and Data Center.

import { describe, expect, it } from 'vitest';

import type { JiraUser } from '../../../types/jira.ts';
import { buildAssigneeClause, resolveUserJqlIdentifier } from './assigneeClause.ts';

function buildUser(overrides: Partial<JiraUser> = {}): JiraUser {
  return { accountId: '', displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', avatarUrls: {}, ...overrides };
}

describe('assigneeClause', () => {
  it('prefers the Cloud accountId', () => {
    const user = buildUser({ accountId: '557058:abc', name: 'ada', key: 'ada-key' });
    expect(resolveUserJqlIdentifier(user)).toBe('557058:abc');
  });

  it('falls back to the Data Center username, then the user key', () => {
    expect(resolveUserJqlIdentifier(buildUser({ accountId: '', name: 'ada' }))).toBe('ada');
    expect(resolveUserJqlIdentifier(buildUser({ accountId: '', name: '', key: 'ada-key' }))).toBe('ada-key');
  });

  it('returns null when no identifier is present', () => {
    expect(resolveUserJqlIdentifier(buildUser({ accountId: '', name: '', key: '' }))).toBeNull();
    expect(buildAssigneeClause(buildUser({ accountId: '', name: '', key: '' }))).toBeNull();
  });

  it('builds a quoted assignee clause', () => {
    expect(buildAssigneeClause(buildUser({ accountId: '557058:abc' }))).toBe('assignee = "557058:abc"');
  });
});
