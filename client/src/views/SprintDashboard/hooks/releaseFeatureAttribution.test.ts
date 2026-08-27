// releaseFeatureAttribution.test.ts — Which Feature each item in a release delivers, defects included.

import { describe, expect, it, vi } from 'vitest';

import {
  buildLinkedIssueFields,
  buildLinkedIssueIndex,
  describeAttributionRoute,
  resolveReleaseFeatureAttribution,
} from './releaseFeatureAttribution.ts';
import { FEATURE_LINK_DEFAULT_FIELD } from '../../../utils/featureLink.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const FEATURE_LINK_FIELD = FEATURE_LINK_DEFAULT_FIELD;

/** An issue carrying only what the attribution reads. */
function issue(
  key: string,
  fields: { typeName?: string; featureKey?: string | null; linkedKeys?: string[] } = {},
): JiraIssue {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      issuetype: { name: fields.typeName ?? 'Story' },
      [FEATURE_LINK_FIELD]: fields.featureKey ?? null,
      issuelinks: (fields.linkedKeys ?? []).map((linkedKey) => ({
        type: { name: 'Relates' },
        outwardIssue: { key: linkedKey },
      })),
    },
  } as unknown as JiraIssue;
}

/** A fetcher serving the given issues, and recording what was asked for. */
function fetcherFor(available: readonly JiraIssue[]) {
  const requestedRounds: string[][] = [];
  const fetch = vi.fn(async (issueKeys: readonly string[]) => {
    requestedRounds.push([...issueKeys]);
    return available.filter((candidate) => issueKeys.includes(candidate.key));
  });
  return { fetch, requestedRounds };
}

describe('buildLinkedIssueFields', () => {
  it('asks for what the precedence chain actually reads', () => {
    const fields = buildLinkedIssueFields(FEATURE_LINK_FIELD);

    expect(fields).toContain('issuetype');
    expect(fields).toContain('issuelinks');
    expect(fields).toContain(FEATURE_LINK_FIELD);
  });
});

describe('resolveReleaseFeatureAttribution', () => {
  it('takes an item at its word when it states its own Feature', async () => {
    const { fetch } = fetcherFor([]);

    const attribution = await resolveReleaseFeatureAttribution(
      [issue('ENCUC-1', { featureKey: 'FEAT-10' })],
      FEATURE_LINK_FIELD,
      fetch,
    );

    expect(attribution.get('ENCUC-1')).toEqual({ featureKey: 'FEAT-10', viaPrecedence: null });
  });

  it('never fetches anything when every item stated its own Feature', async () => {
    // Re-deriving a stated Feature through link precedence could only introduce a disagreement.
    const { fetch } = fetcherFor([]);

    await resolveReleaseFeatureAttribution([issue('ENCUC-1', { featureKey: 'FEAT-10' })], FEATURE_LINK_FIELD, fetch);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('places a defect through the development story it is linked to', async () => {
    // The case a single hop always dropped into "No Feature".
    const devStory = issue('ENCUC-50', { typeName: 'Story', featureKey: 'FEAT-10' });
    const { fetch } = fetcherFor([devStory]);
    const defect = issue('ENCUC-9', { typeName: 'Defect', featureKey: null, linkedKeys: ['ENCUC-50'] });

    const attribution = await resolveReleaseFeatureAttribution([defect], FEATURE_LINK_FIELD, fetch);

    expect(attribution.get('ENCUC-9')).toEqual({ featureKey: 'FEAT-10', viaPrecedence: 'dev-story' });
  });

  it('places a defect linked straight to the Feature', async () => {
    const feature = issue('FEAT-10', { typeName: 'Feature' });
    const { fetch } = fetcherFor([feature]);
    const defect = issue('ENCUC-9', { typeName: 'Defect', featureKey: null, linkedKeys: ['FEAT-10'] });

    const attribution = await resolveReleaseFeatureAttribution([defect], FEATURE_LINK_FIELD, fetch);

    expect(attribution.get('ENCUC-9')?.featureKey).toBe('FEAT-10');
  });

  it('follows defect → QA issue → dev story, which is why a second round exists', async () => {
    // Stopping after one round of fetching would miss exactly the case the chain was built for.
    const qaIssue = issue('QA-5', { typeName: 'Test', featureKey: null, linkedKeys: ['ENCUC-50'] });
    const devStory = issue('ENCUC-50', { typeName: 'Story', featureKey: 'FEAT-10' });
    const { fetch, requestedRounds } = fetcherFor([qaIssue, devStory]);
    const defect = issue('ENCUC-9', { typeName: 'Defect', featureKey: null, linkedKeys: ['QA-5'] });

    const attribution = await resolveReleaseFeatureAttribution([defect], FEATURE_LINK_FIELD, fetch);

    expect(attribution.get('ENCUC-9')).toEqual({ featureKey: 'FEAT-10', viaPrecedence: 'via-qa-issue' });
    expect(requestedRounds).toEqual([['QA-5'], ['ENCUC-50']]);
  });

  it('stops at two rounds, because a third could not change any answer', async () => {
    const { fetch, requestedRounds } = fetcherFor([
      issue('A-1', { linkedKeys: ['A-2'] }),
      issue('A-2', { linkedKeys: ['A-3'] }),
      issue('A-3', { linkedKeys: ['A-4'] }),
      issue('A-4', {}),
    ]);

    await resolveReleaseFeatureAttribution(
      [issue('ENCUC-9', { featureKey: null, linkedKeys: ['A-1'] })],
      FEATURE_LINK_FIELD,
      fetch,
    );

    expect(requestedRounds).toHaveLength(2);
  });

  it('leaves an item with no links unattributed without asking Jira about it', async () => {
    const { fetch } = fetcherFor([]);

    const attribution = await resolveReleaseFeatureAttribution(
      [issue('ENCUC-9', { featureKey: null, linkedKeys: [] })],
      FEATURE_LINK_FIELD,
      fetch,
    );

    expect(attribution.get('ENCUC-9')).toEqual({ featureKey: null, viaPrecedence: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves a defect unattributed when its links lead nowhere, rather than guessing', async () => {
    const unrelated = issue('MISC-1', { typeName: 'Task', featureKey: null });
    const { fetch } = fetcherFor([unrelated]);

    const attribution = await resolveReleaseFeatureAttribution(
      [issue('ENCUC-9', { typeName: 'Defect', featureKey: null, linkedKeys: ['MISC-1'] })],
      FEATURE_LINK_FIELD,
      fetch,
    );

    expect(attribution.get('ENCUC-9')?.featureKey).toBeNull();
  });

  it('keeps the release note when the lookup fails outright', async () => {
    // Attribution improves a table that already renders; losing it to one timed-out lookup would be
    // a poor trade.
    const failingFetch = vi.fn(async () => {
      throw new Error('Jira is unreachable');
    });

    const attribution = await resolveReleaseFeatureAttribution(
      [
        issue('ENCUC-1', { featureKey: 'FEAT-10' }),
        issue('ENCUC-9', { typeName: 'Defect', featureKey: null, linkedKeys: ['ENCUC-50'] }),
      ],
      FEATURE_LINK_FIELD,
      failingFetch,
    );

    expect(attribution.get('ENCUC-1')?.featureKey).toBe('FEAT-10');
    expect(attribution.get('ENCUC-9')?.featureKey).toBeNull();
  });

  it('reports every issue, attributed or not, so nothing is missing downstream', async () => {
    const { fetch } = fetcherFor([]);

    const attribution = await resolveReleaseFeatureAttribution(
      [issue('ENCUC-1', { featureKey: 'FEAT-10' }), issue('ENCUC-2', { featureKey: null })],
      FEATURE_LINK_FIELD,
      fetch,
    );

    expect([...attribution.keys()]).toEqual(['ENCUC-1', 'ENCUC-2']);
  });
});

describe('buildLinkedIssueIndex', () => {
  it('does not re-ask for an issue already in the release', async () => {
    const { fetch, requestedRounds } = fetcherFor([issue('ENCUC-2', {})]);
    const releaseIssues = [
      issue('ENCUC-1', { linkedKeys: ['ENCUC-2'] }),
      issue('ENCUC-2', { linkedKeys: [] }),
    ];

    await buildLinkedIssueIndex(releaseIssues, fetch);

    expect(requestedRounds).toEqual([]);
  });

  it('asks for each linked key once, however many items link to it', async () => {
    const { fetch, requestedRounds } = fetcherFor([issue('ENCUC-50', {})]);

    await buildLinkedIssueIndex(
      [issue('ENCUC-1', { linkedKeys: ['ENCUC-50'] }), issue('ENCUC-2', { linkedKeys: ['ENCUC-50'] })],
      fetch,
    );

    expect(requestedRounds[0]).toEqual(['ENCUC-50']);
  });

  it('returns what it has when a round fails, rather than throwing', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('Jira is unreachable');
    });

    const index = await buildLinkedIssueIndex([issue('ENCUC-1', { linkedKeys: ['ENCUC-50'] })], failingFetch);

    expect([...index.keys()]).toEqual(['ENCUC-1']);
  });
});

describe('describeAttributionRoute', () => {
  it('says nothing for an item that stated its own Feature', () => {
    // Labelling every row would bury the few placements somebody might actually query.
    expect(describeAttributionRoute({ featureKey: 'FEAT-10', viaPrecedence: null })).toBe('');
  });

  it('says nothing for an item nothing could be filed under', () => {
    expect(describeAttributionRoute({ featureKey: null, viaPrecedence: null })).toBe('');
  });

  it('says nothing when the item is not in the map at all', () => {
    expect(describeAttributionRoute(undefined)).toBe('');
  });

  it('names the route a defect took to reach its Feature', () => {
    expect(describeAttributionRoute({ featureKey: 'FEAT-10', viaPrecedence: 'dev-story' }))
      .toBe('via its linked story');
    expect(describeAttributionRoute({ featureKey: 'FEAT-10', viaPrecedence: 'via-qa-issue' }))
      .toBe('via the QA issue and its story');
  });
});
