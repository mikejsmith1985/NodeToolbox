// githubIdRosterImport.test.ts — Tests for parsing the pasted GitHub-id list and matching each id to a
// roster member by name. The fixtures mirror the real GH #218 block and the roster's
// "Lastname, First (CTR)" display-name convention.

import { describe, expect, it } from 'vitest';

import {
  buildGithubIdLinkedDraft,
  matchGithubIdRowsToMembers,
  parseGithubIdRoster,
  type ParsedGithubIdRow,
} from './githubIdRosterImport.ts';
import type { StandupRosterMember } from './hooks/useStandupRosterStore.ts';

// A trimmed slice of the real GH #218 markdown table, including its header and separator rows.
const GH218_MARKDOWN_BLOCK = `Member | ID | Team
-- | -- | --
Anup | C13309_Zilver | Transformers
Brett | C56836_Zilver | CUC
Param | C13471_Zilver | Transformers`;

function buildMember(overrides: Partial<StandupRosterMember>): StandupRosterMember {
  return {
    id: overrides.id ?? `roster-member:${(overrides.displayName ?? 'x').toLowerCase()}`,
    displayName: overrides.displayName ?? 'Doe, Jane (CTR)',
    assigneeQueryValue: overrides.assigneeQueryValue ?? overrides.displayName ?? 'Doe, Jane (CTR)',
    ...overrides,
  };
}

describe('parseGithubIdRoster', () => {
  it('parses a markdown table, skipping the header and separator rows', () => {
    expect(parseGithubIdRoster(GH218_MARKDOWN_BLOCK)).toEqual<ParsedGithubIdRow[]>([
      { memberName: 'Anup', githubAccountId: 'C13309_Zilver', teamName: 'Transformers' },
      { memberName: 'Brett', githubAccountId: 'C56836_Zilver', teamName: 'CUC' },
      { memberName: 'Param', githubAccountId: 'C13471_Zilver', teamName: 'Transformers' },
    ]);
  });

  it('parses tab-separated rows pasted straight from a spreadsheet', () => {
    const pasted = 'Anup\tC13309_Zilver\tTransformers\nParam\tC13471_Zilver\tCUC';
    expect(parseGithubIdRoster(pasted)).toEqual<ParsedGithubIdRow[]>([
      { memberName: 'Anup', githubAccountId: 'C13309_Zilver', teamName: 'Transformers' },
      { memberName: 'Param', githubAccountId: 'C13471_Zilver', teamName: 'CUC' },
    ]);
  });

  it('treats a missing team column as no team', () => {
    expect(parseGithubIdRoster('Anup | C13309_Zilver')).toEqual<ParsedGithubIdRow[]>([
      { memberName: 'Anup', githubAccountId: 'C13309_Zilver', teamName: undefined },
    ]);
  });

  it('de-duplicates by GitHub id, keeping the first occurrence', () => {
    const pasted = 'Anup | C13309_Zilver | Transformers\nAnup Again | c13309_zilver | CUC';
    expect(parseGithubIdRoster(pasted)).toHaveLength(1);
  });

  it('ignores rows whose id column contains whitespace (not a real login)', () => {
    expect(parseGithubIdRoster('Anup | not an id | Transformers')).toEqual([]);
  });

  it('ignores blank lines', () => {
    expect(parseGithubIdRoster('\n\nAnup | C13309_Zilver\n\n')).toHaveLength(1);
  });
});

describe('matchGithubIdRowsToMembers', () => {
  const members: StandupRosterMember[] = [
    buildMember({ id: 'm-param', displayName: 'Sandhu, Param (CTR)' }),
    buildMember({ id: 'm-anup', displayName: 'Kumar, Anup (CTR)' }),
  ];

  it('suggests the single member whose display name contains the first name', () => {
    const [proposal] = matchGithubIdRowsToMembers(
      [{ memberName: 'Param', githubAccountId: 'C13471_Zilver' }],
      members,
    );
    expect(proposal.suggestedMemberId).toBe('m-param');
    expect(proposal.candidateMemberIds).toEqual(['m-param']);
  });

  it('leaves the suggestion null but lists every candidate when a name is ambiguous', () => {
    const ambiguousRoster: StandupRosterMember[] = [
      buildMember({ id: 'm-param-1', displayName: 'Sandhu, Param (CTR)' }),
      buildMember({ id: 'm-param-2', displayName: 'Patel, Param (CTR)' }),
    ];
    const [proposal] = matchGithubIdRowsToMembers(
      [{ memberName: 'Param', githubAccountId: 'C13471_Zilver' }],
      ambiguousRoster,
    );
    expect(proposal.suggestedMemberId).toBeNull();
    expect(proposal.candidateMemberIds).toEqual(['m-param-1', 'm-param-2']);
  });

  it('returns no candidates and a null suggestion when nobody matches', () => {
    const [proposal] = matchGithubIdRowsToMembers(
      [{ memberName: 'Nobody', githubAccountId: 'C00000_Zilver' }],
      members,
    );
    expect(proposal.suggestedMemberId).toBeNull();
    expect(proposal.candidateMemberIds).toEqual([]);
  });
});

describe('buildGithubIdLinkedDraft', () => {
  it('stamps the GitHub id on while preserving the existing Jira identity and roles', () => {
    const member = buildMember({
      id: 'm-param',
      displayName: 'Sandhu, Param (CTR)',
      assigneeQueryValue: 'Sandhu, Param (CTR)',
      jiraAccountId: 'jira-param-777',
      teamName: 'Transformers',
      roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false },
    });

    const draft = buildGithubIdLinkedDraft(member, 'C13471_Zilver', 'CUC');

    expect(draft.githubAccountId).toBe('C13471_Zilver');
    expect(draft.jiraAccountId).toBe('jira-param-777');
    expect(draft.roleCapabilities).toEqual({ canDevelop: true, canInternalTest: false, canExternalTest: false });
    // The member already had a team, so the pasted fallback must NOT overwrite it.
    expect(draft.teamName).toBe('Transformers');
  });

  it('fills the team from the pasted row only when the member has none', () => {
    const member = buildMember({ id: 'm-anup', displayName: 'Kumar, Anup (CTR)' });
    const draft = buildGithubIdLinkedDraft(member, 'C13309_Zilver', 'Transformers');
    expect(draft.teamName).toBe('Transformers');
  });
});
