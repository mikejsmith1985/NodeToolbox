// featureScope.test.ts — Proves the board only shows the Features a team actually tracks, and that
// what it leaves out is left out for a stated reason.
//
// The distinction that carries this: a Feature reached through the Feature Link FIELD is a
// deliberate, structural statement about the work. A Feature reached only by a "relates to" issue
// link is an inference. The first is trusted even when it points outside the team's projects — that
// is not supposed to happen, and hiding it would hide the evidence. The second is noise until the
// viewer asks for it.

import { describe, expect, it } from 'vitest';

import {
  applyFeatureScope,
  isAuthoritativeFeatureRoute,
  type FeatureScopeSettings,
} from './featureScope.ts';
import type { RollUpRoute, RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const FEATURE_LINK_FIELD = 'customfield_10108';

/** A Story carrying the Feature Link field — the authoritative route. */
function buildFeatureLinkRoute(featureKey: string): RollUpRoute {
  return {
    steps: [{ kind: 'featureLink', fieldId: FEATURE_LINK_FIELD, toKey: featureKey }],
    featureKey,
    precedenceRank: null,
    unchosenCandidates: [],
    notes: [],
  };
}

/** A sub-task inheriting its parent's Feature Link — still authoritative. */
function buildParentRoute(featureKey: string): RollUpRoute {
  return {
    steps: [
      { kind: 'parent', toKey: 'DEV-1' },
      { kind: 'featureLink', fieldId: FEATURE_LINK_FIELD, toKey: featureKey },
    ],
    featureKey,
    precedenceRank: null,
    unchosenCandidates: [],
    notes: [],
  };
}

/** A defect reaching the Feature through a Story that IS properly linked — anchored, so authoritative. */
function buildDefectViaStoryRoute(featureKey: string): RollUpRoute {
  return {
    steps: [
      { kind: 'issueLink', linkTypeName: 'Relates', toKey: 'DEV-1' },
      { kind: 'featureLink', fieldId: FEATURE_LINK_FIELD, toKey: featureKey },
    ],
    featureKey,
    precedenceRank: 'dev-story',
    unchosenCandidates: [],
    notes: [],
  };
}

/** A defect linked straight to the Feature by "relates to" — inferred, nothing structural behind it. */
function buildDefectDirectLinkRoute(featureKey: string): RollUpRoute {
  return {
    steps: [{ kind: 'issueLink', linkTypeName: 'Relates', toKey: featureKey }],
    featureKey,
    precedenceRank: 'direct-feature',
    unchosenCandidates: [],
    notes: [],
  };
}

function buildItem(key: string, route: RollUpRoute): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route,
    featureKey: route.featureKey,
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

/** Transformers: one Feature project. */
const SINGLE_PROJECT_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: ['ENCUC'],
  shouldIncludeIssueLinkedFeatures: false,
};

/** Cleanup Crew: two Feature projects. */
const TWO_PROJECT_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: ['ENCUC', 'DENP'],
  shouldIncludeIssueLinkedFeatures: false,
};

/** Nothing configured — every Feature counts, which is how the board behaved before scoping existed. */
const UNCONFIGURED_SCOPE: FeatureScopeSettings = {
  featureProjectKeys: [],
  shouldIncludeIssueLinkedFeatures: false,
};

describe('isAuthoritativeFeatureRoute', () => {
  it('trusts a Story carrying the Feature Link field', () => {
    expect(isAuthoritativeFeatureRoute(buildFeatureLinkRoute('ENCUC-1'))).toBe(true);
  });

  it('trusts a sub-task that inherited its parent\'s Feature Link', () => {
    expect(isAuthoritativeFeatureRoute(buildParentRoute('ENCUC-1'))).toBe(true);
  });

  it('trusts a defect whose route ends at a Story\'s Feature Link', () => {
    // The anchor at the end is a real Feature Link — the defect is just attached to the story.
    expect(isAuthoritativeFeatureRoute(buildDefectViaStoryRoute('ENCUC-1'))).toBe(true);
  });

  it('does NOT trust a defect linked straight to a Feature by a plain issue link', () => {
    expect(isAuthoritativeFeatureRoute(buildDefectDirectLinkRoute('ENCUC-1'))).toBe(false);
  });

  it('does not treat unattributed work as authoritative', () => {
    expect(isAuthoritativeFeatureRoute({
      steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes: [],
    })).toBe(false);
  });
});

describe('applyFeatureScope — a team that tracks one project', () => {
  it('keeps work whose Feature is in the configured project', () => {
    const result = applyFeatureScope([buildItem('DEV-1', buildFeatureLinkRoute('ENCUC-9'))], SINGLE_PROJECT_SCOPE);

    expect(result.items.map((item) => item.key)).toEqual(['DEV-1']);
    expect(result.hiddenIssueCount).toBe(0);
  });

  it('still shows an out-of-project Feature when the Feature Link field says so', () => {
    // "It shouldn't happen" — so when it does, the board is the place it becomes visible.
    const result = applyFeatureScope([buildItem('DEV-1', buildFeatureLinkRoute('OTHER-9'))], SINGLE_PROJECT_SCOPE);

    expect(result.items.map((item) => item.key)).toEqual(['DEV-1']);
    expect(result.outOfScopeFeatureKeys).toContain('OTHER-9');
  });

  it('hides an out-of-project Feature reached only by an issue link', () => {
    const result = applyFeatureScope([buildItem('BUG-1', buildDefectDirectLinkRoute('OTHER-9'))], SINGLE_PROJECT_SCOPE);

    expect(result.items).toEqual([]);
    expect(result.hiddenIssueCount).toBe(1);
  });

  it('reveals those issue-linked Features when the viewer asks for them', () => {
    const result = applyFeatureScope(
      [buildItem('BUG-1', buildDefectDirectLinkRoute('OTHER-9'))],
      { ...SINGLE_PROJECT_SCOPE, shouldIncludeIssueLinkedFeatures: true },
    );

    expect(result.items.map((item) => item.key)).toEqual(['BUG-1']);
    expect(result.hiddenIssueCount).toBe(0);
  });

  it('keeps an IN-project Feature reached by an issue link, toggle or not', () => {
    // The toggle is about other people's projects, not about how the link was made.
    const result = applyFeatureScope([buildItem('BUG-1', buildDefectDirectLinkRoute('ENCUC-9'))], SINGLE_PROJECT_SCOPE);

    expect(result.items.map((item) => item.key)).toEqual(['BUG-1']);
  });
});

describe('applyFeatureScope — a team that tracks two projects', () => {
  it('keeps Features from either configured project', () => {
    const result = applyFeatureScope(
      [buildItem('DEV-1', buildFeatureLinkRoute('ENCUC-9')), buildItem('DEV-2', buildFeatureLinkRoute('DENP-4'))],
      TWO_PROJECT_SCOPE,
    );

    expect(result.items.map((item) => item.key)).toEqual(['DEV-1', 'DEV-2']);
  });

  it('still hides a third project\'s issue-linked Feature', () => {
    const result = applyFeatureScope([buildItem('BUG-1', buildDefectDirectLinkRoute('THIRD-1'))], TWO_PROJECT_SCOPE);

    expect(result.hiddenIssueCount).toBe(1);
  });
});

describe('applyFeatureScope — honesty', () => {
  it('changes nothing at all when no projects are configured', () => {
    const items = [
      buildItem('DEV-1', buildFeatureLinkRoute('ANY-1')),
      buildItem('BUG-1', buildDefectDirectLinkRoute('OTHER-9')),
    ];

    const result = applyFeatureScope(items, UNCONFIGURED_SCOPE);

    expect(result.items).toHaveLength(2);
    expect(result.hiddenIssueCount).toBe(0);
  });

  it('never hides unattributed work — that is a hygiene problem, not another project\'s', () => {
    const unattributed = buildItem('DEV-9', {
      steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes: [],
    });

    const result = applyFeatureScope([unattributed], SINGLE_PROJECT_SCOPE);

    expect(result.items.map((item) => item.key)).toEqual(['DEV-9']);
  });

  it('counts what it hid, so the board can say so instead of just looking smaller', () => {
    const result = applyFeatureScope(
      [
        buildItem('BUG-1', buildDefectDirectLinkRoute('OTHER-1')),
        buildItem('BUG-2', buildDefectDirectLinkRoute('OTHER-2')),
        buildItem('DEV-1', buildFeatureLinkRoute('ENCUC-1')),
      ],
      SINGLE_PROJECT_SCOPE,
    );

    expect(result.hiddenIssueCount).toBe(2);
    expect(result.hiddenFeatureKeys.sort()).toEqual(['OTHER-1', 'OTHER-2']);
  });

  it('compares project keys case-insensitively, since configuration is typed by hand', () => {
    const result = applyFeatureScope(
      [buildItem('DEV-1', buildFeatureLinkRoute('encuc-9'))],
      SINGLE_PROJECT_SCOPE,
    );

    expect(result.items).toHaveLength(1);
  });
});
