// repoStoryBreakdown.test.ts — Deterministic repo-only story generation (spec 031, US3).

import { describe, expect, it } from 'vitest';

import { buildRepoStoryAcceptedByFeature, buildRepoStoryProposals } from './repoStoryBreakdown.ts';
import type { ComponentKind } from '../../AdminHub/lib/componentClassificationStore.ts';
import type { ExistingChild, FeatureInput } from './piPlanTypes.ts';

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

describe('buildRepoStoryAcceptedByFeature', () => {
  function feature(over: Partial<FeatureInput>): FeatureInput {
    return {
      key: 'DENP-1', summary: 'Member Enrollment Enhancement', sizePoints: 8, priorityRank: 1,
      priorityName: null, isCommitted: false, dependencyKeys: [], targetFixVersion: null, existingChildren: [],
      repoComponentNames: [], ...over,
    };
  }

  it('produces one StorySuggestion per repo, splitting the size, keyed by Feature', () => {
    const getKind = kindLookup(['payments-api', 'ui-web']);
    const accepted = buildRepoStoryAcceptedByFeature(
      [feature({ repoComponentNames: ['payments-api', 'ui-web'], sizePoints: 8 })],
      getKind,
    );
    expect(accepted['DENP-1'].map((s) => s.summary)).toEqual([
      'Member Enrollment Enhancement (payments-api)',
      'Member Enrollment Enhancement (ui-web)',
    ]);
    expect(accepted['DENP-1'][0].sizePoints).toBe(4); // 8 split across 2 repos
    expect(accepted['DENP-1'][0].hasTestableOutput).toBe(true);
  });

  it('omits a Feature with no repo components', () => {
    const accepted = buildRepoStoryAcceptedByFeature([feature({ repoComponentNames: [] })], kindLookup([]));
    expect(accepted['DENP-1']).toBeUndefined();
  });

  it('carries the idempotency match from an existing child Story', () => {
    const accepted = buildRepoStoryAcceptedByFeature(
      [feature({
        repoComponentNames: ['payments-api'],
        existingChildren: [{ key: 'DENP-9', kind: 'story', parentKey: 'DENP-1', summary: 'Member Enrollment Enhancement (payments-api)' }],
      })],
      kindLookup(['payments-api']),
    );
    expect(accepted['DENP-1'][0].matchExistingKey).toBe('DENP-9');
  });
});
