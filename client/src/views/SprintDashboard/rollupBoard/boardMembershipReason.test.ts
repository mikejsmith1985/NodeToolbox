// boardMembershipReason.test.ts — Proves the board can answer "why IS this here?", and is honest about
// which answers are inferences rather than facts.
//
// The case behind these: DENP-1398 and DENP-1429 appeared as empty lanes on a team's board. Neither
// carried the team's label; both were simply assigned to the team's Product Owner. The board had that
// reason recorded all along and never showed it.

import { describe, expect, it } from 'vitest';

import {
  describeEmptyFeatureMembership,
  describeGuessedLaneCount,
  describeMembershipTag,
  describeWorkingLaneMembership,
} from './boardMembershipReason.ts';

describe('describeWorkingLaneMembership', () => {
  it('is never a guess — work pointing at a Feature proves the team owns it', () => {
    const reason = describeWorkingLaneMembership(4);

    expect(reason.isGuess).toBe(false);
    expect(reason.summary).toContain('4 issues');
  });

  it('sends the user to the work rather than the Feature, since the lane follows the links', () => {
    expect(describeWorkingLaneMembership(1).howToRemove).toContain('Feature Link');
  });
});

describe('describeEmptyFeatureMembership', () => {
  it('treats a label as a fact, not a guess', () => {
    const reason = describeEmptyFeatureMembership('carries-team-label', 'CUC');

    expect(reason.isGuess).toBe(false);
    expect(reason.summary).toContain('CUC');
    expect(reason.howToRemove).toContain('Remove the “CUC” label');
  });

  it('admits that an assignee match is only an inference', () => {
    const reason = describeEmptyFeatureMembership('assigned-to-po', '');

    expect(reason.isGuess).toBe(true);
    expect(reason.summary).toContain('ASSIGNED');
    expect(reason.howToRemove).toContain('Board setup');
  });

  it('distinguishes being reported by the PO from being assigned to them', () => {
    expect(describeEmptyFeatureMembership('reported-by-po', '').summary).toContain('REPORTED');
  });

  it('explains a child the viewer cannot see on the board', () => {
    const reason = describeEmptyFeatureMembership('has-team-child', '');

    expect(reason.isGuess).toBe(true);
    expect(reason.summary).toMatch(/outside the PI or the board filter/);
  });

  it('always names the label as the way to stop the guessing', () => {
    for (const guessedReason of ['assigned-to-po', 'reported-by-po', 'has-team-child'] as const) {
      expect(describeEmptyFeatureMembership(guessedReason, '').howToRemove).toContain('stops guessing');
    }
  });
});

describe('describeMembershipTag', () => {
  it('marks an inferred lane differently from an owned one', () => {
    expect(describeMembershipTag(describeEmptyFeatureMembership('assigned-to-po', ''))).toBe('here by inference');
    expect(describeMembershipTag(describeEmptyFeatureMembership('carries-team-label', 'CUC'))).toBe('here by ownership');
  });
});

describe('describeGuessedLaneCount', () => {
  it('says nothing when every lane earned its place', () => {
    expect(describeGuessedLaneCount(0)).toBe('');
  });

  it('counts the guessed lanes rather than listing the same fix under each', () => {
    const sentence = describeGuessedLaneCount(2);

    expect(sentence).toContain('2 lanes are');
    expect(sentence).toContain('Board setup');
  });

  it('reads correctly for a single lane', () => {
    expect(describeGuessedLaneCount(1)).toContain('1 lane is');
  });
});
