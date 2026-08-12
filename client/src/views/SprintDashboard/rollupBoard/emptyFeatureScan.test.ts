// emptyFeatureScan.test.ts — Proves the board can name Features committed to a PI with nothing under them.
//
// The board's lanes are built from work upward, so a Feature nobody has broken down has no lane and no
// presence at all. That is the exact state DENP-1387 sat in: forty story points, one PI, zero visibility.

import { describe, expect, it } from 'vitest';

import {
  buildFeaturesInPiJql,
  selectFeaturesWithoutWork,
  sumUnplannedStoryPoints,
} from './emptyFeatureScan.ts';

const PI_NAME = 'PI 26.4 (07/30/26 - 10/07/26)';

/** Builds a Feature the way a Jira search returns one. */
function makeFeature(key: string, extraFields: Record<string, unknown> = {}) {
  return {
    key,
    fields: { summary: `${key} summary`, status: { name: 'Ready Backlog' }, ...extraFields },
  };
}

describe('buildFeaturesInPiJql — ask the Feature projects, not the team project', () => {
  it('scopes by issue type, the configured Feature projects, and the PI', () => {
    const jql = buildFeaturesInPiJql(['DENP'], PI_NAME, 'cf[10301]');

    expect(jql).toBe(
      'issuetype = Feature AND project in ("DENP") AND cf[10301] = '
      + '"PI 26.4 (07/30/26 - 10/07/26)" AND statusCategory != Done ORDER BY key ASC',
    );
  });

  it('excludes finished Features, since a cancelled one is not a gap to fill', () => {
    expect(buildFeaturesInPiJql(['DENP'], PI_NAME, 'cf[10301]')).toContain('statusCategory != Done');
  });

  it('covers every configured Feature project, since a team can own more than one', () => {
    expect(buildFeaturesInPiJql(['ENCUC', 'DENP'], PI_NAME, 'cf[10301]'))
      .toContain('project in ("ENCUC", "DENP")');
  });

  it('escapes a quote in the PI name rather than breaking out of the string', () => {
    const jql = buildFeaturesInPiJql(['DENP'], 'PI "special"', 'cf[10301]');
    expect(jql).toContain('\\"special\\"');
  });

  it('returns null with no PI, so the caller skips the query instead of widening it', () => {
    expect(buildFeaturesInPiJql(['DENP'], '   ', 'cf[10301]')).toBeNull();
  });

  it('returns null when no Feature project is configured', () => {
    expect(buildFeaturesInPiJql([], PI_NAME, 'cf[10301]')).toBeNull();
  });

  it('returns null when the instance has no PI field', () => {
    expect(buildFeaturesInPiJql(['DENP'], PI_NAME, '')).toBeNull();
  });
});

describe('selectFeaturesWithoutWork — only the ones nothing rolls up to', () => {
  it('keeps a Feature that has no work against it', () => {
    const result = selectFeaturesWithoutWork([makeFeature('DENP-1387')], []);

    expect(result).toHaveLength(1);
    expect(result[0].featureKey).toBe('DENP-1387');
    expect(result[0].statusName).toBe('Ready Backlog');
  });

  it('excludes a Feature that already has a lane, so the signal does not become noise', () => {
    expect(selectFeaturesWithoutWork([makeFeature('DENP-1393')], ['DENP-1393'])).toEqual([]);
  });

  it('separates the two in a mixed batch', () => {
    const result = selectFeaturesWithoutWork(
      [makeFeature('DENP-1387'), makeFeature('DENP-1393')],
      ['DENP-1393'],
    );

    expect(result.map((feature) => feature.featureKey)).toEqual(['DENP-1387']);
  });

  it('carries the story points from whichever field this instance uses', () => {
    const feature = makeFeature('DENP-1387', { customfield_10016: 40 });
    const [result] = selectFeaturesWithoutWork([feature], [], ['customfield_10002', 'customfield_10016']);

    expect(result.storyPoints).toBe(40);
  });

  it('reports no points rather than zero when the field is absent', () => {
    const [result] = selectFeaturesWithoutWork([makeFeature('DENP-1387')], [], ['customfield_10016']);
    expect(result.storyPoints).toBeNull();
  });

  it('carries the assignee so the Feature has an owner to chase', () => {
    const feature = makeFeature('DENP-1387', { assignee: { displayName: 'Phatate, Smita' } });
    const [result] = selectFeaturesWithoutWork([feature], []);

    expect(result.assigneeDisplayName).toBe('Phatate, Smita');
  });

  it('does not throw on a Feature Jira returned without fields', () => {
    expect(selectFeaturesWithoutWork([{ key: 'DENP-1' }], [])[0].summary).toBe('');
  });
});

describe('sumUnplannedStoryPoints — one big Feature outweighs three small ones', () => {
  it('adds up the committed points that have no plan behind them', () => {
    const features = selectFeaturesWithoutWork(
      [makeFeature('A-1', { customfield_10016: 40 }), makeFeature('A-2', { customfield_10016: 8 })],
      [],
      ['customfield_10016'],
    );

    expect(sumUnplannedStoryPoints(features)).toBe(48);
  });

  it('treats an unestimated Feature as nothing rather than refusing to total', () => {
    const features = selectFeaturesWithoutWork(
      [makeFeature('A-1', { customfield_10016: 40 }), makeFeature('A-2')],
      [],
      ['customfield_10016'],
    );

    expect(sumUnplannedStoryPoints(features)).toBe(40);
  });

  it('is zero when every Feature has work', () => {
    expect(sumUnplannedStoryPoints([])).toBe(0);
  });
});

describe('buildFeaturesInPiJql — narrowing a shared project by label', () => {
  it('asks only for Features carrying the team\'s label', () => {
    expect(buildFeaturesInPiJql(['DENP', 'DASP'], PI_NAME, 'cf[10301]', 'CUC')).toContain('labels = "CUC"');
  });

  it('omits the clause entirely when no label is configured', () => {
    expect(buildFeaturesInPiJql(['DENP'], PI_NAME, 'cf[10301]')).not.toContain('labels');
  });
});
