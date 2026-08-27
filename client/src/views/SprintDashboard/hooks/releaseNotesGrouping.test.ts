// releaseNotesGrouping.test.ts — Release notes arranged under the Feature each item delivers.

import { describe, expect, it } from 'vitest';

import {
  describeGroupHeading,
  groupReleaseRowsByFeature,
  isGroupingWorthShowing,
  NO_FEATURE_GROUP_LABEL,
} from './releaseNotesGrouping.ts';
import type { ReleaseAiAssistTableRow } from './releaseAiAssistNotes.ts';

/** One release-notes row, carrying only the key the grouping reads. */
function row(issueKey: string): ReleaseAiAssistTableRow {
  return {
    issueKey,
    title: `Title for ${issueKey}`,
    releaseNote: 'What changed.',
    customerImpact: 'Why it matters.',
    technicalDetails: 'How it works.',
    risks: 'None.',
    validation: 'Validated.',
  };
}

describe('groupReleaseRowsByFeature', () => {
  it('puts every item under the Feature it delivers', () => {
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1'), row('ENCUC-2'), row('ENCUC-3')],
      new Map([['ENCUC-1', 'FEAT-10'], ['ENCUC-2', 'FEAT-20'], ['ENCUC-3', 'FEAT-10']]),
      new Map([['FEAT-10', 'Online enrollment intake'], ['FEAT-20', 'Billing consolidation']]),
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].featureKey).toBe('FEAT-10');
    expect(groups[0].rows.map((groupRow) => groupRow.issueKey)).toEqual(['ENCUC-1', 'ENCUC-3']);
    expect(groups[1].rows.map((groupRow) => groupRow.issueKey)).toEqual(['ENCUC-2']);
  });

  it('orders groups by where their first item appeared, not alphabetically', () => {
    // The arrangement follows the release's own ordering rather than one nobody chose.
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1'), row('ENCUC-2')],
      new Map([['ENCUC-1', 'ZED-9'], ['ENCUC-2', 'ABC-1']]),
      new Map(),
    );

    expect(groups.map((group) => group.featureKey)).toEqual(['ZED-9', 'ABC-1']);
  });

  it('carries each Feature its own summary from Jira', () => {
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1')],
      new Map([['ENCUC-1', 'FEAT-10']]),
      new Map([['FEAT-10', 'Online enrollment intake']]),
    );

    expect(groups[0].featureSummary).toBe('Online enrollment intake');
  });

  it('still groups when the Feature summary could not be read', () => {
    // The keys came from the issues themselves, so a failed summary fetch loses the wording, never
    // the grouping.
    const groups = groupReleaseRowsByFeature([row('ENCUC-1')], new Map([['ENCUC-1', 'FEAT-10']]), new Map());

    expect(groups[0].featureKey).toBe('FEAT-10');
    expect(groups[0].featureSummary).toBe('');
  });

  it('files unattributed work under No Feature, and puts it LAST', () => {
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1'), row('ENCUC-2')],
      new Map([['ENCUC-1', null], ['ENCUC-2', 'FEAT-10']]),
      new Map(),
    );

    expect(groups[groups.length - 1].featureKey).toBeNull();
    expect(groups[groups.length - 1].rows.map((groupRow) => groupRow.issueKey)).toEqual(['ENCUC-1']);
  });

  it('never drops work it could not file — a release note that hid it would lie about what shipped', () => {
    const rows = [row('ENCUC-1'), row('ENCUC-2'), row('ENCUC-3')];

    const groups = groupReleaseRowsByFeature(rows, new Map(), new Map());

    expect(groups.flatMap((group) => group.rows)).toHaveLength(3);
  });

  it('treats an issue the map never mentions as unattributed rather than as its own Feature', () => {
    const groups = groupReleaseRowsByFeature([row('ENCUC-9')], new Map(), new Map());

    expect(groups).toEqual([expect.objectContaining({ featureKey: null })]);
  });

  it('attaches the assistant narrative to the Feature it names', () => {
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1')],
      new Map([['ENCUC-1', 'FEAT-10']]),
      new Map([['FEAT-10', 'Online enrollment intake']]),
      new Map([['FEAT-10', 'This release completes intake for batch senders.']]),
    );

    expect(groups[0].narrative).toBe('This release completes intake for batch senders.');
  });

  it('ignores a narrative for a Feature nothing was filed under', () => {
    // The grouping comes from Jira; a narrative naming a Feature that is not in it has nowhere to go,
    // and inventing a group for it would put a heading over no work at all.
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1')],
      new Map([['ENCUC-1', 'FEAT-10']]),
      new Map(),
      new Map([['FEAT-99', 'A Feature this release does not touch.']]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].featureKey).toBe('FEAT-10');
  });

  it('returns nothing at all for a release with no rows', () => {
    expect(groupReleaseRowsByFeature([], new Map(), new Map())).toEqual([]);
  });
});

describe('describeGroupHeading', () => {
  it('reads as the key and the summary together', () => {
    const [group] = groupReleaseRowsByFeature(
      [row('ENCUC-1')],
      new Map([['ENCUC-1', 'FEAT-10']]),
      new Map([['FEAT-10', 'Online enrollment intake']]),
    );

    expect(describeGroupHeading(group)).toBe('FEAT-10 — Online enrollment intake');
  });

  it('falls back to the bare key rather than trailing an empty dash', () => {
    const [group] = groupReleaseRowsByFeature([row('ENCUC-1')], new Map([['ENCUC-1', 'FEAT-10']]), new Map());

    expect(describeGroupHeading(group)).toBe('FEAT-10');
  });

  it('names the unattributed group the way the Roll-Up Board does', () => {
    const [group] = groupReleaseRowsByFeature([row('ENCUC-1')], new Map(), new Map());

    expect(describeGroupHeading(group)).toBe(NO_FEATURE_GROUP_LABEL);
  });
});

describe('isGroupingWorthShowing', () => {
  it('is false when the whole release sits under one Feature', () => {
    // A heading repeated once over every row says nothing the reader did not already know.
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1'), row('ENCUC-2')],
      new Map([['ENCUC-1', 'FEAT-10'], ['ENCUC-2', 'FEAT-10']]),
      new Map(),
    );

    expect(isGroupingWorthShowing(groups)).toBe(false);
  });

  it('is false when nothing could be attributed at all', () => {
    // A single "No Feature" heading over the entire table says less than no heading at all.
    expect(isGroupingWorthShowing(groupReleaseRowsByFeature([row('ENCUC-1')], new Map(), new Map()))).toBe(false);
  });

  it('is true as soon as the release spans two Features', () => {
    const groups = groupReleaseRowsByFeature(
      [row('ENCUC-1'), row('ENCUC-2')],
      new Map([['ENCUC-1', 'FEAT-10'], ['ENCUC-2', 'FEAT-20']]),
      new Map(),
    );

    expect(isGroupingWorthShowing(groups)).toBe(true);
  });
});
