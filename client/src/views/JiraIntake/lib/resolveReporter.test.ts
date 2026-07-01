// resolveReporter.test.ts — Covers the matched path and every fallback branch (no email, no match,
// ambiguous match, search error, user without a username).

import { describe, expect, it, vi } from 'vitest';

import { resolveReporter } from './resolveReporter.ts';
import type { JiraUser } from '../../../types/jira.ts';

function user(partial: Partial<JiraUser>): JiraUser {
  return { accountId: '', displayName: '', emailAddress: '', avatarUrls: {}, ...partial };
}

describe('resolveReporter', () => {
  it('matches a unique user by email (case-insensitive) and returns the DC username', async () => {
    const searchUsers = vi.fn().mockResolvedValue([user({ name: 'msmith', emailAddress: 'Michael_Smith3@hcsc.com' })]);
    const result = await resolveReporter('michael_smith3@hcsc.com', { searchUsers });
    expect(result).toEqual({ outcome: 'matched', reporter: { name: 'msmith' } });
    expect(searchUsers).toHaveBeenCalledWith('michael_smith3@hcsc.com');
  });

  it('falls back when the email is blank (no search performed)', async () => {
    const searchUsers = vi.fn();
    const result = await resolveReporter('   ', { searchUsers });
    expect(result.outcome).toBe('fallback');
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it('falls back when no user matches the email', async () => {
    const searchUsers = vi.fn().mockResolvedValue([user({ name: 'other', emailAddress: 'other@corp.com' })]);
    const result = await resolveReporter('nobody@corp.com', { searchUsers });
    expect(result.outcome).toBe('fallback');
  });

  it('falls back when more than one user matches the email', async () => {
    const searchUsers = vi.fn().mockResolvedValue([
      user({ name: 'a', emailAddress: 'dup@corp.com' }),
      user({ name: 'b', emailAddress: 'dup@corp.com' }),
    ]);
    const result = await resolveReporter('dup@corp.com', { searchUsers });
    expect(result.outcome).toBe('fallback');
  });

  it('falls back (never throws) when the search itself errors', async () => {
    const searchUsers = vi.fn().mockRejectedValue(new Error('proxy down'));
    const result = await resolveReporter('m@corp.com', { searchUsers });
    expect(result.outcome).toBe('fallback');
  });

  it('uses the user key when name is absent', async () => {
    const searchUsers = vi.fn().mockResolvedValue([user({ key: 'JIRAUSER123', emailAddress: 'k@corp.com' })]);
    const result = await resolveReporter('k@corp.com', { searchUsers });
    expect(result).toEqual({ outcome: 'matched', reporter: { name: 'JIRAUSER123' } });
  });
});
