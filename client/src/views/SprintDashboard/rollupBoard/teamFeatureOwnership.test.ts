// teamFeatureOwnership.test.ts — Proves the empty-Feature list is the team's own, and short.
//
// Without these filters the check returned 77 Features for a team that owns a handful: other teams'
// work, and a great many cancelled ones. A list that long is wallpaper, not a signal.

import { describe, expect, it } from 'vitest';

import {
  isFeatureDone,
  readFeatureKeysFromTeamIssues,
  selectTeamOwnedEmptyFeatures,
} from './teamFeatureOwnership.ts';

const PO_QUERY_VALUES = ['smithm', 'phatates'];

/** Builds a Feature the way a Jira search returns one. */
function makeFeature(key: string, extraFields: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary: `${key} summary`,
      status: { name: 'Ready Backlog', statusCategory: { key: 'new' } },
      ...extraFields,
    },
  };
}

/** The inputs with nothing owned, so each test opts into exactly the ownership it means to prove. */
const NO_OWNERSHIP = {
  productOwnerQueryValues: [] as string[],
  featureKeysWithTeamChildren: [] as string[],
  featureKeysWithWork: [] as string[],
};

describe('isFeatureDone — cancelled counts as finished', () => {
  it('is true for the done category however the status is named', () => {
    const cancelled = { fields: { status: { name: 'Cancelled', statusCategory: { key: 'done' } } } };
    expect(isFeatureDone(cancelled)).toBe(true);
  });

  it('is false for work still in flight', () => {
    expect(isFeatureDone(makeFeature('A-1'))).toBe(false);
  });

  it('is false when Jira returned no status at all', () => {
    expect(isFeatureDone({ fields: {} })).toBe(false);
  });
});

describe('selectTeamOwnedEmptyFeatures — the three ways a Feature belongs to this team', () => {
  it('claims a Feature assigned to the team\'s Product Owner', () => {
    const feature = makeFeature('DENP-1387', { assignee: { name: 'smithm' } });
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...NO_OWNERSHIP, productOwnerQueryValues: PO_QUERY_VALUES,
    });

    expect(result).toHaveLength(1);
    expect(result[0].ownershipReason).toBe('assigned-to-po');
  });

  it('claims a Feature reported by the team\'s Product Owner', () => {
    const feature = makeFeature('DENP-1387', { reporter: { name: 'phatates' } });
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...NO_OWNERSHIP, productOwnerQueryValues: PO_QUERY_VALUES,
    });

    expect(result[0].ownershipReason).toBe('reported-by-po');
  });

  it('claims a Feature that already has a child in the team\'s project, whoever owns it', () => {
    const result = selectTeamOwnedEmptyFeatures([makeFeature('DENP-1387')], {
      ...NO_OWNERSHIP, featureKeysWithTeamChildren: ['DENP-1387'],
    });

    expect(result[0].ownershipReason).toBe('has-team-child');
  });

  it('matches a Product Owner by display name as well as username', () => {
    const feature = makeFeature('DENP-1387', { assignee: { displayName: 'Phatate, Smita' } });
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...NO_OWNERSHIP, productOwnerQueryValues: ['Phatate, Smita'],
    });

    expect(result).toHaveLength(1);
  });

  it('leaves another team\'s Feature alone — the 77-row problem', () => {
    const otherTeamFeature = makeFeature('DASP-448', { assignee: { name: 'someone-else' } });
    const result = selectTeamOwnedEmptyFeatures([otherTeamFeature], {
      ...NO_OWNERSHIP, productOwnerQueryValues: PO_QUERY_VALUES,
    });

    expect(result).toEqual([]);
  });

  it('claims nothing at all when the roster names no Product Owner', () => {
    const feature = makeFeature('DENP-1387', { assignee: { name: 'smithm' } });
    expect(selectTeamOwnedEmptyFeatures([feature], NO_OWNERSHIP)).toEqual([]);
  });
});

describe('selectTeamOwnedEmptyFeatures — what it discards', () => {
  const OWNED = { ...NO_OWNERSHIP, productOwnerQueryValues: PO_QUERY_VALUES };

  it('drops a finished Feature even when the team owns it', () => {
    const cancelled = makeFeature('DENP-1', {
      assignee: { name: 'smithm' },
      status: { name: 'Cancelled', statusCategory: { key: 'done' } },
    });

    expect(selectTeamOwnedEmptyFeatures([cancelled], OWNED)).toEqual([]);
  });

  it('drops a Feature that already has a lane, so nothing is listed twice', () => {
    const feature = makeFeature('DENP-1387', { assignee: { name: 'smithm' } });
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...OWNED, featureKeysWithWork: ['DENP-1387'],
    });

    expect(result).toEqual([]);
  });

  it('keeps the owned, unfinished, unbroken-down one out of a realistic mix', () => {
    const features = [
      makeFeature('DENP-1387', { assignee: { name: 'smithm' } }),
      makeFeature('DENP-1393', { assignee: { name: 'smithm' } }),
      makeFeature('DASP-448', { assignee: { name: 'other' } }),
      makeFeature('DENP-9', {
        assignee: { name: 'smithm' },
        status: { name: 'Cancelled', statusCategory: { key: 'done' } },
      }),
    ];

    const result = selectTeamOwnedEmptyFeatures(features, {
      ...OWNED, featureKeysWithWork: ['DENP-1393'],
    });

    expect(result.map((feature) => feature.featureKey)).toEqual(['DENP-1387']);
  });
});

describe('selectTeamOwnedEmptyFeatures — what it carries through', () => {
  it('carries status, points and assignee so the Feature can be acted on', () => {
    const feature = makeFeature('DENP-1387', {
      assignee: { name: 'smithm', displayName: 'Smith, Michael (CTR)' },
      customfield_10016: 40,
    });

    const [result] = selectTeamOwnedEmptyFeatures([feature], {
      ...NO_OWNERSHIP,
      productOwnerQueryValues: PO_QUERY_VALUES,
      storyPointsFieldIds: ['customfield_10016'],
    });

    expect(result.statusName).toBe('Ready Backlog');
    expect(result.storyPoints).toBe(40);
    expect(result.assigneeDisplayName).toBe('Smith, Michael (CTR)');
  });
});

describe('readFeatureKeysFromTeamIssues — the third ownership test, made concrete', () => {
  it('reads a Feature Link stored as a plain key string', () => {
    const teamIssues = [{ fields: { customfield_10108: 'DENP-1387' } }];
    expect(readFeatureKeysFromTeamIssues(teamIssues, 'customfield_10108')).toEqual(['DENP-1387']);
  });

  it('reads a Feature Link stored as an issue object', () => {
    const teamIssues = [{ fields: { customfield_10108: { key: 'DENP-1387' } } }];
    expect(readFeatureKeysFromTeamIssues(teamIssues, 'customfield_10108')).toEqual(['DENP-1387']);
  });

  it('reports each Feature once however many children point at it', () => {
    const teamIssues = [
      { fields: { customfield_10108: 'DENP-1387' } },
      { fields: { customfield_10108: 'DENP-1387' } },
    ];
    expect(readFeatureKeysFromTeamIssues(teamIssues, 'customfield_10108')).toEqual(['DENP-1387']);
  });

  it('ignores an issue with no Feature Link at all', () => {
    expect(readFeatureKeysFromTeamIssues([{ fields: {} }, {}], 'customfield_10108')).toEqual([]);
  });
});

describe('a team label replaces the guessing', () => {
  // Cleanup Crew supports Features in DENP and DASP. Adding DASP to reach six Features dragged in
  // every other team's DASP work, because ownership was inferred from the PO rather than recorded.
  const LABELLED = { ...NO_OWNERSHIP, teamFeatureLabel: 'CUC' };

  it('claims a Feature carrying the label', () => {
    const feature = makeFeature('DASP-925', { labels: ['CUC', 'tech-debt'] });
    const [result] = selectTeamOwnedEmptyFeatures([feature], LABELLED);

    expect(result.ownershipReason).toBe('carries-team-label');
  });

  it('matches the label whatever case it was typed in', () => {
    const feature = makeFeature('DASP-925', { labels: ['cuc'] });
    expect(selectTeamOwnedEmptyFeatures([feature], LABELLED)).toHaveLength(1);
  });

  it('leaves an unlabelled Feature alone even when the PO is its assignee', () => {
    // The point of the label: once it is in use the guesses must stop, or exactly the work it was
    // introduced to exclude walks back in through a side door.
    const feature = makeFeature('DASP-999', { assignee: { name: 'smithm' } });
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...LABELLED, productOwnerQueryValues: ['smithm'],
    });

    expect(result).toEqual([]);
  });

  it('leaves an unlabelled Feature alone even when it has a child in the team\'s project', () => {
    const feature = makeFeature('DASP-999');
    const result = selectTeamOwnedEmptyFeatures([feature], {
      ...LABELLED, featureKeysWithTeamChildren: ['DASP-999'],
    });

    expect(result).toEqual([]);
  });

  it('falls back to the guesses when no label is configured', () => {
    const feature = makeFeature('DENP-1', { assignee: { name: 'smithm' } });
    const [result] = selectTeamOwnedEmptyFeatures([feature], {
      ...NO_OWNERSHIP, productOwnerQueryValues: ['smithm'],
    });

    expect(result.ownershipReason).toBe('assigned-to-po');
  });

  it('still drops a finished Feature, label or not', () => {
    const feature = makeFeature('DASP-925', {
      labels: ['CUC'], status: { name: 'Cancelled', statusCategory: { key: 'done' } },
    });

    expect(selectTeamOwnedEmptyFeatures([feature], LABELLED)).toEqual([]);
  });

  it('does not match a label that merely contains the team\'s', () => {
    const feature = makeFeature('DASP-925', { labels: ['CUCUMBER'] });
    expect(selectTeamOwnedEmptyFeatures([feature], LABELLED)).toEqual([]);
  });
});

// ── Placeholder Features ──
//
// The case behind these: DENP-1398 ("Placeholder feature to align Enrollment configuration defects")
// and DENP-1429 ("EAM Cognizant Enhancement Requests and Discussions (2026 Rolling feature)") appeared
// as permanently empty lanes. Both are genuinely the team's, genuinely in the PI, and never going to be
// broken down — so no OWNERSHIP rule could remove them. They both carry the team's own name as a label
// too, which is why a team label could not separate them either.
describe('selectTeamOwnedEmptyFeatures — Features the team marks as placeholders', () => {
  const OWNED = { ...NO_OWNERSHIP, productOwnerQueryValues: PO_QUERY_VALUES };
  const PLACEHOLDER = makeFeature('DENP-1429', {
    assignee: { name: 'smithm' },
    labels: ['Backlog', 'No-Development', 'Transformers'],
  });

  it('gives no lane to a Feature carrying an excluded label', () => {
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...OWNED,
      excludedFeatureLabels: ['No-Development'],
    });

    expect(empties).toEqual([]);
  });

  it('still lanes it when no exclusions are configured', () => {
    expect(selectTeamOwnedEmptyFeatures([PLACEHOLDER], OWNED)).toHaveLength(1);
  });

  it('matches an excluded label whatever case it was typed in', () => {
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...OWNED,
      excludedFeatureLabels: ['no-development'],
    });

    expect(empties).toEqual([]);
  });

  it('excludes on ANY of the listed labels, not all of them', () => {
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...OWNED,
      excludedFeatureLabels: ['Nothing-Matches', 'Backlog'],
    });

    expect(empties).toEqual([]);
  });

  it('keeps a Feature whose labels do not overlap the exclusions', () => {
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...OWNED,
      excludedFeatureLabels: ['Spike'],
    });

    expect(empties).toHaveLength(1);
  });

  it('never suppresses a Feature that has work, however it is labelled', () => {
    // The safety property: this list is only ever the EMPTY Features, so an exclusion cannot reach a
    // Feature with work under it — hiding that lane would hide the work with it.
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...OWNED,
      featureKeysWithWork: ['DENP-1429'],
      excludedFeatureLabels: ['No-Development'],
    });

    // Absent from the EMPTY list because it has work — its lane is built from that work instead.
    expect(empties).toEqual([]);
  });

  it('does not touch a team label that happens to be on a placeholder too', () => {
    // Both real Features and placeholders carry the team's name, which is exactly why the exclusion
    // has to be a SEPARATE mark rather than a smarter reading of the ownership label.
    const empties = selectTeamOwnedEmptyFeatures([PLACEHOLDER], {
      ...NO_OWNERSHIP,
      teamFeatureLabel: 'Transformers',
      excludedFeatureLabels: ['No-Development'],
    });

    expect(empties).toEqual([]);
  });
});
