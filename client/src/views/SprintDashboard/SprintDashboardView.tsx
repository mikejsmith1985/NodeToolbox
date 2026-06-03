// SprintDashboardView.tsx — Sprint Dashboard view with feature review, sprint health, delivery tracking, and story pointing.
//
// Provides fourteen tabs: Overview (sprint info + burn-down chart), By Assignee (swim lanes),
// Blockers (wall of blocked/stale issues), Defects (bug radar by priority),
// Standup (board walk + 15-min timer), Settings (project key + board picker + roster settings),
// Metrics (velocity/burn stats),
// Pipeline (kanban WIP by status), Planning (unestimated work), Pointing (embedded planning poker),
// Hygiene (dedicated issue-health checks), Feature Review (team-level feature rollup and hygiene),
// PI Review (team-level Confluence authoring), and Releases (readiness by fix version).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import JiraFieldPicker from '../../components/JiraFieldPicker/index.tsx';
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import { jiraGet, jiraPost, jiraPut } from '../../services/jiraApi.ts';
import {
  useSettingsStore,
  type SprintDashboardTeamProfile,
} from '../../store/settingsStore.ts';
import type { JiraComment, JiraIssue, JiraTransition, JiraVersion } from '../../types/jira.ts';
import { downloadElementImage } from '../../utils/downloadElementImage.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import { useRovoAssist } from '../SnowHub/hooks/useRovoAssist.ts';
import BoardPicker from './BoardPicker.tsx';
import FeatureReviewTab from './FeatureReviewTab.tsx';
import MoveToSprintButton from './MoveToSprintButton.tsx';
import RosterTab from './RosterTab.tsx';
import SprintDashboardPiReviewTab from './SprintDashboardPiReviewTab.tsx';
import StandupTab from './StandupTab.tsx';
import TeamDashboardHygieneTab from './TeamDashboardHygieneTab.tsx';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import type { DashboardConfig } from './hooks/useDashboardConfig.ts';
import { useDashboardConfig } from './hooks/useDashboardConfig.ts';
import { useStandupPlanningStore } from './hooks/useStandupPlanningStore.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import {
  calculateIssueAgeDays,
  isBlockedIssue,
  isDoneIssue,
  isStaleIssue,
  readStoryPoints,
  readStoryPointsValue,
  DONE_STATUS_NAMES,
} from './hooks/sprintDashboardIssueUtils.ts';
import {
  buildReleaseRovoPrompt,
  parseReleaseRovoResponse,
  type ReleaseRovoPromptInput,
  type ReleaseRovoTableDocument,
} from './hooks/releaseRovoNotes.ts';
import { useSprintData } from './hooks/useSprintData.ts';
import type { DashboardScopeMode, DashboardTab } from './hooks/useSprintData.ts';
import styles from './SprintDashboardView.module.css';

// ── Named constants ──

const VIEW_TITLE = 'Team Dashboard';
const VIEW_SUBTITLE = 'Monitor team health, board progress, and facilitate standup from one place.';
const SCOPE_MODE_LABEL = 'View Work By';
const TEAM_DASHBOARD_TABS_ARIA_LABEL = 'Team Dashboard tabs';
const DASHBOARD_PI_JQL_FIELD_ID = 'cf[10301]';
const DASHBOARD_SCOPE_MODE_SPRINT = 'sprint';
const DASHBOARD_SCOPE_MODE_FIX_VERSION = 'fixVersion';
const DASHBOARD_SCOPE_MODE_PI = 'pi';
const DASHBOARD_SCOPE_OPTION_LABELS: Record<DashboardScopeMode, string> = {
  sprint: 'Sprint',
  fixVersion: 'Fix Version',
  pi: 'PI',
};

const TAB_OPTIONS: { key: DashboardTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'assignee', label: 'By Assignee' },
  { key: 'blockers', label: 'Blockers' },
  { key: 'defects', label: 'Defects' },
  { key: 'standup', label: 'Standup' },
  { key: 'hygiene', label: 'Hygiene' },
  { key: 'metrics', label: 'Metrics' },
  // Pipeline tab is hidden — the workflow was never fully realised. Code remains for future revival.
  // { key: 'pipeline', label: 'Pipeline' },
  { key: 'planning', label: 'Planning' },
  { key: 'pointing', label: 'Pointing' },
  { key: 'featurereview', label: 'Feature Review' },
  { key: 'pireview', label: 'PI Review' },
  { key: 'releases', label: 'Releases' },
  { key: 'settings', label: 'Settings' },
];

const MS_PER_DAY = 86_400_000;
const EXPAND_TOGGLE_COLLAPSED_ICON = '▼';
const EXPAND_TOGGLE_EXPANDED_ICON = '▲';
const BLOCKED_SECTION_KEY = 'blocked';
const STALE_SECTION_KEY = 'stale';
const BOARD_SETTINGS_TITLE = 'Board Settings';
const GENERIC_SETTINGS_DESCRIPTION = 'Enter your Jira project key to load the team board and dashboard data.';
const SCRUM_SETTINGS_DESCRIPTION = 'Enter your Jira project key to load the active sprint.';
const GENERIC_LOAD_BUTTON_LABEL = 'Load Board';
const SCRUM_LOAD_BUTTON_LABEL = 'Load Sprint';
const SCRUM_VELOCITY_WINDOW_LABEL = 'Scrum velocity window (past sprints)';
const KANBAN_THROUGHPUT_WINDOW_LABEL = 'Kanban throughput window (days)';
const OVERVIEW_EMPTY_STATE_MESSAGE = 'No board data loaded. Go to Settings and load a team board.';
const DASHBOARD_TEAM_SELECTOR_LABEL = 'Dashboard Team';
const DASHBOARD_TEAM_ALIAS_LABEL = 'Team Name / Alias';
const DASHBOARD_TEAM_NAME_PLACEHOLDER = 'e.g. Payments Team';

// Burn-down chart lines use these named identifiers in recharts data.
const BURN_IDEAL_KEY = 'ideal';
const BURN_REMAINING_KEY = 'remaining';
const BURN_COMPLETED_KEY = 'completed';
const BURN_PROJECTED_KEY = 'projected';
const BURNUP_TOGGLE_LABEL = 'Show Burnup';
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const OVERVIEW_GROUP_ORDER = ['In Progress', 'To Do', 'Done'] as const;
const OVERVIEW_IN_PROGRESS_STATUS_TOKENS = ['progress', 'review', 'dev', 'test'];
const OVERVIEW_TO_DO_STATUS_TOKENS = ['to do', 'open', 'backlog', 'new'];
const BLOCKERS_FILTER_LABEL = 'Show:';

const RELEASE_FIELDS =
  'summary,status,assignee,priority,issuetype,fixVersions,description,customfield_10200';
const RELEASE_MAX_RESULTS = 50;
const HIDDEN_ROVO_SHORTCUT_KEY = 'z';
const RELEASE_ROVO_UNLOCK_STORAGE_KEY = 'tbx-release-rovo-unlocked';
const RELEASE_ROVO_NOTES_STORAGE_KEY_PREFIX = 'tbx-release-rovo-notes';
const RELEASE_PROMPT_BUTTON_LABEL = '✦ Build Rovo Prompt';
const RELEASE_IMPORT_BUTTON_LABEL = '↩ Paste Rovo Response';
const COPY_RELEASE_PROMPT_BUTTON_LABEL = '📋 Copy Prompt';
const RENDER_RELEASE_TABLE_BUTTON_LABEL = 'Render Release Notes Table';
const EXPORT_RELEASE_NOTES_BUTTON_LABEL = '🖼 Export Release Notes PNG';
const RELEASE_BUCKETS = [
  { id: 'overdue', label: 'Overdue', emoji: '🚨' },
  { id: 'critical', label: 'Due This Week', emoji: '🔴' },
  { id: 'watch', label: 'Next 30 Days', emoji: '🟡' },
  { id: 'ontrack', label: 'On Track', emoji: '🟢' },
  { id: 'nodate', label: 'Unscheduled', emoji: '📅' },
] as const;
const RELEASE_PROGRESS_STATUS_TOKENS = [
  'in progress',
  'in-progress',
  'in review',
  'in-review',
  'testing',
  'uat',
  'qa',
  'review',
  'deploying',
  'in development',
] as const;
const CYCLE_TIME_PAGE_SIZE = 100;
const MAX_CYCLE_TIME_ISSUES = 200;
const DEFECT_MAX_RESULTS = 200;
const PLANNING_MAX_RESULTS = 200;
const PLANNING_DETAIL_FIELDS = 'description,comment,parent,customfield_10201,customfield_10008,fixVersions,assignee,status';
// Stores which issue keys are flagged for follow-up so selections survive page reloads.
const PLANNING_FOLLOW_UP_KEYS_STORAGE_KEY = 'tbx-planning-follow-up-keys';
const POINTING_DETAIL_FIELDS = 'description,comment,parent,customfield_10200';
const PIPELINE_REL_FIELDS = 'summary,status,assignee,priority,labels,comment,issuelinks,customfield_10016,customfield_10028';
const PIPELINE_COMPANION_FIELDS = 'summary,status,assignee,labels,updated';
const PIPELINE_DEV_FIELDS = 'summary,status,assignee,labels';
const PIPELINE_ROLES = ['DEV', 'REL', 'SL', 'QE', 'BT', 'BC', 'TDR'] as const;
const DEFAULT_POINTING_DONE_STATUSES = ['Done', 'Closed', 'Resolved', 'Accepted'] as const;
const POINTING_SORT_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'priority', label: 'Priority' },
  { id: 'created-newest', label: 'Created (newest)' },
  { id: 'created-oldest', label: 'Created (oldest)' },
  { id: 'summary', label: 'Summary A-Z' },
] as const;
const PLANNING_GROUP_OPTIONS = ['release', 'epic', 'assignee'] as const;

type DashboardBoardType = ReturnType<typeof useSprintData>['state']['boardType'];
type PointingSortId = (typeof POINTING_SORT_OPTIONS)[number]['id'];
type PlanningGroupBy = (typeof PLANNING_GROUP_OPTIONS)[number];
type PipelineFilterMode = 'all' | 'inflight' | 'attention' | 'blocked';
type PipelineRole = (typeof PIPELINE_ROLES)[number];

// ── Helper functions ──

function createDashboardTeamProfileId(): string {
  return `dashboard-team:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function buildDashboardTeamProfileLabel(teamProfile: SprintDashboardTeamProfile): string {
  const trimmedName = teamProfile.name.trim();
  const normalizedProjectKey = teamProfile.projectKey.trim().toUpperCase();
  const isAutoGeneratedProjectKeyLabel =
    trimmedName !== '' &&
    normalizedProjectKey !== '' &&
    trimmedName.toUpperCase() === normalizedProjectKey;

  if (trimmedName && !isAutoGeneratedProjectKeyLabel) {
    return trimmedName;
  }

  if (teamProfile.boardName.trim()) {
    return teamProfile.boardName.trim();
  }

  if (trimmedName) {
    return trimmedName;
  }

  if (normalizedProjectKey) {
    return normalizedProjectKey;
  }

  return 'Saved Team';
}

/** Groups issues by assignee display name, with unassigned issues bucketed under "Unassigned". */
function groupIssuesByAssignee(issues: JiraIssue[]): Map<string, JiraIssue[]> {
  const groupedIssues = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const assigneeName = issue.fields.assignee?.displayName ?? 'Unassigned';
    const existingGroup = groupedIssues.get(assigneeName) ?? [];
    groupedIssues.set(assigneeName, [...existingGroup, issue]);
  }

  return groupedIssues;
}

interface PointingIssueDetail {
  description: string;
  acceptanceCriteria: string;
  comments: JiraComment[];
  parentKey: string | null;
  parentSummary: string | null;
}

interface PipelineChecklistItem {
  label: string;
  isChecked: boolean;
  checkedAt: Date | null;
}

interface PipelineChecklistHistoryEntry {
  date?: string;
  to?: { statusState?: string };
}

interface PipelineChecklistEntryResponse {
  label?: string;
  name?: string;
  status?: { statusState?: string };
  history?: PipelineChecklistHistoryEntry[];
}

interface PipelineChecklistContainerResponse {
  items?: PipelineChecklistEntryResponse[];
  checklistItems?: PipelineChecklistEntryResponse[];
}

interface PipelineChecklistResponse extends PipelineChecklistContainerResponse {
  checklists?: PipelineChecklistContainerResponse[];
}

interface PipelineChecklistResult {
  source: 'dc' | 'cloud-property' | 'error' | 'unavailable';
  isIntDeployChecked: boolean;
  intDeployTimestamp: Date | null;
  isDay4CleanChecked: boolean;
  isDay4ExtendedChecked: boolean;
  allItems: PipelineChecklistItem[];
}

interface PipelineCompanionIssue {
  key: string;
  status: string;
  assignee: string | null;
  hoursOpen: number | null;
}

interface PipelineIntWindowState {
  deployedAt: string | null;
  daysSinceDeploy: number | null;
  decision: 'clean' | 'extended' | null;
  deadlineDate: string | null;
}

interface PipelineRow {
  relKey: string;
  relSummary: string;
  relStatus: string;
  relAssignee: string | null;
  storyPoints: number | null;
  devKey: string | null;
  devSummary: string | null;
  devStatus: string | null;
  devLabels: string[];
  companions: Partial<Record<Lowercase<PipelineRole>, PipelineCompanionIssue>>;
  checklist: PipelineChecklistResult | null;
  relComments: JiraComment[];
  intWindow: PipelineIntWindowState;
  alerts: string[];
}

interface PlanningIssueDetail {
  description: string;
  acceptanceCriteria: string;
  comments: JiraComment[];
  parentKey: string | null;
  parentSummary: string | null;
  subStatusValue: string | null;
  subStatusOptions: string[];
}

function buildSearchPath(jql: string, fields: string, maxResults: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}`;
}

function escapeJqlValue(jqlValue: string): string {
  return jqlValue.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function buildWorkScopeClause(scopeState: Pick<
  ReturnType<typeof useSprintData>['state'],
  'scopeMode' | 'selectedSprintId' | 'selectedFixVersionName' | 'selectedPiValue'
>): string | null {
  if (scopeState.scopeMode === DASHBOARD_SCOPE_MODE_SPRINT) {
    return scopeState.selectedSprintId !== null ? `sprint = ${scopeState.selectedSprintId}` : null;
  }
  if (scopeState.scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION) {
    return scopeState.selectedFixVersionName
      ? `fixVersion = "${escapeJqlValue(scopeState.selectedFixVersionName)}"`
      : null;
  }

  return scopeState.selectedPiValue
    ? `${DASHBOARD_PI_JQL_FIELD_ID} = "${escapeJqlValue(scopeState.selectedPiValue)}"`
    : null;
}

function buildScopedProjectJql(
  projectKey: string,
  scopeState: Pick<
    ReturnType<typeof useSprintData>['state'],
    'scopeMode' | 'selectedSprintId' | 'selectedFixVersionName' | 'selectedPiValue'
  >,
  additionalClauses: string[],
  orderByClause: string,
): string {
  const jqlClauses = [`project = "${escapeJqlValue(projectKey)}"`];
  const workScopeClause = buildWorkScopeClause(scopeState);
  if (workScopeClause) {
    jqlClauses.push(workScopeClause);
  }
  jqlClauses.push(...additionalClauses.filter(Boolean));
  return `${jqlClauses.join(' AND ')} ORDER BY ${orderByClause}`;
}

function readScopeSelectorLabel(scopeMode: DashboardScopeMode): string {
  return DASHBOARD_SCOPE_OPTION_LABELS[scopeMode];
}

function readIssueStatusName(issue: JiraIssue): string {
  return issue.fields.status?.name ?? 'Unknown';
}

function readIssueTypeName(issue: JiraIssue): string {
  return issue.fields.issuetype?.name ?? 'Issue';
}

function readIssuePriorityName(issue: JiraIssue): string {
  return issue.fields.priority?.name ?? 'None';
}

function readAssigneeName(issue: JiraIssue): string {
  return issue.fields.assignee?.displayName ?? 'Unassigned';
}

function getDefectPriorityOrder(priorityName: string): number {
  const normalizedPriority = priorityName.toLowerCase();
  if (normalizedPriority === 'highest' || normalizedPriority === 'critical' || normalizedPriority === 'blocker') {
    return 0;
  }
  if (normalizedPriority === 'high') {
    return 1;
  }
  if (normalizedPriority === 'medium') {
    return 2;
  }
  if (normalizedPriority === 'low' || normalizedPriority === 'lowest') {
    return 3;
  }
  return 4;
}

function isDefectIssue(issue: JiraIssue): boolean {
  const normalizedIssueType = readIssueTypeName(issue).toLowerCase();
  return normalizedIssueType.includes('bug') || normalizedIssueType.includes('defect');
}

function readIssueAgeDays(issue: JiraIssue): number {
  return Math.max(0, Math.floor((Date.now() - new Date(issue.fields.created).getTime()) / MS_PER_DAY));
}

function readIssueUpdatedAgeDays(issue: JiraIssue): number {
  return Math.max(0, Math.floor((Date.now() - new Date(issue.fields.updated).getTime()) / MS_PER_DAY));
}

function readPlanningEpicKey(issue: JiraIssue): string | null {
  const epicField = issue.fields.customfield_10014 ?? issue.fields.customfield_10008 ?? issue.fields.parent;
  if (typeof epicField === 'string') {
    return epicField;
  }
  if (epicField && typeof epicField === 'object' && 'key' in epicField && typeof epicField.key === 'string') {
    return epicField.key;
  }
  return null;
}

function normalizeCommentBody(commentBody: unknown): string {
  return normalizeRichTextToPlainText(commentBody);
}

function detectPipelineRole(summary: string): PipelineRole {
  const bracketMatch = summary.match(/^\[([A-Z]+)\]\s/);
  if (bracketMatch && PIPELINE_ROLES.includes(bracketMatch[1] as PipelineRole)) {
    return bracketMatch[1] as PipelineRole;
  }

  const dashMatch = summary.match(/^(REL|SL|QE|BT|BC|TDR)\s*[–-]/);
  if (dashMatch) {
    return dashMatch[1] as PipelineRole;
  }

  return 'DEV';
}

function findPointingSuggestion(
  issue: JiraIssue,
  issues: JiraIssue[],
  customStoryPointsFieldId: string,
): { key: string; points: number } | null {
  const summary = issue.fields.summary ?? '';
  const bracketMatch = summary.match(/^\[([A-Z]+)\]\s(.+)$/);
  if (bracketMatch && bracketMatch[1] !== 'DEV') {
    const normalizedBaseSummary = bracketMatch[2].trim().toLowerCase();
    for (const candidateIssue of issues) {
      const candidateMatch = candidateIssue.fields.summary.match(/^\[DEV\]\s(.+)$/i);
      if (!candidateMatch) {
        continue;
      }
      if (candidateMatch[1].trim().toLowerCase() !== normalizedBaseSummary) {
        continue;
      }
      const candidatePoints = readStoryPoints(candidateIssue, customStoryPointsFieldId);
      if (candidatePoints > 0) {
        return { key: candidateIssue.key, points: candidatePoints };
      }
    }
  }

  const dashMatch = summary.match(/^(?:SL|QE|BT|BC|REL|TDR)\s*[–-]\s*([A-Z]+-\d+)\s*[–-]/);
  if (dashMatch) {
    const matchedIssue = issues.find((candidateIssue) => candidateIssue.key === dashMatch[1]);
    if (!matchedIssue) {
      return null;
    }
    const candidatePoints = readStoryPoints(matchedIssue, customStoryPointsFieldId);
    if (candidatePoints > 0) {
      return { key: matchedIssue.key, points: candidatePoints };
    }
  }

  return null;
}

function parsePointingScale(pointingScale: string): number[] {
  const parsedScale = pointingScale
    .split(',')
    .map((pointingValue) => Number(pointingValue.trim()))
    .filter((pointingValue) => !Number.isNaN(pointingValue));
  return parsedScale.length > 0 ? parsedScale : [1, 2, 3, 5, 8, 13, 21];
}

function parsePipelineDevKey(summary: string): string | null {
  const match = summary.match(/REL\s*–\s*([A-Z]+-\d+)\s*–/);
  return match?.[1] ?? null;
}

function parsePipelineCompanionDevKey(summary: string): string | null {
  const match = summary.match(/(?:SL|QE|BT|BC|TDR)\s*–\s*([A-Z]+-\d+)\s*–/);
  return match?.[1] ?? null;
}

function parsePipelineCompanionType(summary: string): Lowercase<PipelineRole> | null {
  const match = summary.match(/^(SL|QE|BT|BC|TDR)\s*–/);
  return match?.[1]?.toLowerCase() as Lowercase<PipelineRole> | null;
}

function buildPointingQueue(
  issues: JiraIssue[],
  {
    selectedTypes,
    selectedStatuses,
    sortBy,
    showPointed,
    pipelineRoleFilter,
    customStoryPointsFieldId,
  }: {
    selectedTypes: string[];
    selectedStatuses: string[];
    sortBy: PointingSortId;
    showPointed: boolean;
    pipelineRoleFilter: PipelineRole | '';
    customStoryPointsFieldId: string;
  },
): JiraIssue[] {
  const nextQueue = issues.filter((issue) => {
    const issueTypeName = readIssueTypeName(issue);
    const statusName = readIssueStatusName(issue);
    const storyPoints = readStoryPoints(issue, customStoryPointsFieldId);

    if (!showPointed && storyPoints > 0) {
      return false;
    }
    if (selectedTypes.length > 0 && !selectedTypes.includes(issueTypeName)) {
      return false;
    }
    if (selectedStatuses.length > 0 && !selectedStatuses.includes(statusName)) {
      return false;
    }
    if (pipelineRoleFilter && detectPipelineRole(issue.fields.summary) !== pipelineRoleFilter) {
      return false;
    }
    return true;
  });

  if (sortBy === 'priority') {
    nextQueue.sort(
      (leftIssue, rightIssue) =>
        getDefectPriorityOrder(readIssuePriorityName(leftIssue))
        - getDefectPriorityOrder(readIssuePriorityName(rightIssue)),
    );
  }
  if (sortBy === 'created-newest') {
    nextQueue.sort((leftIssue, rightIssue) => new Date(rightIssue.fields.created).getTime() - new Date(leftIssue.fields.created).getTime());
  }
  if (sortBy === 'created-oldest') {
    nextQueue.sort((leftIssue, rightIssue) => new Date(leftIssue.fields.created).getTime() - new Date(rightIssue.fields.created).getTime());
  }
  if (sortBy === 'summary') {
    nextQueue.sort((leftIssue, rightIssue) => leftIssue.fields.summary.localeCompare(rightIssue.fields.summary));
  }

  return nextQueue;
}

function buildEmptyPipelineChecklist(source: PipelineChecklistResult['source']): PipelineChecklistResult {
  return {
    source,
    isIntDeployChecked: false,
    intDeployTimestamp: null,
    isDay4CleanChecked: false,
    isDay4ExtendedChecked: false,
    allItems: [],
  };
}

function normalizePipelineChecklistItems(
  allItems: PipelineChecklistItem[],
  source: PipelineChecklistResult['source'],
): PipelineChecklistResult {
  const intDeployItem = allItems.find((item) => item.label.toLowerCase().includes('int env deployed'));
  const day4CleanItem = allItems.find(
    (item) => item.label.toLowerCase().includes('day 4') && item.label.toLowerCase().includes('clean'),
  );
  const day4ExtendedItem = allItems.find((item) => item.label.toLowerCase().includes('fixes in flight'));

  return {
    source,
    isIntDeployChecked: Boolean(intDeployItem?.isChecked),
    intDeployTimestamp: intDeployItem?.isChecked ? intDeployItem.checkedAt : null,
    isDay4CleanChecked: Boolean(day4CleanItem?.isChecked),
    isDay4ExtendedChecked: Boolean(day4ExtendedItem?.isChecked),
    allItems,
  };
}

function derivePipelineDeployDate(
  relComments: JiraComment[],
  checklistResult: PipelineChecklistResult | null,
): Date | null {
  if (checklistResult?.isIntDeployChecked && checklistResult.intDeployTimestamp) {
    return checklistResult.intDeployTimestamp;
  }

  for (const relComment of relComments) {
    const normalizedCommentBody = normalizeCommentBody(relComment.body);
    if (normalizedCommentBody.includes('INT env deployed') && normalizedCommentBody.includes('4/7 day window')) {
      return relComment.created ? new Date(relComment.created) : null;
    }
  }

  return null;
}

function derivePipelineIntWindow(
  relComments: JiraComment[],
  checklistResult: PipelineChecklistResult | null,
): PipelineIntWindowState {
  const deployedAt = derivePipelineDeployDate(relComments, checklistResult);
  if (!deployedAt) {
    return { deployedAt: null, daysSinceDeploy: null, decision: null, deadlineDate: null };
  }

  let decision: PipelineIntWindowState['decision'] = null;
  if (checklistResult?.isDay4CleanChecked) {
    decision = 'clean';
  }
  if (checklistResult?.isDay4ExtendedChecked) {
    decision = 'extended';
  }
  if (!decision) {
    for (const relComment of relComments) {
      const normalizedCommentBody = normalizeCommentBody(relComment.body);
      if (!normalizedCommentBody.includes('INT window Day 4')) {
        continue;
      }
      if (normalizedCommentBody.toLowerCase().includes('clean')) {
        decision = 'clean';
      }
      if (normalizedCommentBody.toLowerCase().includes('fixes in flight')) {
        decision = 'extended';
      }
    }
  }

  const daysSinceDeploy = Math.floor((Date.now() - deployedAt.getTime()) / MS_PER_DAY);
  const deadlineDate = new Date(deployedAt.getTime() + (7 * MS_PER_DAY));

  return {
    deployedAt: deployedAt.toISOString(),
    daysSinceDeploy,
    decision,
    deadlineDate: deadlineDate.toISOString(),
  };
}

function derivePipelineAlerts(row: PipelineRow): string[] {
  const nextAlerts: string[] = [];
  const hasBlockedDev = row.devLabels.includes('Blocked');
  const hasOpenTdr = row.companions.tdr != null && !['Done', 'Accepted', 'Closed'].includes(row.companions.tdr.status);
  if (hasBlockedDev && hasOpenTdr) {
    nextAlerts.push('BLOCKED');
  } else if (hasOpenTdr) {
    nextAlerts.push('TDR_OPEN');
  }

  const daysSinceDeploy = row.intWindow.daysSinceDeploy;
  if (daysSinceDeploy != null) {
    if (daysSinceDeploy >= 8) {
      nextAlerts.push('OVERDUE');
    } else if (daysSinceDeploy === 7) {
      nextAlerts.push('DAY7_DEPLOY');
    } else if (daysSinceDeploy === 4 && !row.intWindow.decision) {
      nextAlerts.push('DAY4_DECISION');
    }
  }

  if (row.relStatus.toLowerCase().includes('ready to accept')) {
    nextAlerts.push('AWAITING_PO');
  }

  return nextAlerts;
}

function correlatePipelineRows(
  relStories: JiraIssue[],
  companionStories: JiraIssue[],
  devStories: JiraIssue[],
): PipelineRow[] {
  const devStoryByKey = new Map(devStories.map((issue) => [issue.key, issue]));
  const companionsByDevKey = new Map<string, Partial<Record<Lowercase<PipelineRole>, PipelineCompanionIssue>>>();

  for (const companionStory of companionStories) {
    const companionType = parsePipelineCompanionType(companionStory.fields.summary);
    const devKey = parsePipelineCompanionDevKey(companionStory.fields.summary);
    if (!companionType || !devKey) {
      continue;
    }

    const existingCompanions = companionsByDevKey.get(devKey) ?? {};
    existingCompanions[companionType] = {
      key: companionStory.key,
      status: readIssueStatusName(companionStory),
      assignee: companionStory.fields.assignee?.displayName ?? null,
      hoursOpen: Math.floor((Date.now() - new Date(companionStory.fields.updated).getTime()) / (1000 * 60 * 60)),
    };
    companionsByDevKey.set(devKey, existingCompanions);
  }

  return relStories.map((relStory) => {
    const devKey = parsePipelineDevKey(relStory.fields.summary);
    const devStory = devKey ? devStoryByKey.get(devKey) ?? null : null;
    const relComments = relStory.fields.comment?.comments ?? [];
    const row: PipelineRow = {
      relKey: relStory.key,
      relSummary: relStory.fields.summary,
      relStatus: readIssueStatusName(relStory),
      relAssignee: relStory.fields.assignee?.displayName ?? null,
      storyPoints: readStoryPoints(relStory, ''),
      devKey,
      devSummary: devStory?.fields.summary ?? null,
      devStatus: devStory ? readIssueStatusName(devStory) : null,
      devLabels: devStory?.fields.labels ?? [],
      companions: devKey ? companionsByDevKey.get(devKey) ?? {} : {},
      checklist: null,
      relComments,
      intWindow: derivePipelineIntWindow(relComments, null),
      alerts: [],
    };
    row.alerts = derivePipelineAlerts(row);
    return row;
  });
}

type ReleaseBucketId = (typeof RELEASE_BUCKETS)[number]['id'];

interface ReleaseRadarEntry {
  version: JiraVersion;
  issues: JiraIssue[];
  doneCount: number;
  progressCount: number;
  todoCount: number;
  totalCount: number;
  completionPercentage: number;
  releaseDate: string | null;
  daysLeft: number | null;
  bucket: ReleaseBucketId;
}

interface ReleasePromptModalState {
  versionId: string;
  versionName: string;
  promptText: string;
}

interface ReleaseImportModalState {
  versionId: string;
  versionName: string;
  responseText: string;
  errorMessage: string | null;
}

/** Mirrors the legacy release radar status classification for done / progress / to-do. */
function classifyReleaseIssueStatus(issue: JiraIssue): 'done' | 'progress' | 'todo' {
  if (isDoneIssue(issue)) {
    return 'done';
  }

  if (issue.fields.status.statusCategory.key === 'indeterminate') {
    return 'progress';
  }

  const normalizedStatusName = issue.fields.status.name.toLowerCase();
  if (
    RELEASE_PROGRESS_STATUS_TOKENS.includes(
      normalizedStatusName as (typeof RELEASE_PROGRESS_STATUS_TOKENS)[number],
    )
    || normalizedStatusName.includes('progress')
    || normalizedStatusName.includes('review')
  ) {
    return 'progress';
  }

  return 'todo';
}

/** Uses the same release risk buckets as the live legacy Release Radar. */
function classifyReleaseRiskBucket(daysLeft: number | null): ReleaseBucketId {
  if (daysLeft === null) {
    return 'nodate';
  }
  if (daysLeft < 0) {
    return 'overdue';
  }
  if (daysLeft <= 7) {
    return 'critical';
  }
  if (daysLeft <= 30) {
    return 'watch';
  }
  return 'ontrack';
}

/** Formats release dates the same way the legacy radar shows the due date badge text. */
function formatReleaseDate(releaseDate: string | null): string {
  if (!releaseDate) {
    return '—';
  }

  return new Date(`${releaseDate}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Formats the countdown badge using the legacy day-left wording. */
function formatReleaseCountdown(daysLeft: number | null): string {
  if (daysLeft === null) {
    return 'No date';
  }
  if (daysLeft < 0) {
    return `${Math.abs(daysLeft)}d overdue`;
  }
  if (daysLeft === 0) {
    return 'Today!';
  }
  return `${daysLeft}d left`;
}

function getReleaseCountdownClassName(daysLeft: number | null): string {
  if (daysLeft === null) {
    return styles.releaseCountdownNoDate;
  }
  if (daysLeft < 0) {
    return styles.releaseCountdownOverdue;
  }
  if (daysLeft <= 7) {
    return styles.releaseCountdownCritical;
  }
  if (daysLeft <= 30) {
    return styles.releaseCountdownWatch;
  }
  return styles.releaseCountdownOnTrack;
}

function getReleaseBucketSectionClassName(bucketId: ReleaseBucketId): string {
  if (bucketId === 'overdue') {
    return styles.releaseBucketOverdue;
  }
  if (bucketId === 'critical') {
    return styles.releaseBucketCritical;
  }
  if (bucketId === 'watch') {
    return styles.releaseBucketWatch;
  }
  if (bucketId === 'ontrack') {
    return styles.releaseBucketOnTrack;
  }
  return styles.releaseBucketNoDate;
}

function getReleaseCompletionClassName(completionPercentage: number): string {
  if (completionPercentage >= 80) {
    return styles.releaseCompletionOnTrack;
  }
  if (completionPercentage >= 50) {
    return styles.releaseCompletionWatch;
  }
  return styles.releaseCompletionMuted;
}

function buildReleasePromptInput(projectKey: string, releaseEntry: ReleaseRadarEntry): ReleaseRovoPromptInput {
  return {
    projectKey,
    releaseName: releaseEntry.version.name,
    releaseDate: releaseEntry.releaseDate,
    daysLeft: releaseEntry.daysLeft,
    completionPercentage: releaseEntry.completionPercentage,
    doneCount: releaseEntry.doneCount,
    progressCount: releaseEntry.progressCount,
    todoCount: releaseEntry.todoCount,
    issues: releaseEntry.issues.map((issue) => ({
      issueKey: issue.key,
      summary: issue.fields.summary,
      statusName: readIssueStatusName(issue),
      assigneeName: issue.fields.assignee?.displayName ?? null,
      priorityName: issue.fields.priority?.name ?? null,
      issueTypeName: issue.fields.issuetype?.name ?? null,
      description: issue.fields.description,
      acceptanceCriteria: issue.fields.customfield_10200,
    })),
  };
}

function readStoredReleaseRovoUnlockState(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(RELEASE_ROVO_UNLOCK_STORAGE_KEY) === 'true';
}

function buildReleaseNotesStorageKey(projectKey: string): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase() || 'default';
  return `${RELEASE_ROVO_NOTES_STORAGE_KEY_PREFIX}:${normalizedProjectKey}`;
}

function createReleaseNotesExportFileName(releaseName: string): string {
  const normalizedReleaseName = releaseName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `release-notes-${normalizedReleaseName || 'draft'}.png`;
}

function readStoredReleaseNotes(projectKey: string): Record<string, ReleaseRovoTableDocument> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedValue = window.sessionStorage.getItem(buildReleaseNotesStorageKey(projectKey));
    if (!storedValue) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue);
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    return parsedValue as Record<string, ReleaseRovoTableDocument>;
  } catch {
    return {};
  }
}

interface PredictabilityRow {
  name: string;
  committedPoints: number;
  completedPoints: number;
  committedItems: number;
  completedItems: number;
  completionPercentage: number;
}

interface CycleTimeSummary {
  averageDays: number;
  medianDays: number;
  percentile85Days: number;
  measuredIssueCount: number;
  totalFetchedCount: number;
  excludedCount: number;
  wasCapped: boolean;
  improvementPercentage: number | null;
  startLabel: string;
  doneLabel: string;
  usedExactStatusMatch: boolean;
  workflowFetchSucceeded: boolean;
}

interface BottleneckRow {
  statusName: string;
  categoryKey: string;
  averageDays: number;
  issueCount: number;
}

interface ThroughputRow {
  name: string;
  itemCount: number;
  storyPoints: number;
}

interface MetricsDataState {
  predictabilityRows: PredictabilityRow[];
  cycleTimeSummary: CycleTimeSummary | null;
  bottleneckRows: BottleneckRow[];
  throughputRows: ThroughputRow[];
  boardTypeLabel: string;
}

function calculateMedian(sortedValues: number[]): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length % 2 === 1) {
    return sortedValues[Math.floor(sortedValues.length / 2)];
  }
  const rightIndex = sortedValues.length / 2;
  return (sortedValues[rightIndex - 1] + sortedValues[rightIndex]) / 2;
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const percentileIndex = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * percentile)),
  );
  return sortedValues[percentileIndex];
}

function mapStatusCategory(
  statusName: string,
  workflowStatusCategoryMap: Record<string, string>,
): string {
  return workflowStatusCategoryMap[statusName.toLowerCase()] ?? 'new';
}

function buildCycleTimeStatusCategoryMap(
  projectStatuses: Array<{ statuses?: Array<{ name?: string; statusCategory?: { key?: string; id?: number } }> }>,
): Record<string, string> {
  const statusCategoryMap: Record<string, string> = {};

  for (const issueTypeStatuses of projectStatuses) {
    for (const status of issueTypeStatuses.statuses ?? []) {
      const normalizedStatusName = status.name?.toLowerCase();
      if (!normalizedStatusName) {
        continue;
      }

      const categoryKey = status.statusCategory?.key;
      const categoryId = status.statusCategory?.id;
      if (categoryKey === 'done' || categoryId === 4) {
        statusCategoryMap[normalizedStatusName] = 'done';
      } else if (
        categoryKey === 'indeterminate'
        || categoryKey === 'in_progress'
        || categoryId === 3
      ) {
        statusCategoryMap[normalizedStatusName] = 'indeterminate';
      } else {
        statusCategoryMap[normalizedStatusName] = 'new';
      }
    }
  }

  return statusCategoryMap;
}

async function fetchAllCycleTimeIssues(
  projectKey: string,
  customStoryPointsFieldId: string,
  scopeClause: string | null,
): Promise<{ issues: JiraIssue[]; total: number; wasCapped: boolean }> {
  const jqlClauses = [
    `project = "${escapeJqlValue(projectKey)}"`,
    'statusCategory = Done',
    'updated >= -90d',
  ];
  if (scopeClause) {
    jqlClauses.push(scopeClause);
  }
  const encodedJql = encodeURIComponent(`${jqlClauses.join(' AND ')} ORDER BY updated DESC`);
  const requestedFields = [
    'summary',
    'status',
    'issuetype',
    'created',
    'updated',
    'customfield_10016',
    'customfield_10028',
  ];
  if (!requestedFields.includes(customStoryPointsFieldId)) {
    requestedFields.push(customStoryPointsFieldId);
  }

  const accumulatedIssues: JiraIssue[] = [];
  let startAt = 0;
  let totalAvailable = 0;

  while (accumulatedIssues.length < MAX_CYCLE_TIME_ISSUES) {
    const response = await jiraGet<{ issues?: JiraIssue[]; total?: number }>(
      `/rest/api/2/search?jql=${encodedJql}&maxResults=${CYCLE_TIME_PAGE_SIZE}&startAt=${startAt}&expand=changelog&fields=${requestedFields.join(',')}`,
    );
    const pageIssues = response.issues ?? [];
    totalAvailable = response.total ?? totalAvailable;
    accumulatedIssues.push(...pageIssues);
    startAt += pageIssues.length;

    if (pageIssues.length === 0 || startAt >= totalAvailable) {
      break;
    }
  }

  return {
    issues: accumulatedIssues.slice(0, MAX_CYCLE_TIME_ISSUES),
    total: totalAvailable,
    wasCapped: totalAvailable > MAX_CYCLE_TIME_ISSUES,
  };
}

/** Chooses Settings tab wording that matches Scrum boards without forcing sprint language on Kanban teams. */
function getBoardSettingsCopy(boardType: DashboardBoardType) {
  if (boardType === 'scrum') {
    return {
      description: SCRUM_SETTINGS_DESCRIPTION,
      loadButtonLabel: SCRUM_LOAD_BUTTON_LABEL,
    };
  }

  return {
    description: GENERIC_SETTINGS_DESCRIPTION,
    loadButtonLabel: GENERIC_LOAD_BUTTON_LABEL,
  };
}

/** Per-assignee velocity metrics derived from sprint issues. */
interface AssigneeMetrics {
  assigneeName: string;
  totalCount: number;
  doneCount: number;
  inProgressCount: number;
  toDoCount: number;
  /** Sum of story points for the assignee's issues, or null when none are estimated. */
  totalStoryPoints: number | null;
}

/** Derives velocity metrics for a single assignee from their slice of sprint issues. */
function computeAssigneeMetrics(
  assigneeName: string,
  assigneeIssues: JiraIssue[],
  customStoryPointsFieldId: string,
): AssigneeMetrics {
  const doneCount = assigneeIssues.filter(
    isDoneIssue,
  ).length;
  const inProgressCount = assigneeIssues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'indeterminate',
  ).length;
  const toDoCount = assigneeIssues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'new',
  ).length;
  const hasAnyPoints = assigneeIssues.some(
    (issue) => readStoryPointsValue(issue, customStoryPointsFieldId) !== null,
  );
  const totalStoryPoints = hasAnyPoints
    ? assigneeIssues.reduce(
        (sum, issue) => sum + readStoryPoints(issue, customStoryPointsFieldId),
        0,
      )
    : null;

  return { assigneeName, totalCount: assigneeIssues.length, doneCount, inProgressCount, toDoCount, totalStoryPoints };
}

function groupIssuesByOverviewSection(issues: JiraIssue[]): Record<(typeof OVERVIEW_GROUP_ORDER)[number], JiraIssue[]> {
  return issues.reduce<Record<(typeof OVERVIEW_GROUP_ORDER)[number], JiraIssue[]>>(
    (currentGroups, issue) => {
      const normalizedStatusName = issue.fields.status.name.toLowerCase();
      const targetGroup = isDoneIssue(issue)
        ? 'Done'
        : OVERVIEW_IN_PROGRESS_STATUS_TOKENS.some((statusToken) => normalizedStatusName.includes(statusToken))
          ? 'In Progress'
          : OVERVIEW_TO_DO_STATUS_TOKENS.some((statusToken) => normalizedStatusName.includes(statusToken))
            ? 'To Do'
            : 'To Do';
      currentGroups[targetGroup].push(issue);
      return currentGroups;
    },
    { 'In Progress': [], 'To Do': [], Done: [] },
  );
}

/** Calculates flow counts (total / in-progress / in-review / blocked / done) for the stats bar. */
function calculateFlowCounts(issues: JiraIssue[]) {
  let inProgressCount = 0;
  let inReviewCount = 0;
  let blockedCount = 0;
  let doneCount = 0;

  for (const issue of issues) {
    const statusCategory = issue.fields.status.statusCategory.key;
    const lowerStatusName = issue.fields.status.name.toLowerCase();

    if (isBlockedIssue(issue)) {
      blockedCount++;
    } else if (['in review', 'code review', 'pr review', 'testing'].includes(lowerStatusName)) {
      inReviewCount++;
    } else if (statusCategory === 'indeterminate') {
      inProgressCount++;
    } else if (statusCategory === 'done') {
      doneCount++;
    }
  }

  return { totalCount: issues.length, inProgressCount, inReviewCount, blockedCount, doneCount };
}

/**
 * Checks whether a given status is treated as completed.
 */
function isStatusDone(statusName: string, issue: JiraIssue): boolean {
  if (!statusName) return false;
  if (statusName.toLowerCase() === issue.fields.status.name.toLowerCase()) {
    return isDoneIssue(issue);
  }
  return DONE_STATUS_NAMES.includes(statusName.toLowerCase());
}

/**
 * Builds burn-down chart data points for the ideal, remaining, and completed lines.
 * Reconstructs issue status over each day of the sprint using issue changelogs.
 */
export function buildBurnDownData(
  sprintStartDate: string,
  sprintEndDate: string,
  issues: JiraIssue[],
  isClosed: boolean,
) {
  const startMs = new Date(sprintStartDate).getTime();
  const endMs = new Date(sprintEndDate).getTime();
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));

  const todayMs = Date.now();
  const todayDayIndex = Math.floor((todayMs - startMs) / MS_PER_DAY);

  // Pre-parse issues, their creation date, and status transitions from the changelog
  const parsedIssues = issues.map((issue) => {
    const createdMs = new Date(issue.fields.created).getTime();
    const updatedMs = new Date(issue.fields.updated).getTime();

    const transitions: Array<{ timestamp: number; from: string; to: string }> = [];
    if (issue.changelog && Array.isArray(issue.changelog.histories)) {
      for (const history of issue.changelog.histories) {
        if (!history.created) continue;
        const ts = new Date(history.created).getTime();
        for (const item of history.items) {
          if (item.field === 'status') {
            transitions.push({
              timestamp: ts,
              from: item.fromString || '',
              to: item.toString || '',
            });
          }
        }
      }
    }
    // Sort transitions chronologically
    transitions.sort((a, b) => a.timestamp - b.timestamp);

    return {
      issue,
      createdMs,
      updatedMs,
      transitions,
    };
  });

  return Array.from({ length: totalDays + 1 }, (_, dayIndex) => {
    const dayTimestamp = startMs + dayIndex * MS_PER_DAY;

    // Ideal burndown trends from totalIssues down to 0
    const totalIssues = issues.length;
    const ideal = Math.round(totalIssues - (totalIssues / totalDays) * dayIndex);

    // Calculate projected burnup to show the linear path from 0 to total issues across the sprint
    const projected = Math.round((totalIssues / totalDays) * dayIndex);

    // Only plot remaining and completed for past/current days if active, or all days if closed
    const showPlot = isClosed || dayIndex <= todayDayIndex;

    let remaining: number | undefined = undefined;
    let completed: number | undefined = undefined;

    if (showPlot) {
      let activeCount = 0;
      let doneCount = 0;

      for (const parsed of parsedIssues) {
        // Issue did not exist on this day yet (creation date fallback check)
        if (parsed.createdMs > dayTimestamp) {
          continue;
        }

        let statusName = '';
        if (parsed.transitions.length === 0) {
          // Fallback when no changelog is available:
          // If the issue is currently done, check if we are past the issue's updated timestamp.
          // Otherwise assume it was not done (e.g. "To Do")
          const currentDone = isDoneIssue(parsed.issue);
          if (currentDone) {
            if (dayTimestamp >= parsed.updatedMs) {
              statusName = parsed.issue.fields.status.name;
            } else {
              statusName = 'To Do';
            }
          } else {
            statusName = parsed.issue.fields.status.name;
          }
        } else {
          // Trace history to determine status on this day
          if (dayTimestamp < parsed.transitions[0].timestamp) {
            statusName = parsed.transitions[0].from;
          } else {
            let lastTx = parsed.transitions[0];
            for (const tx of parsed.transitions) {
              if (tx.timestamp <= dayTimestamp) {
                lastTx = tx;
              } else {
                break;
              }
            }
            statusName = lastTx.to;
          }
        }

        const isDone = isStatusDone(statusName, parsed.issue);
        if (isDone) {
          doneCount++;
        } else {
          activeCount++;
        }
      }

      remaining = activeCount;
      completed = doneCount;
    }

    return {
      day: dayIndex,
      [BURN_IDEAL_KEY]: ideal,
      [BURN_REMAINING_KEY]: remaining,
      [BURN_COMPLETED_KEY]: completed,
      [BURN_PROJECTED_KEY]: projected,
    };
  });
}

// ── Issue card with move-to-sprint action ──

/**
 * A single issue row that includes a MoveToSprintButton.
 * Used in both Overview and Assignee tabs to give team members a quick way to shuffle work.
 */
function IssueCardWithMove({
  issue,
  currentSprintId,
  availableSprints,
  isLoadingAvailableSprints,
  staleDaysThreshold,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issue: JiraIssue;
  currentSprintId: number | null;
  availableSprints: ReturnType<typeof useSprintData>['state']['availableSprints'];
  isLoadingAvailableSprints: boolean;
  staleDaysThreshold: number;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isStale = isStaleIssue(issue, staleDaysThreshold);
  const rowClassName = isStale
    ? `${styles.laneIssueRow} ${styles.staleIssueRow}`
    : styles.laneIssueRow;

  function handleRowClick() {
    setIsExpanded((previousIsExpanded) => !previousIsExpanded);
  }

  function stopRowToggle(clickEvent: React.MouseEvent) {
    // Prevent interactive children (link, move button) from also toggling the row.
    clickEvent.stopPropagation();
  }

  return (
    <div className={styles.issueCardWrapper} key={issue.key}>
      {/* Whole row is clickable — caret stays as a visual affordance hint. */}
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${issue.key}`}
        className={`${rowClassName} ${styles.clickableRow}`}
        onClick={handleRowClick}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') handleRowClick();
        }}
        role="button"
        tabIndex={0}
      >
        <a
          className={styles.issueKeyLink}
          href={`${JIRA_BROWSE_URL_PREFIX}${issue.key}`}
          onClick={stopRowToggle}
          target="_blank"
          rel="noreferrer"
        >
          {issue.key}
        </a>
        <span>{issue.fields.summary}</span>
        <span>{issue.fields.status.name}</span>
        <span onClick={stopRowToggle}>
          <MoveToSprintButton
            availableSprints={availableSprints ?? []}
            currentSprintId={currentSprintId}
            isLoadingAvailableSprints={isLoadingAvailableSprints}
            issueKey={issue.key}
            onFetchSprints={onFetchSprints}
            onMoveToSprint={onMoveToSprint}
          />
        </span>
        <span
          aria-hidden="true"
          className={styles.expandToggleButton}
        >
          {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
        </span>
      </div>
      {isExpanded && (
        <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
      )}
    </div>
  );
}

// ── Sub-renderers ──

function DashboardScopeSelector({
  sprintState,
  onScopeModeChange,
  onSprintScopeChange,
  onFixVersionScopeChange,
  onPiScopeChange,
}: {
  sprintState: ReturnType<typeof useSprintData>['state'];
  onScopeModeChange: (scopeMode: DashboardScopeMode) => Promise<void>;
  onSprintScopeChange: (sprintId: number) => Promise<void>;
  onFixVersionScopeChange: (fixVersionName: string) => Promise<void>;
  onPiScopeChange: (piValue: string) => Promise<void>;
}) {
  const secondaryLabel = readScopeSelectorLabel(sprintState.scopeMode);

  return (
    <div className={styles.scopeSelectorBar}>
      <label className={styles.scopeSelectorField}>
        <span>{SCOPE_MODE_LABEL}</span>
        <select
          className={styles.settingsInput}
          onChange={(changeEvent) =>
            void onScopeModeChange(changeEvent.target.value as DashboardScopeMode)}
          value={sprintState.scopeMode}
        >
          <option value={DASHBOARD_SCOPE_MODE_SPRINT}>Sprint</option>
          <option value={DASHBOARD_SCOPE_MODE_PI}>PI</option>
          <option value={DASHBOARD_SCOPE_MODE_FIX_VERSION}>Fix Version</option>
        </select>
      </label>

      <label className={styles.scopeSelectorField}>
        <span>{secondaryLabel}</span>
        {sprintState.scopeMode === DASHBOARD_SCOPE_MODE_SPRINT ? (
          <select
            className={styles.settingsInput}
            onChange={(changeEvent) => void onSprintScopeChange(Number(changeEvent.target.value))}
            value={sprintState.selectedSprintId ?? ''}
          >
            <option disabled value="">
              Active Sprint
            </option>
            {sprintState.availableScopeSprints.map((scopeSprint) => (
              <option key={scopeSprint.id} value={scopeSprint.id}>
                {scopeSprint.name}
              </option>
            ))}
          </select>
        ) : sprintState.scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION ? (
          <select
            className={styles.settingsInput}
            onChange={(changeEvent) => void onFixVersionScopeChange(changeEvent.target.value)}
            value={sprintState.selectedFixVersionName}
          >
            <option disabled value="">
              Select Fix Version
            </option>
            {sprintState.availableFixVersions.map((availableFixVersion) => (
              <option key={availableFixVersion.id} value={availableFixVersion.name}>
                {availableFixVersion.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            className={styles.settingsInput}
            onChange={(changeEvent) => void onPiScopeChange(changeEvent.target.value)}
            value={sprintState.selectedPiValue}
          >
            <option disabled value="">
              Select PI
            </option>
            {sprintState.availablePiValues.map((availablePiValue) => (
              <option key={availablePiValue} value={availablePiValue}>
                {availablePiValue}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}

/** Renders the sprint or board summary card with name, dates, and board context. */
function SprintInfoCard({
  sprintInfo,
  boardId,
  selectedBoardName,
  boardType,
  scopeMode,
  selectedFixVersionName,
  selectedPiValue,
}: {
  sprintInfo: ReturnType<typeof useSprintData>['state']['sprintInfo'];
  boardId: number | null;
  selectedBoardName: string | null;
  boardType: DashboardBoardType;
  scopeMode: DashboardScopeMode;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const title = scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION
    ? selectedFixVersionName || 'Fix Version'
    : scopeMode === DASHBOARD_SCOPE_MODE_PI
      ? selectedPiValue || 'PI'
      : sprintInfo?.name ?? (boardType === 'kanban' ? 'Kanban Board' : 'Team Board');
  const boardContextLabel = selectedBoardName ?? (boardId !== null ? `Board ${boardId}` : null);

  return (
    <div className={styles.sprintInfoCard}>
      <div className={styles.sprintInfoHeader}>
        <h2 className={styles.sprintName}>{title}</h2>
        {boardContextLabel && <span className={styles.boardIdBadge}>{boardContextLabel}</span>}
      </div>
      <div className={styles.sprintMeta}>
        {sprintInfo ? (
          <>
            <span>State: {sprintInfo.state}</span>
            <span>Start: {sprintInfo.startDate.slice(0, 10)}</span>
            <span>End: {sprintInfo.endDate.slice(0, 10)}</span>
            {sprintInfo.goal && <span>Goal: {sprintInfo.goal}</span>}
          </>
        ) : (
          <span>Active work items on the board</span>
        )}
      </div>
    </div>
  );
}

function OverviewStatCards({
  issues,
  customStoryPointsFieldId,
}: {
  issues: JiraIssue[];
  customStoryPointsFieldId: string;
}) {
  const totalCount = issues.length;
  const doneCount = issues.filter(isDoneIssue).length;
  const inProgressCount = issues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'indeterminate',
  ).length;
  const toDoCount = totalCount - doneCount - inProgressCount;
  const totalStoryPoints = issues.reduce(
    (currentPoints, issue) => currentPoints + readStoryPoints(issue, customStoryPointsFieldId),
    0,
  );
  const doneStoryPoints = issues
    .filter(isDoneIssue)
    .reduce(
      (currentPoints, issue) => currentPoints + readStoryPoints(issue, customStoryPointsFieldId),
      0,
    );

  return (
    <div className={styles.flowStatsBar}>
      <StatChip label="Total" value={totalCount} />
      <StatChip label="To Do" value={toDoCount} />
      <StatChip label="In Progress" value={inProgressCount} />
      <StatChip label="Done" value={doneCount} />
      {totalStoryPoints > 0 && <StatChip label="Points Done" value={`${doneStoryPoints}/${totalStoryPoints}`} />}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.flowStatChip}>
      <span className={styles.flowStatCount}>{value}</span>
      <span className={styles.flowStatLabel}>{label}</span>
    </div>
  );
}

function DashboardTabShell({
  title,
  description,
  stats,
  actions,
  filters,
  children,
}: {
  title: string;
  description: string;
  stats?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.dashboardTabShell}>
      <header className={styles.dashboardTabHeader}>
        <div className={styles.dashboardTabCopy}>
          <h2 className={styles.blockersSectionTitle}>{title}</h2>
          <p className={styles.dashboardTabSubtitle}>{description}</p>
        </div>
        {actions ? <div className={styles.dashboardTabActions}>{actions}</div> : null}
      </header>
      {stats ? <div className={styles.dashboardTabStats}>{stats}</div> : null}
      {filters ? <div className={styles.dashboardTabFilters}>{filters}</div> : null}
      <div className={styles.dashboardTabContent}>{children}</div>
    </div>
  );
}

function DashboardEmptyState({ message }: { message: string }) {
  return <div className={styles.dashboardEmptyState}>{message}</div>;
}

/** Renders the 5-chip flow stats bar (Total / In Progress / In Review / Blocked / Done). */
function FlowStatsBar({ issues }: { issues: JiraIssue[] }) {
  const counts = calculateFlowCounts(issues);

  const chipData = [
    { label: 'Total', count: counts.totalCount },
    { label: 'In Progress', count: counts.inProgressCount },
    { label: 'In Review', count: counts.inReviewCount },
    { label: 'Blocked', count: counts.blockedCount },
    { label: 'Done', count: counts.doneCount },
  ];

  return (
    <div className={styles.flowStatsBar}>
      {chipData.map((chip) => (
        <div className={styles.flowStatChip} key={chip.label}>
          <span className={styles.flowStatCount}>{chip.count}</span>
          <span className={styles.flowStatLabel}>{chip.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Renders the health badge based on blocked issue count. */
function HealthBadge({ issues }: { issues: JiraIssue[] }) {
  const blockedCount = issues.filter(isBlockedIssue).length;

  if (blockedCount === 0) {
    return <span className={`${styles.healthBadge} ${styles.healthOnTrack}`}>🟢 On Track</span>;
  }

  if (blockedCount <= 2) {
    return <span className={`${styles.healthBadge} ${styles.healthWatch}`}>🟡 Watch</span>;
  }

  return <span className={`${styles.healthBadge} ${styles.healthAtRisk}`}>🔴 At Risk</span>;
}

/** Renders the burn-down chart using recharts. */
function BurnDownChart({
  sprintInfo,
  issues,
}: {
  sprintInfo: NonNullable<ReturnType<typeof useSprintData>['state']['sprintInfo']>;
  issues: JiraIssue[];
}) {
  const [isBurnupVisible, setIsBurnupVisible] = useState(false);
  const burnDownData = buildBurnDownData(
    sprintInfo.startDate,
    sprintInfo.endDate,
    issues,
    sprintInfo.state === 'closed',
  );

  return (
    <div className={styles.chartSection}>
      <div className={styles.chartHeader}>
        <p className={styles.chartTitle}>Burn-Down Chart</p>
        <button
          className={styles.chartToggleButton}
          onClick={() => setIsBurnupVisible((currentValue) => !currentValue)}
          type="button"
        >
          {isBurnupVisible ? 'Hide Burnup' : BURNUP_TOGGLE_LABEL}
        </button>
      </div>
      <ResponsiveContainer height={240} width="100%">
        <LineChart data={burnDownData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            label={{ value: 'Day', position: 'insideBottomRight', offset: -8 }}
            stroke="var(--color-text-secondary)"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            label={{ value: 'Issues', angle: -90, position: 'insideLeft' }}
            stroke="var(--color-text-secondary)"
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
            }}
          />
          <Line
            dataKey={BURN_IDEAL_KEY}
            dot={false}
            name="Ideal"
            stroke="var(--color-text-secondary)"
            strokeDasharray="4 4"
            type="monotone"
          />
          <Line
            dataKey={BURN_REMAINING_KEY}
            dot={false}
            name="Remaining"
            stroke="var(--color-accent)"
            type="monotone"
          />
          {isBurnupVisible && (
            <Line
              dataKey={BURN_PROJECTED_KEY}
              dot={false}
              name="Projected"
              stroke="var(--color-text-secondary)"
              strokeDasharray="4 4"
              type="monotone"
            />
          )}
          {isBurnupVisible && (
            <Line
              dataKey={BURN_COMPLETED_KEY}
              dot={false}
              name="Completed"
              stroke="var(--color-success)"
              type="monotone"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Renders the Overview tab: sprint info card, health badge, flow stats, burn-down, and full issue list. */
function OverviewTab({
  issues,
  sprintInfo,
  sprintState,
  configState,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  sprintInfo: ReturnType<typeof useSprintData>['state']['sprintInfo'];
  sprintState: ReturnType<typeof useSprintData>['state'];
  configState: DashboardConfig;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  const groupedIssues = groupIssuesByOverviewSection(issues);
  const shouldRenderBoardSummary = sprintInfo !== null || issues.length > 0 || sprintState.boardId !== null;

  return (
    <div>
      {shouldRenderBoardSummary ? (
        <>
          <SprintInfoCard
            boardId={sprintState.boardId}
            selectedBoardName={sprintState.selectedBoardName}
            boardType={sprintState.boardType}
            scopeMode={sprintState.scopeMode}
            selectedFixVersionName={sprintState.selectedFixVersionName}
            selectedPiValue={sprintState.selectedPiValue}
            sprintInfo={sprintInfo}
          />
          <OverviewStatCards
            customStoryPointsFieldId={configState.customStoryPointsFieldId}
            issues={issues}
          />
          <HealthBadge issues={issues} />
          <FlowStatsBar issues={issues} />
          {sprintInfo && <BurnDownChart issues={issues} sprintInfo={sprintInfo} />}
        </>
      ) : (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {OVERVIEW_EMPTY_STATE_MESSAGE}
        </p>
      )}

      {OVERVIEW_GROUP_ORDER.map((groupLabel) => {
        const groupIssues = groupedIssues[groupLabel];
        if (groupIssues.length === 0) {
          return null;
        }

        return (
          <div className={styles.blockersSection} key={groupLabel}>
            <div className={styles.blockersSectionHeader}>
              <h3 className={styles.blockersSectionTitle}>{groupLabel}</h3>
              <span className={styles.countBadge}>{groupIssues.length}</span>
            </div>
            <div className={styles.laneIssueGrid}>
              {groupIssues.map((issue) => (
                <IssueCardWithMove
                  availableSprints={sprintState.availableSprints}
                  currentSprintId={sprintState.sprintInfo?.id ?? null}
                  isLoadingAvailableSprints={sprintState.isLoadingAvailableSprints}
                  issue={issue}
                  key={issue.key}
                  onFetchSprints={onFetchSprints}
                  onIssueUpdated={onIssueUpdated}
                  onMoveToSprint={onMoveToSprint}
                  staleDaysThreshold={configState.staleDaysThreshold}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the By Assignee tab with swim lanes grouping issues per team member. */
function AssigneeTab({
  issues,
  sprintState,
  configState,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  sprintState: ReturnType<typeof useSprintData>['state'];
  configState: DashboardConfig;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  const groupedIssues = Array.from(groupIssuesByAssignee(issues).entries())
    .map(([assigneeName, assigneeIssues]) => ({
      assigneeName,
      assigneeIssues,
      metrics: computeAssigneeMetrics(
        assigneeName,
        assigneeIssues,
        configState.customStoryPointsFieldId,
      ),
    }))
    .sort(
      (leftGroup, rightGroup) =>
        rightGroup.metrics.inProgressCount
          + rightGroup.metrics.toDoCount
          - (leftGroup.metrics.inProgressCount + leftGroup.metrics.toDoCount),
    );

  return (
    <div>
      {groupedIssues.map(({ assigneeName, assigneeIssues, metrics }) => {
        const completionPercentage = metrics.totalCount === 0
          ? 0
          : Math.round((metrics.doneCount / metrics.totalCount) * 100);

        return (
          <div className={styles.assigneeLane} key={assigneeName}>
            <div className={styles.assigneeHeader}>
              <div className={styles.assigneeSummary}>
                <span className={styles.assigneeName}>{assigneeName}</span>
                <span className={styles.assigneeMetaText}>
                  {metrics.totalCount} issues · {completionPercentage}% done
                  {metrics.totalStoryPoints !== null ? ` · ${metrics.totalStoryPoints} pts` : ''}
                </span>
              </div>
              <div className={styles.assigneeHeaderBadges}>
                <span className={styles.assigneeCountBadge}>🔵 {metrics.inProgressCount} in progress</span>
                <span className={styles.assigneeCountBadge}>⚪ {metrics.toDoCount} to do</span>
                <span className={styles.assigneeCountBadge}>✅ {metrics.doneCount} done</span>
              </div>
            </div>
            <div className={styles.assigneeProgressTrack}>
              <div
                className={styles.assigneeProgressFill}
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
            <div className={styles.laneIssueGrid}>
              {assigneeIssues.map((issue) => (
                <IssueCardWithMove
                  availableSprints={sprintState.availableSprints}
                  currentSprintId={sprintState.sprintInfo?.id ?? null}
                  isLoadingAvailableSprints={sprintState.isLoadingAvailableSprints}
                  issue={issue}
                  key={issue.key}
                  onFetchSprints={onFetchSprints}
                  onIssueUpdated={onIssueUpdated}
                  onMoveToSprint={onMoveToSprint}
                  staleDaysThreshold={configState.staleDaysThreshold}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the Blockers tab with the legacy blocked/stale filter model. */
function BlockersTab({
  issues,
  staleDaysThreshold,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  staleDaysThreshold: number;
  onIssueUpdated: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'blockers' | 'stale'>('all');
  const [expandedIssueIdentifier, setExpandedIssueIdentifier] = useState<string | null>(null);
  const blockedIssues = issues.filter(isBlockedIssue);
  const staleIssues = issues.filter(
    (issue) => !isBlockedIssue(issue) && isStaleIssue(issue, staleDaysThreshold),
  );

  function createExpandedIssueIdentifier(sectionKey: string, issueKey: string) {
    return `${sectionKey}:${issueKey}`;
  }

  function toggleExpandedIssue(sectionKey: string, issueKey: string) {
    const nextExpandedIssueIdentifier = createExpandedIssueIdentifier(sectionKey, issueKey);
    setExpandedIssueIdentifier((previousIssueIdentifier) =>
      previousIssueIdentifier === nextExpandedIssueIdentifier ? null : nextExpandedIssueIdentifier,
    );
  }

  function renderBlockerCard(issue: JiraIssue, cardClassName: string, sectionKey: string) {
    const issueIdentifier = createExpandedIssueIdentifier(sectionKey, issue.key);
    const isExpanded = expandedIssueIdentifier === issueIdentifier;
    const expandButtonLabel = `${isExpanded ? 'Collapse' : 'Expand'} details for ${issue.key}`;

    function handleCardClick() {
      toggleExpandedIssue(sectionKey, issue.key);
    }

    return (
      <div className={styles.issueCardWrapper} key={issue.key}>
        {/* Whole card is clickable — caret stays as a visual affordance hint. */}
        <div
          aria-expanded={isExpanded}
          aria-label={expandButtonLabel}
          className={`${cardClassName} ${styles.clickableRow}`}
          onClick={handleCardClick}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') handleCardClick();
          }}
          role="button"
          tabIndex={0}
        >
          <div className={styles.issueCardHeaderRow}>
            <a
              className={styles.issueKeyLink}
              href={`${JIRA_BROWSE_URL_PREFIX}${issue.key}`}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              target="_blank"
              rel="noreferrer"
            >
              {issue.key}
            </a>
            <span aria-hidden="true" className={styles.expandToggleButton}>
              {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
            </span>
          </div>
          <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
          <span className={styles.issueMetaText}>
            {issue.fields.assignee?.displayName ?? 'Unassigned'} · {calculateIssueAgeDays(issue.fields.updated)}d ago
          </span>
        </div>
        {isExpanded && (
          <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.blockerFilterBar}>
        <span className={styles.blockerFilterLabel}>{BLOCKERS_FILTER_LABEL}</span>
        <button
          className={activeFilter === 'all' ? styles.blockerFilterChipActive : styles.blockerFilterChip}
          onClick={() => setActiveFilter('all')}
          type="button"
        >
          All ({blockedIssues.length + staleIssues.length})
        </button>
        <button
          className={activeFilter === 'blockers' ? styles.blockerFilterChipActive : styles.blockerFilterChip}
          onClick={() => setActiveFilter('blockers')}
          type="button"
        >
          🚫 Blocked ({blockedIssues.length})
        </button>
        <button
          className={activeFilter === 'stale' ? styles.blockerFilterChipActive : styles.blockerFilterChip}
          onClick={() => setActiveFilter('stale')}
          type="button"
        >
          ⚠️ Stale ({staleIssues.length})
        </button>
      </div>

      {(activeFilter === 'all' || activeFilter === 'blockers') && blockedIssues.length > 0 && (
        <div className={styles.blockersSection}>
          <div className={styles.blockersSectionHeader}>
            <h3 className={styles.blockersSectionTitle}>Blocked</h3>
            <span className={styles.countBadge}>{blockedIssues.length}</span>
          </div>
          {blockedIssues.map((issue) => renderBlockerCard(issue, styles.blockerCard, BLOCKED_SECTION_KEY))}
        </div>
      )}

      {(activeFilter === 'all' || activeFilter === 'stale') && staleIssues.length > 0 && (
        <div className={styles.blockersSection}>
          <div className={styles.blockersSectionHeader}>
            <h3 className={styles.blockersSectionTitle}>
              Stale (In Progress {staleDaysThreshold}+ days)
            </h3>
            <span className={styles.countBadge}>{staleIssues.length}</span>
          </div>
          {staleIssues.map((issue) => renderBlockerCard(issue, `${styles.blockerCard} ${styles.staleCard}`, STALE_SECTION_KEY))}
        </div>
      )}

      {blockedIssues.length === 0 && staleIssues.length === 0 && (
        <p style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
          No blocked or stale issues.
        </p>
      )}

      {blockedIssues.length + staleIssues.length > 0
        && ((activeFilter === 'blockers' && blockedIssues.length === 0)
          || (activeFilter === 'stale' && staleIssues.length === 0)) && (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>
          Nothing matching this filter.
        </p>
      )}
    </div>
  );
}

/** Renders the Defects tab using the live legacy mix of sprint-seeded bugs plus a project-wide 90-day defect sweep. */
function DefectsTab({
  issues,
  onIssueUpdated,
  projectKey,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  issues: JiraIssue[];
  onIssueUpdated: () => void;
  projectKey: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [projectDefectIssues, setProjectDefectIssues] = useState<JiraIssue[]>([]);
  const [isLoadingDefects, setIsLoadingDefects] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusCategoryFilter, setStatusCategoryFilter] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'priority-age' | 'age' | 'assignee' | 'status'>('priority-age');
  const sprintDefectIssues = useMemo(() => issues.filter(isDefectIssue), [issues]);
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const defectIssues = useMemo(() => {
    if (!normalizedProjectKey) {
      return sprintDefectIssues;
    }

    const mergedIssues = [...sprintDefectIssues];
    const seenIssueKeys = new Set(sprintDefectIssues.map((issue) => issue.key));
    for (const projectDefectIssue of projectDefectIssues) {
      if (!seenIssueKeys.has(projectDefectIssue.key)) {
        mergedIssues.push(projectDefectIssue);
      }
    }

    return mergedIssues;
  }, [normalizedProjectKey, projectDefectIssues, sprintDefectIssues]);

  useEffect(() => {
    if (!normalizedProjectKey) {
      return;
    }

    let isMounted = true;
    async function loadProjectDefects() {
      setIsLoadingDefects(true);
      try {
        const jql = buildScopedProjectJql(
          normalizedProjectKey,
          { scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue },
          [`issuetype in ("Bug","Defect")`],
          'priority ASC, created ASC',
        );
        const response = await jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
          jql,
          'summary,status,assignee,priority,issuetype,created,updated,issuelinks,customfield_10016,customfield_10028,customfield_10021,labels,fixVersions',
          DEFECT_MAX_RESULTS,
        ));
        if (!isMounted) {
          return;
        }
        setProjectDefectIssues(response.issues ?? []);
      } finally {
        if (isMounted) {
          setIsLoadingDefects(false);
        }
      }
    }

    void loadProjectDefects();
    return () => {
      isMounted = false;
    };
  }, [
    normalizedProjectKey,
    scopeMode,
    selectedSprintId,
    selectedFixVersionName,
    selectedPiValue,
  ]);

  const filteredDefects = defectIssues
    .filter((defectIssue) => priorityFilter === '' || readIssuePriorityName(defectIssue) === priorityFilter)
    .filter((defectIssue) => statusCategoryFilter === '' || defectIssue.fields.status.statusCategory.key === statusCategoryFilter)
    .filter((defectIssue) => !showUnassignedOnly || defectIssue.fields.assignee == null)
    .sort((leftIssue, rightIssue) => {
      if (sortMode === 'age') {
        return readIssueAgeDays(rightIssue) - readIssueAgeDays(leftIssue);
      }
      if (sortMode === 'assignee') {
        return readAssigneeName(leftIssue).localeCompare(readAssigneeName(rightIssue));
      }
      if (sortMode === 'status') {
        const statusOrder = { indeterminate: 0, new: 1, done: 2 };
        const leftOrder = statusOrder[leftIssue.fields.status.statusCategory.key as keyof typeof statusOrder] ?? 1;
        const rightOrder = statusOrder[rightIssue.fields.status.statusCategory.key as keyof typeof statusOrder] ?? 1;
        return leftOrder - rightOrder;
      }

      const priorityDelta = getDefectPriorityOrder(readIssuePriorityName(leftIssue))
        - getDefectPriorityOrder(readIssuePriorityName(rightIssue));
      return priorityDelta !== 0 ? priorityDelta : readIssueAgeDays(rightIssue) - readIssueAgeDays(leftIssue);
    });

  const openDefects = defectIssues.filter((defectIssue) => defectIssue.fields.status.statusCategory.key !== 'done');
  const needsTriage = filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key !== 'done' && defectIssue.fields.assignee == null);
  const inProgressDefects = filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'indeterminate' && defectIssue.fields.assignee != null);
  const openAssignedDefects = filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'new' && defectIssue.fields.assignee != null);
  const resolvedDefects = filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'done');
  const assigneeLoad = Array.from(groupIssuesByAssignee(openDefects).entries())
    .map(([assigneeName, assigneeDefects]) => ({ assigneeName, count: assigneeDefects.length }))
    .sort((leftRow, rightRow) => rightRow.count - leftRow.count || leftRow.assigneeName.localeCompare(rightRow.assigneeName));

  const renderedSections = sortMode === 'priority-age'
    ? [
        { title: 'Needs Triage', issues: needsTriage },
        { title: 'In Progress', issues: inProgressDefects },
        { title: 'Assigned — Not Started', issues: openAssignedDefects },
      ]
    : sortMode === 'assignee'
      ? Array.from(groupIssuesByAssignee(filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key !== 'done')).entries())
        .map(([assigneeName, groupedIssues]) => ({ title: assigneeName, issues: groupedIssues }))
      : sortMode === 'status'
        ? [
            { title: 'In Progress', issues: filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'indeterminate') },
            { title: 'To Do', issues: filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'new') },
          ]
        : [
            { title: 'Open Defects — Oldest First', issues: filteredDefects.filter((defectIssue) => defectIssue.fields.status.statusCategory.key !== 'done') },
          ];

  if (defectIssues.length === 0 && !isLoadingDefects) {
    return <p className={styles.issueMetaText}>No defects found. 🎉</p>;
  }

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Defect Management</h2>
      <div className={styles.flowStatsBar}>
        <StatChip label="Total" value={defectIssues.length} />
        <StatChip label="Unassigned" value={openDefects.filter((defectIssue) => defectIssue.fields.assignee == null).length} />
        <StatChip label="P1/P2 Open" value={openDefects.filter((defectIssue) => getDefectPriorityOrder(readIssuePriorityName(defectIssue)) <= 1).length} />
        <StatChip label="To Do" value={defectIssues.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'new').length} />
        <StatChip label="In Progress" value={defectIssues.filter((defectIssue) => defectIssue.fields.status.statusCategory.key === 'indeterminate').length} />
        <StatChip label="Resolved" value={resolvedDefects.length} />
        <StatChip
          label="Avg Open Age"
          value={`${openDefects.length === 0 ? 0 : Math.round(openDefects.reduce((sum, defectIssue) => sum + readIssueAgeDays(defectIssue), 0) / openDefects.length)}d`}
        />
      </div>

      <div className={styles.sprintInfoCard} style={{ marginBottom: 'var(--spacing-md)' }}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>Assignee Load</h3>
          {isLoadingDefects && <span className={styles.issueMetaText}>Loading all project defects…</span>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          {assigneeLoad.map((assigneeRow) => (
            <span className={styles.releaseSummaryMuted} key={assigneeRow.assigneeName}>
              {assigneeRow.assigneeName}: {assigneeRow.count}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
        <select className={styles.settingsInput} onChange={(changeEvent) => setPriorityFilter(changeEvent.target.value)} style={{ width: 'auto' }} value={priorityFilter}>
          <option value="">All Priorities</option>
          {Array.from(new Set(defectIssues.map((defectIssue) => readIssuePriorityName(defectIssue)))).sort().map((priorityName) => (
            <option key={priorityName} value={priorityName}>{priorityName}</option>
          ))}
        </select>
        <select className={styles.settingsInput} onChange={(changeEvent) => setStatusCategoryFilter(changeEvent.target.value)} style={{ width: 'auto' }} value={statusCategoryFilter}>
          <option value="">All Statuses</option>
          <option value="new">To Do</option>
          <option value="indeterminate">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select className={styles.settingsInput} onChange={(changeEvent) => setSortMode(changeEvent.target.value as typeof sortMode)} style={{ width: 'auto' }} value={sortMode}>
          <option value="priority-age">Priority + Age</option>
          <option value="age">Age</option>
          <option value="assignee">Assignee</option>
          <option value="status">Status</option>
        </select>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input checked={showUnassignedOnly} onChange={() => setShowUnassignedOnly((previousValue) => !previousValue)} type="checkbox" />
          Unassigned only
        </label>
      </div>

      {renderedSections.filter((section) => section.issues.length > 0).map((section) => (
        <section className={styles.defectGroup} key={section.title}>
          <div className={styles.defectGroupHeader}>
            <h3 className={styles.defectGroupTitle}>{section.title}</h3>
            <span className={styles.countBadge}>{section.issues.length}</span>
          </div>
          {section.issues.map((defectIssue) => {
            const isExpanded = expandedIssueKey === defectIssue.key;
            return (
              <div className={styles.issueCardWrapper} key={defectIssue.key}>
                <div className={styles.defectCard}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <div>
                      <a
                        className={styles.issueKeyLink}
                        href={`${JIRA_BROWSE_URL_PREFIX}${defectIssue.key}`}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {defectIssue.key}
                      </a>{' '}
                      <span>{defectIssue.fields.summary}</span>
                    </div>
                    <div className={styles.issueMetaText}>
                      {readIssuePriorityName(defectIssue)} · {readAssigneeName(defectIssue)} · {readIssueAgeDays(defectIssue)}d old · updated {readIssueUpdatedAgeDays(defectIssue)}d ago
                    </div>
                  </div>
                  <button
                    aria-expanded={isExpanded}
                    className={styles.expandToggleButton}
                    onClick={() => setExpandedIssueKey((previousIssueKey) => previousIssueKey === defectIssue.key ? null : defectIssue.key)}
                    type="button"
                  >
                    {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
                  </button>
                </div>
                {isExpanded && (
                  <IssueDetailPanel isEmbedded issue={defectIssue} onIssueUpdated={onIssueUpdated} />
                )}
              </div>
            );
          })}
        </section>
      ))}

      {resolvedDefects.length > 0 && priorityFilter === '' && statusCategoryFilter === '' && !showUnassignedOnly && (
        <details className={styles.sprintInfoCard}>
          <summary style={{ cursor: 'pointer' }}>Resolved ({resolvedDefects.length})</summary>
          <div style={{ display: 'grid', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
            {resolvedDefects.slice(0, 20).map((defectIssue) => (
              <div className={styles.issueMetaText} key={defectIssue.key}>
                {defectIssue.key} — {defectIssue.fields.summary}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Settings tab (project key + board picker + advanced config) ──

interface SettingsTabProps {
  issues: JiraIssue[];
  projectKey: string;
  isLoadingSprint: boolean;
  loadError: string | null;
  boardType: DashboardBoardType;
  boardId: number | null;
  availableBoards: ReturnType<typeof useSprintData>['state']['availableBoards'];
  boardSearchQuery: string;
  config: DashboardConfig;
  dashboardTeamProfiles: SprintDashboardTeamProfile[];
  activeDashboardTeamProfileId: string;
  onProjectKeyChange: (key: string) => void;
  onLoadSprint: () => void;
  onBoardSearchChange: (query: string) => void;
  onSelectBoard: (boardId: number) => Promise<void>;
  onConfigChange: (partial: Partial<DashboardConfig>) => void;
  onActivateDashboardTeam: (teamProfileId: string) => void;
  onSaveDashboardTeam: (teamName: string, shouldCreateNewTeam: boolean) => void;
  onRemoveDashboardTeam: (teamProfileId: string) => void;
}

interface DetectedWorkflowIssueType {
  issueTypeName: string;
  statuses: Array<{ name: string; categoryKey: 'new' | 'indeterminate' | 'done' }>;
}

/**
 * Renders the Settings tab: project key, board picker, roster settings, and persisted dashboard config fields.
 * All changes persist to localStorage immediately so they survive page reloads.
 */
function SettingsTab({
  issues,
  projectKey,
  isLoadingSprint,
  loadError,
  boardType,
  boardId,
  availableBoards,
  boardSearchQuery,
  config,
  dashboardTeamProfiles,
  activeDashboardTeamProfileId,
  onProjectKeyChange,
  onLoadSprint,
  onBoardSearchChange,
  onSelectBoard,
  onConfigChange,
  onActivateDashboardTeam,
  onSaveDashboardTeam,
  onRemoveDashboardTeam,
}: SettingsTabProps) {
  const settingsCopy = getBoardSettingsCopy(boardType);
  const activeDashboardTeamProfile = useMemo(
    () =>
      dashboardTeamProfiles.find(
        (teamProfile) => teamProfile.id === activeDashboardTeamProfileId,
      ) ?? null,
    [activeDashboardTeamProfileId, dashboardTeamProfiles],
  );
  const [dashboardTeamName, setDashboardTeamName] = useState(
    activeDashboardTeamProfile?.name ?? '',
  );
  const [detectedWorkflowIssueTypes, setDetectedWorkflowIssueTypes] = useState<DetectedWorkflowIssueType[]>([]);
  const [isDetectingWorkflowStatuses, setIsDetectingWorkflowStatuses] = useState(false);
  const [workflowDetectError, setWorkflowDetectError] = useState<string | null>(null);
  const hasProjectKey = Boolean(projectKey.trim());
  const hasSelectedBoard = boardId !== null;
  const canSaveDashboardTeam = hasProjectKey && hasSelectedBoard;

  async function handleDetectWorkflowStatuses() {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      setWorkflowDetectError('Enter a project key before detecting workflow statuses.');
      setDetectedWorkflowIssueTypes([]);
      return;
    }

    setIsDetectingWorkflowStatuses(true);
    setWorkflowDetectError(null);

    try {
      const projectStatuses = await jiraGet<
        Array<{ name?: string; statuses?: Array<{ name?: string; statusCategory?: { key?: string; id?: number } }> }>
      >(`/rest/api/2/project/${encodeURIComponent(normalizedProjectKey)}/statuses`);

      setDetectedWorkflowIssueTypes(
        projectStatuses.map<DetectedWorkflowIssueType>((issueTypeStatuses) => ({
          issueTypeName: issueTypeStatuses.name ?? 'Issue Type',
          statuses: (issueTypeStatuses.statuses ?? [])
            .map((status) => {
              const categoryKey = status.statusCategory?.key;
              const categoryId = status.statusCategory?.id;
              const normalizedCategoryKey: 'new' | 'indeterminate' | 'done' =
                categoryKey === 'done' || categoryId === 4
                ? 'done'
                : categoryKey === 'indeterminate' || categoryKey === 'in_progress' || categoryId === 3
                  ? 'indeterminate'
                  : 'new';
              return {
                name: status.name ?? 'Unknown',
                categoryKey: normalizedCategoryKey,
              };
            })
            .filter((status) => status.name !== 'Unknown'),
        })),
      );
    } catch (caughtError) {
      setWorkflowDetectError(caughtError instanceof Error ? caughtError.message : 'Failed to detect workflow statuses.');
      setDetectedWorkflowIssueTypes([]);
    } finally {
      setIsDetectingWorkflowStatuses(false);
    }
  }

  function handleApplyDetectedWorkflowStatus(
    statusName: string,
    targetField: 'cycleTimeStartField' | 'cycleTimeDoneField',
  ) {
    const nextValue = config[targetField] === statusName ? '' : statusName;
    onConfigChange({ [targetField]: nextValue });
  }

  return (
    <div className={styles.settingsPanel}>
      <div className={styles.settingsPrimaryColumn}>
        <div>
          <h2 className={styles.settingsSectionTitle}>{BOARD_SETTINGS_TITLE}</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {settingsCopy.description}
          </p>
        </div>
        <div>
          <label
            htmlFor="sprint-project-key-input"
            style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-md)' }}
          >
            Project Key
          </label>
          <input
            className={styles.settingsInput}
            id="sprint-project-key-input"
            onChange={(changeEvent) => onProjectKeyChange(changeEvent.target.value.toUpperCase())}
            placeholder="e.g. TBX"
            type="text"
            value={projectKey}
          />
        </div>
        <button
          className={styles.loadButton}
          disabled={isLoadingSprint || (!projectKey && boardId === null)}
          onClick={onLoadSprint}
          type="button"
        >
          {isLoadingSprint ? 'Loading…' : settingsCopy.loadButtonLabel}
        </button>
        {loadError && <p className={styles.errorMessage}>{loadError}</p>}

        {availableBoards.length > 0 && (
          <BoardPicker
            boards={availableBoards}
            isLoading={isLoadingSprint}
            onSearchChange={onBoardSearchChange}
            onSelectBoard={onSelectBoard}
            searchQuery={boardSearchQuery}
            selectedBoardId={boardId}
          />
        )}

        <div className={styles.settingsDivider} />

        <div>
          <h2 className={styles.settingsSectionTitle}>Saved Dashboard Teams</h2>
          <p className={styles.issueMetaText}>
            Pick a project and board first, then save this setup so you can switch teams from the page header without re-entering details.
          </p>
          <label
            htmlFor="dashboard-team-name-input"
            style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-md)' }}
          >
            {DASHBOARD_TEAM_ALIAS_LABEL}
          </label>
          <input
            className={styles.settingsInput}
            id="dashboard-team-name-input"
            onChange={(changeEvent) => setDashboardTeamName(changeEvent.target.value)}
            placeholder={DASHBOARD_TEAM_NAME_PLACEHOLDER}
            type="text"
            value={dashboardTeamName}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
            <button
              className={styles.secondaryButton}
              disabled={!canSaveDashboardTeam}
              onClick={() => onSaveDashboardTeam(dashboardTeamName, false)}
              type="button"
            >
              {activeDashboardTeamProfile ? 'Update Active Team' : 'Save Team'}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!canSaveDashboardTeam}
              onClick={() => onSaveDashboardTeam(dashboardTeamName, true)}
              type="button"
            >
              Save as New Team
            </button>
            <button
              className={styles.textActionButton}
              disabled={!activeDashboardTeamProfile}
              onClick={() =>
                activeDashboardTeamProfile
                  ? onRemoveDashboardTeam(activeDashboardTeamProfile.id)
                  : undefined
              }
              type="button"
            >
              Remove Active Team
            </button>
          </div>
          {!canSaveDashboardTeam ? (
            <p className={styles.issueMetaText}>
              Enter a project key and choose a board before saving a team profile.
            </p>
          ) : null}
          {dashboardTeamProfiles.length > 0 ? (
            <div className={styles.workflowStatusChipRow}>
              {dashboardTeamProfiles.map((teamProfile) => {
                const isSelected = teamProfile.id === activeDashboardTeamProfileId;
                return (
                  <button
                    className={isSelected ? styles.workflowStatusChipActive : styles.workflowStatusChip}
                    key={teamProfile.id}
                    onClick={() => onActivateDashboardTeam(teamProfile.id)}
                    type="button"
                  >
                    {buildDashboardTeamProfileLabel(teamProfile)}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.issueMetaText}>
              Save the current project and board selection as your first dashboard team.
            </p>
          )}
        </div>

        <div className={styles.settingsDivider} />

        <div>
          <h2 className={styles.settingsSectionTitle}>Advanced Settings</h2>
        </div>

        <AdvancedConfigFields config={config} onConfigChange={onConfigChange} />

        <div className={styles.settingsDivider} />

        <div className={styles.workflowDetectSection}>
          <div className={styles.workflowDetectHeader}>
            <h2 className={styles.settingsSectionTitle}>Workflow Status Detection</h2>
            <button
              className={styles.secondaryButton}
              onClick={() => void handleDetectWorkflowStatuses()}
              type="button"
            >
              {isDetectingWorkflowStatuses ? 'Detecting…' : 'Detect'}
            </button>
          </div>
          <p className={styles.issueMetaText}>
            Statuses are grouped by issue type, reflecting each type&apos;s Jira workflow. Click a status to fill the corresponding cycle-time field. Leave a field blank to auto-detect using Jira status categories.
          </p>
          {workflowDetectError && <p className={styles.errorMessage}>{workflowDetectError}</p>}
          {detectedWorkflowIssueTypes.map((issueTypeStatuses) => (
            <div className={styles.workflowIssueTypeCard} key={issueTypeStatuses.issueTypeName}>
              <h3 className={styles.blockersSectionTitle}>{issueTypeStatuses.issueTypeName}</h3>
              <div className={styles.workflowStatusChipRow}>
                {issueTypeStatuses.statuses.map((status) => {
                  const isDoneStatus = status.categoryKey === 'done';
                  const targetField = isDoneStatus ? 'cycleTimeDoneField' : 'cycleTimeStartField';
                  const isSelected = config[targetField] === status.name;
                  const prefix = status.categoryKey === 'done'
                    ? '🟢'
                    : status.categoryKey === 'indeterminate'
                      ? '🔵'
                      : '⬜';

                  return (
                    <button
                      className={isSelected ? styles.workflowStatusChipActive : styles.workflowStatusChip}
                      key={`${issueTypeStatuses.issueTypeName}-${status.name}`}
                      onClick={() => handleApplyDetectedWorkflowStatus(status.name, targetField)}
                      type="button"
                    >
                      {prefix} {status.name} → {isDoneStatus ? 'set as Done status' : 'set as Start'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.settingsDivider} />
      <RosterTab issues={issues} projectKey={projectKey} />
    </div>
  );
}

/**
 * Renders the advanced config fields as labelled inputs.
 * Extracted into its own component so the main Settings tab stays focused on layout and flow.
 */
function AdvancedConfigFields({
  config,
  onConfigChange,
}: {
  config: DashboardConfig;
  onConfigChange: (partial: Partial<DashboardConfig>) => void;
}) {
  return (
    <div className={styles.advancedConfigGrid}>
      <ConfigNumberField
        id="sd-cfg-stale-days"
        label="Stale threshold (days)"
        onChange={(value) => onConfigChange({ staleDaysThreshold: value })}
        value={config.staleDaysThreshold}
      />
      <ConfigTextField
        id="sd-cfg-pointing-scale"
        label="Story point scale (comma-separated)"
        onChange={(value) => onConfigChange({ storyPointScale: value })}
        value={config.storyPointScale}
      />
      <ConfigNumberField
        id="sd-cfg-sprint-window"
        label={SCRUM_VELOCITY_WINDOW_LABEL}
        onChange={(value) => onConfigChange({ sprintWindow: value })}
        value={config.sprintWindow}
      />
      <ConfigTextField
        id="sd-cfg-ct-start"
        label="Cycle-time start status (e.g. In Progress)"
        onChange={(value) => onConfigChange({ cycleTimeStartField: value })}
        value={config.cycleTimeStartField}
      />
      <ConfigTextField
        id="sd-cfg-ct-done"
        label="Cycle-time done status (e.g. Done)"
        onChange={(value) => onConfigChange({ cycleTimeDoneField: value })}
        value={config.cycleTimeDoneField}
      />
      <ConfigNumberField
        id="sd-cfg-ct-baseline"
        label="Cycle-time baseline (days)"
        onChange={(value) => onConfigChange({ cycleTimeBaselineDays: value })}
        value={config.cycleTimeBaselineDays}
      />
      <ConfigNumberField
        id="sd-cfg-kanban-period"
        label={KANBAN_THROUGHPUT_WINDOW_LABEL}
        onChange={(value) => onConfigChange({ kanbanPeriodDays: value })}
        value={config.kanbanPeriodDays}
      />
      <JiraFieldPicker
        id="sd-cfg-sp-field"
        label="Story Points Field"
        onChange={(fieldId) => onConfigChange({ customStoryPointsFieldId: fieldId })}
        placeholder="Story Points field"
        value={config.customStoryPointsFieldId}
      />
      <JiraFieldPicker
        id="sd-cfg-epic-field"
        label="Epic Link Field"
        onChange={(fieldId) => onConfigChange({ customEpicLinkFieldId: fieldId })}
        placeholder="Epic Link field"
        value={config.customEpicLinkFieldId}
      />
    </div>
  );
}

/** Reusable labelled text input for a config field. */
function ConfigTextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </label>
      <input
        className={styles.settingsInput}
        id={id}
        onChange={(evt) => onChange(evt.target.value)}
        type="text"
        value={value}
      />
    </div>
  );
}

/** Reusable labelled number input for a config field. */
function ConfigNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </label>
      <input
        className={styles.settingsInput}
        id={id}
        min={1}
        onChange={(evt) => onChange(Number(evt.target.value) || 1)}
        type="number"
        value={value}
      />
    </div>
  );
}

// ── Phase 3 tab components ──

/**
 * Renders the Metrics tab using legacy predictability, cycle-time, bottleneck,
 * and throughput calculations against Jira history.
 */
function MetricsTab({
  boardId,
  boardType,
  config,
  projectKey,
  customStoryPointsFieldId,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  boardId: number | null;
  boardType: DashboardBoardType;
  config: DashboardConfig;
  projectKey: string;
  customStoryPointsFieldId: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const [metricsState, setMetricsState] = useState<MetricsDataState>({
    predictabilityRows: [],
    cycleTimeSummary: null,
    bottleneckRows: [],
    throughputRows: [],
    boardTypeLabel: 'No board selected',
  });
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  useEffect(() => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    if (!boardId || !normalizedProjectKey) {
      return;
    }

    let isMounted = true;

    async function loadMetrics() {
      setIsLoadingMetrics(true);
      setMetricsError(null);

      try {
        const detectedBoardType = boardType ?? ((await jiraGet<{ type?: string }>(`/rest/agile/1.0/board/${boardId}`)).type as DashboardBoardType | undefined) ?? 'scrum';
        const boardTypeLabel = `${detectedBoardType.charAt(0).toUpperCase()}${detectedBoardType.slice(1)} board`;
        const workScopeClause = buildWorkScopeClause({
          scopeMode,
          selectedSprintId,
          selectedFixVersionName,
          selectedPiValue,
        });

        const nextState: MetricsDataState = {
          predictabilityRows: [],
          cycleTimeSummary: null,
          bottleneckRows: [],
          throughputRows: [],
          boardTypeLabel,
        };

        if (detectedBoardType === 'scrum' && scopeMode === DASHBOARD_SCOPE_MODE_SPRINT) {
          const closedSprintResponse = await jiraGet<{ values?: Array<{ id: number; name: string; startDate?: string }> }>(
            `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${config.sprintWindow}&orderBy=startDate`,
          );
          const closedSprints = (closedSprintResponse.values ?? [])
            .sort(
              (leftSprint, rightSprint) =>
                new Date(leftSprint.startDate ?? '').getTime()
                - new Date(rightSprint.startDate ?? '').getTime(),
            )
            .slice(-config.sprintWindow);

          nextState.predictabilityRows = await Promise.all(
            closedSprints.map(async (closedSprint) => {
              try {
                const sprintReport = await jiraGet<{
                  contents?: {
                    completedIssues?: Array<Record<string, unknown> & { key?: string }>;
                    incompletedIssues?: Array<Record<string, unknown> & { key?: string }>;
                    puntedIssues?: Array<Record<string, unknown> & { key?: string }>;
                    issueKeysAddedDuringSprint?: Record<string, boolean>;
                  };
                }>(
                  `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${closedSprint.id}`,
                );
                const reportContents = sprintReport.contents;
                if (!reportContents) {
                  return {
                    name: closedSprint.name,
                    committedPoints: 0,
                    completedPoints: 0,
                    committedItems: 0,
                    completedItems: 0,
                    completionPercentage: 0,
                  } satisfies PredictabilityRow;
                }

                const addedKeys = new Set(
                  Object.keys(reportContents.issueKeysAddedDuringSprint ?? {}),
                );
                const completedIssues = reportContents.completedIssues ?? [];
                const incompleteIssues = reportContents.incompletedIssues ?? [];
                const puntedIssues = reportContents.puntedIssues ?? [];
                const committedIssues = [...completedIssues, ...incompleteIssues, ...puntedIssues].filter(
                  (issue) => !addedKeys.has(String(issue.key ?? '')),
                );
                const completedCommittedIssues = completedIssues.filter(
                  (issue) => !addedKeys.has(String(issue.key ?? '')),
                );

                const readSprintReportPoints = (issue: Record<string, unknown>) => {
                  const currentEstimate = issue.currentEstimateStatistic as
                    | { statFieldValue?: { value?: number | string } }
                    | undefined;
                  const estimate = issue.estimateStatistic as
                    | { statFieldValue?: { value?: number | string } }
                    | undefined;
                  return Number(
                    currentEstimate?.statFieldValue?.value
                    ?? estimate?.statFieldValue?.value
                    ?? 0,
                  );
                };

                const committedPoints = committedIssues.reduce(
                  (sum, issue) => sum + readSprintReportPoints(issue),
                  0,
                );
                const completedPoints = completedCommittedIssues.reduce(
                  (sum, issue) => sum + readSprintReportPoints(issue),
                  0,
                );
                const completionPercentage = committedPoints > 0
                  ? Math.round((completedPoints / committedPoints) * 100)
                  : committedIssues.length > 0
                    ? Math.round((completedCommittedIssues.length / committedIssues.length) * 100)
                    : 0;

                return {
                  name: closedSprint.name,
                  committedPoints,
                  completedPoints,
                  committedItems: committedIssues.length,
                  completedItems: completedCommittedIssues.length,
                  completionPercentage,
                } satisfies PredictabilityRow;
              } catch {
                return {
                  name: closedSprint.name,
                  committedPoints: 0,
                  completedPoints: 0,
                  committedItems: 0,
                  completedItems: 0,
                  completionPercentage: 0,
                } satisfies PredictabilityRow;
              }
            }),
          );
        }

        const [cycleTimeIssuesResult, projectStatuses] = await Promise.all([
          fetchAllCycleTimeIssues(normalizedProjectKey, customStoryPointsFieldId, workScopeClause),
          jiraGet<Array<{ statuses?: Array<{ name?: string; statusCategory?: { key?: string; id?: number } }> }>>(
            `/rest/api/2/project/${encodeURIComponent(normalizedProjectKey)}/statuses`,
          ).catch(() => []),
        ]);

        const statusCategoryMap = buildCycleTimeStatusCategoryMap(projectStatuses);
        const exactStartStatuses = config.cycleTimeStartField
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        const exactDoneStatuses = config.cycleTimeDoneField
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        const usedExactStatusMatch = exactStartStatuses.length > 0 || exactDoneStatuses.length > 0;
        const bottleneckMap = new Map<
          string,
          { totalDays: number; count: number; categoryKey: string; displayName: string }
        >();
        const cycleTimeRows: Array<{ days: number }> = [];
        let excludedCount = 0;

        for (const issue of cycleTimeIssuesResult.issues) {
          const issueWithHistory = issue as JiraIssue & {
            changelog?: {
              histories?: Array<{
                created: string;
                items?: Array<{ field?: string; fromString?: string; toString?: string }>;
              }>;
            };
          };
          const histories = [...(issueWithHistory.changelog?.histories ?? [])].sort(
            (leftHistory, rightHistory) =>
              new Date(leftHistory.created).getTime() - new Date(rightHistory.created).getTime(),
          );
          const createdDate = new Date(issue.fields.created);
          const currentStatusLower = issue.fields.status.name.toLowerCase();
          let startTime: Date | null = null;
          let endTime: Date | null = null;
          let firstFromStatus: string | null = null;
          let previousStatusName: string | null = null;
          let previousStatusTime: Date | null = null;
          let isFirstHistoryItem = true;
          const timelineEntries: Array<{ statusName: string; enteredAt: Date; exitedAt: Date }> = [];

          for (const history of histories) {
            const transitionTime = new Date(history.created);
            for (const item of history.items ?? []) {
              if (item.field !== 'status') {
                continue;
              }

              const toStatusName = (item.toString ?? '').toLowerCase();
              const fromStatusName = (item.fromString ?? '').toLowerCase();

              if (isFirstHistoryItem) {
                firstFromStatus = fromStatusName;
                previousStatusName = fromStatusName;
                previousStatusTime = createdDate;
                isFirstHistoryItem = false;
              }

              if (previousStatusName !== null && previousStatusTime !== null) {
                timelineEntries.push({
                  statusName: previousStatusName,
                  enteredAt: previousStatusTime,
                  exitedAt: transitionTime,
                });
              }

              previousStatusName = toStatusName;
              previousStatusTime = transitionTime;

              const isStartTransition = !startTime && (
                (exactStartStatuses.length > 0 && exactStartStatuses.includes(toStatusName))
                || (exactStartStatuses.length === 0
                  && mapStatusCategory(toStatusName, statusCategoryMap) === 'indeterminate')
              );
              if (isStartTransition) {
                startTime = transitionTime;
              }

              const isDoneTransition = (exactDoneStatuses.length > 0 && exactDoneStatuses.includes(toStatusName))
                || (exactDoneStatuses.length === 0 && (
                  mapStatusCategory(toStatusName, statusCategoryMap) === 'done'
                  || toStatusName === currentStatusLower
                ));
              if (isDoneTransition) {
                endTime = transitionTime;
              }
            }
          }

          if (!startTime && firstFromStatus) {
            const firstFromWasWork = exactStartStatuses.length === 0
              ? mapStatusCategory(firstFromStatus, statusCategoryMap) === 'indeterminate'
              : exactStartStatuses.includes(firstFromStatus);
            if (firstFromWasWork) {
              startTime = createdDate;
            }
          }

          if (!startTime) {
            if (endTime) {
              excludedCount++;
            }
            continue;
          }

          if (!endTime || endTime <= startTime) {
            continue;
          }

          const cycleDays = (endTime.getTime() - startTime.getTime()) / MS_PER_DAY;
          cycleTimeRows.push({ days: cycleDays });

          for (const timelineEntry of timelineEntries) {
            const clampedEntryTime = Math.max(timelineEntry.enteredAt.getTime(), startTime.getTime());
            const clampedExitTime = Math.min(timelineEntry.exitedAt.getTime(), endTime.getTime());
            if (clampedExitTime <= clampedEntryTime) {
              continue;
            }

            const dwellDays = (clampedExitTime - clampedEntryTime) / MS_PER_DAY;
            const categoryKey = mapStatusCategory(timelineEntry.statusName, statusCategoryMap) || 'indeterminate';
            const existingEntry = bottleneckMap.get(timelineEntry.statusName) ?? {
              totalDays: 0,
              count: 0,
              categoryKey,
              displayName: timelineEntry.statusName,
            };
            existingEntry.totalDays += dwellDays;
            existingEntry.count += 1;
            existingEntry.categoryKey = categoryKey;
            bottleneckMap.set(timelineEntry.statusName, existingEntry);
          }
        }

        const sortedCycleTimes = cycleTimeRows
          .map((entry) => entry.days)
          .sort((leftDays, rightDays) => leftDays - rightDays);
        const averageDays = sortedCycleTimes.length === 0
          ? 0
          : sortedCycleTimes.reduce((sum, value) => sum + value, 0) / sortedCycleTimes.length;
        const improvementPercentage = config.cycleTimeBaselineDays > 0
          ? Math.round((1 - averageDays / config.cycleTimeBaselineDays) * 100)
          : null;

        nextState.cycleTimeSummary = sortedCycleTimes.length === 0
          ? null
          : {
              averageDays,
              medianDays: calculateMedian(sortedCycleTimes),
              percentile85Days: calculatePercentile(sortedCycleTimes, 0.85),
              measuredIssueCount: sortedCycleTimes.length,
              totalFetchedCount: cycleTimeIssuesResult.total,
              excludedCount,
              wasCapped: cycleTimeIssuesResult.wasCapped,
              improvementPercentage,
              startLabel: usedExactStatusMatch && config.cycleTimeStartField
                ? `"${config.cycleTimeStartField}"`
                : 'statusCategory = In Progress',
              doneLabel: usedExactStatusMatch && config.cycleTimeDoneField
                ? `"${config.cycleTimeDoneField}"`
                : 'statusCategory = Done',
              usedExactStatusMatch,
              workflowFetchSucceeded: projectStatuses.length > 0,
            };

        const categorySortOrder: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };
        nextState.bottleneckRows = Array.from(bottleneckMap.values())
          .map((entry) => ({
            statusName: entry.displayName,
            categoryKey: entry.categoryKey,
            averageDays: entry.count > 0 ? entry.totalDays / entry.count : 0,
            issueCount: entry.count,
          }))
          .sort((leftEntry, rightEntry) => {
            const categoryDifference =
              (categorySortOrder[leftEntry.categoryKey] ?? 0)
              - (categorySortOrder[rightEntry.categoryKey] ?? 0);
            return categoryDifference !== 0
              ? categoryDifference
              : rightEntry.averageDays - leftEntry.averageDays;
          });

        if (detectedBoardType === 'scrum' && scopeMode === DASHBOARD_SCOPE_MODE_SPRINT) {
          const closedSprintResponse = await jiraGet<{ values?: Array<{ id: number; name: string; startDate?: string }> }>(
            `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${config.sprintWindow}`,
          );
          const closedSprints = (closedSprintResponse.values ?? [])
            .sort(
              (leftSprint, rightSprint) =>
                new Date(leftSprint.startDate ?? '').getTime()
                - new Date(rightSprint.startDate ?? '').getTime(),
            )
            .slice(-config.sprintWindow);

          nextState.throughputRows = await Promise.all(
            closedSprints.map(async (closedSprint) => {
              try {
                const sprintIssuesResponse = await jiraGet<{ issues?: JiraIssue[] }>(
                  `/rest/agile/1.0/sprint/${closedSprint.id}/issue?maxResults=200&fields=status,customfield_10016,customfield_10028,${customStoryPointsFieldId}`,
                );
                const completedIssues = (sprintIssuesResponse.issues ?? []).filter((issue) => {
                  const normalizedStatusName = issue.fields.status.name.toLowerCase();
                  return ['done', 'accepted', 'closed', 'resolved', 'complete'].includes(normalizedStatusName);
                });
                return {
                  name: closedSprint.name.replace(/^Sprint /i, 'S'),
                  itemCount: completedIssues.length,
                  storyPoints: completedIssues.reduce(
                    (sum, issue) => sum + readStoryPoints(issue, customStoryPointsFieldId),
                    0,
                  ),
                } satisfies ThroughputRow;
              } catch {
                return {
                  name: closedSprint.name,
                  itemCount: 0,
                  storyPoints: 0,
                } satisfies ThroughputRow;
              }
            }),
          );
        } else {
          const weeksToAnalyze = Math.max(1, Math.round(config.kanbanPeriodDays / 7));
          const throughputJqlClauses = [
            `project = "${escapeJqlValue(normalizedProjectKey)}"`,
            `status CHANGED TO "Done" DURING (-${weeksToAnalyze}w, now())`,
          ];
          if (workScopeClause) {
            throughputJqlClauses.push(workScopeClause);
          }
          const throughputJql = encodeURIComponent(
            `${throughputJqlClauses.join(' AND ')} ORDER BY updated DESC`,
          );
          const throughputSearchResponse = await jiraGet<{ issues?: JiraIssue[] }>(
            `/rest/api/2/search?jql=${throughputJql}&maxResults=500&fields=resolutiondate,updated,customfield_10016,customfield_10028,${customStoryPointsFieldId}`,
          );
          const throughputBuckets = new Map<string, { itemCount: number; storyPoints: number }>();
          const now = Date.now();

          for (const issue of throughputSearchResponse.issues ?? []) {
            const resolvedAt = issue.fields.resolutiondate ?? issue.fields.updated;
            const weekOffset = Math.floor((now - new Date(resolvedAt).getTime()) / (7 * MS_PER_DAY));
            const label = `W-${weekOffset}`;
            const bucket = throughputBuckets.get(label) ?? { itemCount: 0, storyPoints: 0 };
            bucket.itemCount += 1;
            bucket.storyPoints += readStoryPoints(issue, customStoryPointsFieldId);
            throughputBuckets.set(label, bucket);
          }

          nextState.throughputRows = Array.from(throughputBuckets.entries())
            .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel))
            .slice(-weeksToAnalyze)
            .map(([label, bucket]) => ({
              name: label,
              itemCount: bucket.itemCount,
              storyPoints: bucket.storyPoints,
            }));
        }

        if (isMounted) {
          setMetricsState(nextState);
        }
      } catch (caughtError) {
        if (isMounted) {
          setMetricsError(caughtError instanceof Error ? caughtError.message : 'Failed to load metrics.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingMetrics(false);
        }
      }
    }

    void loadMetrics();

    return () => {
      isMounted = false;
    };
  }, [boardId, boardType, config, customStoryPointsFieldId, projectKey, scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue]);

  const predictabilityAverage = metricsState.predictabilityRows.length === 0
    ? 0
    : Math.round(
        metricsState.predictabilityRows.reduce(
          (sum, row) => sum + row.completionPercentage,
          0,
        ) / metricsState.predictabilityRows.length,
      );
  const throughputAverage = metricsState.throughputRows.length === 0
    ? 0
    : (
        metricsState.throughputRows.reduce((sum, row) => sum + row.itemCount, 0)
        / metricsState.throughputRows.length
      );
  const maxThroughput = Math.max(...metricsState.throughputRows.map((row) => row.itemCount), 1);
  const maxPredictabilityPoints = Math.max(
    ...metricsState.predictabilityRows.map((row) => row.committedPoints || row.committedItems || 1),
    1,
  );

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Sprint Metrics</h2>
      <p className={styles.issueMetaText}>{metricsState.boardTypeLabel}</p>
      {isLoadingMetrics && <p className={styles.issueMetaText}>Loading metrics…</p>}
      {metricsError && <p className={styles.errorMessage}>{metricsError}</p>}

      {!isLoadingMetrics && !metricsError && (
        <>
          <div className={styles.sprintInfoCard}>
            <div className={styles.blockersSectionHeader}>
              <h3 className={styles.blockersSectionTitle}>Predictability</h3>
              {metricsState.predictabilityRows.length > 0 && (
                <span className={styles.issueMetaText}>
                  <strong>{predictabilityAverage}% avg</strong> · 80% target
                </span>
              )}
            </div>
            {boardType === 'kanban' ? (
              <p className={styles.issueMetaText}>
                Predictability scoring requires sprint commitment data and is not applicable for Kanban boards.
              </p>
            ) : metricsState.predictabilityRows.length === 0 ? (
              <p className={styles.issueMetaText}>No closed sprints found.</p>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end', overflowX: 'auto' }}>
                {metricsState.predictabilityRows.map((row) => {
                  const barHeight = Math.max(
                    8,
                    Math.round(
                      ((row.committedPoints || row.committedItems || 0) / maxPredictabilityPoints) * 80,
                    ),
                  );
                  const fillHeight = row.committedPoints > 0
                    ? Math.round((row.completedPoints / row.committedPoints) * barHeight)
                    : row.committedItems > 0
                      ? Math.round((row.completedItems / row.committedItems) * barHeight)
                      : 0;
                  return (
                    <div
                      key={row.name}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 72 }}
                    >
                      <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>
                        {row.completionPercentage}%
                      </div>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', height: 84, width: '100%' }}>
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, borderTop: '1px dashed var(--color-success)' }} />
                        <div
                          style={{
                            position: 'relative',
                            flex: 1,
                            height: barHeight,
                            background: 'var(--color-surface-2)',
                            borderRadius: '4px 4px 0 0',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: 0,
                              height: `${Math.min(fillHeight, barHeight)}px`,
                              background: row.completionPercentage >= 80
                                ? 'var(--color-success)'
                                : row.completionPercentage >= 70
                                  ? 'var(--color-warning)'
                                  : 'var(--color-danger)',
                            }}
                          />
                        </div>
                      </div>
                      <div className={styles.issueMetaText}>{row.name.replace(/^Sprint /i, 'S')}</div>
                      <div className={styles.issueMetaText}>
                        {row.completedItems}/{row.committedItems} items
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.sprintInfoCard}>
            <div className={styles.blockersSectionHeader}>
              <h3 className={styles.blockersSectionTitle}>Cycle Time</h3>
            </div>
            {metricsState.cycleTimeSummary ? (
              <>
                <div className={styles.flowStatsBar}>
                  <StatChip label="Average" value={`${metricsState.cycleTimeSummary.averageDays.toFixed(1)} days`} />
                  <StatChip label="Median (p50)" value={`${metricsState.cycleTimeSummary.medianDays.toFixed(1)} days`} />
                  <StatChip label="p85" value={`${metricsState.cycleTimeSummary.percentile85Days.toFixed(1)} days`} />
                  <StatChip
                    label="Issues measured"
                    value={`${metricsState.cycleTimeSummary.measuredIssueCount}/${metricsState.cycleTimeSummary.totalFetchedCount}`}
                  />
                </div>
                <p className={styles.issueMetaText}>
                  Based on last 90 days · Start: {metricsState.cycleTimeSummary.startLabel} · End: {metricsState.cycleTimeSummary.doneLabel}
                </p>
                {metricsState.cycleTimeSummary.improvementPercentage !== null ? (
                  <p className={styles.issueMetaText}>
                    Baseline: <strong>{config.cycleTimeBaselineDays} days</strong> ·{' '}
                    <strong>
                      {metricsState.cycleTimeSummary.improvementPercentage >= 0 ? '↓' : '↑'}
                      {Math.abs(metricsState.cycleTimeSummary.improvementPercentage)}%
                    </strong>{' '}
                    vs baseline
                  </p>
                ) : (
                  <p className={styles.issueMetaText}>
                    Set a cycle-time baseline in Settings to track the legacy 20% reduction goal.
                  </p>
                )}
                {metricsState.cycleTimeSummary.excludedCount > 0 && (
                  <p className={styles.issueMetaText}>
                    {metricsState.cycleTimeSummary.excludedCount} completed issue(s) were excluded because they never entered an in-progress status.
                  </p>
                )}
              </>
            ) : (
              <p className={styles.issueMetaText}>No completed issues matched the cycle-time window.</p>
            )}
          </div>

          <div className={styles.sprintInfoCard}>
            <div className={styles.blockersSectionHeader}>
              <h3 className={styles.blockersSectionTitle}>Bottleneck Analysis</h3>
            </div>
            {metricsState.bottleneckRows.length === 0 ? (
              <p className={styles.issueMetaText}>Bottleneck data will appear once cycle-time issues are loaded.</p>
            ) : (
              metricsState.bottleneckRows.map((row, rowIndex) => {
                const maxAverageDays = Math.max(
                  ...metricsState.bottleneckRows.map((bottleneckRow) => bottleneckRow.averageDays),
                  1,
                );
                const isPrimaryBottleneck = rowIndex === 0 || (
                  row.categoryKey === 'indeterminate'
                  && metricsState.bottleneckRows
                    .filter((bottleneckRow) => bottleneckRow.categoryKey === 'indeterminate')[0]?.statusName === row.statusName
                );
                return (
                  <div
                    key={row.statusName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--spacing-sm)',
                      padding: '4px 6px',
                      marginBottom: 2,
                      borderRadius: 4,
                      background: isPrimaryBottleneck ? 'color-mix(in srgb, var(--color-danger) 10%, transparent)' : undefined,
                    }}
                  >
                    <div style={{ width: 180, minWidth: 180, fontSize: 'var(--font-size-sm)' }}>
                      {row.statusName}
                    </div>
                    <div style={{ position: 'relative', flex: 1, height: 16, background: 'var(--color-surface-2)', borderRadius: 4 }}>
                      <div
                        style={{
                          width: `${Math.round((row.averageDays / maxAverageDays) * 100)}%`,
                          height: '100%',
                          borderRadius: 4,
                          background: isPrimaryBottleneck ? 'var(--color-danger)' : 'var(--color-accent)',
                        }}
                      />
                    </div>
                    <div style={{ width: 90, minWidth: 90, fontSize: 'var(--font-size-sm)', textAlign: 'right' }}>
                      {row.averageDays.toFixed(1)} days
                    </div>
                    <div className={styles.issueMetaText}>{row.issueCount} issues</div>
                  </div>
                );
              })
            )}
          </div>

          <div className={styles.sprintInfoCard}>
            <div className={styles.blockersSectionHeader}>
              <h3 className={styles.blockersSectionTitle}>Throughput Trend</h3>
              <span className={styles.issueMetaText}>
                <strong>{throughputAverage.toFixed(1)} items/{boardType === 'kanban' ? 'week' : 'sprint'} avg</strong>
              </span>
            </div>
            {metricsState.throughputRows.length === 0 ? (
              <p className={styles.issueMetaText}>No throughput history found.</p>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', overflowX: 'auto', height: 118 }}>
                {metricsState.throughputRows.map((row) => (
                  <div
                    key={row.name}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 52 }}
                  >
                    <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>{row.itemCount}</div>
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(4, Math.round((row.itemCount / maxThroughput) * 80))}px`,
                        background: 'var(--color-accent)',
                        borderRadius: '4px 4px 0 0',
                      }}
                    />
                    <div className={styles.issueMetaText}>{row.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PointingTab({
  boardType,
  config,
  issues,
}: {
  boardType: DashboardBoardType;
  config: DashboardConfig;
  issues: JiraIssue[];
}) {
  const allIssueTypes = useMemo(
    () => Array.from(new Set(issues.map((issue) => readIssueTypeName(issue)))).sort(),
    [issues],
  );
  const allStatuses = useMemo(
    () => Array.from(new Set(issues.map((issue) => readIssueStatusName(issue)))).sort(),
    [issues],
  );
  const defaultSelectedStatuses = useMemo(
    () => allStatuses.filter(
      (statusName) => !DEFAULT_POINTING_DONE_STATUSES.includes(
        statusName as (typeof DEFAULT_POINTING_DONE_STATUSES)[number],
      ),
    ),
    [allStatuses],
  );
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(defaultSelectedStatuses);
  const [sortBy, setSortBy] = useState<PointingSortId>('default');
  const [showPointed, setShowPointed] = useState(false);
  const [pipelineRoleFilter, setPipelineRoleFilter] = useState<PipelineRole | ''>('');
  const [pointingQueue, setPointingQueue] = useState<JiraIssue[]>(() =>
    buildPointingQueue(issues, {
      selectedTypes: [],
      selectedStatuses: defaultSelectedStatuses,
      sortBy: 'default',
      showPointed: false,
      pipelineRoleFilter: '',
      customStoryPointsFieldId: config.customStoryPointsFieldId,
    }),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCounts, setSessionCounts] = useState({ pointed: 0, skipped: 0 });
  const [detailByIssueKey, setDetailByIssueKey] = useState<Record<string, PointingIssueDetail>>({});
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const storyPointScale = parsePointingScale(config.storyPointScale);

  function rebuildPointingSession({
    nextPipelineRoleFilter = pipelineRoleFilter,
    nextSelectedStatuses = selectedStatuses,
    nextSelectedTypes = selectedTypes,
    nextShowPointed = showPointed,
    nextSortBy = sortBy,
  }: {
    nextPipelineRoleFilter?: PipelineRole | '';
    nextSelectedStatuses?: string[];
    nextSelectedTypes?: string[];
    nextShowPointed?: boolean;
    nextSortBy?: PointingSortId;
  } = {}) {
    setPointingQueue(
      buildPointingQueue(issues, {
        selectedTypes: nextSelectedTypes,
        selectedStatuses: nextSelectedStatuses,
        sortBy: nextSortBy,
        showPointed: nextShowPointed,
        pipelineRoleFilter: nextPipelineRoleFilter,
        customStoryPointsFieldId: config.customStoryPointsFieldId,
      }),
    );
    setCurrentIndex(0);
    setSessionCounts({ pointed: 0, skipped: 0 });
  }

  const currentIssue = currentIndex < pointingQueue.length ? pointingQueue[currentIndex] : null;

  useEffect(() => {
    if (!currentIssue || detailByIssueKey[currentIssue.key]) {
      return;
    }

    const issueKey = currentIssue.key;
    let isMounted = true;
    async function loadPointingDetail() {
      try {
        const response = await jiraGet<JiraIssue>(`/rest/api/2/issue/${issueKey}?fields=${POINTING_DETAIL_FIELDS}`);
        if (!isMounted) {
          return;
        }
        setDetailByIssueKey((previousDetails) => ({
          ...previousDetails,
          [issueKey]: {
            description: normalizeCommentBody(response.fields.description),
            acceptanceCriteria: normalizeCommentBody(response.fields.customfield_10200),
            comments: response.fields.comment?.comments ?? [],
            parentKey: response.fields.parent?.key ?? null,
            parentSummary: null,
          },
        }));
      } catch {
        if (!isMounted) {
          return;
        }
        setDetailByIssueKey((previousDetails) => ({
          ...previousDetails,
          [issueKey]: {
            description: '',
            acceptanceCriteria: '',
            comments: [],
            parentKey: null,
            parentSummary: null,
          },
        }));
      }
    }

    void loadPointingDetail();
    return () => {
      isMounted = false;
    };
  }, [currentIssue, detailByIssueKey]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { '': 0 };
    for (const role of PIPELINE_ROLES) {
      counts[role] = 0;
    }
    const unfilteredQueue = buildPointingQueue(issues, {
      selectedTypes,
      selectedStatuses,
      sortBy,
      showPointed,
      pipelineRoleFilter: '',
      customStoryPointsFieldId: config.customStoryPointsFieldId,
    });
    counts[''] = unfilteredQueue.length;
    for (const issue of unfilteredQueue) {
      const role = detectPipelineRole(issue.fields.summary);
      counts[role] += 1;
    }
    return counts;
  }, [config.customStoryPointsFieldId, issues, selectedStatuses, selectedTypes, showPointed, sortBy]);

  async function handleVote(pointValue: number) {
    if (!currentIssue) {
      return;
    }

    setIsSaving(true);
    setSaveStatusMessage('Saving…');

    try {
      const storyPointsFieldId = config.customStoryPointsFieldId || 'customfield_10016';
      await jiraPut(`/rest/api/2/issue/${currentIssue.key}`, {
        fields: { [storyPointsFieldId]: pointValue },
      });
      setPointingQueue((previousQueue) => {
        const nextQueue = previousQueue.map((queuedIssue) => (
          queuedIssue.key === currentIssue.key
            ? {
                ...queuedIssue,
                fields: {
                  ...queuedIssue.fields,
                  [storyPointsFieldId]: pointValue,
                },
              }
            : queuedIssue
        ));
        return showPointed
          ? nextQueue
          : nextQueue.filter((queuedIssue) => queuedIssue.key !== currentIssue.key);
      });
      setSessionCounts((previousCounts) => ({ ...previousCounts, pointed: previousCounts.pointed + 1 }));
      if (showPointed) {
        setCurrentIndex((previousIndex) => Math.min(previousIndex + 1, pointingQueue.length));
      }
      setSaveStatusMessage(`Saved ${currentIssue.key} at ${pointValue} points.`);
    } catch (caughtError) {
      setSaveStatusMessage(caughtError instanceof Error ? caughtError.message : `Failed to save ${currentIssue.key}.`);
    } finally {
      setIsSaving(false);
    }
  }

  function handleSkip() {
    if (!currentIssue) {
      return;
    }

    setPointingQueue((previousQueue) => {
      if (currentIndex >= previousQueue.length) {
        return previousQueue;
      }
      const nextQueue = [...previousQueue];
      const [skippedIssue] = nextQueue.splice(currentIndex, 1);
      nextQueue.push(skippedIssue);
      return nextQueue;
    });
    setSessionCounts((previousCounts) => ({ ...previousCounts, skipped: previousCounts.skipped + 1 }));
  }

  function toggleTypeFilter(issueTypeName: string) {
    setSelectedTypes((previousTypes) => {
      const nextSelectedTypes = previousTypes.includes(issueTypeName)
        ? previousTypes.filter((previousType) => previousType !== issueTypeName)
        : [...previousTypes, issueTypeName];
      rebuildPointingSession({ nextSelectedTypes });
      return nextSelectedTypes;
    });
  }

  function toggleStatusFilter(statusName: string) {
    setSelectedStatuses((previousStatuses) => {
      const nextSelectedStatuses = previousStatuses.includes(statusName)
        ? previousStatuses.filter((previousStatus) => previousStatus !== statusName)
        : [...previousStatuses, statusName];
      rebuildPointingSession({ nextSelectedStatuses });
      return nextSelectedStatuses;
    });
  }

  if (issues.length === 0) {
    return <DashboardEmptyState message="Load a board first from Settings to start pointing." />;
  }
  const currentDetail = currentIssue ? detailByIssueKey[currentIssue.key] : null;
  const suggestedPoints = currentIssue ? findPointingSuggestion(currentIssue, issues, config.customStoryPointsFieldId) : null;
  const latestComment = currentDetail && currentDetail.comments.length > 0
    ? currentDetail.comments[currentDetail.comments.length - 1]
    : null;
  const queueProgressLabel = pointingQueue.length === 0
    ? '0/0'
    : `${Math.min(currentIndex + 1, pointingQueue.length)}/${pointingQueue.length}`;

  return (
    <DashboardTabShell
      title="Story Pointing"
      description="Keep estimation moving: focus the queue, point the current issue, and only expand extra context when you need it."
      stats={(
        <div className={styles.flowStatsBar}>
          <StatChip label="Queue" value={queueProgressLabel} />
          <StatChip label="Pointed" value={sessionCounts.pointed} />
          <StatChip label="Skipped" value={sessionCounts.skipped} />
          <StatChip label="Filtered" value={pointingQueue.length} />
        </div>
      )}
      filters={(
        <>
          <span className={styles.issueMetaText}>Role</span>
          <button
            className={pipelineRoleFilter === '' ? styles.secondaryButton : styles.workflowStatusChip}
            onClick={() => {
              setPipelineRoleFilter('');
              rebuildPointingSession({ nextPipelineRoleFilter: '' });
            }}
            type="button"
          >
            All ({roleCounts[''] ?? 0})
          </button>
          {PIPELINE_ROLES.filter((role) => role !== 'TDR').map((role) => (
            (roleCounts[role] ?? 0) > 0 && (
              <button
                className={pipelineRoleFilter === role ? styles.secondaryButton : styles.workflowStatusChip}
                key={role}
                onClick={() => {
                  setPipelineRoleFilter(role);
                  rebuildPointingSession({ nextPipelineRoleFilter: role });
                }}
                type="button"
              >
                {role} ({roleCounts[role] ?? 0})
              </button>
            )
          ))}
          <details className={styles.dashboardFiltersDetail}>
            <summary className={styles.dashboardFiltersSummary}>Advanced queue filters</summary>
            <div className={styles.dashboardFiltersGrid}>
              <div>
                <div className={styles.issueMetaText}>Issue Types</div>
                <div className={styles.dashboardCheckboxGroup}>
                  {allIssueTypes.map((issueTypeName) => (
                    <label className={styles.dashboardCheckboxLabel} key={issueTypeName}>
                      <input
                        checked={selectedTypes.includes(issueTypeName)}
                        onChange={() => toggleTypeFilter(issueTypeName)}
                        type="checkbox"
                      />
                      {issueTypeName}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className={styles.issueMetaText}>Statuses</div>
                <div className={styles.dashboardCheckboxGroup}>
                  {allStatuses.map((statusName) => (
                    <label className={styles.dashboardCheckboxLabel} key={statusName}>
                      <input
                        checked={selectedStatuses.includes(statusName)}
                        onChange={() => toggleStatusFilter(statusName)}
                        type="checkbox"
                      />
                      {statusName}
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.dashboardFiltersInlineRow}>
                <label className={styles.dashboardInlineField}>
                  <span>Sort by</span>
                  <select
                    className={styles.settingsInput}
                    onChange={(changeEvent) => {
                      const nextSortBy = changeEvent.target.value as PointingSortId;
                      setSortBy(nextSortBy);
                      rebuildPointingSession({ nextSortBy });
                    }}
                    value={sortBy}
                  >
                    {POINTING_SORT_OPTIONS.map((sortOption) => (
                      <option key={sortOption.id} value={sortOption.id}>{sortOption.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.dashboardCheckboxLabel}>
                  <input
                    checked={showPointed}
                    onChange={() => {
                      const nextShowPointed = !showPointed;
                      setShowPointed(nextShowPointed);
                      rebuildPointingSession({ nextShowPointed });
                    }}
                    type="checkbox"
                  />
                  Show already pointed
                </label>
              </div>
            </div>
          </details>
        </>
      )}
    >
      {boardType === 'kanban' && (
        <div className={styles.dashboardStatusBanner}>
          <span className={styles.releaseSummaryWatch}>📋 Kanban board detected</span>
          <span className={styles.releaseSummaryMuted}>Use role and status filters to keep the queue lean.</span>
        </div>
      )}
      {saveStatusMessage && <p className={styles.issueMetaText}>{saveStatusMessage}</p>}
      {!currentIssue && <DashboardEmptyState message="No issues match the current pointing filters." />}
      {currentIssue && (
        <div className={styles.pointingShell}>
          <article className={styles.pointingFocusCard}>
            <div className={styles.pointingHeaderRow}>
              <div>
                <div className={styles.pointingMetaRow}>
                  <span className={styles.statusBadge}>{currentIssue.key}</span>
                  <span className={styles.statusBadge}>{readIssueStatusName(currentIssue)}</span>
                  <span className={styles.statusBadge}>{readIssuePriorityName(currentIssue)}</span>
                </div>
                <h3 className={styles.pointingIssueTitle}>{currentIssue.fields.summary}</h3>
                <div className={styles.issueMetaText}>👤 {readAssigneeName(currentIssue)}</div>
              </div>
              <label className={styles.pointingJumpField}>
                <span>Jump to issue</span>
                <select
                  className={`${styles.settingsInput} ${styles.pointingJumpSelect}`}
                  onChange={(changeEvent) => setCurrentIndex(Number(changeEvent.target.value))}
                  value={currentIndex}
                >
                  {pointingQueue.map((queueIssue, queueIndex) => (
                    <option key={queueIssue.key} value={queueIndex}>
                      {queueIndex + 1}. {queueIssue.key} — {queueIssue.fields.summary}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {suggestedPoints && (
              <div className={styles.pointingHintBanner}>
                💡 DEV story <strong>{suggestedPoints.key}</strong> is already pointed at <strong>{suggestedPoints.points}</strong>.
              </div>
            )}

            <div className={styles.pointingVoteGrid}>
              {storyPointScale.map((pointValue) => (
                <button
                  className={styles.loadButton}
                  disabled={isSaving}
                  key={pointValue}
                  onClick={() => void handleVote(pointValue)}
                  style={suggestedPoints?.points === pointValue ? { boxShadow: '0 0 0 2px var(--color-warning)' } : undefined}
                  type="button"
                >
                  {pointValue}
                </button>
              ))}
            </div>

            <div className={styles.pointingActionRow}>
              <button
                className={styles.secondaryButton}
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((previousIndex) => Math.max(0, previousIndex - 1))}
                type="button"
              >
                ← Back
              </button>
              <button className={styles.secondaryButton} onClick={handleSkip} type="button">
                ? Skip
              </button>
            </div>

            <details className={styles.pointingContextCard}>
              <summary className={styles.pointingContextSummary}>Issue context</summary>
              {currentDetail == null ? (
                <p className={styles.issueMetaText}>Loading details…</p>
              ) : (
                <div className={styles.pointingContextGrid}>
                  {currentDetail.parentKey && (
                    <div className={styles.pointingContextBlock}>
                      <strong>Parent</strong>
                      <div className={styles.pointingContextBody}>{currentDetail.parentKey}</div>
                    </div>
                  )}
                  <div className={styles.pointingContextBlock}>
                    <strong>Description</strong>
                    <div className={styles.pointingContextBody}>
                      {currentDetail.description || 'No Jira description was returned for this issue.'}
                    </div>
                  </div>
                  <div className={styles.pointingContextBlock}>
                    <strong>Acceptance Criteria</strong>
                    <div className={styles.pointingContextBody}>
                      {currentDetail.acceptanceCriteria || 'No acceptance criteria were returned for this issue.'}
                    </div>
                  </div>
                  <div className={styles.pointingContextBlock}>
                    <strong>Latest Comment</strong>
                    <div className={styles.pointingContextBody}>
                      {latestComment ? normalizeCommentBody(latestComment.body) : 'No Jira comments were returned for this issue.'}
                    </div>
                  </div>
                </div>
              )}
            </details>
          </article>
        </div>
      )}
    </DashboardTabShell>
  );
}

function PipelineTab({
  projectKey,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  projectKey: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [isLoadingPipeline, setIsLoadingPipeline] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<PipelineFilterMode>('all');
  const [expandedRelKey, setExpandedRelKey] = useState<string | null>(null);
  const [isSavingDecision, setIsSavingDecision] = useState<string | null>(null);

  useEffect(() => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      return;
    }

    let isMounted = true;
    async function loadPipeline() {
      setIsLoadingPipeline(true);
      setPipelineError(null);

      try {
        const scopeState = {
          scopeMode,
          selectedSprintId,
          selectedFixVersionName,
          selectedPiValue,
        };
        const [relResponse, companionResponse, devResponse] = await Promise.all([
          jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
            buildScopedProjectJql(
              normalizedProjectKey,
              scopeState,
              ['summary ~ "REL – "', 'statusCategory != Done'],
              'updated DESC',
            ),
            PIPELINE_REL_FIELDS,
            100,
          )),
          jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
            buildScopedProjectJql(
              normalizedProjectKey,
              scopeState,
              ['(summary ~ "SL – " OR summary ~ "QE – " OR summary ~ "BT – " OR summary ~ "BC – " OR summary ~ "TDR – ")'],
              'updated DESC',
            ),
            PIPELINE_COMPANION_FIELDS,
            200,
          )),
          jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
            buildScopedProjectJql(
              normalizedProjectKey,
              scopeState,
              [
                'statusCategory = Done',
                'summary !~ "REL – "',
                'summary !~ "SL – "',
                'summary !~ "QE – "',
                'summary !~ "BT – "',
                'summary !~ "BC – "',
                'summary !~ "TDR – "',
              ],
              'updated DESC',
            ),
            PIPELINE_DEV_FIELDS,
            200,
          )),
        ]);

        if (!isMounted) {
          return;
        }

        setPipelineRows(correlatePipelineRows(
          relResponse.issues ?? [],
          companionResponse.issues ?? [],
          devResponse.issues ?? [],
        ));
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        setPipelineRows([]);
        setPipelineError(caughtError instanceof Error ? caughtError.message : 'Failed to load pipeline.');
      } finally {
        if (isMounted) {
          setIsLoadingPipeline(false);
        }
      }
    }

    void loadPipeline();
    return () => {
      isMounted = false;
    };
  }, [projectKey, scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue]);

  async function loadChecklist(relKey: string) {
    async function fetchChecklistState(): Promise<PipelineChecklistResult> {
      try {
        const dcResponse = await jiraGet<PipelineChecklistContainerResponse[] | PipelineChecklistResponse>(
          `/rest/railsware/1.0/checklist/${relKey}`,
        );
        const checklistContainers = Array.isArray(dcResponse)
          ? dcResponse
          : Array.isArray(dcResponse?.checklists)
            ? dcResponse.checklists
            : [dcResponse];
        const allItems: PipelineChecklistItem[] = [];
        for (const checklistContainer of checklistContainers) {
          for (const checklistItem of checklistContainer?.items ?? checklistContainer?.checklistItems ?? []) {
            let checkedAt: Date | null = null;
            if (checklistItem?.status?.statusState === 'CHECKED') {
              for (const historyEntry of checklistItem.history ?? []) {
                if (historyEntry?.to?.statusState === 'CHECKED' && historyEntry.date) {
                  const candidateDate = new Date(historyEntry.date);
                  if (!checkedAt || candidateDate > checkedAt) {
                    checkedAt = candidateDate;
                  }
                }
              }
            }
            allItems.push({
              label: checklistItem.label ?? checklistItem.name ?? '',
              isChecked: checklistItem?.status?.statusState === 'CHECKED',
              checkedAt,
            });
          }
        }
        return normalizePipelineChecklistItems(allItems, 'dc');
      } catch (dcError) {
        const isNotFound = dcError instanceof Error && dcError.message.includes('404');
        if (!isNotFound) {
          return buildEmptyPipelineChecklist('error');
        }

        try {
          const cloudResponse = await jiraGet<{ value?: string }>(
            `/rest/api/2/issue/${relKey}/properties/com.railsware.SmartChecklist.checklist`,
          );
          const allItems = (cloudResponse.value ?? '')
            .split('\n')
            .map((checklistLine) => checklistLine.trim())
            .filter(Boolean)
            .map((checklistLine) => ({
              label: checklistLine.replace(/^[+\-x~]\s*/, ''),
              isChecked: checklistLine.startsWith('+'),
              checkedAt: null,
            }));
          return normalizePipelineChecklistItems(allItems, 'cloud-property');
        } catch {
          return buildEmptyPipelineChecklist('unavailable');
        }
      }
    }

    const checklistResult = await fetchChecklistState();
    setPipelineRows((previousRows) => previousRows.map((pipelineRow) => {
      if (pipelineRow.relKey !== relKey) {
        return pipelineRow;
      }
      const nextRow = {
        ...pipelineRow,
        checklist: checklistResult,
        intWindow: derivePipelineIntWindow(pipelineRow.relComments, checklistResult),
      };
      nextRow.alerts = derivePipelineAlerts(nextRow);
      return nextRow;
    }));
  }

  async function postIntDecision(relKey: string, decision: 'clean' | 'extended') {
    setIsSavingDecision(relKey);
    try {
      await jiraPost(`/rest/api/2/issue/${relKey}/comment`, {
        body: decision === 'clean'
          ? 'INT window Day 4 clean — deploy on Day 4/5.'
          : 'INT window Day 4 — Fixes in flight, extend to Day 7.',
      });
      setPipelineRows((previousRows) => previousRows.map((pipelineRow) => {
        if (pipelineRow.relKey !== relKey) {
          return pipelineRow;
        }
        const nextRow = {
          ...pipelineRow,
          intWindow: {
            ...pipelineRow.intWindow,
            decision,
          },
        };
        nextRow.alerts = derivePipelineAlerts(nextRow);
        return nextRow;
      }));
    } finally {
      setIsSavingDecision(null);
    }
  }

  function toggleExpandedRow(relKey: string) {
    const nextExpandedRelKey = expandedRelKey === relKey ? null : relKey;
    setExpandedRelKey(nextExpandedRelKey);
    const matchingRow = pipelineRows.find((pipelineRow) => pipelineRow.relKey === relKey);
    if (nextExpandedRelKey && matchingRow && matchingRow.checklist == null) {
      void loadChecklist(relKey);
    }
  }

  const filteredRows = pipelineRows.filter((pipelineRow) => {
    if (filterMode === 'inflight') {
      return pipelineRow.devStatus == null || !pipelineRow.devStatus.toLowerCase().includes('done');
    }
    if (filterMode === 'attention') {
      return pipelineRow.alerts.length > 0;
    }
    if (filterMode === 'blocked') {
      return pipelineRow.alerts.includes('BLOCKED');
    }
    return true;
  });

  if (!projectKey.trim()) {
    return <DashboardEmptyState message="Add a Project Key in Settings to load the pipeline view." />;
  }

  return (
    <DashboardTabShell
      title="Release Pipeline"
      description="REL stories anchor the pipeline. Companion stories fill SL, QE, BT, BC, INT Window, and TDR."
      stats={(
        <div className={styles.flowStatsBar}>
          <StatChip label="All" value={pipelineRows.length} />
          <StatChip label="In Flight" value={pipelineRows.filter((pipelineRow) => pipelineRow.devStatus == null || !pipelineRow.devStatus.toLowerCase().includes('done')).length} />
          <StatChip label="Attention" value={pipelineRows.filter((pipelineRow) => pipelineRow.alerts.length > 0).length} />
          <StatChip label="Blocked" value={pipelineRows.filter((pipelineRow) => pipelineRow.alerts.includes('BLOCKED')).length} />
        </div>
      )}
      filters={(
        <>
          <button className={filterMode === 'all' ? styles.secondaryButton : styles.workflowStatusChip} onClick={() => setFilterMode('all')} type="button">
            All ({pipelineRows.length})
          </button>
          <button className={filterMode === 'inflight' ? styles.secondaryButton : styles.workflowStatusChip} onClick={() => setFilterMode('inflight')} type="button">
            In Flight
          </button>
          <button className={filterMode === 'attention' ? styles.secondaryButton : styles.workflowStatusChip} onClick={() => setFilterMode('attention')} type="button">
            Needs Attention ({pipelineRows.filter((pipelineRow) => pipelineRow.alerts.length > 0).length})
          </button>
          <button className={filterMode === 'blocked' ? styles.secondaryButton : styles.workflowStatusChip} onClick={() => setFilterMode('blocked')} type="button">
            Blocked ({pipelineRows.filter((pipelineRow) => pipelineRow.alerts.includes('BLOCKED')).length})
          </button>
        </>
      )}
    >
      {isLoadingPipeline && <p className={styles.issueMetaText}>Loading pipeline…</p>}
      {pipelineError && <p className={styles.errorMessage}>{pipelineError}</p>}
      {!isLoadingPipeline && !pipelineError && filteredRows.length === 0 && (
        <DashboardEmptyState message="No active REL stories found in the open sprint." />
      )}
      {filteredRows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>REL Story</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Dev</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>SL</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>QE</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>BT</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>BC</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>INT Window</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>TDR</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.flatMap((pipelineRow) => {
                const isExpanded = expandedRelKey === pipelineRow.relKey;
                return [
                  (
                    <tr
                      key={pipelineRow.relKey}
                      onClick={() => toggleExpandedRow(pipelineRow.relKey)}
                      style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '8px 10px' }}>
                        {pipelineRow.alerts.length > 0 && (
                          <div className={styles.issueMetaText}>{pipelineRow.alerts.join(' · ')}</div>
                        )}
                        <a
                          className={styles.issueKeyLink}
                          href={`${JIRA_BROWSE_URL_PREFIX}${pipelineRow.relKey}`}
                          onClick={(clickEvent) => clickEvent.stopPropagation()}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {pipelineRow.relKey}
                        </a>{' '}
                        <span>{pipelineRow.relSummary.replace(/^REL\s*[–-]\s*[A-Z]+-\d+\s*[–-]\s*/, '')}</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.devStatus ?? '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.companions.sl?.status ?? '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.companions.qe?.status ?? '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.companions.bt?.status ?? '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.companions.bc?.status ?? '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        {pipelineRow.intWindow.daysSinceDeploy == null
                          ? '—'
                          : `Day ${pipelineRow.intWindow.daysSinceDeploy}`}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>{pipelineRow.companions.tdr ? '⚠' : '—'}</td>
                    </tr>
                  ),
                  isExpanded ? (
                      <tr key={`${pipelineRow.relKey}-details`}>
                        <td colSpan={8} style={{ padding: '12px 16px', background: 'var(--color-surface-1)' }}>
                          <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                            <div className={styles.issueMetaText}>
                              Dev: {pipelineRow.devKey ?? '—'} · REL Assignee: {pipelineRow.relAssignee ?? 'Unassigned'} · Story Points: {pipelineRow.storyPoints ?? '—'}
                            </div>
                            {pipelineRow.checklist == null ? (
                              <p className={styles.issueMetaText}>Loading checklist state…</p>
                            ) : (
                              <div className={styles.issueMetaText}>
                                Checklist source: {pipelineRow.checklist.source} · INT deployed: {pipelineRow.checklist.isIntDeployChecked ? 'Yes' : 'No'}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                              <button
                                className={styles.secondaryButton}
                                disabled={isSavingDecision === pipelineRow.relKey}
                                onClick={() => void postIntDecision(pipelineRow.relKey, 'clean')}
                                type="button"
                              >
                                Mark Day 4 Clean
                              </button>
                              <button
                                className={styles.secondaryButton}
                                disabled={isSavingDecision === pipelineRow.relKey}
                                onClick={() => void postIntDecision(pipelineRow.relKey, 'extended')}
                                type="button"
                              >
                                Extend to Day 7
                              </button>
                            </div>
                            {pipelineRow.checklist?.allItems.length ? (
                              <div style={{ display: 'grid', gap: 4 }}>
                                {pipelineRow.checklist.allItems.map((checklistItem) => (
                                  <div className={styles.issueMetaText} key={`${pipelineRow.relKey}-${checklistItem.label}`}>
                                    {checklistItem.isChecked ? '✓' : '○'} {checklistItem.label}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardTabShell>
  );
}

function readStoredFollowUpKeys(): string[] {
  try {
    const storedValue = window.localStorage.getItem(PLANNING_FOLLOW_UP_KEYS_STORAGE_KEY);
    if (!storedValue) return [];
    const parsed = JSON.parse(storedValue);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveFollowUpKeys(issueKeys: string[]): void {
  try {
    window.localStorage.setItem(PLANNING_FOLLOW_UP_KEYS_STORAGE_KEY, JSON.stringify(issueKeys));
  } catch {
    // localStorage may be unavailable in private browsing — proceed without persisting
  }
}

function PlanningTab({
  customStoryPointsFieldId,
  projectKey,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  customStoryPointsFieldId: string;
  projectKey: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const [planningIssues, setPlanningIssues] = useState<JiraIssue[]>([]);
  const [planningVersions, setPlanningVersions] = useState<JiraVersion[]>([]);
  const [epicSummaryByKey, setEpicSummaryByKey] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState<PlanningGroupBy>('release');
  const [selectedReleaseName, setSelectedReleaseName] = useState('');
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [planningDetailByIssueKey, setPlanningDetailByIssueKey] = useState<Record<string, PlanningIssueDetail>>({});
  const [transitionOptionsByIssueKey, setTransitionOptionsByIssueKey] = useState<Record<string, JiraTransition[]>>({});
  const [transitionSelectionByIssueKey, setTransitionSelectionByIssueKey] = useState<Record<string, string>>({});
  const [storyPointDraftByIssueKey, setStoryPointDraftByIssueKey] = useState<Record<string, string>>({});
  const [releaseDraftByIssueKey, setReleaseDraftByIssueKey] = useState<Record<string, string>>({});
  const [subStatusDraftByIssueKey, setSubStatusDraftByIssueKey] = useState<Record<string, string>>({});
  const [commentDraftByIssueKey, setCommentDraftByIssueKey] = useState<Record<string, string>>({});
  const [assigneeSearchByIssueKey, setAssigneeSearchByIssueKey] = useState<Record<string, string>>({});
  const [assigneeCandidatesByIssueKey, setAssigneeCandidatesByIssueKey] = useState<Record<string, Array<{ accountId: string; displayName: string }>>>({});
  const [followUpIssueKeys, setFollowUpIssueKeys] = useState<string[]>(readStoredFollowUpKeys);
  const [planningStatusMessage, setPlanningStatusMessage] = useState<string | null>(null);
  const [isLoadingPlanning, setIsLoadingPlanning] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);

  const reloadPlanningData = useCallback(async () => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      return;
    }

    setIsLoadingPlanning(true);
    setPlanningError(null);

    try {
      const backlogJql = buildScopedProjectJql(
        normalizedProjectKey,
        { scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue },
        [],
        'priority ASC, created DESC',
      );
      const [backlogResponse, versionResponse] = await Promise.all([
        jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
          backlogJql,
          'summary,status,priority,issuetype,assignee,created,updated,customfield_10016,customfield_10028,customfield_10014,customfield_10008,fixVersions,parent,labels,comment,customfield_10201',
          PLANNING_MAX_RESULTS,
        )),
        jiraGet<JiraVersion[]>(`/rest/api/2/project/${encodeURIComponent(normalizedProjectKey)}/versions`),
      ]);

      const backlogIssues = backlogResponse.issues ?? [];
      const referencedHierarchyKeys = Array.from(
        new Set(
          backlogIssues
            .map((planningIssue) => readPlanningEpicKey(planningIssue))
            .filter((planningEpicKey): planningEpicKey is string => Boolean(planningEpicKey)),
        ),
      );
      const epicSummaryResponse = referencedHierarchyKeys.length > 0
        ? await jiraGet<{ issues?: JiraIssue[] }>(buildSearchPath(
            `issuekey in (${referencedHierarchyKeys.join(', ')})`,
            'summary',
            Math.min(PLANNING_MAX_RESULTS, referencedHierarchyKeys.length),
          ))
        : { issues: [] };

      setPlanningIssues(backlogIssues);
      setPlanningVersions(versionResponse.filter((planningVersion) => !planningVersion.released && !planningVersion.archived));
      setEpicSummaryByKey(
        Object.fromEntries((epicSummaryResponse.issues ?? []).map((epicIssue) => [epicIssue.key, epicIssue.fields.summary])),
      );
    } catch (caughtError) {
      setPlanningIssues([]);
      setPlanningVersions([]);
      setPlanningError(caughtError instanceof Error ? caughtError.message : 'Failed to load planning backlog.');
    } finally {
      setIsLoadingPlanning(false);
    }
  }, [projectKey, scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue]);

  useEffect(() => {
    const reloadTimerId = window.setTimeout(() => {
      void reloadPlanningData();
    }, 0);
    return () => {
      window.clearTimeout(reloadTimerId);
    };
  }, [reloadPlanningData]);

  useEffect(() => {
    saveFollowUpKeys(followUpIssueKeys);
  }, [followUpIssueKeys]);

  async function loadPlanningDetail(issue: JiraIssue) {
    if (planningDetailByIssueKey[issue.key]) {
      return;
    }

    const [detailResponse, transitionsResponse, editMetaResponse] = await Promise.all([
      jiraGet<JiraIssue>(`/rest/api/2/issue/${issue.key}?fields=${PLANNING_DETAIL_FIELDS},customfield_10200`),
      jiraGet<{ transitions: JiraTransition[] }>(`/rest/api/2/issue/${issue.key}/transitions`),
      jiraGet<{ fields?: Record<string, { allowedValues?: Array<{ value?: string; name?: string }> }> }>(`/rest/api/2/issue/${issue.key}/editmeta`),
    ]);
    setTransitionOptionsByIssueKey((previousTransitions) => ({
      ...previousTransitions,
      [issue.key]: transitionsResponse.transitions ?? [],
    }));
    setStoryPointDraftByIssueKey((previousDrafts) => ({
      ...previousDrafts,
      [issue.key]: String(readStoryPointsValue(issue, customStoryPointsFieldId) ?? ''),
    }));
    setReleaseDraftByIssueKey((previousDrafts) => ({
      ...previousDrafts,
      [issue.key]: issue.fields.fixVersions?.[0]?.name ?? '',
    }));
    setSubStatusDraftByIssueKey((previousDrafts) => ({
      ...previousDrafts,
      [issue.key]: detailResponse.fields.customfield_10201?.value ?? detailResponse.fields.customfield_10201?.name ?? '',
    }));
    setTransitionSelectionByIssueKey((previousSelections) => ({
      ...previousSelections,
      [issue.key]: '',
    }));
    setPlanningDetailByIssueKey((previousDetails) => ({
      ...previousDetails,
      [issue.key]: {
        description: normalizeCommentBody(detailResponse.fields.description),
        acceptanceCriteria: normalizeCommentBody(detailResponse.fields.customfield_10200),
        comments: detailResponse.fields.comment?.comments ?? [],
        parentKey: detailResponse.fields.parent?.key ?? null,
        parentSummary: null,
        subStatusValue: detailResponse.fields.customfield_10201?.value ?? detailResponse.fields.customfield_10201?.name ?? null,
        subStatusOptions: editMetaResponse.fields?.customfield_10201?.allowedValues?.map((allowedValue) => allowedValue.value ?? allowedValue.name ?? '').filter(Boolean) ?? [],
      },
    }));
  }

  const filteredPlanningIssues = selectedReleaseName
    ? planningIssues.filter((planningIssue) => planningIssue.fields.fixVersions?.some((fixVersion) => fixVersion.name === selectedReleaseName))
    : planningIssues;

  const planningGroups = useMemo(() => {
    const groupedIssues = new Map<string, JiraIssue[]>();
    for (const planningIssue of filteredPlanningIssues) {
      let groupLabel = 'Unscheduled';
      if (groupBy === 'release') {
        groupLabel = planningIssue.fields.fixVersions?.[0]?.name ?? 'Unscheduled';
      }
      if (groupBy === 'assignee') {
        groupLabel = readAssigneeName(planningIssue);
      }
      if (groupBy === 'epic') {
        const epicKey = readPlanningEpicKey(planningIssue);
        groupLabel = epicKey ? `${epicKey} — ${epicSummaryByKey[epicKey] ?? 'Epic'}` : 'No Epic';
      }
      groupedIssues.set(groupLabel, [...(groupedIssues.get(groupLabel) ?? []), planningIssue]);
    }
    return Array.from(groupedIssues.entries()).sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel));
  }, [epicSummaryByKey, filteredPlanningIssues, groupBy]);

  async function handlePlanningAction(action: () => Promise<void>, successMessage: string) {
    try {
      await action();
      setPlanningStatusMessage(successMessage);
      await reloadPlanningData();
    } catch (caughtError) {
      setPlanningStatusMessage(caughtError instanceof Error ? caughtError.message : 'Planning update failed.');
    }
  }

  async function handleSearchAssignees(issueKey: string) {
    const assigneeQuery = assigneeSearchByIssueKey[issueKey]?.trim();
    if (!assigneeQuery) {
      return;
    }
    const searchResults = await jiraGet<Array<{ accountId: string; displayName: string }>>(
      `/rest/api/2/user/search?query=${encodeURIComponent(assigneeQuery)}&maxResults=8`,
    );
    setAssigneeCandidatesByIssueKey((previousCandidates) => ({
      ...previousCandidates,
      [issueKey]: searchResults,
    }));
  }

  async function copyFollowUpReport() {
    const followUpIssues = planningIssues.filter((planningIssue) => followUpIssueKeys.includes(planningIssue.key));
    const reportText = followUpIssues.length === 0
      ? 'No planning follow-ups flagged.'
      : followUpIssues.map((planningIssue) => `- ${planningIssue.key}: ${planningIssue.fields.summary}`).join('\n');
    await navigator.clipboard.writeText(reportText);
    setPlanningStatusMessage('Follow-up report copied to clipboard.');
  }

  if (!projectKey.trim()) {
    return <DashboardEmptyState message="Add a Project Key in Settings to load planning data." />;
  }

  return (
    <DashboardTabShell
      title="Backlog Planning"
      description="Shape the backlog around release, hierarchy, and ownership without leaving the dashboard."
      actions={(
        <>
          {followUpIssueKeys.length > 0 && (
            <button
              className={styles.secondaryButton}
              onClick={() => setFollowUpIssueKeys([])}
              type="button"
            >
              Clear All Follow-ups
            </button>
          )}
          <button className={styles.secondaryButton} onClick={() => void copyFollowUpReport()} type="button">
            Copy Follow-up Report
          </button>
        </>
      )}
      stats={(
        <div className={styles.flowStatsBar}>
          <StatChip label="Issues" value={planningIssues.length} />
          <StatChip label="Unestimated" value={planningIssues.filter((planningIssue) => readStoryPointsValue(planningIssue, customStoryPointsFieldId) == null).length} />
          <StatChip label="Unassigned" value={planningIssues.filter((planningIssue) => !planningIssue.fields.assignee).length} />
          <StatChip label="No Epic" value={planningIssues.filter((planningIssue) => readPlanningEpicKey(planningIssue) == null).length} />
          <StatChip label="No Release" value={planningIssues.filter((planningIssue) => (planningIssue.fields.fixVersions?.length ?? 0) === 0).length} />
        </div>
      )}
      filters={(
        <>
          {PLANNING_GROUP_OPTIONS.map((groupOption) => (
            <button
              className={groupBy === groupOption ? styles.secondaryButton : styles.workflowStatusChip}
              key={groupOption}
              onClick={() => setGroupBy(groupOption)}
              type="button"
            >
              Group by {groupOption}
            </button>
          ))}
          <label className={styles.dashboardInlineField}>
            <span>Release</span>
            <select
              className={styles.settingsInput}
              onChange={(changeEvent) => setSelectedReleaseName(changeEvent.target.value)}
              value={selectedReleaseName}
            >
              <option value="">All Releases</option>
              {planningVersions.map((planningVersion) => (
                <option key={planningVersion.id} value={planningVersion.name}>{planningVersion.name}</option>
              ))}
            </select>
          </label>
        </>
      )}
    >
      {planningStatusMessage && <p className={styles.issueMetaText}>{planningStatusMessage}</p>}
      {isLoadingPlanning && <p className={styles.issueMetaText}>Loading planning backlog…</p>}
      {planningError && <p className={styles.errorMessage}>{planningError}</p>}

      {!isLoadingPlanning && !planningError && planningGroups.length === 0 && (
        <DashboardEmptyState message="No backlog issues matched the current release selection." />
      )}

      {planningGroups.map(([groupLabel, groupedIssues]) => (
        <section className={styles.blockersSection} key={groupLabel}>
          <div className={styles.blockersSectionHeader}>
            <h3 className={styles.blockersSectionTitle}>{groupLabel}</h3>
            <span className={styles.countBadge}>{groupedIssues.length}</span>
          </div>
          {groupedIssues.map((planningIssue) => {
            const isExpanded = expandedIssueKey === planningIssue.key;
            const planningDetail = planningDetailByIssueKey[planningIssue.key];
            return (
              <div className={styles.issueCardWrapper} key={planningIssue.key}>
                <div className={styles.blockerCard}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <div>
                      <a
                        className={styles.issueKeyLink}
                        href={`${JIRA_BROWSE_URL_PREFIX}${planningIssue.key}`}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {planningIssue.key}
                      </a>{' '}
                      <span className={styles.issueSummaryText}>{planningIssue.fields.summary}</span>
                    </div>
                    <div className={styles.issueMetaText}>
                      {readIssueStatusName(planningIssue)} · {readAssigneeName(planningIssue)} · {planningIssue.fields.fixVersions?.[0]?.name ?? 'No release'} · {readStoryPointsValue(planningIssue, customStoryPointsFieldId) ?? '—'} pts
                    </div>
                  </div>
                  <button
                    className={followUpIssueKeys.includes(planningIssue.key) ? styles.followUpButtonActive : styles.followUpButtonInactive}
                    onClick={() => setFollowUpIssueKeys((previousKeys) => previousKeys.includes(planningIssue.key)
                      ? previousKeys.filter((previousKey) => previousKey !== planningIssue.key)
                      : [...previousKeys, planningIssue.key])}
                    title={followUpIssueKeys.includes(planningIssue.key) ? 'Click to remove follow-up flag' : 'Click to flag for follow-up'}
                    type="button"
                  >
                    Follow-up
                  </button>
                  <button
                    aria-expanded={isExpanded}
                    className={styles.expandToggleButton}
                    onClick={() => {
                      const nextExpanded = isExpanded ? null : planningIssue.key;
                      setExpandedIssueKey(nextExpanded);
                      if (nextExpanded) {
                        void loadPlanningDetail(planningIssue);
                      }
                    }}
                    type="button"
                  >
                    {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
                  </button>
                </div>
                {isExpanded && (
                  <div className={styles.sprintInfoCard}>
                    <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                      {planningDetail?.parentKey && (
                        <div className={styles.issueMetaText}>Parent: {planningDetail.parentKey}</div>
                      )}
                      {planningDetail?.description && (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{planningDetail.description}</div>
                      )}
                      {planningDetail?.acceptanceCriteria && (
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          <strong>Acceptance Criteria</strong>
                          <div>{planningDetail.acceptanceCriteria}</div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gap: 'var(--spacing-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <label>
                          Story Points
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className={styles.settingsInput}
                              onChange={(changeEvent) => setStoryPointDraftByIssueKey((previousDrafts) => ({
                                ...previousDrafts,
                                [planningIssue.key]: changeEvent.target.value,
                              }))}
                              value={storyPointDraftByIssueKey[planningIssue.key] ?? ''}
                            />
                            <button
                              className={styles.secondaryButton}
                              onClick={() => void handlePlanningAction(
                                async () => jiraPut(`/rest/api/2/issue/${planningIssue.key}`, {
                                  fields: {
                                    [customStoryPointsFieldId || 'customfield_10016']: Number(storyPointDraftByIssueKey[planningIssue.key] || 0),
                                  },
                                }),
                                `Saved points for ${planningIssue.key}.`,
                              )}
                              type="button"
                            >
                              Save
                            </button>
                          </div>
                        </label>
                        <label>
                          Transition
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              className={styles.settingsInput}
                              onChange={(changeEvent) => setTransitionSelectionByIssueKey((previousSelections) => ({
                                ...previousSelections,
                                [planningIssue.key]: changeEvent.target.value,
                              }))}
                              value={transitionSelectionByIssueKey[planningIssue.key] ?? ''}
                            >
                              <option value="">Transition to…</option>
                              {(transitionOptionsByIssueKey[planningIssue.key] ?? []).map((transitionOption) => (
                                <option key={transitionOption.id} value={transitionOption.id}>{transitionOption.name}</option>
                              ))}
                            </select>
                            <button
                              className={styles.secondaryButton}
                              onClick={() => void handlePlanningAction(
                                async () => jiraPost(`/rest/api/2/issue/${planningIssue.key}/transitions`, {
                                  transition: { id: transitionSelectionByIssueKey[planningIssue.key] },
                                }),
                                `Transitioned ${planningIssue.key}.`,
                              )}
                              type="button"
                            >
                              Apply
                            </button>
                          </div>
                        </label>
                        <label>
                          Release
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              className={styles.settingsInput}
                              onChange={(changeEvent) => setReleaseDraftByIssueKey((previousDrafts) => ({
                                ...previousDrafts,
                                [planningIssue.key]: changeEvent.target.value,
                              }))}
                              value={releaseDraftByIssueKey[planningIssue.key] ?? ''}
                            >
                              <option value="">No Release</option>
                              {planningVersions.map((planningVersion) => (
                                <option key={planningVersion.id} value={planningVersion.name}>{planningVersion.name}</option>
                              ))}
                            </select>
                            <button
                              className={styles.secondaryButton}
                              onClick={() => void handlePlanningAction(
                                async () => jiraPut(`/rest/api/2/issue/${planningIssue.key}`, {
                                  update: {
                                    fixVersions: [
                                      {
                                        set: releaseDraftByIssueKey[planningIssue.key]
                                          ? [{ name: releaseDraftByIssueKey[planningIssue.key] }]
                                          : [],
                                      },
                                    ],
                                  },
                                }),
                                `Updated release for ${planningIssue.key}.`,
                              )}
                              type="button"
                            >
                              Save
                            </button>
                          </div>
                        </label>
                        <label>
                          Sub-status
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              className={styles.settingsInput}
                              onChange={(changeEvent) => setSubStatusDraftByIssueKey((previousDrafts) => ({
                                ...previousDrafts,
                                [planningIssue.key]: changeEvent.target.value,
                              }))}
                              value={subStatusDraftByIssueKey[planningIssue.key] ?? ''}
                            >
                              <option value="">None</option>
                              {(planningDetail?.subStatusOptions ?? []).map((subStatusOption) => (
                                <option key={subStatusOption} value={subStatusOption}>{subStatusOption}</option>
                              ))}
                            </select>
                            <button
                              className={styles.secondaryButton}
                              onClick={() => void handlePlanningAction(
                                async () => jiraPut(`/rest/api/2/issue/${planningIssue.key}`, {
                                  fields: {
                                    customfield_10201: subStatusDraftByIssueKey[planningIssue.key]
                                      ? { value: subStatusDraftByIssueKey[planningIssue.key] }
                                      : null,
                                  },
                                }),
                                `Updated sub-status for ${planningIssue.key}.`,
                              )}
                              type="button"
                            >
                              Save
                            </button>
                          </div>
                        </label>
                      </div>

                      <div style={{ display: 'grid', gap: 'var(--spacing-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <label>
                          Assignee search
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              className={styles.settingsInput}
                              onChange={(changeEvent) => setAssigneeSearchByIssueKey((previousSearches) => ({
                                ...previousSearches,
                                [planningIssue.key]: changeEvent.target.value,
                              }))}
                              value={assigneeSearchByIssueKey[planningIssue.key] ?? ''}
                            />
                            <button className={styles.secondaryButton} onClick={() => void handleSearchAssignees(planningIssue.key)} type="button">
                              Search
                            </button>
                          </div>
                        </label>
                        {assigneeCandidatesByIssueKey[planningIssue.key]?.length ? (
                          <label>
                            Assign to
                            <div style={{ display: 'flex', gap: 8 }}>
                              <select
                                className={styles.settingsInput}
                                onChange={(changeEvent) => setAssigneeSearchByIssueKey((previousSearches) => ({
                                  ...previousSearches,
                                  [planningIssue.key]: changeEvent.target.value,
                                }))}
                                value={assigneeSearchByIssueKey[planningIssue.key] ?? ''}
                              >
                                {assigneeCandidatesByIssueKey[planningIssue.key].map((candidateAssignee) => (
                                  <option key={candidateAssignee.accountId} value={candidateAssignee.accountId}>{candidateAssignee.displayName}</option>
                                ))}
                              </select>
                              <button
                                className={styles.secondaryButton}
                                onClick={() => void handlePlanningAction(
                                  async () => jiraPut(`/rest/api/2/issue/${planningIssue.key}`, {
                                    fields: {
                                      assignee: { accountId: assigneeSearchByIssueKey[planningIssue.key] },
                                    },
                                  }),
                                  `Assigned ${planningIssue.key}.`,
                                )}
                                type="button"
                              >
                                Assign
                              </button>
                            </div>
                          </label>
                        ) : null}
                      </div>

                      <label>
                        Comment
                        <div style={{ display: 'grid', gap: 8 }}>
                          <textarea
                            className={styles.settingsInput}
                            onChange={(changeEvent) => setCommentDraftByIssueKey((previousDrafts) => ({
                              ...previousDrafts,
                              [planningIssue.key]: changeEvent.target.value,
                            }))}
                            rows={3}
                            value={commentDraftByIssueKey[planningIssue.key] ?? ''}
                          />
                          <button
                            className={styles.secondaryButton}
                            onClick={() => void handlePlanningAction(
                              async () => jiraPost(`/rest/api/2/issue/${planningIssue.key}/comment`, {
                                body: commentDraftByIssueKey[planningIssue.key],
                              }),
                              `Posted comment to ${planningIssue.key}.`,
                            )}
                            type="button"
                          >
                            Post Comment
                          </button>
                        </div>
                      </label>

                      {planningDetail?.comments.length ? (
                        <details>
                          <summary style={{ cursor: 'pointer' }}>Comments ({planningDetail.comments.length})</summary>
                          <div style={{ display: 'grid', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-sm)' }}>
                            {planningDetail.comments.slice(-3).reverse().map((issueComment) => (
                              <div key={issueComment.id} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-sm)' }}>
                                <div className={styles.issueMetaText}>{issueComment.author?.displayName ?? 'Unknown'}</div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{normalizeCommentBody(issueComment.body)}</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </DashboardTabShell>
  );
}

/**
 * Renders the live legacy-style Release Radar driven by project versions, release countdowns,
 * and per-release issue classification.
 */
function ReleasesTab({
  projectKey,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  projectKey: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  const { verifyPassphrase } = useRovoAssist();
  const [releaseEntries, setReleaseEntries] = useState<ReleaseRadarEntry[]>([]);
  const [isLoadingReleaseRadar, setIsLoadingReleaseRadar] = useState(false);
  const [releaseRadarError, setReleaseRadarError] = useState<string | null>(null);
  const [expandedReleaseIds, setExpandedReleaseIds] = useState<Record<string, boolean>>({});
  const [isReleaseRovoUnlocked, setIsReleaseRovoUnlocked] = useState<boolean>(() => readStoredReleaseRovoUnlockState());
  const [releaseNotesByVersionId, setReleaseNotesByVersionId] = useState<Record<string, ReleaseRovoTableDocument>>(
    () => readStoredReleaseNotes(projectKey),
  );
  const [isPassphraseModalVisible, setIsPassphraseModalVisible] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [releasePromptModalState, setReleasePromptModalState] = useState<ReleasePromptModalState | null>(null);
  const [releaseImportModalState, setReleaseImportModalState] = useState<ReleaseImportModalState | null>(null);
  const [releaseExportErrorByVersionId, setReleaseExportErrorByVersionId] = useState<Record<string, string>>({});
  const passphraseInputRef = useRef<HTMLInputElement | null>(null);
  const releaseNotesSectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setReleaseNotesByVersionId(readStoredReleaseNotes(projectKey));
    setReleaseExportErrorByVersionId({});
    setReleasePromptModalState(null);
    setReleaseImportModalState(null);
  }, [projectKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(
      RELEASE_ROVO_UNLOCK_STORAGE_KEY,
      isReleaseRovoUnlocked ? 'true' : 'false',
    );
  }, [isReleaseRovoUnlocked]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(
      buildReleaseNotesStorageKey(projectKey),
      JSON.stringify(releaseNotesByVersionId),
    );
  }, [projectKey, releaseNotesByVersionId]);

  useEffect(() => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    if (!normalizedProjectKey) {
      return;
    }

    let isMounted = true;

    async function loadReleaseRadar() {
      setIsLoadingReleaseRadar(true);
      setReleaseRadarError(null);

      try {
        const versions = await jiraGet<JiraVersion[]>(
          `/rest/api/2/project/${encodeURIComponent(normalizedProjectKey)}/versions`,
        );
        const unreleasedVersions = versions
          .filter((version) => !version.released && !version.archived)
          .sort((leftVersion, rightVersion) => {
            if (!leftVersion.releaseDate && !rightVersion.releaseDate) {
              return 0;
            }
            if (!leftVersion.releaseDate) {
              return 1;
            }
            if (!rightVersion.releaseDate) {
              return -1;
            }
            return new Date(leftVersion.releaseDate).getTime()
              - new Date(rightVersion.releaseDate).getTime();
          });
        const versionsToInspect =
          scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION && selectedFixVersionName
            ? unreleasedVersions.filter((version) => version.name === selectedFixVersionName)
            : unreleasedVersions;

        const nextEntries = await Promise.all(
          versionsToInspect.map(async (version) => {
            const releaseJql = buildScopedProjectJql(
              normalizedProjectKey,
              { scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue },
              [`fixVersion = "${escapeJqlValue(version.name)}"`],
              'updated DESC',
            );

            try {
              const searchResponse = await jiraGet<{ issues?: JiraIssue[] }>(
                `/rest/api/2/search?jql=${encodeURIComponent(releaseJql)}&maxResults=${RELEASE_MAX_RESULTS}&fields=${RELEASE_FIELDS}`,
              );
              const versionIssues = searchResponse.issues ?? [];

              let doneCount = 0;
              let progressCount = 0;
              let todoCount = 0;
              for (const issue of versionIssues) {
                const issueStatus = classifyReleaseIssueStatus(issue);
                if (issueStatus === 'done') {
                  doneCount++;
                } else if (issueStatus === 'progress') {
                  progressCount++;
                } else {
                  todoCount++;
                }
              }

              const totalCount = versionIssues.length;
              const completionPercentage = totalCount === 0
                ? 0
                : Math.round((doneCount / totalCount) * 100);
              const releaseDate = version.releaseDate ?? null;
              const daysLeft = releaseDate
                ? Math.ceil((new Date(`${releaseDate}T12:00:00`).getTime() - Date.now()) / MS_PER_DAY)
                : null;

              return {
                version,
                issues: versionIssues,
                doneCount,
                progressCount,
                todoCount,
                totalCount,
                completionPercentage,
                releaseDate,
                daysLeft,
                bucket: classifyReleaseRiskBucket(daysLeft),
              } satisfies ReleaseRadarEntry;
            } catch {
              return {
                version,
                issues: [],
                doneCount: 0,
                progressCount: 0,
                todoCount: 0,
                totalCount: 0,
                completionPercentage: 0,
                releaseDate: version.releaseDate ?? null,
                daysLeft: version.releaseDate
                  ? Math.ceil((new Date(`${version.releaseDate}T12:00:00`).getTime() - Date.now()) / MS_PER_DAY)
                  : null,
                bucket: classifyReleaseRiskBucket(
                  version.releaseDate
                    ? Math.ceil((new Date(`${version.releaseDate}T12:00:00`).getTime() - Date.now()) / MS_PER_DAY)
                    : null,
                ),
              } satisfies ReleaseRadarEntry;
            }
          }),
        );

        if (!isMounted) {
          return;
        }

        setReleaseEntries(nextEntries);
        setExpandedReleaseIds((previousExpandedReleaseIds) => {
          const nextExpandedReleaseIds: Record<string, boolean> = {};
          for (const entry of nextEntries) {
            nextExpandedReleaseIds[entry.version.id] = previousExpandedReleaseIds[entry.version.id] ?? false;
          }
          return nextExpandedReleaseIds;
        });
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        setReleaseEntries([]);
        setReleaseRadarError(caughtError instanceof Error ? caughtError.message : 'Failed to load release radar.');
      } finally {
        if (isMounted) {
          setIsLoadingReleaseRadar(false);
        }
      }
    }

    void loadReleaseRadar();

    return () => {
      isMounted = false;
    };
  }, [projectKey, scopeMode, selectedSprintId, selectedFixVersionName, selectedPiValue]);

  useEffect(() => {
    function handleGlobalKeyDown(keyboardEvent: globalThis.KeyboardEvent): void {
      const isHiddenShortcutPressed = keyboardEvent.ctrlKey
        && keyboardEvent.altKey
        && (
          keyboardEvent.key.toLowerCase() === HIDDEN_ROVO_SHORTCUT_KEY
          || keyboardEvent.code === 'KeyZ'
        );

      if (!isHiddenShortcutPressed || isReleaseRovoUnlocked) {
        return;
      }

      keyboardEvent.preventDefault();
      openReleaseUnlockModal();
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isReleaseRovoUnlocked]);

  useEffect(() => {
    if (isPassphraseModalVisible) {
      passphraseInputRef.current?.focus();
    }
  }, [isPassphraseModalVisible]);

  const atRiskCount = releaseEntries.filter(
    (entry) => entry.bucket === 'overdue' || entry.bucket === 'critical',
  ).length;
  const watchCount = releaseEntries.filter((entry) => entry.bucket === 'watch').length;
  const onTrackCount = releaseEntries.filter((entry) => entry.bucket === 'ontrack').length;
  const unscheduledCount = releaseEntries.filter((entry) => entry.bucket === 'nodate').length;

  function openReleaseUnlockModal(): void {
    setIsPassphraseModalVisible(true);
    setPassphraseInput('');
    setPassphraseError(null);
  }

  const handlePassphraseSubmit = useCallback(async () => {
    const isPassphraseAccepted = await verifyPassphrase(passphraseInput);

    if (isPassphraseAccepted) {
      setIsReleaseRovoUnlocked(true);
      setIsPassphraseModalVisible(false);
      setPassphraseInput('');
      setPassphraseError(null);
      return;
    }

    setPassphraseError('Incorrect passphrase');
  }, [passphraseInput, verifyPassphrase]);

  const handlePassphraseKeyDown = useCallback((keyboardEvent: ReactKeyboardEvent<HTMLInputElement>) => {
    if (keyboardEvent.key === 'Enter') {
      void handlePassphraseSubmit();
      return;
    }

    if (keyboardEvent.key === 'Escape') {
      setIsPassphraseModalVisible(false);
    }
  }, [handlePassphraseSubmit]);

  const handleBuildReleasePrompt = useCallback((releaseEntry: ReleaseRadarEntry) => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const promptInput = buildReleasePromptInput(normalizedProjectKey, releaseEntry);
    const promptText = buildReleaseRovoPrompt(promptInput);

    setReleasePromptModalState({
      versionId: releaseEntry.version.id,
      versionName: releaseEntry.version.name,
      promptText,
    });
  }, [projectKey]);

  const handleOpenReleaseImportModal = useCallback((releaseEntry: ReleaseRadarEntry) => {
    setReleaseImportModalState({
      versionId: releaseEntry.version.id,
      versionName: releaseEntry.version.name,
      responseText: '',
      errorMessage: null,
    });
  }, []);

  const handleReleaseImportTextChange = useCallback((responseText: string) => {
    setReleaseImportModalState((previousModalState) => {
      if (!previousModalState) {
        return previousModalState;
      }

      return {
        ...previousModalState,
        responseText,
        errorMessage: null,
      };
    });
  }, []);

  const handleImportReleaseResponse = useCallback(() => {
    if (!releaseImportModalState) {
      return;
    }

    try {
      const parsedReleaseNotes = parseReleaseRovoResponse(releaseImportModalState.responseText);
      setReleaseNotesByVersionId((previousReleaseNotesByVersionId) => ({
        ...previousReleaseNotesByVersionId,
        [releaseImportModalState.versionId]: parsedReleaseNotes,
      }));
      setReleaseImportModalState(null);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Unable to parse the Rovo response.';
      setReleaseImportModalState((previousModalState) => {
        if (!previousModalState) {
          return previousModalState;
        }

        return {
          ...previousModalState,
          errorMessage,
        };
      });
    }
  }, [releaseImportModalState]);

  const handleReleaseNotesSectionRef = useCallback((versionId: string, releaseNotesSectionElement: HTMLElement | null) => {
    if (releaseNotesSectionElement) {
      releaseNotesSectionRefs.current[versionId] = releaseNotesSectionElement;
      return;
    }

    delete releaseNotesSectionRefs.current[versionId];
  }, []);

  const handleExportReleaseNotes = useCallback(async (versionId: string, releaseName: string) => {
    const releaseNotesSectionElement = releaseNotesSectionRefs.current[versionId];
    if (!releaseNotesSectionElement) {
      setReleaseExportErrorByVersionId((previousExportErrors) => ({
        ...previousExportErrors,
        [versionId]: 'Render the release notes before exporting the PNG.',
      }));
      return;
    }

    try {
      setReleaseExportErrorByVersionId((previousExportErrors) => ({
        ...previousExportErrors,
        [versionId]: '',
      }));
      await downloadElementImage(
        releaseNotesSectionElement,
        createReleaseNotesExportFileName(releaseName),
        'The release notes section is no longer available to export.',
      );
    } catch (caughtError) {
      setReleaseExportErrorByVersionId((previousExportErrors) => ({
        ...previousExportErrors,
        [versionId]: caughtError instanceof Error ? caughtError.message : 'Unable to export the release notes PNG.',
      }));
    }
  }, []);

  if (!projectKey.trim()) {
    return (
      <p style={{ color: 'var(--color-text-secondary)' }}>
        Add a Project Key in Settings to see the Release Radar.
      </p>
    );
  }

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Release Radar</h2>
      {isLoadingReleaseRadar && (
        <p style={{ color: 'var(--color-text-secondary)' }}>Building Release Radar…</p>
      )}
      {releaseRadarError && (
        <p className={styles.errorMessage}>{releaseRadarError}</p>
      )}
      {!isLoadingReleaseRadar && !releaseRadarError && releaseEntries.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          No unreleased fix versions found for {projectKey.trim().toUpperCase()}.
        </p>
      )}
      {releaseEntries.length > 0 && (
        <>
          <div className={styles.releaseSummaryBar}>
            {atRiskCount > 0 && <span className={styles.releaseSummaryRisk}>🔴 {atRiskCount} at risk</span>}
            {watchCount > 0 && <span className={styles.releaseSummaryWatch}>🟡 {watchCount} watch</span>}
            {onTrackCount > 0 && <span className={styles.releaseSummaryOnTrack}>🟢 {onTrackCount} on track</span>}
            {unscheduledCount > 0 && <span className={styles.releaseSummaryMuted}>📅 {unscheduledCount} unscheduled</span>}
            <span className={styles.releaseSummaryMuted}>
              {releaseEntries.length} release{releaseEntries.length === 1 ? '' : 's'} · {projectKey.trim().toUpperCase()}
            </span>
          </div>

          {RELEASE_BUCKETS.map((bucket) => {
            const bucketEntries = releaseEntries.filter((entry) => entry.bucket === bucket.id);
            if (bucketEntries.length === 0) {
              return null;
            }

            return (
              <section className={styles.releaseBucketSection} key={bucket.id}>
                <div className={`${styles.releaseBucketHeader} ${getReleaseBucketSectionClassName(bucket.id)}`}>
                  <span>{bucket.emoji} {bucket.label}</span>
                </div>

                {bucketEntries.map((entry) => {
                  const isExpanded = expandedReleaseIds[entry.version.id] ?? false;
                  const doneWidth = entry.totalCount === 0
                    ? 0
                    : Math.round((entry.doneCount / entry.totalCount) * 100);
                  const progressWidth = entry.totalCount === 0
                    ? 0
                    : Math.round((entry.progressCount / entry.totalCount) * 100);
                  const importedReleaseNotes = releaseNotesByVersionId[entry.version.id] ?? null;
                  const releaseExportError = releaseExportErrorByVersionId[entry.version.id] ?? '';
                  const issueByKey = new Map(entry.issues.map((issue) => [issue.key, issue]));

                  return (
                    <article className={styles.releaseCard} key={entry.version.id}>
                      <div className={styles.releaseCardHeader}>
                        <div className={styles.releaseCardTitleGroup}>
                          <h3 className={styles.releaseCardTitle}>{entry.version.name}</h3>
                          <span className={styles.releaseCardDate}>📅 {formatReleaseDate(entry.releaseDate)}</span>
                        </div>
                        <span className={`${styles.releaseCountdownBadge} ${getReleaseCountdownClassName(entry.daysLeft)}`}>
                          {formatReleaseCountdown(entry.daysLeft)}
                        </span>
                      </div>

                      {entry.totalCount > 0 ? (
                        <>
                          <div className={styles.releaseProgressRow}>
                            <div className={styles.releaseProgressBar}>
                              <div className={styles.releaseProgressDone} style={{ width: `${doneWidth}%` }} />
                              <div
                                className={styles.releaseProgressInProgress}
                                style={{ left: `${doneWidth}%`, width: `${progressWidth}%` }}
                              />
                              <div className={styles.releaseProgressTarget} />
                            </div>
                            <span className={`${styles.releaseCompletionPercent} ${getReleaseCompletionClassName(entry.completionPercentage)}`}>
                              {entry.completionPercentage}%
                            </span>
                          </div>
                          <div className={styles.releaseCountsLine}>
                            ✅ {entry.doneCount} done · 🔄 {entry.progressCount} in progress · ⬜ {entry.todoCount} to do
                          </div>
                        </>
                      ) : (
                        <div className={styles.releaseCountsLine}>No issues linked to this release.</div>
                      )}

                      {isReleaseRovoUnlocked && (
                        <div className={styles.releaseAiActions}>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleBuildReleasePrompt(entry)}
                            type="button"
                          >
                            {RELEASE_PROMPT_BUTTON_LABEL}
                          </button>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleOpenReleaseImportModal(entry)}
                            type="button"
                          >
                            {RELEASE_IMPORT_BUTTON_LABEL}
                          </button>
                        </div>
                      )}

                      {entry.totalCount > 0 && (
                        <>
                          <button
                            className={styles.releaseExpandButton}
                            onClick={() =>
                              setExpandedReleaseIds((previousExpandedReleaseIds) => ({
                                ...previousExpandedReleaseIds,
                                [entry.version.id]: !isExpanded,
                              }))}
                            type="button"
                          >
                            {isExpanded ? '▼ Hide issues' : `▶ Show ${entry.totalCount} issues`}
                          </button>

                          {isExpanded && (
                            <div className={styles.releaseIssueList}>
                              {entry.issues.map((issue) => (
                                <div className={styles.releaseIssueRow} key={issue.key}>
                                  <span className={styles.releaseIssueStatusIcon}>
                                    {classifyReleaseIssueStatus(issue) === 'done'
                                      ? '✅'
                                      : classifyReleaseIssueStatus(issue) === 'progress'
                                        ? '🔄'
                                        : '⬜'}
                                  </span>
                                  <a
                                    className={styles.issueKeyLink}
                                    href={`${JIRA_BROWSE_URL_PREFIX}${issue.key}`}
                                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {issue.key}
                                  </a>
                                  <span className={styles.releaseIssueSummary}>{issue.fields.summary}</span>
                                  <span className={styles.releaseIssueAssignee}>
                                    {issue.fields.assignee?.displayName?.split(' ')[0] ?? '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {importedReleaseNotes && (
                        <section
                          className={styles.releaseNotesSection}
                          ref={(releaseNotesSectionElement) =>
                            handleReleaseNotesSectionRef(entry.version.id, releaseNotesSectionElement)}
                        >
                          <div className={styles.releaseNotesHeader}>
                            <div>
                              <h4 className={styles.releaseNotesTitle}>Rovo Release Notes Draft</h4>
                              <p className={styles.releaseNotesSummary}>
                                {importedReleaseNotes.releaseSummary}
                              </p>
                            </div>
                            <div className={styles.releaseNotesHeaderActions}>
                              <span className={styles.releaseNotesBadge}>
                                {importedReleaseNotes.items.length} item{importedReleaseNotes.items.length === 1 ? '' : 's'}
                              </span>
                              <button
                                className={styles.releaseNotesExportButton}
                                data-export-exclude="true"
                                onClick={() => void handleExportReleaseNotes(entry.version.id, importedReleaseNotes.releaseName)}
                                type="button"
                              >
                                {EXPORT_RELEASE_NOTES_BUTTON_LABEL}
                              </button>
                            </div>
                          </div>
                          {releaseExportError ? <p className={styles.errorMessage}>{releaseExportError}</p> : null}
                          <div className={styles.releaseNotesTableShell} data-export-expand="true">
                            <table className={styles.releaseNotesTable}>
                              <thead>
                                <tr>
                                  <th scope="col">Release Item</th>
                                  <th scope="col">Release Note</th>
                                  <th scope="col">Customer Impact</th>
                                  <th scope="col">Technical Details</th>
                                  <th scope="col">Risks</th>
                                  <th scope="col">Validation</th>
                                </tr>
                              </thead>
                              <tbody>
                                {importedReleaseNotes.items.map((releaseItem) => {
                                  const matchingIssue = issueByKey.get(releaseItem.issueKey) ?? null;

                                  return (
                                    <tr key={`${entry.version.id}-${releaseItem.issueKey}`}>
                                      <td>
                                        <div className={styles.releaseNotesItemCell}>
                                          <strong>{releaseItem.issueKey}</strong>
                                          <span>{releaseItem.title}</span>
                                          {matchingIssue ? (
                                            <div className={styles.releaseNotesMetaRow}>
                                              <span className={styles.statusBadge}>{readIssueStatusName(matchingIssue)}</span>
                                              <span className={styles.statusBadge}>{readAssigneeName(matchingIssue)}</span>
                                            </div>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td>{releaseItem.releaseNote}</td>
                                      <td>{releaseItem.customerImpact}</td>
                                      <td>{releaseItem.technicalDetails}</td>
                                      <td>{releaseItem.risks}</td>
                                      <td>{releaseItem.validation}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </>
      )}

      {isPassphraseModalVisible ? (
        <div
          aria-modal="true"
          className={styles.releasePromptOverlay}
          role="dialog"
        >
          <div className={styles.releasePromptModal}>
            <h3 className={styles.releasePromptTitle}>Unlock protected tools</h3>
            <input
              aria-label="Protected tools passphrase"
              className={styles.releasePromptInput}
              onChange={(changeEvent) => setPassphraseInput(changeEvent.target.value)}
              onKeyDown={handlePassphraseKeyDown}
              placeholder="Enter passphrase"
              ref={passphraseInputRef}
              type="password"
              value={passphraseInput}
            />
            {passphraseError ? <p className={styles.errorMessage}>{passphraseError}</p> : null}
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => void handlePassphraseSubmit()}
                type="button"
              >
                Unlock
              </button>
              <button
                className={styles.textActionButton}
                onClick={() => setIsPassphraseModalVisible(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {releasePromptModalState ? (
        <div
          aria-modal="true"
          className={styles.releasePromptOverlay}
          role="dialog"
        >
          <div className={styles.releasePromptWideModal}>
            <h3 className={styles.releasePromptTitle}>
              Rovo prompt for {releasePromptModalState.versionName}
            </h3>
            <p className={styles.releasePromptInstructions}>
              Copy this prompt into Rovo, then paste the JSON response back into Toolbox to render the release-notes table.
            </p>
            <textarea
              aria-label="Rovo release prompt"
              className={styles.releasePromptTextArea}
              readOnly
              value={releasePromptModalState.promptText}
            />
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => void navigator.clipboard.writeText(releasePromptModalState.promptText)}
                type="button"
              >
                {COPY_RELEASE_PROMPT_BUTTON_LABEL}
              </button>
              <button
                className={styles.textActionButton}
                onClick={() => setReleasePromptModalState(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {releaseImportModalState ? (
        <div
          aria-modal="true"
          className={styles.releasePromptOverlay}
          role="dialog"
        >
          <div className={styles.releasePromptWideModal}>
            <h3 className={styles.releasePromptTitle}>
              Paste Rovo response for {releaseImportModalState.versionName}
            </h3>
            <p className={styles.releasePromptInstructions}>
              Paste the JSON response from Rovo. Toolbox will parse it and render a release-notes table for this release.
            </p>
            <textarea
              aria-label="Rovo release response"
              className={styles.releasePromptTextArea}
              onChange={(changeEvent) => handleReleaseImportTextChange(changeEvent.target.value)}
              value={releaseImportModalState.responseText}
            />
            {releaseImportModalState.errorMessage ? (
              <p className={styles.errorMessage}>{releaseImportModalState.errorMessage}</p>
            ) : null}
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                onClick={handleImportReleaseResponse}
                type="button"
              >
                {RENDER_RELEASE_TABLE_BUTTON_LABEL}
              </button>
              <button
                className={styles.textActionButton}
                onClick={() => setReleaseImportModalState(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Main component ──

/**
 * Renders the Sprint Dashboard view so teams can monitor sprint health,
 * review assignments, identify blockers, and run standup in one workspace.
 * Supports both scrum (active sprint) and kanban (board issues) boards.
 */
export default function SprintDashboardView() {
  const dashboardTeamProfiles = useSettingsStore((storeState) => storeState.sprintDashboardTeamProfiles);
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );
  const setDashboardTeamProfiles = useSettingsStore(
    (storeState) => storeState.setSprintDashboardTeamProfiles,
  );
  const setActiveDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.setSprintDashboardActiveTeamProfileId,
  );
  const updateActiveDashboardTeamProfile = useSettingsStore(
    (storeState) => storeState.updateActiveSprintDashboardTeamProfile,
  );
  const activeDashboardTeamProfile = useMemo(
    () =>
      dashboardTeamProfiles.find(
        (teamProfile) => teamProfile.id === activeDashboardTeamProfileId,
      ) ?? null,
    [activeDashboardTeamProfileId, dashboardTeamProfiles],
  );
  const { state, actions } = useSprintData(activeDashboardTeamProfileId);
  const { config, actions: configActions } = useDashboardConfig(activeDashboardTeamProfileId);
  const { loadSprint } = actions;
  const hasAttemptedRestoreLoad = useRef(false);
  const tabPanelRef = useRef<HTMLElement | null>(null);

  // Local state for the board picker search field — not persisted, just UI.
  const [boardSearchQuery, setBoardSearchQuery] = useState('');

  useEffect(() => {
    useStandupRosterStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
    useStandupPlanningStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
    useCapacityStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
  }, [activeDashboardTeamProfileId]);

  useEffect(() => {
    hasAttemptedRestoreLoad.current = false;
  }, [activeDashboardTeamProfileId]);

  useEffect(() => {
    if (!activeDashboardTeamProfileId) {
      return;
    }

    updateActiveDashboardTeamProfile({
      projectKey: state.projectKey,
      boardId: state.boardId === null ? '' : String(state.boardId),
      boardName: state.selectedBoardName ?? '',
      boardType: state.boardType ?? '',
      scopeMode: state.scopeMode,
      selectedSprintId: state.selectedSprintId === null ? '' : String(state.selectedSprintId),
      selectedFixVersion: state.selectedFixVersionName,
      selectedPiValue: state.selectedPiValue,
    });
  }, [
    state.boardId,
    state.boardType,
    state.projectKey,
    state.scopeMode,
    state.selectedBoardName,
    state.selectedFixVersionName,
    state.selectedPiValue,
    state.selectedSprintId,
    updateActiveDashboardTeamProfile,
  ]);

  useEffect(() => {
    if (hasAttemptedRestoreLoad.current) {
      return;
    }

    hasAttemptedRestoreLoad.current = true;
    const hasSavedDashboardSelection = state.boardId !== null || Boolean(state.projectKey.trim());
    const hasLoadedDashboardData = state.sprintInfo !== null || state.sprintIssues.length > 0;

    if (!hasSavedDashboardSelection || hasLoadedDashboardData) {
      return;
    }

    // Restored selections should reopen the dashboard immediately after a refresh.
    void loadSprint();
  }, [loadSprint, state.boardId, state.projectKey, state.sprintInfo, state.sprintIssues.length]);

  useEffect(() => {
    if (tabPanelRef.current) {
      tabPanelRef.current.scrollTop = 0;
    }

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [state.activeTab]);

  function handleIssueUpdated() {
    void loadSprint();
  }

  function handleSaveDashboardTeam(teamName: string, shouldCreateNewTeam: boolean) {
    const trimmedTeamName = teamName.trim();
    const nextTeamProfileName =
      trimmedTeamName ||
      state.selectedBoardName?.trim() ||
      state.projectKey.trim().toUpperCase() ||
      'Saved Team';
    const nextTeamProfile: SprintDashboardTeamProfile = {
      id:
        shouldCreateNewTeam || !activeDashboardTeamProfile
          ? createDashboardTeamProfileId()
          : activeDashboardTeamProfile.id,
      name: nextTeamProfileName,
      projectKey: state.projectKey.trim().toUpperCase(),
      boardId: state.boardId === null ? '' : String(state.boardId),
      boardName: state.selectedBoardName ?? '',
      boardType: state.boardType ?? '',
      scopeMode: state.scopeMode,
      selectedSprintId: state.selectedSprintId === null ? '' : String(state.selectedSprintId),
      selectedFixVersion: state.selectedFixVersionName,
      selectedPiValue: state.selectedPiValue,
    };
    const preservedTeamProfiles = shouldCreateNewTeam
      ? dashboardTeamProfiles
      : dashboardTeamProfiles.filter((teamProfile) => teamProfile.id !== nextTeamProfile.id);
    setDashboardTeamProfiles([...preservedTeamProfiles, nextTeamProfile]);
    setActiveDashboardTeamProfileId(nextTeamProfile.id);
  }

  function handleRemoveDashboardTeam(teamProfileId: string) {
    const currentActiveDashboardTeamProfileId =
      useSettingsStore.getState().sprintDashboardActiveTeamProfileId;
    const remainingTeamProfiles = dashboardTeamProfiles.filter(
      (teamProfile) => teamProfile.id !== teamProfileId,
    );
    setDashboardTeamProfiles(remainingTeamProfiles);
    if (teamProfileId === currentActiveDashboardTeamProfileId && remainingTeamProfiles.length > 0) {
      setActiveDashboardTeamProfileId(remainingTeamProfiles[0].id);
    }
  }

  function renderActiveTabPanel(activeTab: DashboardTab) {
    if (activeTab === 'overview') {
      return (
        <OverviewTab
          configState={config}
          issues={state.sprintIssues}
          onFetchSprints={actions.loadAvailableSprints}
          onIssueUpdated={handleIssueUpdated}
          onMoveToSprint={actions.moveIssueToSprint}
          sprintInfo={state.sprintInfo}
          sprintState={state}
        />
      );
    }

    if (activeTab === 'assignee') {
      return (
        <AssigneeTab
          configState={config}
          issues={state.sprintIssues}
          onFetchSprints={actions.loadAvailableSprints}
          onIssueUpdated={handleIssueUpdated}
          onMoveToSprint={actions.moveIssueToSprint}
          sprintState={state}
        />
      );
    }

    if (activeTab === 'blockers') {
      return (
        <BlockersTab
          issues={state.sprintIssues}
          onIssueUpdated={handleIssueUpdated}
          staleDaysThreshold={config.staleDaysThreshold}
        />
      );
    }

    if (activeTab === 'defects') {
      return (
        <DefectsTab
          issues={state.sprintIssues}
          onIssueUpdated={handleIssueUpdated}
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
      );
    }

    if (activeTab === 'standup') {
      return (
        <StandupTab
          key={`standup-${activeDashboardTeamProfileId || 'legacy-default'}`}
          dashboardTeamProfileId={activeDashboardTeamProfileId}
          isTimerRunning={state.isTimerRunning}
          issues={state.sprintIssues}
          onReset={actions.resetTimer}
          onRefreshIssues={actions.loadSprint}
          onStart={actions.startTimer}
          onStop={actions.stopTimer}
          onTick={actions.tickTimer}
          projectKey={state.projectKey}
          timerSecondsRemaining={state.timerSecondsRemaining}
        />
      );
    }

    if (activeTab === 'hygiene') {
      return (
        <TeamDashboardHygieneTab projectKey={state.projectKey} />
      );
    }

    if (activeTab === 'metrics') {
      return (
        <MetricsTab
          boardId={state.boardId}
          boardType={state.boardType}
          config={config}
          customStoryPointsFieldId={config.customStoryPointsFieldId}
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
      );
    }

    if (activeTab === 'pipeline') {
      return (
        <PipelineTab
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
      );
    }

    if (activeTab === 'planning') {
      return (
        <PlanningTab
          customStoryPointsFieldId={config.customStoryPointsFieldId}
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
      );
    }

    if (activeTab === 'pointing') {
      return (
        <PointingTab
          key={`${state.boardType ?? 'none'}:${config.customStoryPointsFieldId}:${state.sprintIssues.map((issue) => issue.key).join('|')}`}
          boardType={state.boardType}
          config={config}
          issues={state.sprintIssues}
        />
      );
    }

    if (activeTab === 'featurereview') {
      return (
        <FeatureReviewTab
          boardId={state.boardId}
          boardName={state.selectedBoardName}
          projectKey={state.projectKey}
          selectedPiName={state.selectedPiValue}
        />
      );
    }

    if (activeTab === 'pireview') {
      return (
        <SprintDashboardPiReviewTab
          boardId={state.boardId}
          boardName={state.selectedBoardName}
          projectKey={state.projectKey}
          selectedPiName={state.selectedPiValue}
          sprintIssues={state.sprintIssues}
        />
      );
    }

    if (activeTab === 'releases') {
      return (
        <ReleasesTab
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
      );
    }

    return (
      <SettingsTab
      key={`settings-${activeDashboardTeamProfileId || 'legacy-default'}`}
      availableBoards={state.availableBoards}
        boardId={state.boardId}
        boardType={state.boardType}
        boardSearchQuery={boardSearchQuery}
        config={config}
        dashboardTeamProfiles={dashboardTeamProfiles}
        activeDashboardTeamProfileId={activeDashboardTeamProfileId}
        issues={state.sprintIssues}
        isLoadingSprint={state.isLoadingSprint}
        loadError={state.loadError}
        onActivateDashboardTeam={setActiveDashboardTeamProfileId}
        onBoardSearchChange={setBoardSearchQuery}
        onConfigChange={configActions.updateConfig}
        onLoadSprint={actions.loadSprint}
        onProjectKeyChange={actions.setProjectKey}
        onRemoveDashboardTeam={handleRemoveDashboardTeam}
        onSaveDashboardTeam={handleSaveDashboardTeam}
        onSelectBoard={actions.selectBoard}
        projectKey={state.projectKey}
      />
    );
  }

  return (
    <div className={styles.sprintDashboardView}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p>{VIEW_SUBTITLE}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)', maxWidth: '20rem' }}>
          <label htmlFor="dashboard-team-selector" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
            {DASHBOARD_TEAM_SELECTOR_LABEL}
          </label>
          <select
            className={styles.settingsInput}
            id="dashboard-team-selector"
            onChange={(changeEvent) => setActiveDashboardTeamProfileId(changeEvent.target.value)}
            value={activeDashboardTeamProfileId}
          >
            <option value="">
              {dashboardTeamProfiles.length > 0 ? 'Select a saved team' : 'No saved teams yet'}
            </option>
            {dashboardTeamProfiles.map((teamProfile) => (
              <option key={teamProfile.id} value={teamProfile.id}>
                {buildDashboardTeamProfileLabel(teamProfile)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <DashboardScopeSelector
        onFixVersionScopeChange={actions.selectFixVersionScope}
        onPiScopeChange={actions.selectPiScope}
        onScopeModeChange={actions.setScopeMode}
        onSprintScopeChange={actions.selectSprintScope}
        sprintState={state}
      />

      <PrimaryTabs
        ariaLabel={TEAM_DASHBOARD_TABS_ARIA_LABEL}
        idPrefix="team-dashboard"
        tabs={TAB_OPTIONS}
        activeTab={state.activeTab}
        onChange={actions.setActiveTab}
      />

      <section
        className={styles.tabPanelSection}
        aria-labelledby={`team-dashboard-${state.activeTab}-tab`}
        id={`team-dashboard-${state.activeTab}-panel`}
        ref={tabPanelRef}
        role="tabpanel"
      >
        {renderActiveTabPanel(state.activeTab)}
      </section>
    </div>
  );
}
