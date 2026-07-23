// useStandupRosterStore.ts — Persisted Team Dashboard roster store shared by Standup and DSU board views.

import { create } from 'zustand';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import {
  buildTeamScopedStorageKey,
  readTeamScopedStorageValue,
  resolveTeamScopedStorageProfileId,
} from './teamScopedStorage.ts';

const STANDUP_ROSTER_STORAGE_KEY = 'tbxSprintDashboardRoster';

/**
 * The three independent role capabilities a team member may perform, used by the Feature Canvas
 * work re-allocation planner to reason about who can take which kind of work. Any combination is
 * valid (including none). This is distinct from the free-text `roleName` job-title label.
 */
export interface RosterRoleCapabilities {
  canDevelop: boolean;
  canInternalTest: boolean;
  canExternalTest: boolean;
  // Coordination / leadership roles. Optional so rosters persisted before these existed stay valid
  // (an absent flag reads as false). SM/PO/Systems Analyst/SA/Dev Lead/RTE give the re-allocation
  // planner fuller context.
  canScrumMaster?: boolean;
  canProductOwner?: boolean;
  canSystemsAnalyst?: boolean;
  canSolutionArchitect?: boolean;
  canDevLead?: boolean;
  canReleaseTrainEngineer?: boolean;
}

export interface StandupRosterMember {
  id: string;
  displayName: string;
  assigneeQueryValue: string;
  jiraAccountId?: string;
  snowUserDisplayName?: string;
  snowUserSysId?: string;
  teamName?: string;
  roleName?: string;
  /** Which of the three roles this person can perform; absent means none are set. */
  roleCapabilities?: RosterRoleCapabilities;
  emailAddress?: string;
  locationTimeZone?: string;
  lanId?: string;
  workingHours?: string;
}

export interface StandupRosterMemberDraft {
  displayName: string;
  assigneeQueryValue: string;
  jiraAccountId?: string;
  snowUserDisplayName?: string;
  snowUserSysId?: string;
  teamName?: string;
  roleName?: string;
  roleCapabilities?: RosterRoleCapabilities;
  emailAddress?: string;
  locationTimeZone?: string;
  lanId?: string;
  workingHours?: string;
}

interface PersistedStandupRosterState {
  rosterMembers: StandupRosterMember[];
}

interface StandupRosterState extends PersistedStandupRosterState {
  dashboardTeamProfileId: string;
  setDashboardTeamProfileId: (dashboardTeamProfileId: string) => void;
  addRosterMember: (memberDraft: StandupRosterMemberDraft) => void;
  upsertRosterMembers: (memberDrafts: StandupRosterMemberDraft[]) => void;
  replaceRosterMembers: (memberDrafts: StandupRosterMemberDraft[]) => void;
  removeRosterMember: (memberId: string) => void;
  setRosterMemberRoles: (memberId: string, capabilities: RosterRoleCapabilities) => void;
}

interface RosterTeamFilterOptions {
  includeTeamlessMembers?: boolean;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function resolveDashboardTeamProfileId(dashboardTeamProfileId: string): string {
  return resolveTeamScopedStorageProfileId(dashboardTeamProfileId);
}

function buildStandupRosterStorageKey(dashboardTeamProfileId: string): string {
  return buildTeamScopedStorageKey(STANDUP_ROSTER_STORAGE_KEY, dashboardTeamProfileId);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeAssigneeQueryValue(assigneeQueryValue: string): string {
  return normalizeWhitespace(assigneeQueryValue).toLowerCase();
}

function createRosterMemberId(assigneeQueryValue: string): string {
  return `roster-member:${normalizeAssigneeQueryValue(assigneeQueryValue)}`;
}

/**
 * Reports whether a persisted `roleCapabilities` value is structurally sound: it must be a plain
 * object whose three known flags, when present, are booleans. Anything else (a string, an array,
 * a non-boolean flag) is considered malformed so the caller can safely drop it to "no roles".
 */
function isValidRoleCapabilities(value: unknown): value is RosterRoleCapabilities {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.canDevelop === undefined || typeof candidate.canDevelop === 'boolean') &&
    (candidate.canInternalTest === undefined || typeof candidate.canInternalTest === 'boolean') &&
    (candidate.canExternalTest === undefined || typeof candidate.canExternalTest === 'boolean') &&
    (candidate.canScrumMaster === undefined || typeof candidate.canScrumMaster === 'boolean') &&
    (candidate.canProductOwner === undefined || typeof candidate.canProductOwner === 'boolean') &&
    (candidate.canSystemsAnalyst === undefined || typeof candidate.canSystemsAnalyst === 'boolean') &&
    (candidate.canSolutionArchitect === undefined || typeof candidate.canSolutionArchitect === 'boolean') &&
    (candidate.canDevLead === undefined || typeof candidate.canDevLead === 'boolean') &&
    (candidate.canReleaseTrainEngineer === undefined || typeof candidate.canReleaseTrainEngineer === 'boolean')
  );
}

function isStandupRosterMember(value: unknown): value is StandupRosterMember {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  // Tolerant read: a malformed persisted role-capabilities value is coerced to "no roles" (undefined)
  // in place so the member still loads. Role data is never allowed to reject an otherwise-valid member.
  if (candidate.roleCapabilities !== undefined && !isValidRoleCapabilities(candidate.roleCapabilities)) {
    delete candidate.roleCapabilities;
  }

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.assigneeQueryValue === 'string' &&
    (candidate.jiraAccountId === undefined || typeof candidate.jiraAccountId === 'string') &&
    (candidate.snowUserDisplayName === undefined || typeof candidate.snowUserDisplayName === 'string') &&
    (candidate.snowUserSysId === undefined || typeof candidate.snowUserSysId === 'string') &&
    (candidate.teamName === undefined || typeof candidate.teamName === 'string') &&
    (candidate.roleName === undefined || typeof candidate.roleName === 'string') &&
    (candidate.emailAddress === undefined || typeof candidate.emailAddress === 'string') &&
    (candidate.locationTimeZone === undefined || typeof candidate.locationTimeZone === 'string') &&
    (candidate.lanId === undefined || typeof candidate.lanId === 'string') &&
    (candidate.workingHours === undefined || typeof candidate.workingHours === 'string')
  );
}

/** Reads the persisted Team Dashboard roster members from localStorage. */
export function readStoredStandupRosterMembers(dashboardTeamProfileId = ''): StandupRosterMember[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const storedValue = readTeamScopedStorageValue(STANDUP_ROSTER_STORAGE_KEY, dashboardTeamProfileId);
    if (storedValue === null) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return [];
    }

    const candidateRosterMembers = (parsedValue as PersistedStandupRosterState).rosterMembers;
    return Array.isArray(candidateRosterMembers) ? candidateRosterMembers.filter(isStandupRosterMember) : [];
  } catch {
    return [];
  }
}

function writeStoredStandupRosterMembers(
  rosterMembers: StandupRosterMember[],
  dashboardTeamProfileId: string,
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      buildStandupRosterStorageKey(dashboardTeamProfileId),
      JSON.stringify({ rosterMembers }),
    );
  } catch {
    // Storage failures are non-fatal because the in-memory roster remains usable.
  }
}

function buildOptionalRosterField(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = normalizeWhitespace(value);
  return normalizedValue || undefined;
}

function createRosterMember(memberDraft: StandupRosterMemberDraft): StandupRosterMember | null {
  const displayName = normalizeWhitespace(memberDraft.displayName);
  const assigneeQueryValue = normalizeWhitespace(memberDraft.assigneeQueryValue);
  if (!displayName || !assigneeQueryValue) {
    return null;
  }

  return {
    id: createRosterMemberId(assigneeQueryValue),
    displayName,
    assigneeQueryValue,
    jiraAccountId: buildOptionalRosterField(memberDraft.jiraAccountId),
    snowUserDisplayName: buildOptionalRosterField(memberDraft.snowUserDisplayName),
    snowUserSysId: buildOptionalRosterField(memberDraft.snowUserSysId),
    emailAddress: buildOptionalRosterField(memberDraft.emailAddress),
    lanId: buildOptionalRosterField(memberDraft.lanId),
    locationTimeZone: buildOptionalRosterField(memberDraft.locationTimeZone),
    roleName: buildOptionalRosterField(memberDraft.roleName),
    teamName: buildOptionalRosterField(memberDraft.teamName),
    workingHours: buildOptionalRosterField(memberDraft.workingHours),
    // Role capabilities are carried through verbatim so a draft→member rebuild (e.g. upsert, SNow
    // linking) never silently drops a person's roles. Absent stays absent (treated as "no roles").
    roleCapabilities: memberDraft.roleCapabilities,
  };
}

function createRosterMemberLookupKey(assigneeQueryValue: string): string {
  return normalizeAssigneeQueryValue(assigneeQueryValue);
}

function normalizeRosterTeamName(teamName: string | undefined): string {
  return buildOptionalRosterField(teamName) ?? '';
}

function addRosterMemberToList(
  currentRosterMembers: StandupRosterMember[],
  memberDraft: StandupRosterMemberDraft,
): StandupRosterMember[] {
  const nextRosterMember = createRosterMember(memberDraft);
  if (nextRosterMember === null) {
    return currentRosterMembers;
  }

  const hasExistingMember = currentRosterMembers.some(
    (rosterMember) =>
      normalizeAssigneeQueryValue(rosterMember.assigneeQueryValue) ===
      normalizeAssigneeQueryValue(nextRosterMember.assigneeQueryValue),
  );
  if (hasExistingMember) {
    return currentRosterMembers;
  }

  return [...currentRosterMembers, nextRosterMember].sort((firstMember, secondMember) =>
    firstMember.displayName.localeCompare(secondMember.displayName),
  );
}

function sortRosterMembers(rosterMembers: StandupRosterMember[]): StandupRosterMember[] {
  return [...rosterMembers].sort((firstMember, secondMember) =>
    firstMember.displayName.localeCompare(secondMember.displayName),
  );
}

function upsertRosterMembersInList(
  currentRosterMembers: StandupRosterMember[],
  memberDrafts: StandupRosterMemberDraft[],
): StandupRosterMember[] {
  const rosterMembersByLookupKey = new Map(
    currentRosterMembers.map((rosterMember) => [
      createRosterMemberLookupKey(rosterMember.assigneeQueryValue),
      rosterMember,
    ]),
  );

  for (const memberDraft of memberDrafts) {
    // Preserve an existing member's role capabilities when the incoming draft carries none. Re-imports
    // from Jira (project users, recent assignees, quick-add) build role-less drafts, so without this a
    // bulk re-import would silently wipe roles a user already set on people already on the roster.
    const existingMember = rosterMembersByLookupKey.get(createRosterMemberLookupKey(memberDraft.assigneeQueryValue));
    const draftWithPreservedRoles = memberDraft.roleCapabilities === undefined && existingMember?.roleCapabilities !== undefined
      ? { ...memberDraft, roleCapabilities: existingMember.roleCapabilities }
      : memberDraft;
    const nextRosterMember = createRosterMember(draftWithPreservedRoles);
    if (nextRosterMember === null) {
      continue;
    }

    rosterMembersByLookupKey.set(
      createRosterMemberLookupKey(nextRosterMember.assigneeQueryValue),
      nextRosterMember,
    );
  }

  return sortRosterMembers([...rosterMembersByLookupKey.values()]);
}

function replaceRosterMembersInList(memberDrafts: StandupRosterMemberDraft[]): StandupRosterMember[] {
  return upsertRosterMembersInList([], memberDrafts);
}

/** Builds a Jira `assignee in (...)` clause from the current standup roster. */
export function buildStandupRosterAssigneeClause(
  rosterMembers = useStandupRosterStore.getState().rosterMembers,
  activeTeamName: string | null = null,
): string | null {
  return buildRosterAssigneeClause('assignee in', rosterMembers, activeTeamName);
}

/**
 * Builds a Jira `assignee WAS in (...)` clause — issues the roster held at ANY point, not only those
 * they hold now.
 *
 * Flow analysis needs this because an issue a developer built and then handed to a product owner
 * outside the roster disappears from a present-tense `assignee in (...)` search. That hand-off is
 * usually where the delay is, so a query that hides it would hide the finding.
 */
export function buildStandupRosterAssigneeWasClause(
  rosterMembers = useStandupRosterStore.getState().rosterMembers,
  activeTeamName: string | null = null,
): string | null {
  return buildRosterAssigneeClause('assignee WAS in', rosterMembers, activeTeamName);
}

/**
 * Shared body of both clause builders, so the team scoping and the quote escaping can never differ
 * between the present-tense and historical forms.
 */
function buildRosterAssigneeClause(
  clauseOperator: 'assignee in' | 'assignee WAS in',
  rosterMembers: StandupRosterMember[],
  activeTeamName: string | null,
): string | null {
  const scopedRosterMembers = activeTeamName === null
    ? rosterMembers
    : filterRosterMembersByActiveTeam(rosterMembers, activeTeamName);
  const assigneeQueryValues = scopedRosterMembers
    .map((rosterMember) => normalizeWhitespace(rosterMember.assigneeQueryValue))
    .filter(Boolean);
  if (assigneeQueryValues.length === 0) {
    return null;
  }

  const escapedQueryValues = assigneeQueryValues.map(
    (assigneeQueryValue) => `"${assigneeQueryValue.replace(/"/g, '\\"')}"`,
  );
  return `${clauseOperator} (${escapedQueryValues.join(', ')})`;
}

/** Returns the distinct imported team names in alphabetical order. */
export function readAvailableRosterTeamNames(
  rosterMembers = useStandupRosterStore.getState().rosterMembers,
): string[] {
  return [...new Set(
    rosterMembers
      .map((rosterMember) => normalizeRosterTeamName(rosterMember.teamName))
      .filter(Boolean),
  )].sort((firstTeamName, secondTeamName) => firstTeamName.localeCompare(secondTeamName));
}

/** Resolves the effective active team, defaulting to the first imported team when none is stored yet. */
export function resolveActiveRosterTeamName(
  storedActiveTeamName: string,
  rosterMembers = useStandupRosterStore.getState().rosterMembers,
): string {
  const availableRosterTeamNames = readAvailableRosterTeamNames(rosterMembers);
  const normalizedStoredActiveTeamName = normalizeRosterTeamName(storedActiveTeamName);
  if (normalizedStoredActiveTeamName && availableRosterTeamNames.includes(normalizedStoredActiveTeamName)) {
    return normalizedStoredActiveTeamName;
  }

  return availableRosterTeamNames[0] ?? '';
}

/** Filters the roster down to the currently active team when team metadata exists. */
export function filterRosterMembersByActiveTeam(
  rosterMembers = useStandupRosterStore.getState().rosterMembers,
  activeTeamName = '',
  options: RosterTeamFilterOptions = {},
): StandupRosterMember[] {
  const resolvedActiveTeamName = resolveActiveRosterTeamName(activeTeamName, rosterMembers);
  if (!resolvedActiveTeamName) {
    return rosterMembers;
  }

  const { includeTeamlessMembers = false } = options;
  return rosterMembers.filter(
    (rosterMember) => {
      const normalizedRosterTeamName = normalizeRosterTeamName(rosterMember.teamName);
      return normalizedRosterTeamName === resolvedActiveTeamName
        || (includeTeamlessMembers && !normalizedRosterTeamName);
    },
  );
}

/** Zustand store for the Team Dashboard roster shared by standup and DSU workflows. */
export const useStandupRosterStore = create<StandupRosterState>((setState, getState) => ({
  dashboardTeamProfileId: resolveDashboardTeamProfileId(
    useSettingsStore.getState().sprintDashboardActiveTeamProfileId,
  ),
  rosterMembers: readStoredStandupRosterMembers(
    useSettingsStore.getState().sprintDashboardActiveTeamProfileId,
  ),
  setDashboardTeamProfileId: (dashboardTeamProfileId) => {
    const resolvedTeamProfileId = resolveDashboardTeamProfileId(dashboardTeamProfileId);
    setState({
      dashboardTeamProfileId: resolvedTeamProfileId,
      rosterMembers: readStoredStandupRosterMembers(resolvedTeamProfileId),
    });
  },
  addRosterMember: (memberDraft) => {
    const rosterMembers = addRosterMemberToList(getState().rosterMembers, memberDraft);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers, getState().dashboardTeamProfileId);
  },
  upsertRosterMembers: (memberDrafts) => {
    const rosterMembers = upsertRosterMembersInList(getState().rosterMembers, memberDrafts);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers, getState().dashboardTeamProfileId);
  },
  replaceRosterMembers: (memberDrafts) => {
    const rosterMembers = replaceRosterMembersInList(memberDrafts);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers, getState().dashboardTeamProfileId);
  },
  removeRosterMember: (memberId) => {
    const rosterMembers = getState().rosterMembers.filter((rosterMember) => rosterMember.id !== memberId);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers, getState().dashboardTeamProfileId);
  },
  setRosterMemberRoles: (memberId, capabilities) => {
    // Replace one member's role triple, then re-persist through the same write path as
    // removeRosterMember so the team-scoped roster stays the single source of truth.
    const rosterMembers = getState().rosterMembers.map((rosterMember) =>
      rosterMember.id === memberId ? { ...rosterMember, roleCapabilities: capabilities } : rosterMember,
    );
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers, getState().dashboardTeamProfileId);
  },
}));
