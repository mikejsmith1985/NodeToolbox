// piReviewSchedulerImport.ts — Pure helpers that turn the app's already-configured team PI Review
// pages (Team Dashboard profiles) into PI Review scheduler entries, so the Admin Hub sync panel can
// offer a picker instead of hand-typed page URLs.

import type { SprintDashboardTeamProfile } from '../../store/settingsStore.ts';

/** One page as the scheduler config stores it. */
export interface SchedulerPageEntry {
  pageUrlOrId: string;
  piName: string;
}

/** The scheduler team shape the panel edits (mirrors the server sanitiser). */
export interface SchedulerTeamEntry {
  teamName: string;
  isEnabled: boolean;
  scheduleTime: string;
  /** 0 = once daily at scheduleTime; >0 = clock-aligned polling every that many minutes. */
  intervalMin: number;
  productOwnerAssignee: string;
  piFieldId: string;
  dependencyLinkTypes: string[];
  pages: SchedulerPageEntry[];
}

/** A team profile's importable PI Review pages plus the roster-derived Product Owner suggestion. */
export interface ImportableTeamPages {
  profileId: string;
  teamName: string;
  suggestedProductOwner: string;
  pages: SchedulerPageEntry[];
}

/** The smallest roster-member shape the Product Owner suggestion needs. */
export interface RosterMemberLike {
  assigneeQueryValue?: string;
  roleCapabilities?: { canProductOwner?: boolean };
}

const DEFAULT_SCHEDULE_TIME = '06:00';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

/**
 * Collects each team profile's configured PI Review pages into an importable entry, suggesting the
 * team's Product Owner from its roster (the first member flagged with the PO capability). Profiles
 * with no configured pages are skipped — there is nothing to schedule for them.
 */
export function buildImportableTeamPages(
  teamProfiles: SprintDashboardTeamProfile[],
  readRosterForProfile: (profileId: string) => RosterMemberLike[],
): ImportableTeamPages[] {
  const importableTeams: ImportableTeamPages[] = [];
  for (const teamProfile of teamProfiles) {
    const pages = (teamProfile.piReviewPages ?? [])
      .map((page) => ({ pageUrlOrId: page.pageUrl.trim(), piName: page.piName.trim() }))
      .filter((page) => page.pageUrlOrId !== '');
    if (pages.length === 0) {
      continue;
    }

    const rosterMembers = readRosterForProfile(teamProfile.id);
    const productOwnerMember = rosterMembers.find(
      (member) => member.roleCapabilities?.canProductOwner === true && (member.assigneeQueryValue ?? '').trim() !== '',
    );
    importableTeams.push({
      profileId: teamProfile.id,
      teamName: teamProfile.name.trim(),
      suggestedProductOwner: productOwnerMember?.assigneeQueryValue?.trim() ?? '',
      pages,
    });
  }
  return importableTeams;
}

/** True when the scheduler config already has a team entry matching this profile's name. */
export function findSchedulerTeamIndexByName(schedulerTeams: SchedulerTeamEntry[], teamName: string): number {
  const normalizedName = teamName.trim().toLowerCase();
  return schedulerTeams.findIndex((team) => team.teamName.trim().toLowerCase() === normalizedName);
}

function isSamePage(firstPage: SchedulerPageEntry, secondPage: SchedulerPageEntry): boolean {
  return firstPage.pageUrlOrId === secondPage.pageUrlOrId && firstPage.piName === secondPage.piName;
}

/**
 * Merges an importable team's selected pages into the scheduler config. A team not yet scheduled is
 * appended with sensible defaults (disabled until the operator enables it, daily 06:00, PO suggestion
 * prefilled); an existing team keeps every operator-set field and only gains the pages it was missing.
 */
export function mergeImportedTeamPages(
  schedulerTeams: SchedulerTeamEntry[],
  importableTeam: ImportableTeamPages,
  selectedPages: SchedulerPageEntry[],
): SchedulerTeamEntry[] {
  if (selectedPages.length === 0) {
    return schedulerTeams;
  }

  const existingTeamIndex = findSchedulerTeamIndexByName(schedulerTeams, importableTeam.teamName);
  if (existingTeamIndex < 0) {
    return [
      ...schedulerTeams,
      {
        teamName: importableTeam.teamName,
        isEnabled: false,
        scheduleTime: DEFAULT_SCHEDULE_TIME,
        intervalMin: 0,
        productOwnerAssignee: importableTeam.suggestedProductOwner,
        piFieldId: DEFAULT_PI_FIELD_ID,
        dependencyLinkTypes: [],
        pages: [...selectedPages],
      },
    ];
  }

  return schedulerTeams.map((team, teamIndex) => {
    if (teamIndex !== existingTeamIndex) {
      return team;
    }
    const missingPages = selectedPages.filter(
      (selectedPage) => !team.pages.some((existingPage) => isSamePage(existingPage, selectedPage)),
    );
    return {
      ...team,
      // A blank PO on the existing entry gains the roster suggestion; an operator-set PO is kept.
      productOwnerAssignee: team.productOwnerAssignee.trim() === ''
        ? importableTeam.suggestedProductOwner
        : team.productOwnerAssignee,
      pages: [...team.pages, ...missingPages],
    };
  });
}
