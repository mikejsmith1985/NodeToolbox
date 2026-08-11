// masterCards.test.ts — Proves the board accounts for every issue exactly once.
//
// SC-001 is the board's central claim: the number of issues shown equals the number Jira has. The
// last assertion here is that claim, expressed arithmetically.

import { describe, expect, it } from 'vitest';
import type { MasterCard } from './rollupBoardTypes.ts';

import { buildMasterCards,
  orderLanesLikePiReview,
} from './masterCards.ts';
import { NO_FEATURE_KEY, type RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** Builds a resolved board item with just the fields grouping cares about. */
function buildItem(key: string, featureKey: string | null): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: `Summary of ${key}`,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey, precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey,
    columnId: '__unmapped__',
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
  };
}

/** Builds a Feature issue as the feature sweep would return it. */
function buildFeature(key: string, summary: string): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary,
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      issuelinks: [],
    },
  } as unknown as JiraIssue;
}

describe('buildMasterCards', () => {
  it('creates one lane per Feature the work rolls up to', () => {
    const items = [buildItem('DEV-1', 'FEAT-1'), buildItem('DEV-2', 'FEAT-1'), buildItem('DEV-3', 'FEAT-2')];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment')], ['FEAT-2', buildFeature('FEAT-2', 'Billing')]]);

    const masterCards = buildMasterCards(items, features);

    expect(masterCards).toHaveLength(2);
    expect(masterCards.find((card) => card.featureKey === 'FEAT-1')?.items).toHaveLength(2);
  });

  it('collects unattributed work in one No Feature lane and counts it', () => {
    const items = [buildItem('DEV-1', 'FEAT-1'), buildItem('DEV-2', null), buildItem('DEV-3', null)];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment')]]);

    const masterCards = buildMasterCards(items, features);
    const noFeatureCard = masterCards.find((card) => card.featureKey === NO_FEATURE_KEY);

    expect(noFeatureCard?.isSynthetic).toBe(true);
    expect(noFeatureCard?.vitals.childCount).toBe(2);
  });

  it('does not invent a No Feature lane when every item is attributed', () => {
    const items = [buildItem('DEV-1', 'FEAT-1')];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment')]]);

    const masterCards = buildMasterCards(items, features);

    expect(masterCards.some((card) => card.featureKey === NO_FEATURE_KEY)).toBe(false);
  });

  it('sorts the No Feature lane last, so hygiene sits below real delivery', () => {
    const items = [buildItem('DEV-2', null), buildItem('DEV-1', 'FEAT-1')];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment')]]);

    const masterCards = buildMasterCards(items, features);

    expect(masterCards[masterCards.length - 1].featureKey).toBe(NO_FEATURE_KEY);
  });

  it('still shows a lane for a Feature it could not read, rather than folding it into No Feature', () => {
    const items = [buildItem('DEV-1', 'FEAT-MISSING')];

    const masterCards = buildMasterCards(items, new Map());

    expect(masterCards[0].featureKey).toBe('FEAT-MISSING');
    expect(masterCards[0].isFeatureUnreadable).toBe(true);
    expect(masterCards[0].vitals.key).toBe('FEAT-MISSING');
  });

  it('creates no lane for a Feature with nothing on this board — the scope is the board, not the backlog', () => {
    const items = [buildItem('DEV-1', 'FEAT-1')];
    const features = new Map([
      ['FEAT-1', buildFeature('FEAT-1', 'Enrolment')],
      ['FEAT-UNUSED', buildFeature('FEAT-UNUSED', 'Nothing here')],
    ]);

    const masterCards = buildMasterCards(items, features);

    expect(masterCards).toHaveLength(1);
  });

  it('accounts for every item exactly once across all lanes (SC-001)', () => {
    const items = [
      buildItem('DEV-1', 'FEAT-1'),
      buildItem('DEV-2', 'FEAT-1'),
      buildItem('DEV-3', 'FEAT-2'),
      buildItem('DEV-4', null),
      buildItem('DEV-5', 'FEAT-MISSING'),
    ];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment')], ['FEAT-2', buildFeature('FEAT-2', 'Billing')]]);

    const masterCards = buildMasterCards(items, features);
    const placedKeys = masterCards.flatMap((card) => card.items.map((item) => item.key));

    expect(placedKeys).toHaveLength(items.length);
    expect(new Set(placedKeys).size).toBe(items.length);
  });

  it('reads the Feature\'s own summary and priority for the lane header', () => {
    const items = [buildItem('DEV-1', 'FEAT-1')];
    const features = new Map([['FEAT-1', buildFeature('FEAT-1', 'Enrolment revamp')]]);

    const [masterCard] = buildMasterCards(items, features);

    expect(masterCard.vitals.summary).toBe('Enrolment revamp');
    expect(masterCard.vitals.priorityName).toBe('High');
  });

  it('states that an unreadable Feature has no priority rather than showing a blank one', () => {
    const [masterCard] = buildMasterCards([buildItem('DEV-1', 'FEAT-MISSING')], new Map());

    expect(masterCard.vitals.priorityName).toBeNull();
    expect(masterCard.vitals.storyPoints).toBeNull();
  });
});

describe('orderLanesLikePiReview — one sequence, not two', () => {
  /** A lane, real or not, reduced to what the ordering cares about. */
  function makeCard(featureKey: string, isSynthetic = false): MasterCard {
    return {
      featureKey,
      isSynthetic,
      featureIssue: null,
      isFeatureUnreadable: false,
      vitals: {} as MasterCard['vitals'],
      items: [],
    };
  }

  it('interleaves Features with no work among those that have it, by key', () => {
    // DENP-1387 has no work and used to be appended last; PI Review lists it first.
    const ordered = orderLanesLikePiReview([
      makeCard('DENP-1393'),
      makeCard('DENP-1420'),
      makeCard('DENP-1387'),
    ]);

    expect(ordered.map((card) => card.featureKey)).toEqual(['DENP-1387', 'DENP-1393', 'DENP-1420']);
  });

  it('sorts numerically, so DENP-99 comes before DENP-100', () => {
    const ordered = orderLanesLikePiReview([makeCard('DENP-100'), makeCard('DENP-99')]);
    expect(ordered.map((card) => card.featureKey)).toEqual(['DENP-99', 'DENP-100']);
  });

  it('keeps No Feature last, since it is a hygiene bucket rather than a Feature', () => {
    const ordered = orderLanesLikePiReview([
      makeCard(NO_FEATURE_KEY, true),
      makeCard('DENP-1393'),
    ]);

    expect(ordered[ordered.length - 1].featureKey).toBe(NO_FEATURE_KEY);
  });

  it('survives an empty board', () => {
    expect(orderLanesLikePiReview([])).toEqual([]);
  });
});

describe('orderLanesLikePiReview — one lane per Feature, always', () => {
  /** A lane, real or not, reduced to what deduplication cares about. */
  function makeLane(featureKey: string, itemCount: number): MasterCard {
    return {
      featureKey,
      isSynthetic: false,
      featureIssue: null,
      isFeatureUnreadable: false,
      vitals: {} as MasterCard['vitals'],
      items: Array.from({ length: itemCount }, () => ({}) as MasterCard['items'][number]),
    };
  }

  it('keeps only one lane when a Feature arrives twice', () => {
    // Two headers for one Feature also means a collapse toggle that appears not to work, because it
    // flips both at once.
    const ordered = orderLanesLikePiReview([makeLane('DENP-1414', 22), makeLane('DENP-1414', 0)]);

    expect(ordered).toHaveLength(1);
  });

  it('keeps the lane that carries the work, whichever order they arrive in', () => {
    expect(orderLanesLikePiReview([makeLane('DENP-1414', 0), makeLane('DENP-1414', 22)])[0].items)
      .toHaveLength(22);
    expect(orderLanesLikePiReview([makeLane('DENP-1414', 22), makeLane('DENP-1414', 0)])[0].items)
      .toHaveLength(22);
  });

  it('leaves distinct Features alone', () => {
    const ordered = orderLanesLikePiReview([makeLane('DENP-2', 1), makeLane('DENP-1', 0)]);
    expect(ordered.map((card) => card.featureKey)).toEqual(['DENP-1', 'DENP-2']);
  });
});
