// RosterTab.tsx — Team Dashboard roster settings used by roster-scoped standup workflows.

import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { snowFetch } from '../../services/snowApi.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import type { JiraIssue, JiraUser } from '../../types/jira.ts';
import type { SnowIssueType, SnowMyIssue, SnowTableResponse } from '../../types/snow.ts';
import { SnowLookupField } from '../SnowHub/components/SnowLookupField.tsx';
import {
  filterRosterMembersByActiveTeam,
  readAvailableRosterTeamNames,
  resolveActiveRosterTeamName,
  type StandupRosterMember,
  type StandupRosterMemberDraft,
  useStandupRosterStore,
} from './hooks/useStandupRosterStore.ts';
import styles from './SprintDashboardView.module.css';

const MIN_JIRA_ROSTER_SEARCH_LENGTH = 2;
const MAX_JIRA_ROSTER_SEARCH_RESULTS = 8;
const JIRA_PROJECT_USER_PAGE_SIZE = 50;
const MAX_JIRA_PROJECT_USER_PAGES = 20;
const MAX_SNOW_RECORDS_PER_TYPE = 25;
const SNOW_ROSTER_WORK_FIELDS =
  'sys_id,number,short_description,state,priority,sys_class_name,opened_at,problem_statement';
const SNOW_ROSTER_RECORD_TYPES: SnowIssueType[] = ['incident', 'problem', 'sc_task', 'change_request'];

interface RosterSnowReference {
  sysId: string;
  displayName: string;
}

interface RosterTabProps {
  issues: JiraIssue[];
  projectKey: string;
}

interface RosterSuggestion {
  displayName: string;
  assigneeQueryValue: string;
  jiraAccountId?: string;
  emailAddress?: string;
}

interface JiraRosterSearchResult {
  displayName: string;
  assigneeQueryValue: string;
  jiraAccountId: string;
  emailAddress?: string;
}

interface ProjectUserSelectionCardProps {
  isSelected: boolean;
  rosterMember: JiraRosterSearchResult;
  onSelectionChange: (changeEvent: ChangeEvent<HTMLInputElement>) => void;
}

interface RosterCardProps {
  rosterMember: Pick<
    StandupRosterMember | StandupRosterMemberDraft,
    | 'assigneeQueryValue'
    | 'displayName'
    | 'jiraAccountId'
    | 'snowUserDisplayName'
    | 'snowUserSysId'
    | 'emailAddress'
    | 'lanId'
    | 'locationTimeZone'
    | 'roleName'
    | 'teamName'
    | 'workingHours'
  >;
  actionAriaLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

interface RosterLinkedWorkPanelProps {
  rosterMember: StandupRosterMember;
  jiraIssues: JiraIssue[];
  snowIssues: SnowMyIssue[];
  hasLoadedSnowWork: boolean;
  isSnowRelayConnected: boolean;
  onSnowUserChange: (nextReference: RosterSnowReference) => void;
}

function buildRosterSuggestions(issues: JiraIssue[], rosterAssigneeValues: Set<string>): RosterSuggestion[] {
  const suggestionsByValue = new Map<string, RosterSuggestion>();
  for (const issue of issues) {
    const displayName = issue.fields.assignee?.displayName?.trim();
    if (!displayName) {
      continue;
    }

    const normalizedAssigneeValue = displayName.toLowerCase();
    if (rosterAssigneeValues.has(normalizedAssigneeValue) || suggestionsByValue.has(normalizedAssigneeValue)) {
      continue;
    }

    suggestionsByValue.set(normalizedAssigneeValue, {
      displayName,
      assigneeQueryValue: displayName,
      emailAddress: issue.fields.assignee?.emailAddress,
      jiraAccountId: issue.fields.assignee?.accountId,
    });
  }

  return [...suggestionsByValue.values()].sort((firstSuggestion, secondSuggestion) =>
    firstSuggestion.displayName.localeCompare(secondSuggestion.displayName),
  );
}

function buildRosterCardMetaLine(...metaParts: Array<string | undefined>): string | null {
  const populatedMetaParts = metaParts.filter(Boolean);
  return populatedMetaParts.length > 0 ? populatedMetaParts.join(' · ') : null;
}

function normalizeRosterMatchValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function doesIssueBelongToRosterMember(issue: JiraIssue, rosterMember: StandupRosterMember): boolean {
  const issueAssignee = issue.fields.assignee;
  if (issueAssignee === null) {
    return false;
  }

  if (rosterMember.jiraAccountId && issueAssignee.accountId === rosterMember.jiraAccountId) {
    return true;
  }

  const normalizedIssueAssigneeDisplayName = normalizeRosterMatchValue(issueAssignee.displayName);
  return normalizedIssueAssigneeDisplayName === normalizeRosterMatchValue(rosterMember.assigneeQueryValue)
    || normalizedIssueAssigneeDisplayName === normalizeRosterMatchValue(rosterMember.displayName);
}

function buildRosterSnowTablePath(recordType: SnowIssueType, snowUserSysId: string): string {
  const encodedQuery = encodeURIComponent(`assigned_to=${snowUserSysId}^active=true`);
  return (
    `/api/now/table/${recordType}` +
    `?sysparm_query=${encodedQuery}` +
    `&sysparm_fields=${SNOW_ROSTER_WORK_FIELDS}` +
    `&sysparm_limit=${MAX_SNOW_RECORDS_PER_TYPE}` +
    '&sysparm_display_value=true'
  );
}

async function fetchSnowWorkItemsForRosterMember(snowUserSysId: string): Promise<SnowMyIssue[]> {
  const snowIssueGroups = await Promise.all(
    SNOW_ROSTER_RECORD_TYPES.map(async (recordType) => {
      const snowResponse = await snowFetch<SnowTableResponse<SnowMyIssue>>(buildRosterSnowTablePath(recordType, snowUserSysId));
      return snowResponse.result.map((snowIssue) => ({ ...snowIssue, sys_class_name: recordType }));
    }),
  );

  return snowIssueGroups
    .flat()
    .sort((firstIssue, secondIssue) => new Date(secondIssue.opened_at).getTime() - new Date(firstIssue.opened_at).getTime());
}

/**
 * Reads the stable identity key for a Jira user across Cloud (accountId) and Server (name/key).
 * Jira Cloud always provides accountId; Jira Server provides name and key instead.
 */
function readJiraUserIdentityKey(jiraUser: JiraUser): string {
  return jiraUser.accountId?.trim() || jiraUser.name?.trim() || jiraUser.key?.trim() || '';
}

/**
 * Reads the best available assignee query value for a Jira user.
 * Jira Cloud assignees are identified by displayName in JQL; Jira Server by username/name.
 */
function readJiraUserAssigneeQueryValue(jiraUser: JiraUser): string {
  return jiraUser.displayName?.trim() || jiraUser.name?.trim() || '';
}

function mapJiraUsersToRosterSearchResults(
  jiraUsers: JiraUser[],
  rosterAssigneeValues: Set<string>,
): JiraRosterSearchResult[] {
  const searchResultsByIdentityKey = new Map<string, JiraRosterSearchResult>();
  for (const jiraUser of jiraUsers) {
    const identityKey = readJiraUserIdentityKey(jiraUser);
    const displayName = jiraUser.displayName?.trim() || jiraUser.name?.trim() || '';
    if (!displayName || !identityKey) {
      continue;
    }

    const assigneeQueryValue = readJiraUserAssigneeQueryValue(jiraUser);
    const normalizedAssigneeValue = assigneeQueryValue.toLowerCase();
    if (rosterAssigneeValues.has(normalizedAssigneeValue) || searchResultsByIdentityKey.has(identityKey)) {
      continue;
    }

    searchResultsByIdentityKey.set(identityKey, {
      displayName,
      assigneeQueryValue,
      jiraAccountId: jiraUser.accountId?.trim() || jiraUser.name?.trim() || identityKey,
      emailAddress: jiraUser.emailAddress?.trim() || undefined,
    });
  }

  return [...searchResultsByIdentityKey.values()].sort((firstUser, secondUser) =>
    firstUser.displayName.localeCompare(secondUser.displayName),
  );
}

async function loadPaginatedProjectUsers(
  requestPathBuilder: (startAt: number) => string,
): Promise<JiraUser[]> {
  const projectUsersByIdentityKey = new Map<string, JiraUser>();

  for (let pageIndex = 0; pageIndex < MAX_JIRA_PROJECT_USER_PAGES; pageIndex += 1) {
    const startAt = pageIndex * JIRA_PROJECT_USER_PAGE_SIZE;
    // Guard against non-array responses — some Jira versions return null or a non-array on error.
    const rawResponse = await jiraGet<JiraUser[] | null | undefined>(requestPathBuilder(startAt));
    const jiraUsers = Array.isArray(rawResponse) ? rawResponse : [];

    for (const jiraUser of jiraUsers) {
      const identityKey = readJiraUserIdentityKey(jiraUser);
      if (identityKey) {
        projectUsersByIdentityKey.set(identityKey, jiraUser);
      }
    }

    if (jiraUsers.length < JIRA_PROJECT_USER_PAGE_SIZE) {
      break;
    }
  }

  return [...projectUsersByIdentityKey.values()];
}

/** Detects whether a Jira error message indicates a redirect or missing-query-param issue. */
function isJiraAssignableSearchRedirectError(caughtError: unknown): boolean {
  if (!(caughtError instanceof Error)) {
    return false;
  }
  const lowerMessage = caughtError.message.toLowerCase();
  // 302 = redirect (Jira Server requires username param); 400 = missing required param on some versions
  return lowerMessage.includes(': 302') || lowerMessage.includes(': 400');
}

async function loadProjectUsersForRoster(
  normalizedProjectKey: string,
  rosterAssigneeValues: Set<string>,
): Promise<JiraRosterSearchResult[]> {
  // Try the standard v2 assignable/search endpoint first (works on Jira Cloud and most Server versions).
  // On some Jira Server versions this endpoint requires a `username` query parameter and returns a
  // 302 redirect when the param is absent — detect that and retry with an empty username param.
  let assignableProjectUsers: JiraUser[];
  try {
    assignableProjectUsers = await loadPaginatedProjectUsers(
      (startAt) =>
        `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&startAt=${startAt}&maxResults=${JIRA_PROJECT_USER_PAGE_SIZE}`,
    );
  } catch (caughtError) {
    if (!isJiraAssignableSearchRedirectError(caughtError)) {
      throw caughtError;
    }
    // Jira Server fallback: include username= so the server does not redirect.
    // An empty username string returns all assignable users on Jira Server.
    assignableProjectUsers = await loadPaginatedProjectUsers(
      (startAt) =>
        `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&username=&startAt=${startAt}&maxResults=${JIRA_PROJECT_USER_PAGE_SIZE}`,
    );
  }

  // If the no-query call returned 0 users (Jira Server silently returns empty without redirecting),
  // retry with username= which forces the server to enumerate all assignable users.
  if (assignableProjectUsers.length === 0) {
    const serverFallbackUsers = await loadPaginatedProjectUsers(
      (startAt) =>
        `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&username=&startAt=${startAt}&maxResults=${JIRA_PROJECT_USER_PAGE_SIZE}`,
    );
    if (serverFallbackUsers.length > 0) {
      return mapJiraUsersToRosterSearchResults(serverFallbackUsers, rosterAssigneeValues);
    }
  }

  return mapJiraUsersToRosterSearchResults(assignableProjectUsers, rosterAssigneeValues);
}

function RosterCard({ rosterMember, actionAriaLabel, actionLabel, onAction, children }: RosterCardProps) {
  const primaryMetaLine = buildRosterCardMetaLine(rosterMember.emailAddress);
  const jiraMetaLine = buildRosterCardMetaLine(
    `Jira: ${rosterMember.assigneeQueryValue}`,
    rosterMember.jiraAccountId ? `Account: ${rosterMember.jiraAccountId}` : undefined,
  );
  const snowMetaLine = buildRosterCardMetaLine(
    rosterMember.snowUserDisplayName ? `SNow: ${rosterMember.snowUserDisplayName}` : undefined,
    rosterMember.snowUserSysId ? `User: ${rosterMember.snowUserSysId}` : undefined,
  );
  const secondaryMetaLine = buildRosterCardMetaLine(
    rosterMember.locationTimeZone,
    rosterMember.workingHours,
    rosterMember.lanId ? `LAN: ${rosterMember.lanId}` : undefined,
  );

  return (
    <article className={styles.rosterMemberCard}>
      <div className={styles.rosterMemberCardHeader}>
        <div className={styles.rosterMemberHeaderText}>
          <p className={styles.rosterMemberName}>{rosterMember.displayName}</p>
          <div className={styles.rosterChipRow}>
            {rosterMember.teamName ? (
              <span className={styles.rosterTeamBadge}>{rosterMember.teamName}</span>
            ) : (
              <span className={styles.rosterDetailChip}>Needs team</span>
            )}
            {rosterMember.roleName ? <span className={styles.rosterDetailChip}>{rosterMember.roleName}</span> : null}
            {rosterMember.snowUserSysId ? <span className={styles.rosterDetailChip}>SNow linked</span> : null}
          </div>
        </div>
        {onAction && actionLabel ? (
          <button
            aria-label={actionAriaLabel ?? `${actionLabel} ${rosterMember.displayName}`}
            className={styles.textActionButton}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {primaryMetaLine ? <p className={styles.rosterMemberPrimaryMeta}>{primaryMetaLine}</p> : null}
      {jiraMetaLine ? <p className={styles.rosterMemberPrimaryMeta}>{jiraMetaLine}</p> : null}
      {snowMetaLine ? <p className={styles.rosterMemberPrimaryMeta}>{snowMetaLine}</p> : null}
      {secondaryMetaLine ? <p className={styles.rosterMemberSecondaryMeta}>{secondaryMetaLine}</p> : null}
      {children}
    </article>
  );
}

function ProjectUserSelectionCard({
  isSelected,
  rosterMember,
  onSelectionChange,
}: ProjectUserSelectionCardProps) {
  return (
    <RosterCard rosterMember={rosterMember}>
      <label className={styles.rosterSelectionRow}>
        <input
          aria-label={`Select ${rosterMember.displayName} for roster`}
          checked={isSelected}
          className={styles.rosterSelectionCheckbox}
          onChange={onSelectionChange}
          type="checkbox"
        />
        <span>{isSelected ? 'Selected for roster' : 'Not selected'}</span>
      </label>
    </RosterCard>
  );
}

function RosterLinkedWorkPanel({
  rosterMember,
  jiraIssues,
  snowIssues,
  hasLoadedSnowWork,
  isSnowRelayConnected,
  onSnowUserChange,
}: RosterLinkedWorkPanelProps) {
  const snowLookupValue: RosterSnowReference = {
    sysId: rosterMember.snowUserSysId ?? '',
    displayName: rosterMember.snowUserDisplayName ?? '',
  };

  return (
    <div className={styles.rosterLinkedWorkPanel}>
      <div className={styles.rosterLinkFieldShell}>
        <SnowLookupField
          isDisabled={!isSnowRelayConnected}
          label={`Link ServiceNow person for ${rosterMember.displayName}`}
          tableName="sys_user"
          value={snowLookupValue}
          onChange={onSnowUserChange}
        />
      </div>
      {!isSnowRelayConnected ? (
        <p className={styles.personWalkMeta}>
          Connect the ServiceNow relay bookmarklet to search and link SNow users for this roster member.
        </p>
      ) : null}
      <div className={styles.rosterWorkloadGrid}>
        <section className={styles.rosterWorkloadColumn}>
          <div className={styles.rosterWorkloadHeader}>
            <h4 className={styles.rosterWorkloadTitle}>Jira sprint work</h4>
            <span className={styles.columnCountBadge}>{jiraIssues.length}</span>
          </div>
          {jiraIssues.length === 0 ? (
            <p className={styles.personWalkMeta}>No current sprint Jira issues match this roster member.</p>
          ) : (
            <ul className={styles.rosterWorkItemList}>
              {jiraIssues.map((jiraIssue) => (
                <li className={styles.rosterWorkItem} key={jiraIssue.key}>
                  <span className={styles.rosterWorkItemKey}>{jiraIssue.key}</span>
                  <span className={styles.rosterWorkItemSummary}>{jiraIssue.fields.summary}</span>
                  <span className={styles.rosterWorkItemMeta}>{jiraIssue.fields.status.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.rosterWorkloadColumn}>
          <div className={styles.rosterWorkloadHeader}>
            <h4 className={styles.rosterWorkloadTitle}>ServiceNow work</h4>
            <span className={styles.columnCountBadge}>{snowIssues.length}</span>
          </div>
          {!rosterMember.snowUserSysId ? (
            <p className={styles.personWalkMeta}>Link a ServiceNow user to show this person&apos;s SNow work.</p>
          ) : !isSnowRelayConnected ? (
            <p className={styles.personWalkMeta}>Reconnect the ServiceNow relay to load work items.</p>
          ) : !hasLoadedSnowWork ? (
            <p className={styles.personWalkMeta}>Use Refresh linked Jira + SNow work to load this person&apos;s SNow records.</p>
          ) : snowIssues.length === 0 ? (
            <p className={styles.personWalkMeta}>No active SNow work was found for the linked user.</p>
          ) : (
            <ul className={styles.rosterWorkItemList}>
              {snowIssues.map((snowIssue) => (
                <li className={styles.rosterWorkItem} key={snowIssue.sys_id}>
                  <span className={styles.rosterWorkItemKey}>{snowIssue.number}</span>
                  <span className={styles.rosterWorkItemSummary}>{snowIssue.short_description}</span>
                  <span className={styles.rosterWorkItemMeta}>{snowIssue.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Renders the Team Dashboard roster editor so roster-scoped standup can be filtered by active team. */
export default function RosterTab({ issues, projectKey }: RosterTabProps) {
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const addRosterMember = useStandupRosterStore((state) => state.addRosterMember);
  const removeRosterMember = useStandupRosterStore((state) => state.removeRosterMember);
  const upsertRosterMembers = useStandupRosterStore((state) => state.upsertRosterMembers);
  const isSnowRelayConnected = useConnectionStore((state) => state.relayBridgeStatus?.isConnected ?? false);
  const storedActiveTeamName = useSettingsStore((state) => state.sprintDashboardActiveTeam);
  const setActiveTeamName = useSettingsStore((state) => state.setSprintDashboardActiveTeam);
  const [displayName, setDisplayName] = useState('');
  const [assigneeQueryValue, setAssigneeQueryValue] = useState('');
  const [jiraSearchQuery, setJiraSearchQuery] = useState('');
  const [jiraSearchResults, setJiraSearchResults] = useState<JiraRosterSearchResult[]>([]);
  const [jiraSearchErrorMessage, setJiraSearchErrorMessage] = useState<string | null>(null);
  const [jiraSearchStatusMessage, setJiraSearchStatusMessage] = useState<string | null>(null);
  const [isSearchingJiraUsers, setIsSearchingJiraUsers] = useState(false);
  // loadProjectKey is a local override so users can load users from any project,
  // independent of the Team Dashboard's active sprint project.
  const [loadProjectKey, setLoadProjectKey] = useState(() => projectKey.trim().toUpperCase());
  const [projectUserResults, setProjectUserResults] = useState<JiraRosterSearchResult[]>([]);
  const [selectedProjectUserIds, setSelectedProjectUserIds] = useState<string[]>([]);
  const [projectUserErrorMessage, setProjectUserErrorMessage] = useState<string | null>(null);
  const [projectUserStatusMessage, setProjectUserStatusMessage] = useState<string | null>(null);
  const [isLoadingProjectUsers, setIsLoadingProjectUsers] = useState(false);
  const [snowWorkByRosterMemberId, setSnowWorkByRosterMemberId] = useState<Record<string, SnowMyIssue[]>>({});
  const [snowWorkErrorMessage, setSnowWorkErrorMessage] = useState<string | null>(null);
  const [snowWorkStatusMessage, setSnowWorkStatusMessage] = useState<string | null>(null);
  const [isLoadingSnowWork, setIsLoadingSnowWork] = useState(false);

  const rosterAssigneeValues = useMemo(
    () => new Set(rosterMembers.map((rosterMember) => rosterMember.assigneeQueryValue.trim().toLowerCase())),
    [rosterMembers],
  );
  const rosterSuggestions = useMemo(
    () => buildRosterSuggestions(issues, rosterAssigneeValues),
    [issues, rosterAssigneeValues],
  );
  const visibleJiraSearchResults = useMemo(
    () => jiraSearchResults.filter(
      (searchResult) => !rosterAssigneeValues.has(searchResult.assigneeQueryValue.trim().toLowerCase()),
    ),
    [jiraSearchResults, rosterAssigneeValues],
  );
  const visibleProjectUserResults = useMemo(
    () => projectUserResults.filter(
      (projectUserResult) => !rosterAssigneeValues.has(projectUserResult.assigneeQueryValue.trim().toLowerCase()),
    ),
    [projectUserResults, rosterAssigneeValues],
  );
  const availableRosterTeamNames = useMemo(
    () => readAvailableRosterTeamNames(rosterMembers),
    [rosterMembers],
  );
  const activeRosterTeamName = useMemo(
    () => resolveActiveRosterTeamName(storedActiveTeamName, rosterMembers),
    [rosterMembers, storedActiveTeamName],
  );
  const visibleRosterMembers = useMemo(
    () => filterRosterMembersByActiveTeam(rosterMembers, activeRosterTeamName, { includeTeamlessMembers: true }),
    [activeRosterTeamName, rosterMembers],
  );
  const jiraIssuesByRosterMemberId = useMemo(
    () => new Map(
      visibleRosterMembers.map((rosterMember) => [
        rosterMember.id,
        issues.filter((jiraIssue) => doesIssueBelongToRosterMember(jiraIssue, rosterMember)),
      ]),
    ),
    [issues, visibleRosterMembers],
  );
  const linkedSnowRosterMemberCount = useMemo(
    () => visibleRosterMembers.filter((rosterMember) => rosterMember.snowUserSysId).length,
    [visibleRosterMembers],
  );

  function handleAddManualMember() {
    addRosterMember({
      displayName,
      assigneeQueryValue,
      teamName: activeRosterTeamName || undefined,
    });
    setDisplayName('');
    setAssigneeQueryValue('');
  }

  function resetProjectUserSelection(nextProjectUsers: JiraRosterSearchResult[]) {
    setProjectUserResults(nextProjectUsers);
    setSelectedProjectUserIds(nextProjectUsers.map((projectUserResult) => projectUserResult.jiraAccountId));
  }

  async function handleSearchJiraUsers() {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const normalizedSearchQuery = jiraSearchQuery.trim();
    if (!normalizedProjectKey) {
      setJiraSearchResults([]);
      setJiraSearchStatusMessage(null);
      setJiraSearchErrorMessage('Enter and load a Jira project before searching for project users.');
      return;
    }

    if (normalizedSearchQuery.length < MIN_JIRA_ROSTER_SEARCH_LENGTH) {
      setJiraSearchResults([]);
      setJiraSearchStatusMessage(null);
      setJiraSearchErrorMessage(
        `Enter at least ${MIN_JIRA_ROSTER_SEARCH_LENGTH} characters before searching Jira project users.`,
      );
      return;
    }

    setIsSearchingJiraUsers(true);
    try {
      const jiraUsers = await jiraGet<JiraUser[]>(
        `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&query=${encodeURIComponent(normalizedSearchQuery)}&maxResults=${MAX_JIRA_ROSTER_SEARCH_RESULTS}`,
      );
      const nextSearchResults = mapJiraUsersToRosterSearchResults(jiraUsers, rosterAssigneeValues);
      setJiraSearchResults(nextSearchResults);
      setJiraSearchErrorMessage(null);
      setJiraSearchStatusMessage(
        nextSearchResults.length > 0
          ? `Found ${nextSearchResults.length} Jira project users for ${normalizedProjectKey}.`
          : `No Jira project users matched "${normalizedSearchQuery}" in ${normalizedProjectKey}.`,
      );
    } catch (caughtError) {
      setJiraSearchResults([]);
      setJiraSearchStatusMessage(null);
      setJiraSearchErrorMessage(
        caughtError instanceof Error ? caughtError.message : 'Failed to search Jira project users.',
      );
    } finally {
      setIsSearchingJiraUsers(false);
    }
  }

  async function handleLoadProjectUsers() {
    const normalizedProjectKey = loadProjectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      setProjectUserStatusMessage(null);
      setProjectUserErrorMessage('Enter a project key to load its assignable Jira users.');
      resetProjectUserSelection([]);
      return;
    }

    setIsLoadingProjectUsers(true);
    try {
      const nextProjectUsers = await loadProjectUsersForRoster(normalizedProjectKey, rosterAssigneeValues);
      resetProjectUserSelection(nextProjectUsers);
      setProjectUserErrorMessage(null);
      setProjectUserStatusMessage(
        nextProjectUsers.length > 0
          ? `Loaded ${nextProjectUsers.length} Jira project users for ${normalizedProjectKey}.`
          : `No Jira project users are currently available for ${normalizedProjectKey}.`,
      );
    } catch (caughtError) {
      resetProjectUserSelection([]);
      setProjectUserStatusMessage(null);
      setProjectUserErrorMessage(
        caughtError instanceof Error ? caughtError.message : 'Failed to load Jira project users.',
      );
    } finally {
      setIsLoadingProjectUsers(false);
    }
  }

  function handleAddJiraSearchResult(searchResult: JiraRosterSearchResult) {
    addRosterMember({
      displayName: searchResult.displayName,
      assigneeQueryValue: searchResult.assigneeQueryValue,
      jiraAccountId: searchResult.jiraAccountId,
      emailAddress: searchResult.emailAddress,
      teamName: activeRosterTeamName || undefined,
    });
    setJiraSearchStatusMessage(`Added ${searchResult.displayName} to the roster.`);
  }

  function handleToggleProjectUserSelection(jiraAccountId: string, isSelected: boolean) {
    setSelectedProjectUserIds((currentSelectedProjectUserIds) => {
      if (isSelected) {
        return currentSelectedProjectUserIds.includes(jiraAccountId)
          ? currentSelectedProjectUserIds
          : [...currentSelectedProjectUserIds, jiraAccountId];
      }

      return currentSelectedProjectUserIds.filter((selectedProjectUserId) => selectedProjectUserId !== jiraAccountId);
    });
  }

  function handleSelectAllProjectUsers() {
    setSelectedProjectUserIds(visibleProjectUserResults.map((projectUserResult) => projectUserResult.jiraAccountId));
  }

  function handleDeselectAllProjectUsers() {
    setSelectedProjectUserIds([]);
  }

  function handleAddSelectedProjectUsers() {
    const selectedProjectUsers = visibleProjectUserResults.filter((projectUserResult) =>
      selectedProjectUserIds.includes(projectUserResult.jiraAccountId),
    );

    upsertRosterMembers(
      selectedProjectUsers.map((projectUserResult) => ({
        displayName: projectUserResult.displayName,
        assigneeQueryValue: projectUserResult.assigneeQueryValue,
        jiraAccountId: projectUserResult.jiraAccountId,
        emailAddress: projectUserResult.emailAddress,
        teamName: activeRosterTeamName || undefined,
      })),
    );

    setProjectUserStatusMessage(
      selectedProjectUsers.length > 0
        ? `Added ${selectedProjectUsers.length} project users to the roster.`
        : 'Select at least one project user before adding them to the roster.',
    );
    resetProjectUserSelection([]);
  }

  function handleSnowUserChange(rosterMember: StandupRosterMember, nextReference: RosterSnowReference) {
    setSnowWorkByRosterMemberId((currentSnowWorkByRosterMemberId) => {
      const nextSnowWorkByRosterMemberId = { ...currentSnowWorkByRosterMemberId };
      delete nextSnowWorkByRosterMemberId[rosterMember.id];
      return nextSnowWorkByRosterMemberId;
    });
    setSnowWorkStatusMessage(null);
    setSnowWorkErrorMessage(null);
    upsertRosterMembers([
      {
        displayName: rosterMember.displayName,
        assigneeQueryValue: rosterMember.assigneeQueryValue,
        jiraAccountId: rosterMember.jiraAccountId,
        snowUserDisplayName: nextReference.displayName || undefined,
        snowUserSysId: nextReference.sysId || undefined,
        emailAddress: rosterMember.emailAddress,
        lanId: rosterMember.lanId,
        locationTimeZone: rosterMember.locationTimeZone,
        roleName: rosterMember.roleName,
        teamName: rosterMember.teamName,
        workingHours: rosterMember.workingHours,
      },
    ]);
  }

  async function handleRefreshLinkedSnowWork() {
    if (linkedSnowRosterMemberCount === 0) {
      setSnowWorkErrorMessage('Link at least one ServiceNow user before refreshing linked work.');
      setSnowWorkStatusMessage(null);
      return;
    }

    if (!isSnowRelayConnected) {
      setSnowWorkErrorMessage(
        'Connect the ServiceNow relay bookmarklet before refreshing linked Jira + SNow work.',
      );
      setSnowWorkStatusMessage(null);
      return;
    }

    setIsLoadingSnowWork(true);
    setSnowWorkErrorMessage(null);
    try {
      const snowWorkEntries = await Promise.all(
        visibleRosterMembers
          .filter((rosterMember) => rosterMember.snowUserSysId)
          .map(async (rosterMember) => [
            rosterMember.id,
            await fetchSnowWorkItemsForRosterMember(rosterMember.snowUserSysId ?? ''),
          ] as const),
      );
      setSnowWorkByRosterMemberId(Object.fromEntries(snowWorkEntries));
      setSnowWorkStatusMessage(`Loaded ServiceNow work for ${snowWorkEntries.length} linked roster members.`);
    } catch (caughtError) {
      setSnowWorkStatusMessage(null);
      setSnowWorkErrorMessage(
        caughtError instanceof Error ? caughtError.message : 'Failed to load linked ServiceNow work.',
      );
    } finally {
      setIsLoadingSnowWork(false);
    }
  }

  return (
    <div className={styles.rosterShell}>
      <section className={styles.rosterSection}>
        <div className={styles.dashboardTabHeader}>
          <div className={styles.dashboardTabCopy}>
            <h2 className={styles.blockersSectionTitle}>Roster Settings</h2>
            <p className={styles.dashboardTabSubtitle}>
              Manage the people list used by roster-scoped standup. The active team controls who appears when roster scope is selected.
            </p>
          </div>
        </div>
        {availableRosterTeamNames.length > 0 ? (
          <label className={styles.rosterFieldLabel}>
            <span>Active team</span>
            <select
              className={styles.settingsInput}
              onChange={(changeEvent) => setActiveTeamName(changeEvent.target.value)}
              value={activeRosterTeamName}
            >
              {availableRosterTeamNames.map((teamName) => (
                <option key={teamName} value={teamName}>
                  {teamName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.personWalkMeta}>
            Add roster members with team names to enable active-team filtering.
          </p>
        )}
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Find people in Jira project</h3>
        </div>
        <div className={styles.rosterInputGrid}>
          <label className={styles.rosterFieldLabel}>
            <span>Search Jira project users</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(event) => setJiraSearchQuery(event.target.value)}
              value={jiraSearchQuery}
            />
          </label>
          <button
            className={styles.secondaryButton}
            disabled={isSearchingJiraUsers}
            onClick={() => void handleSearchJiraUsers()}
            type="button"
          >
            {isSearchingJiraUsers ? 'Searching Jira project…' : 'Search project users'}
          </button>
        </div>
        <p className={styles.personWalkMeta}>
          Search the current Jira project for assignable users, then add only the people who belong in this roster.
        </p>
        {jiraSearchStatusMessage ? <p className={styles.personWalkMeta}>{jiraSearchStatusMessage}</p> : null}
        {jiraSearchErrorMessage ? <p className={styles.errorMessage}>{jiraSearchErrorMessage}</p> : null}
        {visibleJiraSearchResults.length > 0 ? (
          <div className={styles.rosterImportPreviewGrid}>
            {visibleJiraSearchResults.map((searchResult) => (
              <RosterCard
                actionLabel="Add"
                key={searchResult.jiraAccountId}
                onAction={() => handleAddJiraSearchResult(searchResult)}
                rosterMember={searchResult}
              />
            ))}
          </div>
        ) : null}
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Load all project users</h3>
        </div>
        <div className={styles.rosterInputGrid}>
          <label className={styles.rosterFieldLabel}>
            <span>Project key</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(changeEvent) => setLoadProjectKey(changeEvent.target.value.toUpperCase())}
              placeholder="e.g. ENFCT"
              value={loadProjectKey}
            />
          </label>
          <button
            className={styles.secondaryButton}
            disabled={isLoadingProjectUsers || !loadProjectKey.trim()}
            onClick={() => void handleLoadProjectUsers()}
            type="button"
          >
            {isLoadingProjectUsers ? 'Loading Jira project users…' : 'Load project users'}
          </button>
        </div>
        {visibleProjectUserResults.length > 0 ? (
          <div className={styles.rosterImportActionRow}>
            <button className={styles.secondaryButton} onClick={handleSelectAllProjectUsers} type="button">
              Select all
            </button>
            <button className={styles.secondaryButton} onClick={handleDeselectAllProjectUsers} type="button">
              Deselect all
            </button>
            <button className={styles.secondaryButton} onClick={handleAddSelectedProjectUsers} type="button">
              Add selected users to roster
            </button>
          </div>
        ) : null}
        <p className={styles.personWalkMeta}>
          Load the current Jira project&apos;s assignable users, then keep everyone selected or deselect the people who do not belong in this roster.
        </p>
        {projectUserStatusMessage ? <p className={styles.personWalkMeta}>{projectUserStatusMessage}</p> : null}
        {projectUserErrorMessage ? <p className={styles.errorMessage}>{projectUserErrorMessage}</p> : null}
        {visibleProjectUserResults.length > 0 ? (
          <div className={styles.rosterImportPreviewGrid}>
            {visibleProjectUserResults.map((projectUserResult) => (
              <ProjectUserSelectionCard
                isSelected={selectedProjectUserIds.includes(projectUserResult.jiraAccountId)}
                key={projectUserResult.jiraAccountId}
                onSelectionChange={(changeEvent) =>
                  handleToggleProjectUserSelection(projectUserResult.jiraAccountId, changeEvent.target.checked)}
                rosterMember={projectUserResult}
              />
            ))}
          </div>
        ) : null}
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Manual roster entry</h3>
        </div>
        <div className={styles.rosterInputGrid}>
          <label className={styles.rosterFieldLabel}>
            <span>Display name</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </label>
          <label className={styles.rosterFieldLabel}>
            <span>Jira assignee value</span>
            <input
              className={styles.personWalkPostInput}
              onChange={(event) => setAssigneeQueryValue(event.target.value)}
              value={assigneeQueryValue}
            />
          </label>
          <button className={styles.secondaryButton} onClick={handleAddManualMember} type="button">
            Add to roster
          </button>
        </div>
        {activeRosterTeamName ? (
          <p className={styles.personWalkMeta}>
            New manual entries and quick adds are assigned to <strong>{activeRosterTeamName}</strong>.
          </p>
        ) : null}
      </section>

      <section className={styles.rosterSection}>
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Quick add from current sprint</h3>
        </div>
        {rosterSuggestions.length === 0 ? (
          <p className={styles.personWalkMeta}>No extra sprint assignees are available to add right now.</p>
        ) : (
          <div className={styles.rosterQuickPickGrid}>
            {rosterSuggestions.map((rosterSuggestion) => (
              <button
                className={styles.standupToggleButton}
                key={rosterSuggestion.assigneeQueryValue}
                onClick={() =>
                  addRosterMember({
                    ...rosterSuggestion,
                    teamName: activeRosterTeamName || undefined,
                  })}
                type="button"
              >
                Add {rosterSuggestion.displayName}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.rosterSection}>
        <div className={styles.personWalkSectionHeader}>
          <h3 className={styles.personWalkSectionTitle}>Current roster</h3>
          <span className={styles.columnCountBadge}>{visibleRosterMembers.length}</span>
        </div>
        {activeRosterTeamName ? (
          <p className={styles.personWalkMeta}>
            Showing {visibleRosterMembers.length} of {rosterMembers.length} roster members for <strong>{activeRosterTeamName}</strong>.
          </p>
        ) : null}
        <div className={styles.rosterImportActionRow}>
          <button
            className={styles.secondaryButton}
            disabled={isLoadingSnowWork || visibleRosterMembers.length === 0}
            onClick={() => void handleRefreshLinkedSnowWork()}
            type="button"
          >
            {isLoadingSnowWork ? 'Refreshing linked work…' : 'Refresh linked Jira + SNow work'}
          </button>
        </div>
        <p className={styles.personWalkMeta}>
          Link each person to a ServiceNow user to compare their current sprint Jira issues and active ServiceNow work side by side.
        </p>
        {snowWorkStatusMessage ? <p className={styles.personWalkMeta}>{snowWorkStatusMessage}</p> : null}
        {snowWorkErrorMessage ? <p className={styles.errorMessage}>{snowWorkErrorMessage}</p> : null}
        {rosterMembers.length === 0 ? (
          <p className={styles.personWalkMeta}>Add team members here to run standup outside the sprint.</p>
        ) : visibleRosterMembers.length === 0 ? (
          <p className={styles.personWalkMeta}>No roster members are assigned to the active team yet.</p>
        ) : (
          <div className={styles.rosterMemberList}>
            {visibleRosterMembers.map((rosterMember) => (
              <RosterCard
                actionLabel="Remove"
                key={rosterMember.id}
                onAction={() => removeRosterMember(rosterMember.id)}
                rosterMember={rosterMember}
              >
                <RosterLinkedWorkPanel
                  hasLoadedSnowWork={Object.prototype.hasOwnProperty.call(snowWorkByRosterMemberId, rosterMember.id)}
                  isSnowRelayConnected={isSnowRelayConnected}
                  jiraIssues={jiraIssuesByRosterMemberId.get(rosterMember.id) ?? []}
                  onSnowUserChange={(nextReference) => handleSnowUserChange(rosterMember, nextReference)}
                  rosterMember={rosterMember}
                  snowIssues={snowWorkByRosterMemberId[rosterMember.id] ?? []}
                />
              </RosterCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
