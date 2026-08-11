// defectRollup.test.ts — Proves a defect always lands somewhere explainable.
//
// Defects in this Jira are linked inconsistently: sometimes to the dev Story, sometimes to the QA
// issue, sometimes straight to the Feature. That inconsistency is the reason the board exists, so
// these tests care most about the cases where SEVERAL routes are available at once — the placement
// must be the same every time, and the routes not taken must still be visible.

import { describe, expect, it } from 'vitest';

import { resolveDefectRollup } from './defectRollup.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const FEATURE_LINK_FIELD = 'customfield_10108';

interface BuildIssueInput {
  key: string;
  typeName: string;
  featureKey?: string;
  linkedKeys?: string[];
}

/** Builds an issue with outward "relates to" links, which is how this team records these. */
function buildIssue({ key, typeName, featureKey, linkedKeys = [] }: BuildIssueInput): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: key,
      issuetype: { name: typeName, subtask: typeName === 'Sub-task' },
      [FEATURE_LINK_FIELD]: featureKey ?? null,
      issuelinks: linkedKeys.map((linkedKey) => ({
        type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
        outwardIssue: { key: linkedKey },
      })),
    },
  } as unknown as JiraIssue;
}

/** Indexes issues by key, as the resolver expects. */
function buildIndex(issues: JiraIssue[]): Map<string, JiraIssue> {
  return new Map(issues.map((issue) => [issue.key, issue]));
}

describe('resolveDefectRollup — precedence', () => {
  it('prefers the development Story a defect is linked to', () => {
    const devStory = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['DEV-1'] });

    const route = resolveDefectRollup(defect, buildIndex([devStory, defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBe('FEAT-1');
    expect(route.precedenceRank).toBe('dev-story');
  });

  it('reaches the Feature through a QA issue when no dev Story is linked directly', () => {
    const devStory = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const qaIssue = buildIssue({ key: 'QA-1', typeName: 'Task', linkedKeys: ['DEV-1'] });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['QA-1'] });

    const route = resolveDefectRollup(defect, buildIndex([devStory, qaIssue, defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBe('FEAT-1');
    expect(route.precedenceRank).toBe('via-qa-issue');
    // The intermediate must be nameable, or the card cannot explain how it got here.
    expect(route.steps.some((step) => 'toKey' in step && step.toKey === 'QA-1')).toBe(true);
  });

  it('uses a direct Feature link when there is no delivery issue between them', () => {
    const feature = buildIssue({ key: 'FEAT-1', typeName: 'Feature' });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['FEAT-1'] });

    const route = resolveDefectRollup(defect, buildIndex([feature, defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBe('FEAT-1');
    expect(route.precedenceRank).toBe('direct-feature');
  });

  it('lets the dev Story beat a competing QA route, keeping the loser visible', () => {
    const devStory = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const otherStory = buildIssue({ key: 'DEV-2', typeName: 'Story', featureKey: 'FEAT-2' });
    const qaIssue = buildIssue({ key: 'QA-1', typeName: 'Task', linkedKeys: ['DEV-2'] });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['QA-1', 'DEV-1'] });

    const route = resolveDefectRollup(defect, buildIndex([devStory, otherStory, qaIssue, defect]), FEATURE_LINK_FIELD);

    expect(route.precedenceRank).toBe('dev-story');
    expect(route.featureKey).toBe('FEAT-1');
    expect(route.unchosenCandidates.map((candidate) => candidate.toKey)).toContain('QA-1');
  });

  it('lands in No Feature when nothing is linked', () => {
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect' });

    const route = resolveDefectRollup(defect, buildIndex([defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBeNull();
    expect(route.steps).toEqual([]);
  });

  it('lands in No Feature when every linked issue is itself unattributed', () => {
    const orphanStory = buildIssue({ key: 'DEV-1', typeName: 'Story' });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['DEV-1'] });

    const route = resolveDefectRollup(defect, buildIndex([orphanStory, defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBeNull();
  });
});

describe('resolveDefectRollup — determinism and safety', () => {
  it('breaks a tie between two same-rank Stories by ascending key, not by link order', () => {
    const storyB = buildIssue({ key: 'DEV-2', typeName: 'Story', featureKey: 'FEAT-2' });
    const storyA = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const defectListedBFirst = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['DEV-2', 'DEV-1'] });
    const defectListedAFirst = buildIssue({ key: 'BUG-2', typeName: 'Defect', linkedKeys: ['DEV-1', 'DEV-2'] });
    const index = buildIndex([storyA, storyB, defectListedBFirst, defectListedAFirst]);

    expect(resolveDefectRollup(defectListedBFirst, index, FEATURE_LINK_FIELD).featureKey).toBe('FEAT-1');
    expect(resolveDefectRollup(defectListedAFirst, index, FEATURE_LINK_FIELD).featureKey).toBe('FEAT-1');
  });

  it('keeps the Feature it did not choose visible, so a duplicate concern is not lost', () => {
    const storyA = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const storyB = buildIssue({ key: 'DEV-2', typeName: 'Story', featureKey: 'FEAT-2' });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['DEV-1', 'DEV-2'] });

    const route = resolveDefectRollup(defect, buildIndex([storyA, storyB, defect]), FEATURE_LINK_FIELD);

    expect(route.unchosenCandidates.map((candidate) => candidate.resolvedFeatureKey)).toContain('FEAT-2');
    expect(route.notes).toContain('multiple-features-touched');
  });

  it('terminates on a circular link instead of recursing forever', () => {
    const qaIssue = buildIssue({ key: 'QA-1', typeName: 'Task', linkedKeys: ['BUG-1'] });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['QA-1'] });

    const route = resolveDefectRollup(defect, buildIndex([qaIssue, defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBeNull();
    expect(route.notes).toContain('link-loop-detected');
  });

  it('stops at one intermediate hop, so a placement is always explainable in a sentence', () => {
    const devStory = buildIssue({ key: 'DEV-1', typeName: 'Story', featureKey: 'FEAT-1' });
    const middleIssue = buildIssue({ key: 'MID-1', typeName: 'Task', linkedKeys: ['DEV-1'] });
    const qaIssue = buildIssue({ key: 'QA-1', typeName: 'Task', linkedKeys: ['MID-1'] });
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['QA-1'] });

    const route = resolveDefectRollup(defect, buildIndex([devStory, middleIssue, qaIssue, defect]), FEATURE_LINK_FIELD);

    // Two hops away is beyond the cap, so it falls through rather than being found by an open-ended walk.
    expect(route.featureKey).toBeNull();
  });

  it('ignores a linked issue that is not in scope, since its own links cannot be read', () => {
    const defect = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['ELSEWHERE-9'] });

    const route = resolveDefectRollup(defect, buildIndex([defect]), FEATURE_LINK_FIELD);

    expect(route.featureKey).toBeNull();
  });
});

describe('a defect whose stronger route reaches a Feature that has shipped', () => {
  // The production case: ENCUC-2070 reaches the live Feature FEAT-LIVE through a dev Story, and the
  // shipped Feature FEAT-SHIPPED through a QA issue. Rank alone files it under the shipped one.
  const SHIPPED_STORY = buildIssue({ key: 'DEV-OLD', typeName: 'Story', featureKey: 'FEAT-SHIPPED' });
  const QA_ISSUE = buildIssue({ key: 'QA-1', typeName: 'Task', linkedKeys: ['DEV-OLD'] });
  const LIVE_FEATURE = buildIssue({ key: 'FEAT-LIVE', typeName: 'Feature' });
  const DEFECT = buildIssue({ key: 'BUG-1', typeName: 'Defect', linkedKeys: ['QA-1', 'FEAT-LIVE'] });

  const INDEX = buildIndex([SHIPPED_STORY, QA_ISSUE, LIVE_FEATURE, DEFECT]);
  const isShipped = (featureKey: string) => featureKey === 'FEAT-SHIPPED';

  it('still prefers the QA route when nothing is known to have shipped', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD);

    expect(route.featureKey).toBe('FEAT-SHIPPED');
    expect(route.precedenceRank).toBe('via-qa-issue');
  });

  it('files it under the Feature still in flight once the shipped one is known', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, isShipped);

    expect(route.featureKey).toBe('FEAT-LIVE');
    expect(route.precedenceRank).toBe('direct-feature');
  });

  it('says a stronger route was passed over, so the change is never silent', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, isShipped);
    expect(route.notes).toContain('preferred-unfinished-feature');
  });

  it('keeps the shipped route as an unchosen candidate, so the provenance survives', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, isShipped);
    expect(route.unchosenCandidates.map((candidate) => candidate.toKey)).toContain('QA-1');
  });

  it('falls back to the shipped Feature when every route reaches one', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, () => true);

    // A finished Feature is better than no Feature at all.
    expect(route.featureKey).toBe('FEAT-SHIPPED');
    expect(route.notes).not.toContain('preferred-unfinished-feature');
  });

  it('adds no note when the highest-ranked route was preferred anyway', () => {
    const onlyLiveShipped = (featureKey: string) => featureKey === 'FEAT-LIVE';
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, onlyLiveShipped);

    expect(route.featureKey).toBe('FEAT-SHIPPED');
    expect(route.notes).not.toContain('preferred-unfinished-feature');
  });
});

describe('a defect whose other links reach Features this team does not track', () => {
  // The production regression: ENCUC-2070 links to a long tail of QA issues, some belonging to other
  // teams' Features. Preferring "unfinished" alone chose one of those, and the board's project scope
  // then removed the defect from the board entirely rather than moving it to another lane.
  const OUT_OF_SCOPE_STORY = buildIssue({ key: 'QEINT-1', typeName: 'Story', featureKey: 'QEINT-613' });
  const OUT_OF_SCOPE_QA = buildIssue({ key: 'INTTEST-4021', typeName: 'Task', linkedKeys: ['QEINT-1'] });
  const OWN_FEATURE = buildIssue({ key: 'DENP-1414', typeName: 'Feature' });
  const DEFECT = buildIssue({
    key: 'ENCUC-2070', typeName: 'Defect', linkedKeys: ['INTTEST-4021', 'DENP-1414'],
  });

  const INDEX = buildIndex([OUT_OF_SCOPE_STORY, OUT_OF_SCOPE_QA, OWN_FEATURE, DEFECT]);
  const isTracked = (featureKey: string) => featureKey.startsWith('DENP-');
  const nothingFinished = () => false;

  it('keeps the defect on a Feature this team tracks, even though the QA route ranks higher', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, nothingFinished, isTracked);

    expect(route.featureKey).toBe('DENP-1414');
  });

  it('would otherwise have chosen the out-of-scope Feature, which is what removed it from the board', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, nothingFinished);

    expect(route.featureKey).toBe('QEINT-613');
  });

  it('prefers a tracked Feature even when the untracked one is the livelier of the two', () => {
    const trackedIsFinished = (featureKey: string) => featureKey === 'DENP-1414';
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, trackedIsFinished, isTracked);

    // A lane the viewer can see beats a lane they cannot, shipped or not.
    expect(route.featureKey).toBe('DENP-1414');
  });

  it('falls back to an untracked Feature rather than nothing at all', () => {
    const onlyUntracked = buildIssue({ key: 'BUG-9', typeName: 'Defect', linkedKeys: ['INTTEST-4021'] });
    const route = resolveDefectRollup(
      onlyUntracked, buildIndex([OUT_OF_SCOPE_STORY, OUT_OF_SCOPE_QA, onlyUntracked]),
      FEATURE_LINK_FIELD, nothingFinished, isTracked,
    );

    expect(route.featureKey).toBe('QEINT-613');
  });

  it('keeps the untaken route visible, so the QA trail is not lost', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD, nothingFinished, isTracked);

    expect(route.unchosenCandidates.map((candidate) => candidate.toKey)).toContain('INTTEST-4021');
  });
});

describe('a defect that names its own Feature', () => {
  // The production case: ENCUC-2070 has Feature Link DENP-1414 set on the defect itself, yet sat in
  // DENP-1288's lane because only its ELEVEN issue links were ever walked — while its own sub-tasks,
  // which read the parent's Feature Link, sat under DENP-1414. The two disagreed about the same defect.
  const QA_STORY = buildIssue({ key: 'DEV-OLD', typeName: 'Story', featureKey: 'DENP-1288' });
  const QA_ISSUE = buildIssue({ key: 'INTTEST-3961', typeName: 'Task', linkedKeys: ['DEV-OLD'] });
  const DEFECT = buildIssue({
    key: 'ENCUC-2070', typeName: 'Defect', featureKey: 'DENP-1414', linkedKeys: ['INTTEST-3961'],
  });
  const INDEX = buildIndex([QA_STORY, QA_ISSUE, DEFECT]);

  it('uses the Feature Link set on the defect, in preference to anything it walked to', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD);

    expect(route.featureKey).toBe('DENP-1414');
    expect(route.precedenceRank).toBe('own-feature-link');
  });

  it('agrees with where its own sub-tasks land, which read the same field', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD);
    const subtaskFeatureKey = 'DENP-1414';

    expect(route.featureKey).toBe(subtaskFeatureKey);
  });

  it('keeps the route it walked to as an unchosen candidate, so the QA trail survives', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD);
    expect(route.unchosenCandidates.map((candidate) => candidate.toKey)).toContain('INTTEST-3961');
  });

  it('names the field it used in the route, so the card can still explain itself', () => {
    const route = resolveDefectRollup(DEFECT, INDEX, FEATURE_LINK_FIELD);

    expect(route.steps.some((step) => step.kind === 'featureLink' && step.toKey === 'DENP-1414')).toBe(true);
  });

  it('still walks the links when the defect names no Feature of its own', () => {
    const unlinkedDefect = buildIssue({ key: 'BUG-2', typeName: 'Defect', linkedKeys: ['INTTEST-3961'] });
    const route = resolveDefectRollup(
      unlinkedDefect, buildIndex([QA_STORY, QA_ISSUE, unlinkedDefect]), FEATURE_LINK_FIELD,
    );

    expect(route.featureKey).toBe('DENP-1288');
    expect(route.precedenceRank).toBe('via-qa-issue');
  });

  it('still avoids a Feature this team does not track, even one named on the defect', () => {
    const outOfScopeDefect = buildIssue({
      key: 'BUG-3', typeName: 'Defect', featureKey: 'QEINT-613', linkedKeys: ['INTTEST-3961'],
    });
    const route = resolveDefectRollup(
      outOfScopeDefect, buildIndex([QA_STORY, QA_ISSUE, outOfScopeDefect]),
      FEATURE_LINK_FIELD, () => false, (featureKey) => featureKey.startsWith('DENP-'),
    );

    // A lane the viewer can see still beats a lane they cannot, however the Feature was named.
    expect(route.featureKey).toBe('DENP-1288');
  });
});
