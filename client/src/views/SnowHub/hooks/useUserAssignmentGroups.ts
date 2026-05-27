// useUserAssignmentGroups.ts — Fetches and maps a selected user's ServiceNow assignment-group memberships.

import { useCallback, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowReference } from './useCrgState.ts';

const MEMBERSHIP_TABLE_PATH = '/api/now/table/sys_user_grmember';
const MEMBERSHIP_QUERY_FIELDS = 'sys_id,group';
const MEMBERSHIP_QUERY_LIMIT = 200;
const UNKNOWN_LOOKUP_ERROR_MESSAGE = 'Failed to load assignment groups.';

type SnowReferenceField = string | { value?: string; display_value?: string } | null | undefined;

interface SnowGroupMembershipRecord {
  sys_id: SnowReferenceField;
  group: SnowReferenceField;
}

interface SnowGroupMembershipResponse {
  result: SnowGroupMembershipRecord[];
}

export interface UserAssignmentGroupMembership {
  membershipSysId: string;
  groupSysId: string;
  groupDisplayName: string;
}

function extractReferenceValue(referenceField: SnowReferenceField): string {
  if (typeof referenceField === 'string') {
    return referenceField;
  }

  return referenceField?.value ?? '';
}

function extractReferenceDisplayValue(referenceField: SnowReferenceField): string {
  if (typeof referenceField === 'string') {
    return referenceField;
  }

  return referenceField?.display_value ?? referenceField?.value ?? '';
}

function buildMembershipQueryPath(userSysId: string, rowOffset: number): string {
  const encodedQuery = encodeURIComponent(`user=${userSysId}`);
  return `${MEMBERSHIP_TABLE_PATH}?sysparm_query=${encodedQuery}&sysparm_fields=${MEMBERSHIP_QUERY_FIELDS}&sysparm_display_value=all&sysparm_limit=${MEMBERSHIP_QUERY_LIMIT}&sysparm_offset=${rowOffset}&sysparm_exclude_reference_link=true`;
}

function mapMembershipRecords(
  membershipRecords: SnowGroupMembershipRecord[],
): UserAssignmentGroupMembership[] {
  const membershipsByGroupSysId = new Map<string, UserAssignmentGroupMembership>();

  membershipRecords.forEach((membershipRecord) => {
    const groupSysId = extractReferenceValue(membershipRecord.group);
    if (!groupSysId) {
      return;
    }

    membershipsByGroupSysId.set(groupSysId, {
      membershipSysId: extractReferenceValue(membershipRecord.sys_id),
      groupSysId,
      groupDisplayName: extractReferenceDisplayValue(membershipRecord.group) || 'Unknown Group',
    });
  });

  return Array.from(membershipsByGroupSysId.values()).sort((firstGroup, secondGroup) =>
    firstGroup.groupDisplayName.localeCompare(secondGroup.groupDisplayName),
  );
}

async function fetchAllMembershipRecords(userSysId: string): Promise<SnowGroupMembershipRecord[]> {
  const allMembershipRecords: SnowGroupMembershipRecord[] = [];
  let rowOffset = 0;
  let hasAdditionalRecords = true;

  while (hasAdditionalRecords) {
    const lookupPath = buildMembershipQueryPath(userSysId, rowOffset);
    const membershipResponse = await snowFetch<SnowGroupMembershipResponse>(lookupPath);
    const currentPageRecords = membershipResponse.result ?? [];
    allMembershipRecords.push(...currentPageRecords);

    if (currentPageRecords.length < MEMBERSHIP_QUERY_LIMIT) {
      hasAdditionalRecords = false;
    } else {
      rowOffset += MEMBERSHIP_QUERY_LIMIT;
    }
  }

  return allMembershipRecords;
}

/**
 * Provides reverse lookup state/actions for finding all assignment groups tied to one ServiceNow user.
 */
export function useUserAssignmentGroups() {
  const [assignmentGroupMemberships, setAssignmentGroupMemberships] = useState<UserAssignmentGroupMembership[]>([]);
  const [isLoadingAssignmentGroups, setIsLoadingAssignmentGroups] = useState<boolean>(false);
  const [lookupErrorMessage, setLookupErrorMessage] = useState<string | null>(null);

  const clearAssignmentGroupResults = useCallback(() => {
    setAssignmentGroupMemberships([]);
    setLookupErrorMessage(null);
  }, []);

  const lookupAssignmentGroupsForUser = useCallback(async (selectedUser: SnowReference) => {
    if (!selectedUser.sysId) {
      setAssignmentGroupMemberships([]);
      setLookupErrorMessage('Select a user before running assignment-group lookup.');
      return;
    }

    setIsLoadingAssignmentGroups(true);
    setLookupErrorMessage(null);

    try {
      const allMembershipRecords = await fetchAllMembershipRecords(selectedUser.sysId);
      const mappedMemberships = mapMembershipRecords(allMembershipRecords);
      setAssignmentGroupMemberships(mappedMemberships);
    } catch (lookupError: unknown) {
      const resolvedErrorMessage = lookupError instanceof Error
        ? lookupError.message
        : UNKNOWN_LOOKUP_ERROR_MESSAGE;
      setAssignmentGroupMemberships([]);
      setLookupErrorMessage(resolvedErrorMessage);
    } finally {
      setIsLoadingAssignmentGroups(false);
    }
  }, []);

  return {
    assignmentGroupMemberships,
    isLoadingAssignmentGroups,
    lookupErrorMessage,
    lookupAssignmentGroupsForUser,
    clearAssignmentGroupResults,
  };
}
