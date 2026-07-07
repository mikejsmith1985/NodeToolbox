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
  type RosterRoleCapabilities,
  type StandupRosterMember,
  type StandupRosterMemberDraft,
  useStandupRosterStore,
} from './hooks/useStandupRosterStore.ts';
import styles from './SprintDashboardView.module.css';

const MIN_JIRA_ROSTER_SEARCH_LENGTH = 2;
const MAX_JIRA_ROSTER_SEARCH_RESULTS = 20;
// Jira Server's hard limit per request is 1000. Requesting the maximum in a single call avoids
// pagination issues where Jira Server ignores startAt on the username= and username=. endpoints.
const JIRA_BULK_USER_PAGE_SIZE = 1000;
const MAX_JIRA_PROJECT_USER_PAGES = 20;
// 91 days ≈ 3 months; used by the recently-active assignee loader to scope the JQL window.
const RECENT_ASSIGNEE_LOOKBACK_DAYS = 91;
const MAX_RECENT_ROSTER_ASSIGNEES = 15;
// Fetch up to this many recent issues to tally per-person assignment frequency.
const RECENT_ASSIGNEE_ISSUE_FETCH_LIMIT = 500;
const MAX_SNOW_RECORDS_PER_TYPE = 25;
const SNOW_ROSTER_WORK_FIELDS =
  'sys_id,number,short_description,state,priority,sys_class_name,opened_at,problem_statement';
const SNOW_ROSTER_RECORD_TYPES: SnowIssueType[] = ['incident', 'problem', 'sc_task', 'change_request'];

// The three editable role capabilities shown on each current-roster member, in display order.
// Each maps a human label to the matching boolean flag on RosterRoleCapabilities.
const ROSTER_ROLE_OPTIONS: Array<{ capabilityKey: keyof RosterRoleCapabilities; label: string }> = [
  { capabilityKey: 'canDevelop', label: 'Developer' },
  { capabilityKey: 'canInternalTest', label: 'Internal Tester' },
  { capabilityKey: 'canExternalTest', label: 'External Tester' },
  { capabilityKey: 'canScrumMaster', label: 'Scrum Master' },
  { capabilityKey: 'canProductOwner', label: 'Product Owner' },
  { capabilityKey: 'canSolutionArchitect', label: 'Solution Architect' },
  { capabilityKey: 'canDevLead', label: 'Dev Lead' },
];

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
    | 'roleCapabilities'
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
    const startAt = pageIndex * JIRA_BULK_USER_PAGE_SIZE;
    // Guard against non-array responses — some Jira versions return null or a non-array on error.
    const rawResponse = await jiraGet<JiraUser[] | null | undefined>(requestPathBuilder(startAt));
    const jiraUsers = Array.isArray(rawResponse) ? rawResponse : [];

    for (const jiraUser of jiraUsers) {
      const identityKey = readJiraUserIdentityKey(jiraUser);
      if (identityKey) {
        projectUsersByIdentityKey.set(identityKey, jiraUser);
      }
    }

    if (jiraUsers.length < JIRA_BULK_USER_PAGE_SIZE) {
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
  // Attempt sequence for Jira Cloud and various Jira Server versions:
  //   1. Standard endpoint with no query param (Jira Cloud, modern Server)
  //   2. username= empty string (some Jira Server versions require the param to be present)
  //   3. username=. dot wildcard (Jira Server convention for "all users" enumeration)
  const endpointBuilders: Array<(startAt: number) => string> = [
    (startAt) =>
      `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&startAt=${startAt}&maxResults=${JIRA_BULK_USER_PAGE_SIZE}`,
    (startAt) =>
      `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&username=&startAt=${startAt}&maxResults=${JIRA_BULK_USER_PAGE_SIZE}`,
    (startAt) =>
      `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&username=.&startAt=${startAt}&maxResults=${JIRA_BULK_USER_PAGE_SIZE}`,
  ];

  for (const endpointBuilder of endpointBuilders) {
    try {
      const projectUsers = await loadPaginatedProjectUsers(endpointBuilder);
      if (projectUsers.length > 0) {
        return mapJiraUsersToRosterSearchResults(projectUsers, rosterAssigneeValues);
      }
    } catch (caughtError) {
      // A 302 or 400 means this variant is not supported on this Jira version — try the next one.
      if (!isJiraAssignableSearchRedirectError(caughtError)) {
        throw caughtError;
      }
    }
  }

  // All variants returned zero users — report empty rather than throwing.
  return [];
}

/**
 * Fetches the top N most-active assignees for a project over the past RECENT_ASSIGNEE_LOOKBACK_DAYS days.
 * Uses the issue search endpoint (not user/assignable) so it is immune to Jira Server's pagination cap
 * on assignable-user endpoints. Results are ordered by assignment frequency, most active first.
 */
async function loadRecentlyActiveAssignees(
  normalizedProjectKey: string,
  rosterAssigneeValues: Set<string>,
): Promise<JiraRosterSearchResult[]> {
  const jql = `project = "${normalizedProjectKey}" AND assignee is not EMPTY AND updated >= "-${RECENT_ASSIGNEE_LOOKBACK_DAYS}d" ORDER BY updated DESC`;
  const rawResponse = await jiraGet<{ issues?: JiraIssue[] } | null | undefined>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=assignee&maxResults=${RECENT_ASSIGNEE_ISSUE_FETCH_LIMIT}`,
  );

  const recentIssues = rawResponse != null && Array.isArray(rawResponse.issues) ? rawResponse.issues : [];

  // Tally how many issues each person was assigned to so we can rank by activity level.
  const assigneeCountsByIdentityKey = new Map<string, { jiraUser: JiraUser; issueCount: number }>();
  for (const recentIssue of recentIssues) {
    const assignee = recentIssue.fields?.assignee;
    if (!assignee) {
      continue;
    }
    const identityKey = readJiraUserIdentityKey(assignee);
    if (!identityKey) {
      continue;
    }
    const existingEntry = assigneeCountsByIdentityKey.get(identityKey);
    if (existingEntry) {
      existingEntry.issueCount += 1;
    } else {
      assigneeCountsByIdentityKey.set(identityKey, { jiraUser: assignee, issueCount: 1 });
    }
  }

  // Sort by issue count descending and take only the top N before mapping.
  const topAssignees = [...assigneeCountsByIdentityKey.values()]
    .sort((firstEntry, secondEntry) => secondEntry.issueCount - firstEntry.issueCount)
    .slice(0, MAX_RECENT_ROSTER_ASSIGNEES);

  // Map to roster results in frequency order — do not re-sort alphabetically.
  const searchResults: JiraRosterSearchResult[] = [];
  const seenIdentityKeys = new Set<string>();
  for (const { jiraUser } of topAssignees) {
    const identityKey = readJiraUserIdentityKey(jiraUser);
    const displayName = jiraUser.displayName?.trim() || jiraUser.name?.trim() || '';
    if (!displayName || !identityKey || seenIdentityKeys.has(identityKey)) {
      continue;
    }
    const assigneeQueryValue = readJiraUserAssigneeQueryValue(jiraUser);
    if (rosterAssigneeValues.has(assigneeQueryValue.toLowerCase())) {
      continue;
    }
    seenIdentityKeys.add(identityKey);
    searchResults.push({
      displayName,
      assigneeQueryValue,
      jiraAccountId: jiraUser.accountId?.trim() || jiraUser.name?.trim() || identityKey,
      emailAddress: jiraUser.emailAddress?.trim() || undefined,
    });
  }

  return searchResults;
}

/**
 * Produces a complete role object with a single flag flipped, defaulting any absent flag to false.
 * Built by iterating ROSTER_ROLE_OPTIONS so it always covers every defined role (no hardcoded key
 * list to keep in sync), keeping every persisted `roleCapabilities` complete regardless of how many
 * roles exist, so downstream readers never have to special-case partial data.
 */
function buildUpdatedRoleCapabilities(
  currentCapabilities: RosterRoleCapabilities | undefined,
  changedCapabilityKey: keyof RosterRoleCapabilities,
  isEnabled: boolean,
): RosterRoleCapabilities {
  const nextCapabilities = {} as Record<keyof RosterRoleCapabilities, boolean>;
  for (const roleOption of ROSTER_ROLE_OPTIONS) {
    nextCapabilities[roleOption.capabilityKey] = roleOption.capabilityKey === changedCapabilityKey
      ? isEnabled
      : currentCapabilities?.[roleOption.capabilityKey] ?? false;
  }
  return nextCapabilities;
}

interface RosterRoleControlsProps {
  rosterMember: StandupRosterMember;
  onRolesChange: (capabilities: RosterRoleCapabilities) => void;
}

/**
 * Renders the role-capability checkboxes (Developer, Internal/External Tester, Scrum Master, Product
 * Owner, Solution Architect, Dev Lead) for a current-roster member. Each toggle reflects the member's
 * stored flag and, on change, persists the whole updated role set through the roster store. This UI
 * has no dependency on the AI Assist unlock.
 */
function RosterRoleControls({ rosterMember, onRolesChange }: RosterRoleControlsProps) {
  const roleCapabilities = rosterMember.roleCapabilities;

  return (
    <fieldset className={styles.rosterRoleFieldset}>
      <legend className={styles.rosterRoleLegend}>Roles</legend>
      <div className={styles.rosterRoleToggleRow}>
        {ROSTER_ROLE_OPTIONS.map((roleOption) => {
          const isRoleEnabled = roleCapabilities?.[roleOption.capabilityKey] ?? false;
          return (
            <label className={styles.rosterRoleToggle} key={roleOption.capabilityKey}>
              <input
                checked={isRoleEnabled}
                onChange={(changeEvent) =>
                  onRolesChange(
                    buildUpdatedRoleCapabilities(
                      roleCapabilities,
                      roleOption.capabilityKey,
                      changeEvent.target.checked,
                    ),
                  )}
                type="checkbox"
              />
              <span>{roleOption.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
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
            {ROSTER_ROLE_OPTIONS.filter(
              (roleOption) => rosterMember.roleCapabilities?.[roleOption.capabilityKey],
            ).map((roleOption) => (
              <span className={styles.rosterRoleChip} key={roleOption.capabilityKey}>{roleOption.label}</span>
            ))}
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
  const setRosterMemberRoles = useStandupRosterStore((state) => state.setRosterMemberRoles);
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
      // Run both query= (Jira Cloud) and username= (Jira Server) searches.
      // Jira Server may ignore `query=` and return up to MAX_JIRA_ROSTER_SEARCH_RESULTS unfiltered.
      const [rawQuery, rawUsername] = await Promise.all([
        jiraGet<JiraUser[] | null | undefined>(
          `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&query=${encodeURIComponent(normalizedSearchQuery)}&maxResults=${MAX_JIRA_ROSTER_SEARCH_RESULTS}`,
        ).catch(() => null),
        jiraGet<JiraUser[] | null | undefined>(
          `/rest/api/2/user/assignable/search?project=${encodeURIComponent(normalizedProjectKey)}&username=${encodeURIComponent(normalizedSearchQuery)}&maxResults=${MAX_JIRA_ROSTER_SEARCH_RESULTS}`,
        ).catch(() => null),
      ]);

      const queryUsers = Array.isArray(rawQuery) ? rawQuery : [];
      const usernameUsers = Array.isArray(rawUsername) ? rawUsername : [];

      // Choose the result set with fewer entries (more filtered). If equal, prefer queryUsers.
      let jiraUsers: JiraUser[] = queryUsers;
      if (
        usernameUsers.length > 0 &&
        (queryUsers.length === 0 || usernameUsers.length < queryUsers.length)
      ) {
        jiraUsers = usernameUsers;
      }

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


  async function handleLoadRecentAssignees() {
    const normalizedProjectKey = loadProjectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      setProjectUserStatusMessage(null);
      setProjectUserErrorMessage('Enter a project key to load recently active assignees.');
      resetProjectUserSelection([]);
      return;
    }

    setIsLoadingProjectUsers(true);
    try {
      const nextRecentAssignees = await loadRecentlyActiveAssignees(normalizedProjectKey, rosterAssigneeValues);
      resetProjectUserSelection(nextRecentAssignees);
      setProjectUserErrorMessage(null);
      setProjectUserStatusMessage(
        nextRecentAssignees.length > 0
          ? `Found ${nextRecentAssignees.length} recently active assignees for ${normalizedProjectKey} (last ${RECENT_ASSIGNEE_LOOKBACK_DAYS} days, ranked by activity).`
          : `No recently active assignees found for ${normalizedProjectKey} in the last ${RECENT_ASSIGNEE_LOOKBACK_DAYS} days.`,
      );
    } catch (caughtError) {
      resetProjectUserSelection([]);
      setProjectUserStatusMessage(null);
      setProjectUserErrorMessage(
        caughtError instanceof Error ? caughtError.message : 'Failed to load recently active assignees.',
      );
    } finally {
      setIsLoadingProjectUsers(false);
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
        roleCapabilities: rosterMember.roleCapabilities,
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
          <h3 className={styles.personWalkSectionTitle}>Add project users to roster</h3>
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
            onClick={() => void handleLoadRecentAssignees()}
            type="button"
          >
            {isLoadingProjectUsers ? 'Loading assignees…' : 'Recently active (last 3 mo)'}
          </button>
          <button
            className={styles.secondaryButton}
            disabled={isLoadingProjectUsers || !loadProjectKey.trim()}
            onClick={() => void handleLoadProjectUsers()}
            type="button"
          >
            {isLoadingProjectUsers ? 'Loading assignees…' : 'Load all project users'}
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
          <strong>Recently active</strong> finds the top {MAX_RECENT_ROSTER_ASSIGNEES} people assigned to issues in the last 3 months, ranked by activity — great for projects with a large access list.{' '}
          <strong>Load all</strong> returns every Jira-assignable user for the project.
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
                <RosterRoleControls
                  onRolesChange={(capabilities) => setRosterMemberRoles(rosterMember.id, capabilities)}
                  rosterMember={rosterMember}
                />
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
