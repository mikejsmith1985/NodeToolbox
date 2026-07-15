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

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import IssueComments from '../../components/CommentThread/IssueComments.tsx';
import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import JiraFieldPicker from '../../components/JiraFieldPicker/index.tsx';
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import { jiraGet, jiraPost, jiraPut } from '../../services/jiraApi.ts';
import {
  useSettingsStore,
  type SprintDashboardPiReviewPage,
  type SprintDashboardTeamProfile,
} from '../../store/settingsStore.ts';
import type { JiraComment, JiraIssue, JiraTransition, JiraVersion } from '../../types/jira.ts';
import { copyElementReportToClipboard } from '../../utils/downloadElementImage.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import { useAiAssist } from '../SnowHub/hooks/useAiAssist.ts';
import {
  calculateCompositeScore,
  extractIssueFeatures,
  snapToNearestPointValue,
  STORY_POINT_BREAKDOWN_THRESHOLD,
} from './storyPointEstimator.ts';
import type { IssueFeatureVector } from './storyPointEstimator.ts';
import BoardPicker from './BoardPicker.tsx';
import { assessBoardHealth, computeAverageVelocity } from './sprintMetrics.ts';
import { parsePiDateRange, timeElapsedFraction } from '../FeatureCanvas/logic/piSchedule.ts';
import FeatureReviewTab from './FeatureReviewTab.tsx';
import { BacklogRemediationPanel } from './backlogRemediation/BacklogRemediationPanel.tsx';
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
  buildReleaseNotesHeading,
  buildReleaseNotesHtml,
  buildReleaseAiAssistPrompt,
  parseReleaseAiAssistResponse,
  type ReleaseAiAssistPromptInput,
  type ReleaseAiAssistTableDocument,
} from './hooks/releaseAiAssistNotes.ts';
import {
  buildDevSkipRiskAssistPrompt,
  summarizeIssueCommentsForPrompt,
  type ReleaseDevSkipRiskPromptInput,
} from './hooks/releaseDevSkipRisk.ts';
import { renderMarkdownReport } from '../../utils/markdownReport.tsx';
import { useAiAssistExchange } from '../SnowHub/hooks/useAiAssistExchange.ts';
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
  { key: 'backlogremediation', label: 'Remediation' },
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
  'summary,status,assignee,priority,issuetype,fixVersions,description,customfield_10200,comment';
const RELEASE_MAX_RESULTS = 50;
const POINTING_AI_ASSIST_ENHANCE_BUTTON_LABEL = '✦ Enhance with AI';
const POINTING_AI_ASSIST_COPY_BUTTON_LABEL = '📋 Copy Prompt';
const POINTING_AI_ASSIST_APPLY_BUTTON_LABEL = 'Apply estimates →';
// Identifier renamed to AI Assist; the string value is kept so previously stored notes still load.
const RELEASE_AI_ASSIST_NOTES_STORAGE_KEY_PREFIX = 'tbx-release-rovo-notes';
const RELEASE_PROMPT_BUTTON_LABEL = '✦ Build AI Assist Prompt';
const RELEASE_IMPORT_BUTTON_LABEL = '↩ Paste AI Assist Response';
const COPY_RELEASE_PROMPT_BUTTON_LABEL = '📋 Copy Prompt';
const RENDER_RELEASE_TABLE_BUTTON_LABEL = 'Render Release Notes Table';
const COPY_RELEASE_NOTES_BUTTON_LABEL = '📋 Copy Release Notes';
// Dev-skip test-risk assessment: gauges the risk of promoting a release straight to Integration
// testing without a Dev-environment test pass. Stored per release version, like the release notes.
const RELEASE_DEV_SKIP_RISK_STORAGE_KEY_PREFIX = 'tbx-release-dev-skip-risk';
const RELEASE_DEV_SKIP_RISK_BUTTON_LABEL = '✦ Assess Dev-Skip Risk';
// Shown briefly after a successful clipboard copy so the user knows the image is ready to paste.
const RELEASE_NOTES_COPIED_CONFIRMATION = 'Copied to clipboard — paste it into your email or chat.';
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
// Issue types that are never valid for story-point estimation; excluded from the pointing queue entirely.
const POINTING_EXCLUDED_ISSUE_TYPE_NAMES = new Set(['risk']);
// Maximum concurrent Jira PUT requests when saving all pointing estimates; avoids 429 rate-limit errors.
const SAVE_ALL_BATCH_SIZE = 5;
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

/** Baseline issue used to calibrate all subsequent auto-estimates in a pointing session. */
interface AnchorConfig {
  issueKey: string;
  pointValue: number;
  /** Complexity features captured at the moment the anchor was set — used as the ratio denominator. */
  features: IssueFeatureVector;
}

/** Result of running the anchor-based estimation algorithm for a single issue. */
interface PointingEstimateResult {
  suggestedPoints: number;
  /** True when the estimate exceeds the breakdown threshold and the story should be split. */
  requiresBreakdown: boolean;
  /** True when the estimate snaps to the same value as the anchor (typically sparse content). */
  isSameAsAnchor: boolean;
  /** Raw feature scores that produced the estimate — displayed to the user in the table. */
  featureBreakdown: IssueFeatureVector;
  /** True when the issue has too little text for a reliable relative estimate. */
  isSparseContent: boolean;
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
    projectKey,
  }: {
    selectedTypes: string[];
    selectedStatuses: string[];
    sortBy: PointingSortId;
    showPointed: boolean;
    pipelineRoleFilter: PipelineRole | '';
    customStoryPointsFieldId: string;
    /** When non-empty, restricts the queue to issues whose key prefix matches this project key.
     *  Guards against sprints that contain issues from multiple Jira projects. */
    projectKey: string;
  },
): JiraIssue[] {
  const normalizedProjectKey = projectKey.trim().toUpperCase();

  const nextQueue = issues.filter((issue) => {
    const issueTypeName = readIssueTypeName(issue);
    const statusName = readIssueStatusName(issue);
    const storyPoints = readStoryPoints(issue, customStoryPointsFieldId);

    // Reject issue types that do not support story-point estimation (e.g. Risk).
    if (POINTING_EXCLUDED_ISSUE_TYPE_NAMES.has(issueTypeName.toLowerCase())) {
      return false;
    }
    // Reject issues that belong to a different Jira project when a project key is configured.
    if (normalizedProjectKey && !issue.key.toUpperCase().startsWith(`${normalizedProjectKey}-`)) {
      return false;
    }
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

function buildReleasePromptInput(projectKey: string, releaseEntry: ReleaseRadarEntry): ReleaseAiAssistPromptInput {
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

/**
 * Maps a Release Radar entry into the dev-skip test-risk prompt input, pulling each ticket's
 * comment thread (where unit-test evidence usually lives) alongside its description and criteria.
 */
function buildDevSkipRiskPromptInput(
  projectKey: string,
  releaseEntry: ReleaseRadarEntry,
): ReleaseDevSkipRiskPromptInput {
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
      issueTypeName: issue.fields.issuetype?.name ?? null,
      priorityName: issue.fields.priority?.name ?? null,
      description: issue.fields.description,
      acceptanceCriteria: issue.fields.customfield_10200,
      comments: summarizeIssueCommentsForPrompt(issue.fields.comment?.comments),
    })),
  };
}



function buildReleaseNotesStorageKey(projectKey: string): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase() || 'default';
  return `${RELEASE_AI_ASSIST_NOTES_STORAGE_KEY_PREFIX}:${normalizedProjectKey}`;
}

function readStoredReleaseNotes(projectKey: string): Record<string, ReleaseAiAssistTableDocument> {
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

    return parsedValue as Record<string, ReleaseAiAssistTableDocument>;
  } catch {
    return {};
  }
}

function buildDevSkipRiskStorageKey(projectKey: string): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase() || 'default';
  return `${RELEASE_DEV_SKIP_RISK_STORAGE_KEY_PREFIX}:${normalizedProjectKey}`;
}

/**
 * Loads any previously rendered dev-skip risk reports (raw Markdown keyed by fix-version id) for
 * this project from session storage, so a rendered assessment survives a tab switch or reload.
 */
function readStoredDevSkipRisk(projectKey: string): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedValue = window.sessionStorage.getItem(buildDevSkipRiskStorageKey(projectKey));
    if (!storedValue) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue);
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    return parsedValue as Record<string, string>;
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

        // No initialiser: every branch below assigns it, and seeding '' only hid that fact — an
        // unassigned path would now be a compile error rather than a silently empty status.
        let statusName: string;
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

/**
 * Renders the delivery-health badge from schedule progress AND blockers — not blockers alone. A board
 * that has burned far fewer points than the fraction of the sprint/PI window elapsed is behind, even
 * with zero blockers. `timeElapsedFraction` is null when no date window is known (falls back to blockers).
 */
function HealthBadge({
  issues,
  customStoryPointsFieldId,
  windowElapsedFraction,
}: {
  issues: JiraIssue[];
  customStoryPointsFieldId: string;
  windowElapsedFraction: number | null;
}) {
  const blockedCount = issues.filter(isBlockedIssue).length;
  const pointsTotal = issues.reduce((sum, issue) => sum + readStoryPoints(issue, customStoryPointsFieldId), 0);
  const pointsDone = issues.filter(isDoneIssue).reduce((sum, issue) => sum + readStoryPoints(issue, customStoryPointsFieldId), 0);
  const status = assessBoardHealth({ pointsDone, pointsTotal, timeElapsedFraction: windowElapsedFraction, blockedCount });

  // A short "why" so the verdict is transparent (e.g. "32% done · 67% elapsed").
  const detail = windowElapsedFraction !== null && pointsTotal > 0
    ? ` — ${Math.round((pointsDone / pointsTotal) * 100)}% done · ${Math.round(windowElapsedFraction * 100)}% elapsed`
    : blockedCount > 0 ? ` — ${blockedCount} blocked` : '';

  if (status === 'on-track') {
    return <span className={`${styles.healthBadge} ${styles.healthOnTrack}`}>🟢 On Track{detail}</span>;
  }
  if (status === 'watch') {
    return <span className={`${styles.healthBadge} ${styles.healthWatch}`}>🟡 Watch{detail}</span>;
  }
  return <span className={`${styles.healthBadge} ${styles.healthAtRisk}`}>🔴 At Risk{detail}</span>;
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

  // How far through the current window we are — a sprint's own dates when scoped to a sprint, else the
  // PI's date range parsed from its name (sprints have no PI field; they just fall within the dates).
  const todayIso = new Date().toISOString().slice(0, 10);
  const windowElapsedFraction = (() => {
    if (sprintInfo?.startDate && sprintInfo?.endDate) {
      return timeElapsedFraction(sprintInfo.startDate.slice(0, 10), sprintInfo.endDate.slice(0, 10), todayIso);
    }
    const piRange = parsePiDateRange(sprintState.selectedPiValue);
    return piRange ? timeElapsedFraction(piRange.startIso, piRange.endIso, todayIso) : null;
  })();

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
          <HealthBadge issues={issues} customStoryPointsFieldId={configState.customStoryPointsFieldId} windowElapsedFraction={windowElapsedFraction} />
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
            // Toggle this defect's detail panel open/closed. Shared by the whole-row
            // click and keyboard handlers so the entire bar acts as one control.
            const toggleThisDefect = () =>
              setExpandedIssueKey((previousIssueKey) => previousIssueKey === defectIssue.key ? null : defectIssue.key);
            return (
              <div className={styles.issueCardWrapper} key={defectIssue.key}>
                {/* Whole bar is clickable — the chevron is now a visual affordance only. */}
                <div
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${defectIssue.key}`}
                  className={`${styles.defectCard} ${styles.clickableRow}`}
                  onClick={toggleThisDefect}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                      keyEvent.preventDefault();
                      toggleThisDefect();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
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
                  <span aria-hidden="true" className={styles.expandToggleButton}>
                    {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
                  </span>
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
  /** Draft PI Review pages for the active team (edited here; saved onto the profile). */
  piReviewPages: SprintDashboardPiReviewPage[];
  /** Program Increment names offered in each PI Review page's dropdown. */
  availablePiValues: string[];
  onProjectKeyChange: (key: string) => void;
  onLoadSprint: () => void;
  onBoardSearchChange: (query: string) => void;
  onSelectBoard: (boardId: number) => Promise<void>;
  onConfigChange: (partial: Partial<DashboardConfig>) => void;
  onActivateDashboardTeam: (teamProfileId: string) => void;
  onSaveDashboardTeam: (teamName: string, shouldCreateNewTeam: boolean) => void;
  onRemoveDashboardTeam: (teamProfileId: string) => void;
  onAddPiReviewPage: () => void;
  onUpdatePiReviewPage: (pageIndex: number, changes: Partial<SprintDashboardPiReviewPage>) => void;
  onRemovePiReviewPage: (pageIndex: number) => void;
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
  piReviewPages,
  availablePiValues,
  onProjectKeyChange,
  onLoadSprint,
  onBoardSearchChange,
  onSelectBoard,
  onConfigChange,
  onActivateDashboardTeam,
  onSaveDashboardTeam,
  onRemoveDashboardTeam,
  onAddPiReviewPage,
  onUpdatePiReviewPage,
  onRemovePiReviewPage,
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
      <section className={styles.settingsSectionCard}>
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
        </div>
      </section>

      <section className={styles.settingsSectionCard}>
        <div className={styles.settingsPrimaryColumn}>
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
        </div>
      </section>

      {/* PI Review pages — configured here per team; displayed as sub-tabs in the ART view.
          Rendered as a full-width card so long Confluence URLs stay readable while editing. */}
      <section className={styles.settingsSectionCard}>
        <h2 className={styles.settingsSectionTitle}>PI Review Pages</h2>
        <p className={styles.issueMetaText}>
          Add one Confluence page per Program Increment. They appear as sub-tabs on the PI Review tab and are
          shown in the ART view. Click <strong>Save PI Review Pages</strong> below to keep your changes.
        </p>
        {(piReviewPages ?? []).map((piReviewPage, pageIndex) => (
          <div className={styles.piReviewPageRow} key={pageIndex}>
            <select
              aria-label={`PI for PI Review page ${pageIndex + 1}`}
              className={`${styles.settingsInput} ${styles.piReviewPagePiSelect}`}
              onChange={(changeEvent) => onUpdatePiReviewPage(pageIndex, { piName: changeEvent.target.value })}
              value={piReviewPage.piName}
            >
              <option value="">— Select PI —</option>
              {availablePiValues.map((availablePiValue) => (
                <option key={availablePiValue} value={availablePiValue}>{availablePiValue}</option>
              ))}
              {piReviewPage.piName.trim() !== '' && !availablePiValues.includes(piReviewPage.piName) && (
                <option value={piReviewPage.piName}>{piReviewPage.piName}</option>
              )}
            </select>
            <input
              aria-label={`PI Review Page URL ${pageIndex + 1}`}
              className={`${styles.settingsInput} ${styles.piReviewPageUrlInput}`}
              onChange={(changeEvent) => onUpdatePiReviewPage(pageIndex, { pageUrl: changeEvent.target.value })}
              placeholder="Confluence page URL"
              type="text"
              value={piReviewPage.pageUrl}
            />
            <button
              className={styles.textActionButton}
              onClick={() => onRemovePiReviewPage(pageIndex)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
        <div className={styles.piReviewPagesActions}>
          <button
            className={styles.secondaryButton}
            onClick={onAddPiReviewPage}
            type="button"
          >
            + Add PI
          </button>
          {/* Persisting the pages saves the whole team profile (their single source of truth), so this
              reuses the same team-save action as "Update Active Team" — no separate persistence path. */}
          <button
            className={styles.secondaryButton}
            disabled={!canSaveDashboardTeam}
            onClick={() => onSaveDashboardTeam(dashboardTeamName, false)}
            type="button"
          >
            {activeDashboardTeamProfile ? 'Save PI Review Pages' : 'Save PI Review Pages as New Team'}
          </button>
        </div>
        {!canSaveDashboardTeam ? (
          <p className={styles.issueMetaText}>
            Enter a project key and choose a board (in Board Settings above) before saving PI Review pages.
          </p>
        ) : null}
      </section>

      <section className={styles.settingsSectionCard}>
        <h2 className={styles.settingsSectionTitle}>Advanced Settings</h2>

        <AdvancedConfigFields config={config} onConfigChange={onConfigChange} />
      </section>

      <section className={`${styles.settingsSectionCard} ${styles.workflowDetectSection}`}>
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
      </section>

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
      <ConfigNumberField
        id="sd-cfg-sprint-capacity"
        label="Sprint Point Capacity (0 = auto from velocity)"
        onChange={(value) => onConfigChange({ sprintPointCapacity: value })}
        value={config.sprintPointCapacity}
      />
      <JiraFieldPicker
        id="sd-cfg-epic-field"
        label="Epic Link Field"
        onChange={(fieldId) => onConfigChange({ customEpicLinkFieldId: fieldId })}
        placeholder="Epic Link field"
        value={config.customEpicLinkFieldId}
      />
      <JiraFieldPicker
        id="sd-cfg-risk-impact-date-field"
        label="Risk Impact Date Field"
        onChange={(fieldId) => onConfigChange({ riskImpactDateFieldId: fieldId })}
        placeholder="Risk Impact Date field"
        value={config.riskImpactDateFieldId}
      />
      <JiraFieldPicker
        id="sd-cfg-risk-response-field"
        label="Risk Response (ROAM) Field"
        onChange={(fieldId) => onConfigChange({ riskResponseFieldId: fieldId })}
        placeholder="Risk Response field"
        value={config.riskResponseFieldId}
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

        // Velocity/throughput are BOARD history, not scope-dependent: sprints carry no PI field, they
        // simply fall within a PI's dates. So load the most-recent closed sprints regardless of whether
        // the dashboard is scoped to a Sprint, PI, or Fix Version — otherwise these go blank in PI scope.
        // Paginate and sort so we always get the latest N (a single maxResults page can return the
        // OLDEST sprints instead of the most recent).
        const fetchRecentClosedSprints = async (): Promise<Array<{ id: number; name: string; startDate?: string }>> => {
          const collected: Array<{ id: number; name: string; startDate?: string }> = [];
          let startAt = 0;
          for (let page = 0; page < 20; page += 1) {
            const response = await jiraGet<{ values?: Array<{ id: number; name: string; startDate?: string }>; isLast?: boolean }>(
              `/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=50`,
            );
            const values = response.values ?? [];
            collected.push(...values);
            if (response.isLast || values.length === 0) {
              break;
            }
            startAt += values.length;
          }
          return collected
            .sort((leftSprint, rightSprint) => new Date(rightSprint.startDate ?? '').getTime() - new Date(leftSprint.startDate ?? '').getTime())
            .slice(0, config.sprintWindow)
            .reverse(); // most-recent N, back in chronological order for the chart
        };

        if (detectedBoardType === 'scrum') {
          const closedSprints = await fetchRecentClosedSprints();

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

        if (detectedBoardType === 'scrum') {
          const closedSprints = await fetchRecentClosedSprints();

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
  // Running average of completed points per sprint across the window — the team's velocity.
  const averageVelocityPoints = computeAverageVelocity(metricsState.predictabilityRows);
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
                  <strong>{predictabilityAverage}% avg</strong> · <strong>{averageVelocityPoints} pts</strong> avg velocity ({metricsState.predictabilityRows.length} sprints) · 80% target
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

/**
 * Pure helper that runs the anchor-based algorithm for a single target issue.
 * Extracted from the render path so it can be called in a useMemo loop over all queue items.
 */
function computeSingleEstimate(
  issue: JiraIssue,
  anchorConfig: AnchorConfig,
  detail: PointingIssueDetail | undefined,
  storyPointScale: number[],
): PointingEstimateResult {
  const targetFeatureVector = extractIssueFeatures(
    issue.fields.summary ?? '',
    detail?.description ?? normalizeCommentBody(issue.fields.description),
    detail?.acceptanceCriteria ?? '',
    (issue.fields.issuelinks ?? []).length,
  );
  const targetCompositeScore = calculateCompositeScore(targetFeatureVector);
  const anchorCompositeScore = calculateCompositeScore(anchorConfig.features);
  // Guard against a degenerate anchor (all-zero score) by treating the ratio as 1:1
  const complexityRatio = anchorCompositeScore > 0 ? targetCompositeScore / anchorCompositeScore : 1;
  const suggestedPoints = snapToNearestPointValue(complexityRatio * anchorConfig.pointValue, storyPointScale);
  return {
    suggestedPoints,
    requiresBreakdown: suggestedPoints > STORY_POINT_BREAKDOWN_THRESHOLD,
    isSameAsAnchor: suggestedPoints === anchorConfig.pointValue,
    featureBreakdown: targetFeatureVector,
    isSparseContent: targetCompositeScore < 0.5,
  };
}

// ── AI Assist helpers ──

/**
 * Parsed estimate from an AI Assist response. Points have already been validated
 * against the Fibonacci scale before this type is constructed.
 */
interface AiAssistPointingItem {
  key: string;
  points: number;
  reasoning: string;
}

/**
 * Builds the prompt text the user pastes into AI Assist.
 * Includes the anchor story as a calibration reference, every non-anchor queue
 * issue with its algorithm estimate and dimension scores, and explicit output
 * format instructions so the response can be parsed back automatically.
 */
function buildPointingAiAssistPrompt(
  anchorIssue: JiraIssue,
  anchorConfig: AnchorConfig,
  nonAnchorIssues: JiraIssue[],
  allEstimates: Record<string, PointingEstimateResult>,
  detailByIssueKey: Record<string, PointingIssueDetail>,
  storyPointScale: number[],
): string {
  const anchorDetail = detailByIssueKey[anchorIssue.key];
  const anchorDescription = anchorDetail?.description ?? normalizeCommentBody(anchorIssue.fields.description);
  const anchorAc = anchorDetail?.acceptanceCriteria ?? '';
  const { scopeScore, techComplexityScore, integrationRiskScore, uncertaintyScore } = anchorConfig.features;

  const anchorSection = [
    `${anchorIssue.key}: ${anchorIssue.fields.summary ?? '(no summary)'}`,
    `Point value: ${anchorConfig.pointValue} pts  ← calibration baseline`,
    `Description: ${anchorDescription || '(not provided)'}`,
    anchorAc ? `Acceptance Criteria: ${anchorAc}` : null,
    `Algorithm scores — Scope: ${scopeScore.toFixed(1)}, Tech: ${techComplexityScore.toFixed(1)}, Integration: ${integrationRiskScore.toFixed(1)}, Uncertainty: ${uncertaintyScore.toFixed(1)}`,
  ].filter(Boolean).join('\n');

  const issueSections = nonAnchorIssues.map((issue, index) => {
    const detail = detailByIssueKey[issue.key];
    const description = detail?.description ?? normalizeCommentBody(issue.fields.description);
    const ac = detail?.acceptanceCriteria ?? '';
    const estimate = allEstimates[issue.key];
    const scores = estimate
      ? `Algorithm scores — Scope: ${estimate.featureBreakdown.scopeScore.toFixed(1)}, Tech: ${estimate.featureBreakdown.techComplexityScore.toFixed(1)}, Integration: ${estimate.featureBreakdown.integrationRiskScore.toFixed(1)}, Uncertainty: ${estimate.featureBreakdown.uncertaintyScore.toFixed(1)}`
      : 'Algorithm scores — (no anchor set)';

    return [
      `[${index + 1}] ${issue.key}: ${issue.fields.summary ?? '(no summary)'}`,
      `Algorithm estimate: ${estimate?.suggestedPoints ?? '(none)'} pts`,
      scores,
      `Description: ${description || '(not provided)'}`,
      ac ? `Acceptance Criteria: ${ac}` : null,
    ].filter(Boolean).join('\n');
  });

  const scaleText = storyPointScale.join(', ');
  // Stories above this value are conventionally flagged for breakdown on this team's scale.
  const breakdownThreshold = storyPointScale.find((value) => value > STORY_POINT_BREAKDOWN_THRESHOLD)
    ?? storyPointScale[Math.floor(storyPointScale.length / 2)];

  return [
    'You are helping a software team estimate story points during sprint planning.',
    'Use the ANCHOR STORY as your complexity calibration reference — it is worth exactly the stated points.',
    `The team's point scale is: ${scaleText}.`,
    `Stories estimated above ${breakdownThreshold} points should be broken down into smaller tickets.`,
    '',
    '── ANCHOR STORY ──',
    anchorSection,
    '',
    '── STORIES TO ESTIMATE ──',
    issueSections.join('\n\n'),
    '',
    '── INSTRUCTIONS ──',
    'For each story above, use the anchor as your 1× reference point.',
    'The algorithm estimate is a starting point — apply your judgment based on description and context.',
    'For sparse stories (short summary, no description), reason conservatively from available signals.',
    '',
    'Respond ONLY with a valid JSON array — no prose, no markdown code fences:',
    '[',
    '  { "key": "PROJ-123", "points": 5, "reasoning": "One sentence." },',
    `  { "key": "PROJ-124", "points": ${breakdownThreshold}, "reasoning": "One sentence. ⚠ Consider breakdown." }`,
    ']',
    '',
    `Only use values from the team's scale: ${scaleText}.`,
    `Append "⚠ Consider breakdown." to the reasoning for any estimate above ${breakdownThreshold}.`,
  ].join('\n');
}

/**
 * Extracts and validates an AI Assist pointing response pasted by the user.
 * Searches the full text for a JSON array (AI Assist often wraps JSON in prose),
 * then filters out any entries whose key is not in the current queue or whose
 * point value is not on the Fibonacci scale.
 */
function parseAiAssistPointingResponse(
  responseText: string,
  validQueueKeys: Set<string>,
  storyPointScale: number[],
): { items: AiAssistPointingItem[]; errorMessage: string | null } {
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return {
      items: [],
      errorMessage: 'No JSON array found. Make sure AI Assist returned the array format described in the prompt.',
    };
  }

  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      items: [],
      errorMessage: 'The JSON in the response could not be parsed — check for missing commas or quotes.',
    };
  }

  if (!Array.isArray(parsedResponse)) {
    return { items: [], errorMessage: 'Expected a JSON array but found a different type.' };
  }

  const validScaleValues = new Set(storyPointScale);
  const validItems: AiAssistPointingItem[] = [];

  for (const rawEntry of parsedResponse) {
    if (typeof rawEntry !== 'object' || rawEntry === null) continue;

    const entry = rawEntry as Record<string, unknown>;
    const issueKey = typeof entry.key === 'string' ? entry.key.trim().toUpperCase() : null;
    const pointValue = typeof entry.points === 'number' ? entry.points : null;
    const reasoning = typeof entry.reasoning === 'string' ? entry.reasoning : '';

    // Skip entries whose key is not in the current pointing queue
    if (!issueKey || !validQueueKeys.has(issueKey)) continue;

    // Skip entries with point values that are off the configured scale
    if (pointValue === null || !validScaleValues.has(pointValue)) continue;

    validItems.push({ key: issueKey, points: pointValue, reasoning });
  }

  if (validItems.length === 0) {
    return {
      items: [],
      errorMessage: 'No valid estimates matched the current queue. Check that issue keys are correct and point values are on the scale (1 2 3 5 8 13 20 40 100).',
    };
  }

  return { items: validItems, errorMessage: null };
}

interface PointingTableRowProps {
  issue: JiraIssue;
  /** True when this row IS the currently configured anchor issue. */
  isAnchor: boolean;
  /** True when any anchor has been set for this session. */
  hasAnchor: boolean;
  /** Point value the user chose when designating this row as the anchor. Only set when isAnchor. */
  anchorPointValue: number | undefined;
  estimate: PointingEstimateResult | undefined;
  detail: PointingIssueDetail | undefined;
  override: number | undefined;
  saveProgress: 'idle' | 'saving' | 'saved' | 'error';
  /** Jira error message from the last failed save attempt, if any. */
  saveError: string | undefined;
  isExpanded: boolean;
  storyPointScale: number[];
  customStoryPointsFieldId: string;
  onSetAnchor: (issue: JiraIssue, pointValue: number) => void;
  onOverride: (issueKey: string, pointValue: number | null) => void;
  onSave: (issueKey: string, pointValue: number) => Promise<void>;
  onToggleExpand: () => void;
}

/** Renders a single row (plus an optional inline expanded-detail row) in the pointing table. */
function PointingTableRow({
  issue, isAnchor, hasAnchor, anchorPointValue, estimate, detail, override, saveProgress, saveError,
  isExpanded, storyPointScale, customStoryPointsFieldId, onSetAnchor,
  onOverride, onSave, onToggleExpand,
}: PointingTableRowProps) {
  const issueKey = issue.key;
  const storyPointsFieldId = customStoryPointsFieldId || 'customfield_10016';
  const rawCurrentValue = (issue.fields as Record<string, unknown>)[storyPointsFieldId]
    ?? (issue.fields as Record<string, unknown>).customfield_10028 ?? null;
  // Select-type story-points fields return {id, value} objects — extract the numeric value.
  const currentPoints = rawCurrentValue !== null && typeof rawCurrentValue === 'object'
    ? ((rawCurrentValue as Record<string, unknown>).value ?? null)
    : rawCurrentValue;
  const effectivePoints = override ?? estimate?.suggestedPoints;

  return (
    <>
      <tr className={isAnchor ? styles.ptRowAnchor : styles.ptRow}>
        <td className={styles.ptCellKey}>
          {isAnchor && <span className={styles.ptAnchorBadge}>⚓</span>}
          <span className={styles.ptIssueKey}>{issueKey}</span>
          <span className={styles.statusBadge}>{readIssueTypeName(issue)}</span>
        </td>
        <td className={styles.ptCellSummary}>
          <button className={styles.ptSummaryBtn} onClick={onToggleExpand} type="button">
            <span>{issue.fields.summary}</span>
            <span className={styles.ptExpandCaret}>{isExpanded ? '▲' : '▼'}</span>
          </button>
        </td>
        <td className={styles.ptCellMeta}>
          <span className={styles.statusBadge}>{readIssueStatusName(issue)}</span>
        </td>
        <td className={styles.ptCellNum}>{currentPoints != null ? String(currentPoints) : '—'}</td>
        {hasAnchor && (
          <td className={styles.ptCellEstimate}>
            {isAnchor ? (
              <span className={styles.issueMetaText}>anchor</span>
            ) : estimate ? (
              <>
                <strong className={estimate.requiresBreakdown ? styles.ptEstimateBreakdown : undefined}>
                  {estimate.suggestedPoints} pts{estimate.requiresBreakdown ? ' ⚠️' : ''}
                </strong>
                <div className={styles.ptBreakdownTags}>
                  <span>Scope {estimate.featureBreakdown.scopeScore.toFixed(1)}</span>
                  <span>Tech {estimate.featureBreakdown.techComplexityScore.toFixed(1)}</span>
                  <span>Int {estimate.featureBreakdown.integrationRiskScore.toFixed(1)}</span>
                  <span>Unc {estimate.featureBreakdown.uncertaintyScore.toFixed(1)}</span>
                  {estimate.isSparseContent && <span className={styles.ptSparseHint}>sparse — add description</span>}
                </div>
              </>
            ) : null}
          </td>
        )}
        {hasAnchor && (
          <td className={styles.ptCellOverride}>
            {!isAnchor && estimate && (
              <select
                className={styles.settingsInput}
                onChange={(changeEvent) => {
                  const selectedValue = Number(changeEvent.target.value);
                  onOverride(issueKey, selectedValue === estimate.suggestedPoints ? null : selectedValue);
                }}
                value={override ?? estimate.suggestedPoints}
              >
                {storyPointScale.map((scaleValue) => (
                  <option key={scaleValue} value={scaleValue}>{scaleValue}</option>
                ))}
              </select>
            )}
          </td>
        )}
        <td className={styles.ptCellAction}>
          {!hasAnchor ? (
            <details className={styles.ptAnchorDropdown}>
              <summary className={styles.workflowStatusChip}>⚓ Set anchor</summary>
              <div className={styles.ptAnchorPicker}>
                {storyPointScale.map((scaleValue) => (
                  <button
                    className={styles.workflowStatusChip}
                    key={scaleValue}
                    onClick={() => onSetAnchor(issue, scaleValue)}
                    type="button"
                  >
                    {scaleValue}
                  </button>
                ))}
              </div>
            </details>
          ) : isAnchor && saveProgress === 'saved' ? (
            <span className={styles.ptSaveSuccess}>✓ Saved</span>
          ) : isAnchor && anchorPointValue != null ? (
            // Anchor row gets its own save button so a single-issue queue can be pointed.
            <button
              className={styles.secondaryButton}
              disabled={saveProgress === 'saving'}
              onClick={() => void onSave(issueKey, anchorPointValue)}
              type="button"
            >
              {saveProgress === 'saving' ? 'Saving…' : `Save ${anchorPointValue} pts`}
            </button>
          ) : isAnchor ? (
            <span className={styles.issueMetaText}>baseline</span>
          ) : saveProgress === 'saved' ? (
            <span className={styles.ptSaveSuccess}>✓ Saved</span>
          ) : saveProgress === 'error' ? (
            <span className={styles.ptSaveErrorBlock}>
              <span className={styles.ptSaveError} title={saveError}>
                ⚠️ {saveError ?? 'Save failed'}
              </span>
              {effectivePoints != null && (
                <button
                  className={styles.textActionButton}
                  onClick={() => void onSave(issueKey, effectivePoints)}
                  type="button"
                >
                  Retry
                </button>
              )}
            </span>
          ) : effectivePoints != null ? (
            <button
              className={styles.secondaryButton}
              disabled={saveProgress === 'saving'}
              onClick={() => void onSave(issueKey, effectivePoints)}
              type="button"
            >
              {saveProgress === 'saving' ? 'Saving…' : `Save ${effectivePoints} pts`}
            </button>
          ) : null}
        </td>
      </tr>
      {isExpanded && (
        <tr className={styles.ptRowExpanded}>
          <td className={styles.ptCellExpanded} colSpan={99}>
            {detail == null ? (
              <span className={styles.issueMetaText}>Loading details…</span>
            ) : (
              <div className={styles.ptExpandedContent}>
                {detail.parentKey && <p><strong>Parent:</strong> {detail.parentKey}</p>}
                {detail.description ? (
                  <p><strong>Description:</strong>{' '}<span className={styles.ptExpandedBody}>{detail.description}</span></p>
                ) : (
                  <p className={styles.issueMetaText}>No description.</p>
                )}
                {detail.acceptanceCriteria && (
                  <p><strong>Acceptance Criteria:</strong>{' '}<span className={styles.ptExpandedBody}>{detail.acceptanceCriteria}</span></p>
                )}
                <div className={styles.ptExpandedComments}>
                  <strong>Comments</strong>
                  <IssueComments issueKey={issueKey} />
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PointingTab({
  boardType,
  config,
  issues,
  projectKey,
}: {
  boardType: DashboardBoardType;
  config: DashboardConfig;
  issues: JiraIssue[];
  /** Jira project key for the active team — filters the queue to this project's issues only. */
  projectKey: string;
}) {
  const allIssueTypes = useMemo(
    () => Array.from(new Set(issues.map((issue) => readIssueTypeName(issue)))).sort(),
    [issues],
  );
  const allStatuses = useMemo(
    () => Array.from(new Set(issues.map((issue) => readIssueStatusName(issue)))).sort(),
    [issues],
  );
  // Build a set of status names whose issues are in a "done" category so we can default them off.
  // Using statusCategory.key matches Hygiene's "statusCategory != Done" JQL — a status name like
  // "Accepted" may be mapped to a non-done category in custom Jira configurations.
  const doneStatusNames = useMemo(() => {
    const doneNames = new Set<string>();
    for (const issue of issues) {
      if (issue.fields.status.statusCategory.key === 'done') {
        doneNames.add(readIssueStatusName(issue));
      }
    }
    return doneNames;
  }, [issues]);
  const defaultSelectedStatuses = useMemo(
    () => allStatuses.filter((statusName) => !doneStatusNames.has(statusName)),
    [allStatuses, doneStatusNames],
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
      projectKey,
    }),
  );
  const [detailByIssueKey, setDetailByIssueKey] = useState<Record<string, PointingIssueDetail>>({});
  // Cleared by the user via the "Clear" button; intentionally survives filter/sort rebuilds
  // so the same anchor stays active for the whole pointing session.
  const [anchorConfig, setAnchorConfig] = useState<AnchorConfig | null>(null);
  const [overridesByKey, setOverridesByKey] = useState<Record<string, number>>({});
  const [saveProgressByKey, setSaveProgressByKey] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [saveErrorByKey, setSaveErrorByKey] = useState<Record<string, string>>({});
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const storyPointScale = parsePointingScale(config.storyPointScale);

  // Detect whether the configured story points field is a Jira Select (dropdown) rather than a
  // plain number field. Sprint board issues with existing estimates return an object
  // {id, value} for Select fields and a bare number for numeric fields. When all issues are
  // unpointed (null), detection returns false and handleSaveRow falls back via retry.
  const isStoryPointsFieldDropdown = useMemo(() => {
    const storyPointsFieldId = config.customStoryPointsFieldId || 'customfield_10016';
    for (const issue of issues) {
      const rawFieldValue = (issue.fields as Record<string, unknown>)[storyPointsFieldId];
      if (rawFieldValue !== null && rawFieldValue !== undefined && typeof rawFieldValue === 'object') {
        return true;
      }
    }
    return false;
  }, [config.customStoryPointsFieldId, issues]);

  // ── AI Assist state ──
  // Unlock state comes from the shared aiAssistStore (via useAiAssist) so one
  // passphrase entry unlocks every AI Assist surface, including the Admin Hub config.
  const { isUnlocked: isPointingAiAssistUnlocked } = useAiAssist();
  const [isAiAssistModalVisible, setIsAiAssistModalVisible] = useState(false);
  const [generatedAiAssistPromptText, setGeneratedAiAssistPromptText] = useState('');
  const [aiAssistResponseInput, setAiAssistResponseInput] = useState('');
  const [aiAssistResponseParseError, setAiAssistResponseParseError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  // Automated AI Assist exchange for pointing — dispatch the prompt and apply the
  // returned estimates without the manual copy-paste.
  const { isRunning: isPointingAiAssistRunning, runAiAssistExchange: runPointingAiAssistExchange } = useAiAssistExchange();
  const [pointingAiAssistAutoStatus, setPointingAiAssistAutoStatus] = useState<string | null>(null);

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
        projectKey,
      }),
    );
  }

  /** Loads description, AC, and comments for one issue on demand; no-op if already loaded. */
  async function loadIssueDetail(issueKey: string) {
    if (detailByIssueKey[issueKey]) return;
    try {
      const response = await jiraGet<JiraIssue>(`/rest/api/2/issue/${issueKey}?fields=${POINTING_DETAIL_FIELDS}`);
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
      setDetailByIssueKey((previousDetails) => ({
        ...previousDetails,
        [issueKey]: { description: '', acceptanceCriteria: '', comments: [], parentKey: null, parentSummary: null },
      }));
    }
  }

  /** Fetches details for every issue in the queue that hasn't been loaded yet. */
  async function handleLoadAllDetails() {
    setIsLoadingDetails(true);
    try {
      await Promise.allSettled(
        pointingQueue
          .filter((issue) => !detailByIssueKey[issue.key])
          .map((issue) => loadIssueDetail(issue.key)),
      );
    } finally {
      setIsLoadingDetails(false);
    }
  }

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
      projectKey,
    });
    counts[''] = unfilteredQueue.length;
    for (const issue of unfilteredQueue) {
      const role = detectPipelineRole(issue.fields.summary);
      counts[role] += 1;
    }
    return counts;
  }, [config.customStoryPointsFieldId, issues, projectKey, selectedStatuses, selectedTypes, showPointed, sortBy]);

  /** Saves one issue's story points to Jira and records the outcome in per-row state. */
  async function handleSaveRow(issueKey: string, pointValue: number) {
    setSaveProgressByKey((prev) => ({ ...prev, [issueKey]: 'saving' }));
    setSaveErrorByKey((prev) => { const next = { ...prev }; delete next[issueKey]; return next; });
    try {
      const storyPointsFieldId = config.customStoryPointsFieldId || 'customfield_10016';

      // Jira Select (dropdown) fields require {value: "N"} format; plain number fields take a bare number.
      // Detection uses existing field values from sprint board issues; falls back to bare number
      // and retries as dropdown if Jira returns a 400 format error (covers the all-unpointed case).
      const dropdownPayload = { value: String(pointValue) };
      const numericPayload = pointValue;
      const primaryPayload = isStoryPointsFieldDropdown ? dropdownPayload : numericPayload;

      try {
        await jiraPut(`/rest/api/2/issue/${issueKey}`, { fields: { [storyPointsFieldId]: primaryPayload } });
      } catch (firstAttemptError) {
        // If the number format bounced back with a Jira field-format error, silently retry
        // using the dropdown object format — avoids requiring users to reconfigure Settings.
        const firstMessage = firstAttemptError instanceof Error ? firstAttemptError.message : '';
        const isJiraFormatError = !isStoryPointsFieldDropdown
          && firstMessage.includes('400')
          && (firstMessage.toLowerCase().includes('value') || firstMessage.toLowerCase().includes('id'));

        if (!isJiraFormatError) throw firstAttemptError;
        await jiraPut(`/rest/api/2/issue/${issueKey}`, { fields: { [storyPointsFieldId]: dropdownPayload } });
      }

      setSaveProgressByKey((prev) => ({ ...prev, [issueKey]: 'saved' }));
      setPointingQueue((previousQueue) =>
        showPointed
          ? previousQueue.map((queuedIssue) =>
              queuedIssue.key === issueKey
                ? { ...queuedIssue, fields: { ...queuedIssue.fields, [storyPointsFieldId]: pointValue } }
                : queuedIssue,
            )
          : previousQueue.filter((queuedIssue) => queuedIssue.key !== issueKey),
      );
    } catch (caughtError) {
      setSaveProgressByKey((prev) => ({ ...prev, [issueKey]: 'error' }));
      // Strip the verbose "Jira PUT /path failed: " prefix — keep only the status + Jira message.
      const rawMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
      const failedIndex = rawMessage.indexOf(' failed: ');
      setSaveErrorByKey((prev) => ({
        ...prev,
        [issueKey]: failedIndex !== -1 ? rawMessage.slice(failedIndex + ' failed: '.length) : rawMessage,
      }));
    }
  }

  function handleOverride(issueKey: string, pointValue: number | null) {
    setOverridesByKey((prev) => {
      const next = { ...prev };
      if (pointValue == null) { delete next[issueKey]; } else { next[issueKey] = pointValue; }
      return next;
    });
  }

  /** Expands or collapses a row's detail section; triggers a detail load on first expand. */
  function toggleExpandedRow(issueKey: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(issueKey)) { next.delete(issueKey); } else { next.add(issueKey); }
      return next;
    });
    void loadIssueDetail(issueKey);
  }

  /**
   * Sets the chosen table row as the complexity anchor, then background-loads all
   * issue details so the algorithm has full text rather than just sprint-field summaries.
   */
  function handleSetAnchorFromRow(issue: JiraIssue, anchorPointValue: number) {
    const detail = detailByIssueKey[issue.key];
    setAnchorConfig({
      issueKey: issue.key,
      pointValue: anchorPointValue,
      features: extractIssueFeatures(
        issue.fields.summary ?? '',
        detail?.description ?? normalizeCommentBody(issue.fields.description),
        detail?.acceptanceCriteria ?? '',
        (issue.fields.issuelinks ?? []).length,
      ),
    });
    void handleLoadAllDetails();
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

  // Batch algorithm: computes estimates for every non-anchor issue in the queue.
  // Placed before the early return so this hook is always called in the same order.
  const allEstimates = useMemo((): Record<string, PointingEstimateResult> => {
    if (!anchorConfig) return {};
    const estimatesByKey: Record<string, PointingEstimateResult> = {};
    for (const issue of pointingQueue) {
      if (issue.key === anchorConfig.issueKey) continue;
      estimatesByKey[issue.key] = computeSingleEstimate(
        issue, anchorConfig, detailByIssueKey[issue.key], storyPointScale,
      );
    }
    return estimatesByKey;
  }, [anchorConfig, pointingQueue, detailByIssueKey, storyPointScale]);

  /** Saves all rows that have an estimate (or override) and have not yet been saved.
   *  Includes the anchor row (using its manually chosen point value) so a single-issue queue
   *  can be fully saved. Processes in batches to avoid overwhelming Jira's API. */
  async function handleSaveAll() {
    const rowsToSave: Array<{ key: string; pointValue: number }> = [];

    // Always include the anchor with its manually chosen value if it hasn't been saved yet.
    if (anchorConfig && saveProgressByKey[anchorConfig.issueKey] !== 'saved') {
      rowsToSave.push({ key: anchorConfig.issueKey, pointValue: anchorConfig.pointValue });
    }

    // Include all non-anchor rows that have an estimate or manual override.
    for (const issue of pointingQueue) {
      if (issue.key === anchorConfig?.issueKey) continue;
      const pointValue = overridesByKey[issue.key] ?? allEstimates[issue.key]?.suggestedPoints;
      if (pointValue != null && saveProgressByKey[issue.key] !== 'saved') {
        rowsToSave.push({ key: issue.key, pointValue });
      }
    }

    // Process in SAVE_ALL_BATCH_SIZE-wide windows so Jira's rate limiter is never saturated.
    for (let batchStart = 0; batchStart < rowsToSave.length; batchStart += SAVE_ALL_BATCH_SIZE) {
      const batch = rowsToSave.slice(batchStart, batchStart + SAVE_ALL_BATCH_SIZE);
      await Promise.allSettled(
        batch.map(({ key, pointValue }) => handleSaveRow(key, pointValue)),
      );
    }
  }

  // ── AI Assist handlers ──

  /** Builds the prompt from current queue state and opens the two-panel AI Assist modal. */
  function handleOpenAiAssistModal() {
    if (!anchorConfig) return;
    const anchorIssue = pointingQueue.find((issue) => issue.key === anchorConfig.issueKey);
    if (!anchorIssue) return;
    const nonAnchorIssues = pointingQueue.filter((issue) => issue.key !== anchorConfig.issueKey);
    setGeneratedAiAssistPromptText(
      buildPointingAiAssistPrompt(anchorIssue, anchorConfig, nonAnchorIssues, allEstimates, detailByIssueKey, storyPointScale),
    );
    setAiAssistResponseInput('');
    setAiAssistResponseParseError(null);
    setIsCopied(false);
    setIsAiAssistModalVisible(true);
  }

  /** Copies the generated prompt to the clipboard and briefly shows a confirmation label. */
  async function handleCopyAiAssistPrompt() {
    await navigator.clipboard.writeText(generatedAiAssistPromptText);
    setIsCopied(true);
    // Reset the copy button label after two seconds so it can be clicked again.
    setTimeout(() => setIsCopied(false), 2000);
  }

  /**
   * Parses AI Assist's JSON response and maps each valid entry to the override column.
   * Closes the modal on success so the user can review and save at their own pace.
   */
  function applyAiAssistResponse(responseText: string) {
    const validQueueKeys = new Set(
      pointingQueue
        .filter((issue) => issue.key !== anchorConfig?.issueKey)
        .map((issue) => issue.key),
    );
    const { items, errorMessage } = parseAiAssistPointingResponse(responseText, validQueueKeys, storyPointScale);

    if (errorMessage) {
      setAiAssistResponseParseError(errorMessage);
      return;
    }

    setOverridesByKey((previousOverrides) => {
      const nextOverrides = { ...previousOverrides };
      for (const item of items) {
        nextOverrides[item.key] = item.points;
      }
      return nextOverrides;
    });
    setIsAiAssistModalVisible(false);
    setAiAssistResponseInput('');
    setAiAssistResponseParseError(null);
  }

  // Automated path: dispatch the pointing prompt to AI Assist, then apply the returned
  // estimates directly — no manual paste.
  async function handleRunPointingAiAssistAuto() {
    setPointingAiAssistAutoStatus('Sending to AI Assist…');
    const exchange = await runPointingAiAssistExchange(generatedAiAssistPromptText);
    if (!exchange.ok) {
      setPointingAiAssistAutoStatus(exchange.message);
      return;
    }
    setPointingAiAssistAutoStatus(null);
    applyAiAssistResponse(exchange.response ?? '');
  }

  if (issues.length === 0) {
    return <DashboardEmptyState message="Load a board first from Settings to start pointing." />;
  }

  const estimatedCount = Object.keys(allEstimates).length;
  const savedCount = Object.values(saveProgressByKey).filter((s) => s === 'saved').length;
  const hasAnyUnsavedEstimate = anchorConfig != null && (
    // The anchor itself is unsaved (covers the single-issue case).
    saveProgressByKey[anchorConfig.issueKey] !== 'saved'
    || pointingQueue.some((issue) => {
      if (issue.key === anchorConfig.issueKey) return false;
      const pointValue = overridesByKey[issue.key] ?? allEstimates[issue.key]?.suggestedPoints;
      return pointValue != null && saveProgressByKey[issue.key] !== 'saved';
    })
  );

  return (
    <DashboardTabShell
      title="Story Pointing"
      description="Set an anchor issue to calibrate estimates, then review, override, and save — all from one table."
      stats={(
        <div className={styles.flowStatsBar}>
          <StatChip label="Queue" value={pointingQueue.length} />
          <StatChip label="Estimated" value={estimatedCount} />
          <StatChip label="Saved" value={savedCount} />
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

      {/* Session anchor banner — shows current anchor and batch action buttons. */}
      {anchorConfig ? (
        <div className={styles.pointingAnchorBanner}>
          <span>⚓ Anchor: <strong>{anchorConfig.issueKey}</strong> = <strong>{anchorConfig.pointValue} pts</strong></span>
          <button
            className={styles.workflowStatusChip}
            onClick={() => setAnchorConfig(null)}
            type="button"
          >
            Clear anchor
          </button>
          <button
            className={styles.workflowStatusChip}
            disabled={isLoadingDetails}
            onClick={() => void handleLoadAllDetails()}
            type="button"
          >
            {isLoadingDetails ? 'Loading…' : 'Load all details'}
          </button>
          {hasAnyUnsavedEstimate && (
            <button
              className={styles.secondaryButton}
              onClick={() => void handleSaveAll()}
              type="button"
            >
              Save All
            </button>
          )}
          {isPointingAiAssistUnlocked && (
            <button
              className={styles.secondaryButton}
              onClick={handleOpenAiAssistModal}
              type="button"
            >
              {POINTING_AI_ASSIST_ENHANCE_BUTTON_LABEL}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.pointingHintBanner}>
          Click <strong>⚓ Set anchor</strong> on any row to begin estimating — pick an issue whose complexity you already know.
        </div>
      )}

      {/* Empty state */}
      {pointingQueue.length === 0 && (
        <DashboardEmptyState message="No issues match the current pointing filters." />
      )}

      {/* Pointing table */}
      {pointingQueue.length > 0 && (
        <div className={styles.ptTableWrapper}>
          <table className={styles.ptTable}>
            <thead>
              <tr>
                <th className={styles.ptHeadKey}>Key / Type</th>
                <th className={styles.ptHeadSummary}>Summary ▼ to expand</th>
                <th className={styles.ptHeadMeta}>Status</th>
                <th className={styles.ptHeadNum}>Current</th>
                {anchorConfig && <th className={styles.ptHeadEstimate}>Estimate</th>}
                {anchorConfig && <th className={styles.ptHeadOverride}>Override</th>}
                <th className={styles.ptHeadAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pointingQueue.map((issue) => (
                <PointingTableRow
                  key={issue.key}
                  anchorPointValue={issue.key === anchorConfig?.issueKey ? anchorConfig?.pointValue : undefined}
                  customStoryPointsFieldId={config.customStoryPointsFieldId}
                  detail={detailByIssueKey[issue.key]}
                  estimate={allEstimates[issue.key]}
                  hasAnchor={anchorConfig != null}
                  isAnchor={issue.key === anchorConfig?.issueKey}
                  isExpanded={expandedKeys.has(issue.key)}
                  issue={issue}
                  onOverride={handleOverride}
                  onSave={handleSaveRow}
                  onSetAnchor={handleSetAnchorFromRow}
                  onToggleExpand={() => toggleExpandedRow(issue.key)}
                  override={overridesByKey[issue.key]}
                  saveError={saveErrorByKey[issue.key]}
                  saveProgress={saveProgressByKey[issue.key] ?? 'idle'}
                  storyPointScale={storyPointScale}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Assist modal — two panels: copy prompt / paste response */}
      {isAiAssistModalVisible ? (
        <div aria-modal="true" className={styles.releasePromptOverlay} role="dialog">
          <div className={styles.ptAiAssistModal}>
            <h3 className={styles.releasePromptTitle}>✦ AI-Assisted Pointing</h3>

            <section className={styles.ptAiAssistSection}>
              <p className={styles.releasePromptInstructions}>
                <strong>Step 1</strong> — Copy this prompt into AI Assist. It includes the anchor story,
                all queue issues, and their algorithm estimates as a starting point.
              </p>
              <textarea
                aria-label="AI Assist pointing prompt"
                className={styles.releasePromptTextArea}
                readOnly
                value={generatedAiAssistPromptText}
              />
              <div className={styles.releasePromptActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={isPointingAiAssistRunning}
                  onClick={() => void handleRunPointingAiAssistAuto()}
                  type="button"
                >
                  {isPointingAiAssistRunning ? '⏳ Running via AI Assist…' : '⚡ Run via AI Assist (auto)'}
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => void handleCopyAiAssistPrompt()}
                  type="button"
                >
                  {isCopied ? '✓ Copied!' : POINTING_AI_ASSIST_COPY_BUTTON_LABEL}
                </button>
              </div>
              {pointingAiAssistAutoStatus !== null ? (
                <p className={styles.releasePromptInstructions} role="status">{pointingAiAssistAutoStatus}</p>
              ) : null}
            </section>

            <hr className={styles.ptAiAssistDivider} />

            <section className={styles.ptAiAssistSection}>
              <p className={styles.releasePromptInstructions}>
                <strong>Step 2</strong> — Paste AI Assist's JSON response below. Toolbox will apply
                the estimates to the Override column so you can review each value before saving.
              </p>
              <textarea
                aria-label="AI Assist pointing response"
                className={styles.ptAiAssistResponseTextArea}
                onChange={(changeEvent) => {
                  setAiAssistResponseInput(changeEvent.target.value);
                  setAiAssistResponseParseError(null);
                }}
                placeholder={'[\n  { "key": "PROJ-123", "points": 5, "reasoning": "..." },\n  ...\n]'}
                value={aiAssistResponseInput}
              />
              {aiAssistResponseParseError ? (
                <p className={styles.errorMessage}>{aiAssistResponseParseError}</p>
              ) : null}
              <div className={styles.releasePromptActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={aiAssistResponseInput.trim() === ''}
                  onClick={() => applyAiAssistResponse(aiAssistResponseInput)}
                  type="button"
                >
                  {POINTING_AI_ASSIST_APPLY_BUTTON_LABEL}
                </button>
                <button
                  className={styles.textActionButton}
                  onClick={() => setIsAiAssistModalVisible(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : null}
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
            // Toggle this planning row and lazy-load its detail on first expand.
            // Shared by the whole-row click and keyboard handlers.
            const toggleThisPlanning = () => {
              const nextExpanded = isExpanded ? null : planningIssue.key;
              setExpandedIssueKey(nextExpanded);
              if (nextExpanded) {
                void loadPlanningDetail(planningIssue);
              }
            };
            return (
              <div className={styles.issueCardWrapper} key={planningIssue.key}>
                {/* Whole bar is clickable — the chevron is now a visual affordance only. */}
                <div
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${planningIssue.key}`}
                  className={`${styles.blockerCard} ${styles.clickableRow}`}
                  onClick={toggleThisPlanning}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                      keyEvent.preventDefault();
                      toggleThisPlanning();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
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
                    onClick={(clickEvent) => {
                      // Flagging follow-up must not also expand/collapse the row.
                      clickEvent.stopPropagation();
                      setFollowUpIssueKeys((previousKeys) => previousKeys.includes(planningIssue.key)
                        ? previousKeys.filter((previousKey) => previousKey !== planningIssue.key)
                        : [...previousKeys, planningIssue.key]);
                    }}
                    title={followUpIssueKeys.includes(planningIssue.key) ? 'Click to remove follow-up flag' : 'Click to flag for follow-up'}
                    type="button"
                  >
                    Follow-up
                  </button>
                  <span aria-hidden="true" className={styles.expandToggleButton}>
                    {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
                  </span>
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
  teamName,
  scopeMode,
  selectedSprintId,
  selectedFixVersionName,
  selectedPiValue,
}: {
  projectKey: string;
  teamName: string;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
}) {
  // Unlock state comes from the shared aiAssistStore (via useAiAssist) so one
  // passphrase entry unlocks every AI Assist surface, including the Admin Hub config.
  const { isUnlocked: isReleaseAiAssistUnlocked } = useAiAssist();
  const [releaseEntries, setReleaseEntries] = useState<ReleaseRadarEntry[]>([]);
  const [isLoadingReleaseRadar, setIsLoadingReleaseRadar] = useState(false);
  const [releaseRadarError, setReleaseRadarError] = useState<string | null>(null);
  const [expandedReleaseIds, setExpandedReleaseIds] = useState<Record<string, boolean>>({});
  const [releaseNotesByVersionId, setReleaseNotesByVersionId] = useState<Record<string, ReleaseAiAssistTableDocument>>(
    () => readStoredReleaseNotes(projectKey),
  );

  const [releasePromptModalState, setReleasePromptModalState] = useState<ReleasePromptModalState | null>(null);
  const [releaseImportModalState, setReleaseImportModalState] = useState<ReleaseImportModalState | null>(null);
  const [releaseExportErrorByVersionId, setReleaseExportErrorByVersionId] = useState<Record<string, string>>({});
  const [releaseCopyConfirmationByVersionId, setReleaseCopyConfirmationByVersionId] = useState<Record<string, string>>({});
  // Automated AI Assist exchange for release notes — dispatches the prompt and renders
  // the parsed table without the manual copy-paste.
  const { isRunning: isReleaseAiAssistRunning, runAiAssistExchange: runReleaseAiAssistExchange } = useAiAssistExchange();
  const [releaseAiAssistAutoStatus, setReleaseAiAssistAutoStatus] = useState<string | null>(null);
  // Dev-skip test-risk assessment: raw Markdown reports keyed by fix-version id, plus its own
  // prompt modal and status line. It reuses the shared AI Assist exchange above.
  const [devSkipRiskByVersionId, setDevSkipRiskByVersionId] = useState<Record<string, string>>(
    () => readStoredDevSkipRisk(projectKey),
  );
  const [devSkipRiskPromptModalState, setDevSkipRiskPromptModalState] = useState<ReleasePromptModalState | null>(null);
  const [devSkipRiskAutoStatus, setDevSkipRiskAutoStatus] = useState<string | null>(null);
  const releaseNotesSectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setReleaseNotesByVersionId(readStoredReleaseNotes(projectKey));
    setDevSkipRiskByVersionId(readStoredDevSkipRisk(projectKey));
    setReleaseExportErrorByVersionId({});
    setReleaseCopyConfirmationByVersionId({});
    setReleasePromptModalState(null);
    setReleaseImportModalState(null);
    setDevSkipRiskPromptModalState(null);
    setDevSkipRiskAutoStatus(null);
  }, [projectKey]);

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
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(
      buildDevSkipRiskStorageKey(projectKey),
      JSON.stringify(devSkipRiskByVersionId),
    );
  }, [projectKey, devSkipRiskByVersionId]);

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

  const atRiskCount = releaseEntries.filter(
    (entry) => entry.bucket === 'overdue' || entry.bucket === 'critical',
  ).length;
  const watchCount = releaseEntries.filter((entry) => entry.bucket === 'watch').length;
  const onTrackCount = releaseEntries.filter((entry) => entry.bucket === 'ontrack').length;
  const unscheduledCount = releaseEntries.filter((entry) => entry.bucket === 'nodate').length;

  const handleBuildReleasePrompt = useCallback((releaseEntry: ReleaseRadarEntry) => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const promptInput = buildReleasePromptInput(normalizedProjectKey, releaseEntry);
    const promptText = buildReleaseAiAssistPrompt(promptInput);

    setReleasePromptModalState({
      versionId: releaseEntry.version.id,
      versionName: releaseEntry.version.name,
      promptText,
    });
  }, [projectKey]);

  // Automated path: dispatch the shown release prompt to AI Assist, parse the returned
  // table, and render it — no manual paste step.
  const handleRunReleaseAiAssistAuto = useCallback(async () => {
    if (!releasePromptModalState) return;
    const { versionId, promptText } = releasePromptModalState;

    setReleaseAiAssistAutoStatus('Sending to AI Assist…');
    const exchange = await runReleaseAiAssistExchange(promptText);
    if (!exchange.ok) {
      setReleaseAiAssistAutoStatus(exchange.message);
      return;
    }

    try {
      const parsedReleaseNotes = parseReleaseAiAssistResponse(exchange.response ?? '');
      setReleaseNotesByVersionId((previousReleaseNotesByVersionId) => ({
        ...previousReleaseNotesByVersionId,
        [versionId]: parsedReleaseNotes,
      }));
      setReleaseAiAssistAutoStatus(null);
      setReleasePromptModalState(null);
    } catch (caughtError) {
      setReleaseAiAssistAutoStatus(caughtError instanceof Error ? caughtError.message : 'Unable to parse the AI Assist response.');
    }
  }, [releasePromptModalState, runReleaseAiAssistExchange]);

  // Builds the dev-skip test-risk prompt for one release and opens its prompt modal.
  const handleBuildDevSkipRiskPrompt = useCallback((releaseEntry: ReleaseRadarEntry) => {
    const normalizedProjectKey = projectKey.trim().toUpperCase();
    const promptInput = buildDevSkipRiskPromptInput(normalizedProjectKey, releaseEntry);
    const promptText = buildDevSkipRiskAssistPrompt(promptInput);

    setDevSkipRiskAutoStatus(null);
    setDevSkipRiskPromptModalState({
      versionId: releaseEntry.version.id,
      versionName: releaseEntry.version.name,
      promptText,
    });
  }, [projectKey]);

  // Automated path: dispatch the risk prompt to AI Assist and store the returned Markdown report
  // as-is (no strict parsing — the assessment is rendered read-only from Markdown).
  const handleRunDevSkipRiskAuto = useCallback(async () => {
    if (!devSkipRiskPromptModalState) return;
    const { versionId, promptText } = devSkipRiskPromptModalState;

    setDevSkipRiskAutoStatus('Sending to AI Assist…');
    const exchange = await runReleaseAiAssistExchange(promptText);
    if (!exchange.ok) {
      setDevSkipRiskAutoStatus(exchange.message);
      return;
    }

    const reportMarkdown = (exchange.response ?? '').trim();
    if (!reportMarkdown) {
      setDevSkipRiskAutoStatus('AI Assist returned an empty response.');
      return;
    }

    setDevSkipRiskByVersionId((previousReports) => ({
      ...previousReports,
      [versionId]: reportMarkdown,
    }));
    setDevSkipRiskAutoStatus(null);
    setDevSkipRiskPromptModalState(null);
  }, [devSkipRiskPromptModalState, runReleaseAiAssistExchange]);

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
      const parsedReleaseNotes = parseReleaseAiAssistResponse(releaseImportModalState.responseText);
      setReleaseNotesByVersionId((previousReleaseNotesByVersionId) => ({
        ...previousReleaseNotesByVersionId,
        [releaseImportModalState.versionId]: parsedReleaseNotes,
      }));
      setReleaseImportModalState(null);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Unable to parse the AI Assist response.';
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

  // Copies the rendered release-notes section to the clipboard as BOTH a reflowable HTML table and
  // an image, so email pastes a readable native table while chat tools fall back to the picture.
  // The report carries the team/release identity only — no AI or tooling wording.
  const handleCopyReleaseNotes = useCallback(async (
    versionId: string,
    fixVersionName: string,
    releaseDocument: ReleaseAiAssistTableDocument,
  ) => {
    const releaseNotesSectionElement = releaseNotesSectionRefs.current[versionId];
    if (!releaseNotesSectionElement) {
      setReleaseExportErrorByVersionId((previousExportErrors) => ({
        ...previousExportErrors,
        [versionId]: 'Render the release notes before copying them.',
      }));
      return;
    }

    // Clear any prior outcome so the user sees the result of this attempt only.
    setReleaseExportErrorByVersionId((previousExportErrors) => ({ ...previousExportErrors, [versionId]: '' }));
    setReleaseCopyConfirmationByVersionId((previousConfirmations) => ({ ...previousConfirmations, [versionId]: '' }));

    try {
      const reportHeading = buildReleaseNotesHeading(teamName, fixVersionName);
      const reportHtml = buildReleaseNotesHtml(reportHeading, releaseDocument);
      await copyElementReportToClipboard(
        releaseNotesSectionElement,
        reportHtml,
        'The release notes section is no longer available to copy.',
      );
      setReleaseCopyConfirmationByVersionId((previousConfirmations) => ({
        ...previousConfirmations,
        [versionId]: RELEASE_NOTES_COPIED_CONFIRMATION,
      }));
    } catch (caughtError) {
      setReleaseExportErrorByVersionId((previousExportErrors) => ({
        ...previousExportErrors,
        [versionId]: caughtError instanceof Error ? caughtError.message : 'Unable to copy the release notes.',
      }));
    }
  }, [teamName]);

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
                  const devSkipRiskReport = devSkipRiskByVersionId[entry.version.id] ?? null;
                  const releaseExportError = releaseExportErrorByVersionId[entry.version.id] ?? '';
                  const releaseCopyConfirmation = releaseCopyConfirmationByVersionId[entry.version.id] ?? '';
                  const issueByKey = new Map(entry.issues.map((issue) => [issue.key, issue]));
                  // Only releases with linked issues can expand; when they can, the
                  // whole header bar toggles the issue list (the labeled button below stays too).
                  const canExpandRelease = entry.totalCount > 0;
                  const toggleThisRelease = () =>
                    setExpandedReleaseIds((previousExpandedReleaseIds) => ({
                      ...previousExpandedReleaseIds,
                      [entry.version.id]: !isExpanded,
                    }));

                  return (
                    <article className={styles.releaseCard} key={entry.version.id}>
                      {/* Header bar is clickable when the release has issues to reveal. */}
                      <div
                        aria-expanded={canExpandRelease ? isExpanded : undefined}
                        aria-label={canExpandRelease ? `${isExpanded ? 'Collapse' : 'Expand'} issues for ${entry.version.name}` : undefined}
                        className={canExpandRelease ? `${styles.releaseCardHeader} ${styles.clickableRow}` : styles.releaseCardHeader}
                        onClick={canExpandRelease ? toggleThisRelease : undefined}
                        onKeyDown={canExpandRelease ? (keyEvent) => {
                          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                            keyEvent.preventDefault();
                            toggleThisRelease();
                          }
                        } : undefined}
                        role={canExpandRelease ? 'button' : undefined}
                        tabIndex={canExpandRelease ? 0 : undefined}
                      >
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

                      {isReleaseAiAssistUnlocked && (
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
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleBuildDevSkipRiskPrompt(entry)}
                            type="button"
                          >
                            {RELEASE_DEV_SKIP_RISK_BUTTON_LABEL}
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
                              <h4 className={styles.releaseNotesTitle}>
                                {buildReleaseNotesHeading(teamName, entry.version.name)}
                              </h4>
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
                                onClick={() => void handleCopyReleaseNotes(entry.version.id, entry.version.name, importedReleaseNotes)}
                                type="button"
                              >
                                {COPY_RELEASE_NOTES_BUTTON_LABEL}
                              </button>
                            </div>
                          </div>
                          {releaseExportError ? <p className={styles.errorMessage}>{releaseExportError}</p> : null}
                          {releaseCopyConfirmation ? (
                            <p className={styles.releaseNotesCopyConfirmation} data-export-exclude="true">
                              {releaseCopyConfirmation}
                            </p>
                          ) : null}
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

                      {devSkipRiskReport && (
                        <section className={styles.releaseRiskSection}>
                          <div className={styles.releaseRiskHeader}>
                            <h4 className={styles.releaseNotesTitle}>
                              Dev-Skip Test Risk — {entry.version.name}
                            </h4>
                            <button
                              className={styles.textActionButton}
                              onClick={() =>
                                setDevSkipRiskByVersionId((previousReports) => {
                                  const nextReports = { ...previousReports };
                                  delete nextReports[entry.version.id];
                                  return nextReports;
                                })}
                              type="button"
                            >
                              Clear
                            </button>
                          </div>
                          <div className={styles.releaseRiskMarkdown}>
                            {renderMarkdownReport(devSkipRiskReport)}
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

      {releasePromptModalState ? (
        <div
          aria-modal="true"
          className={styles.releasePromptOverlay}
          role="dialog"
        >
          <div className={styles.releasePromptWideModal}>
            <h3 className={styles.releasePromptTitle}>
              AI Assist prompt for {releasePromptModalState.versionName}
            </h3>
            <p className={styles.releasePromptInstructions}>
              Copy this prompt into AI Assist, then paste the JSON response back into Toolbox to render the release-notes table.
            </p>
            <textarea
              aria-label="AI Assist release prompt"
              className={styles.releasePromptTextArea}
              readOnly
              value={releasePromptModalState.promptText}
            />
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                disabled={isReleaseAiAssistRunning}
                onClick={() => void handleRunReleaseAiAssistAuto()}
                type="button"
              >
                {isReleaseAiAssistRunning ? '⏳ Running via AI Assist…' : '⚡ Run via AI Assist (auto)'}
              </button>
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
            {releaseAiAssistAutoStatus !== null ? (
              <p className={styles.releasePromptInstructions} role="status">{releaseAiAssistAutoStatus}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {devSkipRiskPromptModalState ? (
        <div
          aria-modal="true"
          className={styles.releasePromptOverlay}
          role="dialog"
        >
          <div className={styles.releasePromptWideModal}>
            <h3 className={styles.releasePromptTitle}>
              Dev-Skip Test Risk prompt for {devSkipRiskPromptModalState.versionName}
            </h3>
            <p className={styles.releasePromptInstructions}>
              Assesses the risk of skipping Dev-environment testing and promoting straight to Integration.
              Run it via AI Assist, or copy the prompt to run it manually — the Markdown report renders below the release.
            </p>
            <textarea
              aria-label="Dev-skip test risk prompt"
              className={styles.releasePromptTextArea}
              readOnly
              value={devSkipRiskPromptModalState.promptText}
            />
            <div className={styles.releasePromptActions}>
              <button
                className={styles.secondaryButton}
                disabled={isReleaseAiAssistRunning}
                onClick={() => void handleRunDevSkipRiskAuto()}
                type="button"
              >
                {isReleaseAiAssistRunning ? '⏳ Running via AI Assist…' : '⚡ Run via AI Assist (auto)'}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => void navigator.clipboard.writeText(devSkipRiskPromptModalState.promptText)}
                type="button"
              >
                {COPY_RELEASE_PROMPT_BUTTON_LABEL}
              </button>
              <button
                className={styles.textActionButton}
                onClick={() => setDevSkipRiskPromptModalState(null)}
                type="button"
              >
                Close
              </button>
            </div>
            {devSkipRiskAutoStatus !== null ? (
              <p className={styles.releasePromptInstructions} role="status">{devSkipRiskAutoStatus}</p>
            ) : null}
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
              Paste AI Assist response for {releaseImportModalState.versionName}
            </h3>
            <p className={styles.releasePromptInstructions}>
              Paste the JSON response from AI Assist. Toolbox will parse it and render a release-notes table for this release.
            </p>
            <textarea
              aria-label="AI Assist release response"
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
  const revertActiveDashboardTeamProfile = useSettingsStore(
    (storeState) => storeState.revertActiveSprintDashboardTeamProfile,
  );
  const dashboardHydrationNonce = useSettingsStore(
    (storeState) => storeState.sprintDashboardHydrationNonce,
  );
  const activeDashboardTeamProfile = useMemo(
    () =>
      dashboardTeamProfiles.find(
        (teamProfile) => teamProfile.id === activeDashboardTeamProfileId,
      ) ?? null,
    [activeDashboardTeamProfileId, dashboardTeamProfiles],
  );
  const { config, actions: configActions } = useDashboardConfig(activeDashboardTeamProfileId);
  const { state, actions } = useSprintData(
    activeDashboardTeamProfileId,
    config.customStoryPointsFieldId,
    dashboardHydrationNonce,
  );
  const { loadSprint } = actions;
  const hasAttemptedRestoreLoad = useRef(false);
  const tabPanelRef = useRef<HTMLElement | null>(null);

  // Local state for the board picker search field — not persisted, just UI.
  const [boardSearchQuery, setBoardSearchQuery] = useState('');
  // When the user tries to switch teams with unsaved draft changes, we hold the target team id
  // here and surface a confirm prompt rather than silently discarding their edits.
  const [pendingTeamSwitchId, setPendingTeamSwitchId] = useState<string | null>(null);

  useEffect(() => {
    useStandupRosterStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
    useStandupPlanningStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
    useCapacityStore.getState().setDashboardTeamProfileId(activeDashboardTeamProfileId);
  }, [activeDashboardTeamProfileId]);

  // Reset the one-shot restore guard whenever the active team changes (id) or the draft is
  // re-hydrated by a Revert (nonce), so the restored selection reloads.
  useEffect(() => {
    hasAttemptedRestoreLoad.current = false;
  }, [activeDashboardTeamProfileId, dashboardHydrationNonce]);

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
      piReviewPages: state.piReviewPages,
    };
    const preservedTeamProfiles = shouldCreateNewTeam
      ? dashboardTeamProfiles
      : dashboardTeamProfiles.filter((teamProfile) => teamProfile.id !== nextTeamProfile.id);
    setDashboardTeamProfiles([...preservedTeamProfiles, nextTeamProfile]);
    setActiveDashboardTeamProfileId(nextTeamProfile.id);
    // The working selection is now saved to this team, so clear the unsaved-changes flag.
    actions.markTeamChangesSaved();
  }

  // Saves the current working selection into the active team profile (the header "Save" action).
  function handleSaveActiveTeamChanges() {
    if (!activeDashboardTeamProfile) {
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
      piReviewPages: state.piReviewPages,
    });
    actions.markTeamChangesSaved();
  }

  // Discards unsaved draft edits and reloads the active team's saved configuration.
  function handleRevertActiveTeamChanges() {
    revertActiveDashboardTeamProfile();
  }

  // Routes every team switch through an unsaved-changes guard so a team's saved config is never
  // silently lost. When the draft is clean, the switch happens immediately.
  function handleActivateDashboardTeam(teamProfileId: string) {
    if (teamProfileId === activeDashboardTeamProfileId) {
      return;
    }
    if (state.hasUnsavedTeamChanges) {
      setPendingTeamSwitchId(teamProfileId);
      return;
    }
    setActiveDashboardTeamProfileId(teamProfileId);
  }

  function confirmPendingTeamSwitch() {
    if (pendingTeamSwitchId !== null) {
      setActiveDashboardTeamProfileId(pendingTeamSwitchId);
    }
    setPendingTeamSwitchId(null);
  }

  function cancelPendingTeamSwitch() {
    setPendingTeamSwitchId(null);
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
          dashboardScopeMode={state.scopeMode}
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
        <TeamDashboardHygieneTab
          projectKey={state.projectKey}
          scopeMode={state.scopeMode}
          selectedFixVersionName={state.selectedFixVersionName}
          selectedPiValue={state.selectedPiValue}
          selectedSprintId={state.selectedSprintId}
        />
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
          projectKey={state.projectKey}
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
          riskImpactDateFieldId={config.riskImpactDateFieldId}
          riskResponseFieldId={config.riskResponseFieldId}
          selectedPiName={state.selectedPiValue}
          sprintIssues={state.sprintIssues}
        />
      );
    }

    if (activeTab === 'backlogremediation') {
      return (
        <BacklogRemediationPanel
          teamProfileId={activeDashboardTeamProfileId}
          projectKey={state.projectKey}
          piName={state.selectedPiValue}
        />
      );
    }

    if (activeTab === 'releases') {
      return (
        <ReleasesTab
          projectKey={state.projectKey}
          teamName={activeDashboardTeamProfile?.name ?? ''}
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
        onActivateDashboardTeam={handleActivateDashboardTeam}
        onBoardSearchChange={setBoardSearchQuery}
        onConfigChange={configActions.updateConfig}
        onLoadSprint={actions.loadSprint}
        onProjectKeyChange={actions.setProjectKey}
        onRemoveDashboardTeam={handleRemoveDashboardTeam}
        onSaveDashboardTeam={handleSaveDashboardTeam}
        onSelectBoard={actions.selectBoard}
        piReviewPages={state.piReviewPages}
        availablePiValues={state.availablePiValues}
        onAddPiReviewPage={actions.addPiReviewPage}
        onUpdatePiReviewPage={actions.updatePiReviewPage}
        onRemovePiReviewPage={actions.removePiReviewPage}
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
            onChange={(changeEvent) => handleActivateDashboardTeam(changeEvent.target.value)}
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
          {activeDashboardTeamProfile && state.hasUnsavedTeamChanges ? (
            <div className={styles.teamUnsavedBar} role="status">
              <span className={styles.teamUnsavedBadge}>● Unsaved changes</span>
              <button
                className={styles.secondaryButton}
                onClick={handleSaveActiveTeamChanges}
                type="button"
              >
                Save to {activeDashboardTeamProfile.name}
              </button>
              <button
                className={styles.textActionButton}
                onClick={handleRevertActiveTeamChanges}
                type="button"
              >
                Revert
              </button>
            </div>
          ) : null}
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

      {pendingTeamSwitchId !== null ? (
        <div aria-modal="true" className={styles.teamSwitchOverlay} role="dialog">
          <div className={styles.teamSwitchModal}>
            <h3 className={styles.teamSwitchTitle}>Discard unsaved changes?</h3>
            <p className={styles.teamSwitchMessage}>
              You have unsaved changes to <strong>{activeDashboardTeamProfile?.name ?? 'this team'}</strong>.
              Switching teams will discard them. Save first if you want to keep this setup.
            </p>
            <div className={styles.teamSwitchActions}>
              <button className={styles.secondaryButton} onClick={confirmPendingTeamSwitch} type="button">
                Discard and switch
              </button>
              <button className={styles.textActionButton} onClick={cancelPendingTeamSwitch} type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
