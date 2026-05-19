// useStandupRosterStore.ts — Persisted Team Dashboard roster store shared by Standup and DSU board views.

import { create } from 'zustand';

const STANDUP_ROSTER_STORAGE_KEY = 'tbxSprintDashboardRoster';

export interface StandupRosterMember {
  id: string;
  displayName: string;
  assigneeQueryValue: string;
  teamName?: string;
  roleName?: string;
  emailAddress?: string;
  locationTimeZone?: string;
  lanId?: string;
  workingHours?: string;
}

export interface StandupRosterMemberDraft {
  displayName: string;
  assigneeQueryValue: string;
  teamName?: string;
  roleName?: string;
  emailAddress?: string;
  locationTimeZone?: string;
  lanId?: string;
  workingHours?: string;
}

interface PersistedStandupRosterState {
  rosterMembers: StandupRosterMember[];
}

interface StandupRosterState extends PersistedStandupRosterState {
  addRosterMember: (memberDraft: StandupRosterMemberDraft) => void;
  upsertRosterMembers: (memberDrafts: StandupRosterMemberDraft[]) => void;
  replaceRosterMembers: (memberDrafts: StandupRosterMemberDraft[]) => void;
  removeRosterMember: (memberId: string) => void;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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

function isStandupRosterMember(value: unknown): value is StandupRosterMember {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.assigneeQueryValue === 'string' &&
    (candidate.teamName === undefined || typeof candidate.teamName === 'string') &&
    (candidate.roleName === undefined || typeof candidate.roleName === 'string') &&
    (candidate.emailAddress === undefined || typeof candidate.emailAddress === 'string') &&
    (candidate.locationTimeZone === undefined || typeof candidate.locationTimeZone === 'string') &&
    (candidate.lanId === undefined || typeof candidate.lanId === 'string') &&
    (candidate.workingHours === undefined || typeof candidate.workingHours === 'string')
  );
}

/** Reads the persisted Team Dashboard roster members from localStorage. */
export function readStoredStandupRosterMembers(): StandupRosterMember[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(STANDUP_ROSTER_STORAGE_KEY);
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

function writeStoredStandupRosterMembers(rosterMembers: StandupRosterMember[]): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STANDUP_ROSTER_STORAGE_KEY, JSON.stringify({ rosterMembers }));
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
    emailAddress: buildOptionalRosterField(memberDraft.emailAddress),
    lanId: buildOptionalRosterField(memberDraft.lanId),
    locationTimeZone: buildOptionalRosterField(memberDraft.locationTimeZone),
    roleName: buildOptionalRosterField(memberDraft.roleName),
    teamName: buildOptionalRosterField(memberDraft.teamName),
    workingHours: buildOptionalRosterField(memberDraft.workingHours),
  };
}

function createRosterMemberLookupKey(assigneeQueryValue: string): string {
  return normalizeAssigneeQueryValue(assigneeQueryValue);
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
    const nextRosterMember = createRosterMember(memberDraft);
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
): string | null {
  const assigneeQueryValues = rosterMembers
    .map((rosterMember) => normalizeWhitespace(rosterMember.assigneeQueryValue))
    .filter(Boolean);
  if (assigneeQueryValues.length === 0) {
    return null;
  }

  const escapedQueryValues = assigneeQueryValues.map(
    (assigneeQueryValue) => `"${assigneeQueryValue.replace(/"/g, '\\"')}"`,
  );
  return `assignee in (${escapedQueryValues.join(', ')})`;
}

/** Zustand store for the Team Dashboard roster shared by standup and DSU workflows. */
export const useStandupRosterStore = create<StandupRosterState>((setState, getState) => ({
  rosterMembers: readStoredStandupRosterMembers(),
  addRosterMember: (memberDraft) => {
    const rosterMembers = addRosterMemberToList(getState().rosterMembers, memberDraft);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers);
  },
  upsertRosterMembers: (memberDrafts) => {
    const rosterMembers = upsertRosterMembersInList(getState().rosterMembers, memberDrafts);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers);
  },
  replaceRosterMembers: (memberDrafts) => {
    const rosterMembers = replaceRosterMembersInList(memberDrafts);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers);
  },
  removeRosterMember: (memberId) => {
    const rosterMembers = getState().rosterMembers.filter((rosterMember) => rosterMember.id !== memberId);
    setState({ rosterMembers });
    writeStoredStandupRosterMembers(rosterMembers);
  },
}));
