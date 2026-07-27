// repoStoryBreakdown.test.ts — Deterministic repo-only story generation (spec 031, US3).

import { describe, expect, it } from 'vitest';

import { buildRepoStoryProposals } from './repoStoryBreakdown.ts';
import type { ComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';
import type { ExistingChild } from './piPlanTypes.ts';

const FEATURE = { key: 'DENP-1', summary: 'Member Enrollment Enhancement' };

/** A classification lookup where the named repos are 'repo', Enrollment is 'domain', the rest unclassified. */
function kindLookup(repos: string[], domains: string[] = []): (name: string) => ComponentKind | null {
  const repoSet = new Set(repos.map((r) => r.toLowerCase()));
  const domainSet = new Set(domains.map((d) => d.toLowerCase()));
  return (name) => (repoSet.has(name.toLowerCase()) ? 'repo' : domainSet.has(name.toLowerCase()) ? 'domain' : null);
}

describe('buildRepoStoryProposals', () => {
  it('creates one story per repo, titled "{summary} ({repo})", and none for domain/unclassified', () => {
    const getKind = kindLookup(['payments-api', 'ui-web'], ['Enrollment']);
    const result = buildRepoStoryProposals(
      FEATURE,
      ['payments-api', 'ui-web', 'Enrollment', 'mystery-tag'],
      [],
      getKind,
    );
    expect(result.proposals.map((p) => p.title)).toEqual([
      'Member Enrollment Enhancement (payments-api)',
      'Member Enrollment Enhancement (ui-web)',
    ]);
    expect(result.proposals.every((p) => p.matchExistingKey === null)).toBe(true);
    expect(result.honestStates).toEqual([]);
  });

  it('carries each proposal\'s single repo name (for the components write)', () => {
    const result = buildRepoStoryProposals(FEATURE, ['payments-api'], [], kindLookup(['payments-api']));
    expect(result.proposals[0].repoName).toBe('payments-api');
  });

  it('yields zero stories and an honest state when there are no repo components', () => {
    const result = buildRepoStoryProposals(FEATURE, ['Enrollment', 'mystery-tag'], [], kindLookup([], ['Enrollment']));
    expect(result.proposals).toEqual([]);
    expect(result.honestStates[0]).toMatch(/map repos first/i);
  });

  it('is idempotent — a repo with a matching existing child Story is linked, not duplicated', () => {
    const existing: ExistingChild[] = [
      { key: 'DENP-9', kind: 'story', parentKey: 'DENP-1', summary: 'Member Enrollment Enhancement (payments-api)' },
    ];
    const result = buildRepoStoryProposals(FEATURE, ['payments-api', 'ui-web'], existing, kindLookup(['payments-api', 'ui-web']));
    const byRepo = Object.fromEntries(result.proposals.map((p) => [p.repoName, p.matchExistingKey]));
    expect(byRepo['payments-api']).toBe('DENP-9'); // matched existing → caller skips creation
    expect(byRepo['ui-web']).toBeNull();           // genuinely new
  });

  it('re-classifying a repo to domain stops it generating (evaluated at generation time)', () => {
    // payments-api is no longer a repo in this lookup.
    const result = buildRepoStoryProposals(FEATURE, ['payments-api'], [], kindLookup([], ['payments-api']));
    expect(result.proposals).toEqual([]);
  });

  it('de-duplicates repeated components in the input', () => {
    const result = buildRepoStoryProposals(FEATURE, ['payments-api', 'PAYMENTS-API'], [], kindLookup(['payments-api']));
    expect(result.proposals).toHaveLength(1);
  });
});
