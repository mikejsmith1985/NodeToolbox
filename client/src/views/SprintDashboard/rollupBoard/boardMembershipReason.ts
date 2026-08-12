// boardMembershipReason.ts — "Why IS this on my board?"
//
// The board has a troubleshooter for work that is missing. It had nothing for the opposite question,
// which turns out to be the more common one: a lane appears for a Feature the team has never touched,
// and there is no way to find out what put it there.
//
// The answer already exists — the ownership scan records which of its tests admitted each Feature —
// it simply never reached the screen. So it is said out loud here, together with the thing the user
// actually needs, which is not the rule but the way to stop it: three of the four reasons are GUESSES
// the board only makes because the team has not named a label for its Features, and a lane admitted by
// a guess is a lane that a two-word setting would remove.

import type { TeamOwnedEmptyFeature } from './teamFeatureOwnership.ts';

/** Why one lane is on the board. */
export interface BoardMembershipReason {
  /** One line naming what admitted it. */
  summary: string;
  /** What to do if it should not be here. Empty when the lane is unarguably the team's. */
  howToRemove: string;
  /** True when the board INFERRED ownership rather than being told it. */
  isGuess: boolean;
}

/**
 * Explains a lane whose Feature has work under it.
 *
 * This case is never a mystery and never a guess: something the team is doing points at this Feature.
 * The lane is a consequence of the work, so the way to remove it is to fix the work's links.
 */
export function describeWorkingLaneMembership(issueCount: number): BoardMembershipReason {
  const issueWord = issueCount === 1 ? 'issue' : 'issues';
  return {
    summary: `${issueCount} ${issueWord} on this board roll up to it.`,
    howToRemove: `If that is wrong, the ${issueWord} are pointing at the wrong Feature —`
      + ' correct their Feature Link in Jira and the lane goes with them.',
    isGuess: false,
  };
}

/**
 * Explains a lane for a Feature with nothing under it.
 *
 * These are the lanes that provoke the question, because there is no work to justify them: the board
 * added them on the strength of who the Feature is assigned to, or who raised it, or a label.
 */
export function describeEmptyFeatureMembership(
  ownershipReason: TeamOwnedEmptyFeature['ownershipReason'],
  teamFeatureLabel: string,
): BoardMembershipReason {
  const setALabelAdvice = 'Set a Jira label for this team\'s Features in Board setup — the board stops'
    + ' guessing entirely once it has one, and only labelled Features appear.';

  if (ownershipReason === 'carries-team-label') {
    return {
      summary: `It carries this team's Feature label “${teamFeatureLabel}”.`,
      howToRemove: `Remove the “${teamFeatureLabel}” label from the Feature in Jira.`,
      isGuess: false,
    };
  }

  if (ownershipReason === 'has-team-child') {
    return {
      summary: 'It has a child issue in this team\'s project, even though none of it is on this board'
        + ' — the child may be outside the PI or the board filter.',
      howToRemove: setALabelAdvice,
      isGuess: true,
    };
  }

  const roleWording = ownershipReason === 'assigned-to-po'
    ? 'is ASSIGNED to this team\'s Product Owner'
    : 'was REPORTED by this team\'s Product Owner';

  return {
    // Naming this as a guess matters: a PO owning a Feature is not the same as the team working on it,
    // and this is exactly the case where the two came apart.
    summary: `It ${roleWording}, which the board treats as ownership only because no Feature label is set.`,
    howToRemove: setALabelAdvice,
    isGuess: true,
  };
}

/** A short tag for the lane header — the full explanation lives in the troubleshooter. */
export function describeMembershipTag(reason: BoardMembershipReason): string {
  return reason.isGuess ? 'here by inference' : 'here by ownership';
}

/**
 * The one thing worth saying about a whole board's worth of guessed lanes.
 *
 * Counted rather than listed, because the fix is the same for all of them and repeating it per lane is
 * how the notices panel got out of hand the first time.
 */
export function describeGuessedLaneCount(guessedLaneCount: number): string {
  if (guessedLaneCount === 0) return '';
  const laneWord = guessedLaneCount === 1 ? 'lane is' : 'lanes are';
  return `${guessedLaneCount} ${laneWord} on this board by inference rather than by a label —`
    + ' the board guessed from the Product Owner or an existing child issue.'
    + ' Set a Feature label in Board setup to decide this deliberately instead.';
}
