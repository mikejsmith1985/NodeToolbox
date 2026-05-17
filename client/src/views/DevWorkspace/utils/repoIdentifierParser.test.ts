// repoIdentifierParser.test.ts — Unit tests for repo URL/identifier normalization.

import { describe, expect, it } from 'vitest';

import { parseRepoIdentifiersFromInput } from './repoIdentifierParser.ts';

describe('parseRepoIdentifiersFromInput', () => {
  it('normalizes mixed owner/repo and GitHub URL inputs', () => {
    const parsedRepos = parseRepoIdentifiersFromInput(
      'https://github.com/octocat/hello-world\nocto-org/platform-api,git@github.com:octo-org/web-client.git'
    );
    expect(parsedRepos).toEqual([
      'octocat/hello-world',
      'octo-org/platform-api',
      'octo-org/web-client',
    ]);
  });

  it('filters invalid repo inputs and de-duplicates matches', () => {
    const parsedRepos = parseRepoIdentifiersFromInput(
      'https://github.com/octocat/hello-world\nhttps://github.com/octocat/hello-world/issues\nnot-a-repo'
    );
    expect(parsedRepos).toEqual(['octocat/hello-world']);
  });

  it('normalizes full GitHub URLs with deeper paths to owner/repo', () => {
    const parsedRepos = parseRepoIdentifiersFromInput(
      'https://github.com/zilvertonz/usmg-facets-enrollment/tree/main/src/app'
    );
    expect(parsedRepos).toEqual(['zilvertonz/usmg-facets-enrollment']);
  });
});
