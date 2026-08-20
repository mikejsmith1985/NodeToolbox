// sharedRoster.ts — Carrying a team's roster in the shared ART workspace.
//
// The roster lived only in `tbxSprintDashboardRoster` on one machine. Two consequences, both real:
// "Clear All Connection Data" removed it with no copy anywhere, and the team-to-team sharing that
// covers boards, PI pages and settings did not cover the people — so a new machine, or a second
// person on the same team, started from an empty roster and rebuilt it by hand.
//
// This converts between the roster the UI edits and the shape the workspace stores. Deliberately
// dull: the wire format is pinned here so a UI change cannot silently alter what is already saved in
// Confluence, and every optional field survives a round trip untouched rather than being rebuilt
// field by field from a list that would need maintaining.

import type { SharedArtWorkspaceRosterMember } from '../../services/confluenceApi.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

/** A team as the Train space knows it. Only the fields the join needs. */
export interface JoinableTeam {
  id: string;
  boardId?: string;
}

/**
 * Finds the Team Dashboard profile that holds a Train team's roster.
 *
 * These are two separate records with two separate id spaces — an ART team and a dashboard profile
 * describe the same team but are never the same object, so the ART team's id will not find the
 * roster. They both carry the **board id**, and a team is its board, which makes that the join.
 *
 * Returns null rather than guessing when no board matches or when several profiles claim the same
 * board. Sharing the wrong team's roster is worse than sharing none: it would put other people's
 * names into this team's capacity planning, and nothing on screen would say where they came from.
 */
export function findRosterProfileId(
  artTeam: JoinableTeam,
  dashboardProfiles: readonly { id: string; boardId?: string }[],
): string | null {
  const artBoardId = (artTeam.boardId ?? '').trim();
  if (artBoardId === '') {
    return null;
  }
  const matchingProfiles = dashboardProfiles.filter(
    (profile) => (profile.boardId ?? '').trim() === artBoardId,
  );
  return matchingProfiles.length === 1 ? matchingProfiles[0].id : null;
}

/**
 * Converts the stored roster into the shape the dashboard uses.
 *
 * A member with no id or no display name is DROPPED rather than repaired. An unnamed roster row is
 * not a person — it is the residue of a half-finished edit, and inventing a name for it would put a
 * phantom into everyone's capacity planning.
 */
export function readSharedRoster(
  storedRoster: readonly SharedArtWorkspaceRosterMember[] | undefined,
): StandupRosterMember[] {
  return (storedRoster ?? [])
    .filter((member) => typeof member?.id === 'string' && member.id !== '')
    .filter((member) => typeof member.displayName === 'string' && member.displayName.trim() !== '')
    .map((member) => ({
      ...member,
      assigneeQueryValue: member.assigneeQueryValue ?? member.displayName,
    })) as StandupRosterMember[];
}

/**
 * Converts the dashboard's roster into the stored shape.
 *
 * Returns undefined for an empty roster rather than an empty array, so a team that has never had one
 * writes nothing at all. The difference matters to the merge: an empty array is a VALUE, and would
 * overwrite a colleague's shared roster with emptiness the first time somebody with a blank machine
 * pressed Share.
 */
export function buildSharedRoster(
  roster: readonly StandupRosterMember[],
): SharedArtWorkspaceRosterMember[] | undefined {
  const shareableMembers = roster.filter((member) => member.displayName.trim() !== '');
  return shareableMembers.length === 0
    ? undefined
    : shareableMembers.map((member) => ({ ...member })) as SharedArtWorkspaceRosterMember[];
}
