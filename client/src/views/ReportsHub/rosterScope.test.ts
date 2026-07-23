// rosterScope.test.ts — Tests for resolving which roster a Reports Hub report should actually run.
//
// The bug this exists to kill: teams in this app are saved **Dashboard Team profiles**, and each
// profile owns its own roster under a profile-scoped storage key. Roster members do not carry a team
// NAME. Every previous attempt to scope these reports filtered members by `teamName`, which is empty
// — so the filter matched nothing, fell back to "whatever profile Agile Hub last selected", and the
// Reports Hub team dropdown had no effect at all.
//
// The second rule here matters as much as the first: resolving a team must NOT write the global
// active profile. Reports Hub is a reader. Changing the profile as a side effect would silently
// re-point the user's Agile Hub the moment they glanced at a report.

import { describe, expect, it, vi } from 'vitest';

import { resolveReportRosterScope } from './rosterScope.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

const TEAM_PROFILES = [
  { id: 'profile-transformers', name: 'Transformers' },
  { id: 'profile-cleanup', name: 'Cleanup Crew' },
];

/** Each profile owns a different roster, exactly as the profile-scoped storage does. */
const ROSTERS: Record<string, StandupRosterMember[]> = {
  'profile-transformers': [
    { id: 'roster-member:optimus', displayName: 'Optimus Prime', assigneeQueryValue: 'optimus' },
  ],
  'profile-cleanup': [
    { id: 'roster-member:jane', displayName: 'Jane Dev', assigneeQueryValue: 'jane.dev' },
    { id: 'roster-member:mark', displayName: 'Mark PO', assigneeQueryValue: 'mark.po' },
  ],
};

function readRosterFor(profileId: string): StandupRosterMember[] {
  return ROSTERS[profileId] ?? [];
}

describe('resolveReportRosterScope — the team dropdown actually scopes the run', () => {
  it('runs the roster belonging to the requested team profile', () => {
    const scope = resolveReportRosterScope({
      requestedTeamName: 'Transformers',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-cleanup',
      readRosterForProfile: readRosterFor,
    });

    // Cleanup Crew is the ACTIVE profile, but Transformers was asked for — so Transformers runs.
    // This is the whole complaint: picking a team in Reports Hub used to change nothing.
    expect(scope.label).toBe('Transformers');
    expect(scope.rosterMembers.map((member) => member.displayName)).toEqual(['Optimus Prime']);
  });

  it('matches the profile name case-insensitively and ignores stray whitespace', () => {
    const scope = resolveReportRosterScope({
      requestedTeamName: '  cleanup crew ',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-transformers',
      readRosterForProfile: readRosterFor,
    });

    expect(scope.label).toBe('Cleanup Crew');
    expect(scope.rosterMembers).toHaveLength(2);
  });

  it('falls back to the active profile when no team was requested', () => {
    const scope = resolveReportRosterScope({
      requestedTeamName: '',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-cleanup',
      readRosterForProfile: readRosterFor,
    });

    expect(scope.label).toBe('Cleanup Crew');
    expect(scope.rosterMembers).toHaveLength(2);
    expect(scope.isRequestedTeamMatched).toBe(true);
  });
});

describe('resolveReportRosterScope — never lies about what it ran', () => {
  it('reports a requested team that matches no profile, and says which roster it used instead', () => {
    const scope = resolveReportRosterScope({
      requestedTeamName: 'Some ART Team',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-cleanup',
      readRosterForProfile: readRosterFor,
    });

    // The Team filter lists Jira/ART teams, which need not match the saved dashboard teams. When they
    // do not, the report must name the roster it ACTUALLY ran, never the one that was asked for.
    expect(scope.isRequestedTeamMatched).toBe(false);
    expect(scope.label).toBe('Cleanup Crew');
    expect(scope.label).not.toBe('Some ART Team');
  });

  it('does not report a mismatch when no team was requested at all', () => {
    // Nothing was asked for, so nothing was ignored. Warning here would put a banner on every default
    // run and train the reader to ignore the one that matters.
    const scope = resolveReportRosterScope({
      requestedTeamName: '',
      teamProfiles: [],
      activeTeamProfileId: '',
      readRosterForProfile: () => [],
    });

    expect(scope.isRequestedTeamMatched).toBe(true);
    expect(scope.label).toBe('All roster members (no team assigned)');
  });

  it('names no team at all when there are no saved profiles', () => {
    const scope = resolveReportRosterScope({
      requestedTeamName: 'Transformers',
      teamProfiles: [],
      activeTeamProfileId: '',
      readRosterForProfile: () => [],
    });

    expect(scope.label).toBe('All roster members (no team assigned)');
    expect(scope.isRequestedTeamMatched).toBe(false);
  });
});

describe('resolveReportRosterScope — Reports Hub is a reader', () => {
  it('never writes the active profile as a side effect', () => {
    // Switching the global profile here would silently re-point the user's Agile Hub simply because
    // they looked at a report. Reports Hub reads another profile's roster; it does not select it.
    const readRoster = vi.fn(readRosterFor);

    resolveReportRosterScope({
      requestedTeamName: 'Transformers',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-cleanup',
      readRosterForProfile: readRoster,
    });

    expect(readRoster).toHaveBeenCalledWith('profile-transformers');
    expect(readRoster).not.toHaveBeenCalledWith('profile-cleanup');
  });

  it('is pure — the same inputs give the same scope', () => {
    const buildScope = () => resolveReportRosterScope({
      requestedTeamName: 'Transformers',
      teamProfiles: TEAM_PROFILES,
      activeTeamProfileId: 'profile-cleanup',
      readRosterForProfile: readRosterFor,
    });

    expect(buildScope()).toEqual(buildScope());
  });
});
