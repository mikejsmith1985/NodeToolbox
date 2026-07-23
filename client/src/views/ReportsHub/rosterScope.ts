// rosterScope.ts — Decides WHICH roster a Reports Hub report runs, and what to call it.
//
// Teams in this app are saved **Dashboard Team profiles**, and each profile owns its own roster,
// stored under a profile-scoped key. A roster member does not carry a team name — the profile is the
// team. Earlier attempts to scope these reports filtered members by `teamName`, a field that is empty
// in practice, so the filter matched nothing, quietly fell back to whichever profile Agile Hub had
// selected, and the Reports Hub team dropdown changed nothing at all.
//
// Two rules follow from that, and both are load-bearing:
//
//   1. Resolve the requested team to a PROFILE, then read that profile's roster.
//   2. Read it — never select it. Writing the global active profile would silently re-point the
//      user's Agile Hub simply because they looked at a report (the 017 selection-isolation rule).
//
// Pure: the roster reader is injected, so nothing here touches storage or React.

/** The identifying slice of a saved Dashboard Team profile. */
export interface TeamProfileIdentity {
  id: string;
  name: string;
}

/** What a report should call a roster it could not attribute to any team. */
const UNSCOPED_ROSTER_LABEL = 'All roster members (no team assigned)';

/** Which roster a report will run, what to call it, and whether the request was honoured. */
export interface ReportRosterScope<TRosterMember> {
  /** The name to print. Always the roster ACTUALLY used, never the one merely asked for. */
  label: string;
  rosterMembers: TRosterMember[];
  /**
   * False when a team was requested that matches no saved profile — the Team filter lists Jira/ART
   * teams, which need not match the saved dashboard teams. Callers warn on this rather than pretend.
   */
  isRequestedTeamMatched: boolean;
}

export interface ReportRosterScopeInput<TRosterMember> {
  /** The team chosen in Reports Hub. Empty means "whatever is active". */
  requestedTeamName: string;
  teamProfiles: readonly TeamProfileIdentity[];
  activeTeamProfileId: string;
  readRosterForProfile: (teamProfileId: string) => TRosterMember[];
}

/** Compares team names the way a person would: trimmed, and ignoring case. */
function matchesTeamName(candidateName: string, requestedName: string): boolean {
  return candidateName.trim().toLowerCase() === requestedName.trim().toLowerCase();
}

/**
 * Resolves the roster a report should run against.
 *
 * Preference order: the requested team's profile, then the active profile, then nothing. The label
 * always describes what was actually used — a report that names a team it did not run is worse than
 * one that names no team, because the reader has no way to tell.
 */
export function resolveReportRosterScope<TRosterMember>(
  input: ReportRosterScopeInput<TRosterMember>,
): ReportRosterScope<TRosterMember> {
  const trimmedRequest = input.requestedTeamName.trim();
  const requestedProfile = trimmedRequest === ''
    ? undefined
    : input.teamProfiles.find((teamProfile) => matchesTeamName(teamProfile.name, trimmedRequest));

  if (requestedProfile !== undefined) {
    return {
      label: requestedProfile.name,
      rosterMembers: input.readRosterForProfile(requestedProfile.id),
      isRequestedTeamMatched: true,
    };
  }

  // A request that named no team was honoured by definition — there is nothing to mismatch against,
  // and warning about it would put a scary banner on every default run.
  const wasTeamRequested = trimmedRequest !== '';

  const activeProfile = input.teamProfiles.find((teamProfile) => teamProfile.id === input.activeTeamProfileId);
  if (activeProfile === undefined) {
    return {
      label: UNSCOPED_ROSTER_LABEL,
      rosterMembers: [],
      isRequestedTeamMatched: !wasTeamRequested,
    };
  }

  return {
    label: activeProfile.name,
    rosterMembers: input.readRosterForProfile(activeProfile.id),
    isRequestedTeamMatched: !wasTeamRequested,
  };
}
