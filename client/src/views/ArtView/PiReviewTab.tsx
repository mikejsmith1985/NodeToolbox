// PiReviewTab.tsx — Editable ART PI Review workspace that syncs one Confluence-backed section per team.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import { useToast } from '../../components/Toast/ToastContext.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import {
  fetchConfluencePageByReference,
  resolveConfluencePageIdFromReference,
  updateConfluencePage,
} from '../../services/confluenceApi.ts';
import type { CapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { JiraIssue, JiraTransition } from '../../types/jira.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { downloadPiReviewPanelImage } from './piReviewPdf.ts';
import { PiReviewAiPanel } from './ai/PiReviewAiPanel.tsx';
import { PiReviewSizingCard } from './ai/PiReviewSizingCard.tsx';
import { applyPiReviewSuggestion, type PiReviewSuggestionFieldSelection } from './ai/piReviewAiApply.ts';
import type { PiReviewAiSuggestion } from './ai/piReviewAiAssist.ts';
import {
  CONFIDENCE_VOTE_COLUMN_LABELS,
  CORE_PI_REVIEW_COLUMN_KEYS,
  OPTIONAL_PI_REVIEW_COLUMN_KEYS,
  PI_REVIEW_COLUMN_LABELS,
  createInitialPiReviewPageStorage,
  createEmptyConfidenceVoteRow,
  buildCarryOverRows,
  createEmptyPiReviewRow,
  exportPiReviewRowsToCsv,
  parsePiReviewCapacitySummary,
  parseConfidenceVoteTable,
  parsePiReviewTable,
  type OptionalPiReviewColumnKey,
  type PiReviewColumnKey,
  type PiReviewCustomGroupingLine,
  type PiReviewRow,
  type PiReviewTableBinding,
  type ConfidenceVoteRow,
  type ConfidenceVoteTableBinding,
  writeConfidenceVoteTable,
  writePiReviewCapacitySummary,
  writePiReviewTable,
} from './piReviewTable.ts';
import {
  extractPiReviewFeatureKey,
  fetchPiReviewFeatureTransitions,
  fetchPiReviewTransitionFields,
  fetchPiReviewFeatureIssues,
  formatPiReviewFeatureDisplayValue,
  parsePiReviewFeatureDateUpdates,
  type PiReviewJiraFieldChange,
  type PiReviewTransitionAllowedValue,
  type PiReviewTransitionField,
  readPiReviewFeatureDatePills,
  reconcilePiReviewRowsWithJira,
  savePiReviewFeatureDates,
  savePiReviewFeatureEstimates,
  savePiReviewFeatureTransition,
  savePiReviewTransitionRequiredFields,
} from './piReviewJira.ts';
import { getStoryPointsCandidateFieldIds } from '../SprintDashboard/featureReviewFixes.ts';
import { useStandupRosterStore } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { pullPiReviewFeatures } from './piReviewPullFeatures.ts';
import styles from './PiReviewTab.module.css';

const LONG_TEXT_COLUMNS = new Set<PiReviewColumnKey>(['dependency', 'risks', 'notes']);
const CHECKBOX_COLUMNS = new Set<PiReviewColumnKey>(['carryOver', 'committed', 'devWork', 'testSupport']);
const FEATURE_COLUMN_KEY = 'feature';
const FIST_OF_FIVE_VALUES = ['1', '2', '3', '4', '5'] as const;
const CONFIDENCE_VOTE_MIN = 0;
const CONFIDENCE_VOTE_MAX = 5;
const CONFIDENCE_VOTE_STEP = 0.1;
const FINGER_FULL_HEIGHT = 18;
const FINGER_FOLDED_HEIGHT = 8;
const FINGER_RAISED_Y = 10;
const FINGER_FOLDED_Y = 20;
const STRETCH_GOALS_LINE_COLOR = '#f5c400';
const DEFAULT_CUSTOM_GROUPING_LINE_COLOR = '#0ea5e9';
const DEFAULT_CUSTOM_GROUPING_LINE_LABEL = 'New grouping';
const CHECKBOX_YES_SYMBOL = '✓';
const EMPTY_TARGET_KEY = '';
const JIRA_DATE_PASTE_PLACEHOLDER = [
  'Jira Key | Target Start | Target End | Due Date',
  'DASP-966 | 5/21/2026 | 6/3/2026 | 6/25/2026',
].join('\n');
const TEAM_DASHBOARD_ROUTE = '/sprint-dashboard';
const TEAM_DASHBOARD_PI_REVIEW_TAB = 'pireview';
const PI_REVIEW_TEAM_TABS_ID_PREFIX = 'art-pi-review-team';
const SAVE_CONFIDENCE_VOTES_BUTTON_LABEL = 'Save Confidence Votes';
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const PI_REVIEW_TEMPLATE_REQUIRED_MESSAGE =
  'Load the Toolbox PI Review template locally before saving because this page does not contain a recognized PI Review table yet.';
const CUSTOM_GROUPING_LINE_COLOR_OPTIONS = [
  { label: 'Blue', value: '#0ea5e9' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Orange', value: '#f97316' },
];
type PiReviewMode = 'authoring' | 'readout';

interface PiReviewLoadedSnapshot {
  rows: PiReviewRow[];
  confidenceRows: ConfidenceVoteRow[];
  savedCapacitySummary: CapacitySummary | null;
  tableBinding: PiReviewTableBinding | null;
  confidenceTableBinding: ConfidenceVoteTableBinding | null;
  visibleOptionalColumns: Set<OptionalPiReviewColumnKey>;
  commitmentBoundaryIndex: number | null;
  customGroupingLines: PiReviewCustomGroupingLine[];
  jiraIssueMap: Record<string, JiraIssue>;
  hasUnsavedChanges: boolean;
}

interface PiReviewTabProps {
  selectedPiName: string;
  teams: ArtTeam[];
  mode?: PiReviewMode;
  teamCapacitySummaries?: Record<string, CapacitySummary | null>;
}

interface PiReviewLoadTarget {
  teamId: string;
  /** The full ART team behind this page — carried so Pull Features can query by project + PI. */
  team: ArtTeam;
  /** The Program Increment this specific page belongs to (empty for legacy migrated pages). */
  piName: string;
  targetKey: string;
  targetLabel: string;
  pageReference: string;
}

interface PiReviewPagePanelProps {
  target: PiReviewLoadTarget;
  selectedPiName: string;
  mode: PiReviewMode;
  capacitySummaryOverride: CapacitySummary | null;
  /** The OTHER configured PI pages for this team, offered as sources to carry Features over from. */
  carryOverSourceTargets: PiReviewLoadTarget[];
}

/**
 * Builds the sub-tab label for one PI Review page. When several teams are shown at once
 * (ART view) the team name disambiguates; a single team (Team Dashboard) shows just the PI.
 */
function buildPiReviewTargetLabel(team: ArtTeam, piName: string, hasMultipleTeams: boolean): string {
  if (piName === '') {
    return team.name;
  }
  return hasMultipleTeams ? `${team.name} — ${piName}` : piName;
}

/**
 * Expands every team's configured PI Review pages into one load target per page, so a team
 * planning several PIs concurrently gets one Confluence-backed sub-tab per PI.
 */
function readConfiguredPiReviewTargets(teams: ArtTeam[]): PiReviewLoadTarget[] {
  const hasMultipleTeams = teams.length > 1;
  return teams.flatMap((team) =>
    (team.piReviewPages ?? [])
      .filter((page) => page.pageUrl.trim() !== '')
      .map((page) => {
        const piName = page.piName.trim();
        const pageReference = page.pageUrl.trim();
        return {
          teamId: team.id,
          team,
          piName,
          // A PI is unique within a team; fall back to the URL for legacy unnamed pages.
          targetKey: `${team.id}::${piName || pageReference}`,
          targetLabel: buildPiReviewTargetLabel(team, piName, hasMultipleTeams),
          pageReference,
        };
      }),
  );
}

/**
 * Narrows the configured pages to the one Program Increment the surrounding view has selected.
 *
 * Team Dashboard already has a PI selector, so it — not a second row of tabs in here — decides which
 * PI Review page is on screen. ART's readout shows several teams at once with no single driving PI,
 * so it keeps every page and tabs between them (this filter is not applied there).
 *
 * Legacy pages carry no PI of their own; they adopt whichever PI is selected, but only when no page
 * explicitly claims that PI — an exact match always wins.
 */
function selectTargetsForSelectedPi(
  configuredTargets: PiReviewLoadTarget[],
  selectedPiName: string,
): PiReviewLoadTarget[] {
  const trimmedSelectedPiName = selectedPiName.trim();
  if (trimmedSelectedPiName === '') {
    return configuredTargets;
  }

  const targetsClaimingSelectedPi = configuredTargets.filter((target) => target.piName === trimmedSelectedPiName);
  if (targetsClaimingSelectedPi.length > 0) {
    return targetsClaimingSelectedPi;
  }

  return configuredTargets.filter((target) => target.piName === '');
}

function readDefaultPiReviewTargetKey(configuredTargets: PiReviewLoadTarget[]): string {
  return configuredTargets[0]?.targetKey ?? EMPTY_TARGET_KEY;
}

function readActivePiReviewTargetKey(previousTargetKey: string, configuredTargets: PiReviewLoadTarget[]): string {
  if (configuredTargets.some((target) => target.targetKey === previousTargetKey)) {
    return previousTargetKey;
  }

  return readDefaultPiReviewTargetKey(configuredTargets);
}

/**
 * Quick-access edit handoff: activates the ART team's matching Team Dashboard profile and lands on
 * its PI Review tab, so the user edits pages in the one place they live (the team profile). The
 * match (by name, then board, then project) is inlined here rather than imported so the ART PI
 * Review test's module environment stays isolated from the Team Dashboard context helper.
 */
function openTeamDashboardPiReviewWorkspace(team: ArtTeam): void {
  const settingsState = useSettingsStore.getState();
  const teamProfiles = settingsState.sprintDashboardTeamProfiles;
  const normalizedName = team.name.trim().toLowerCase();
  const normalizedBoardId = team.boardId.trim();
  const normalizedProjectKey = (team.projectKey ?? '').trim().toUpperCase();
  const matchedProfile =
    teamProfiles.find((profile) => normalizedName !== '' && profile.name.trim().toLowerCase() === normalizedName)
    ?? teamProfiles.find((profile) => normalizedBoardId !== '' && profile.boardId.trim() === normalizedBoardId)
    ?? teamProfiles.find((profile) => normalizedProjectKey !== '' && profile.projectKey.trim().toUpperCase() === normalizedProjectKey);
  if (matchedProfile) {
    settingsState.setSprintDashboardActiveTeamProfileId(matchedProfile.id);
  }
  settingsState.setSprintDashboardActiveTab(TEAM_DASHBOARD_PI_REVIEW_TAB);
}

/**
 * Builds the direct Confluence page URL for "Open in Confluence" links.
 * If the configured reference is already a full URL, it is returned as-is.
 * Otherwise, falls back to constructing a /pages/<id> URL from the Confluence base URL.
 */
function buildConfluencePageUrl(pageReference: string, resolvedPageId: string, confluenceBaseUrl: string): string | null {
  const trimmedReference = pageReference.trim();
  if (trimmedReference.startsWith('http')) {
    return trimmedReference;
  }

  const trimmedBaseUrl = confluenceBaseUrl.trim().replace(/\/$/, '');
  const pageIdForUrl = resolvedPageId.trim();
  if (trimmedBaseUrl !== '' && pageIdForUrl !== '') {
    return `${trimmedBaseUrl}/pages/${pageIdForUrl}`;
  }

  return null;
}

function createTodayDateValue(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

function createPiReviewDownloadNameSegment(rawValue: string): string {
  return rawValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function createPiReviewExportFileName(selectedPiName: string, targetLabel: string): string {
  const normalizedTargetLabel = createPiReviewDownloadNameSegment(targetLabel);
  const normalizedPiName = createPiReviewDownloadNameSegment(selectedPiName);
  return `pi-review-${normalizedTargetLabel || 'team'}-${normalizedPiName || 'export'}.png`;
}

function createPiReviewIssueBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_URL_PREFIX}${encodeURIComponent(issueKey)}`;
}

function normalizeTransitionFieldLabel(rawLabel: string): string {
  return rawLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readMissingFieldLabelsFromTransitionError(errorMessage: string): string[] {
  // Match "fields are required: ..." patterns, allowing for various endings (newline, period, semicolon, etc.)
  const missingFieldMatch = errorMessage.match(/fields are required:\s*([^;.\n]+)/i);
  if (!missingFieldMatch) {
    return [];
  }

  return missingFieldMatch[1]
    .split(/[,;]/)
    .map((fieldLabel) => fieldLabel.trim())
    .filter((fieldLabel) => fieldLabel.length > 0)
    .filter((fieldLabel) => fieldLabel !== '');
}

function readTransitionAllowedValueOption(
  allowedValue: PiReviewTransitionAllowedValue,
): { label: string; value: string } | null {
  const optionValue = allowedValue.id
    ?? allowedValue.value
    ?? allowedValue.name
    ?? allowedValue.key
    ?? allowedValue.accountId
    ?? '';
  const optionLabel = allowedValue.displayName
    ?? allowedValue.value
    ?? allowedValue.name
    ?? allowedValue.key
    ?? allowedValue.accountId
    ?? optionValue;
  if (optionValue.trim() === '' || optionLabel.trim() === '') {
    return null;
  }

  return {
    label: optionLabel,
    value: optionValue,
  };
}

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

function downloadPiReviewCsv(rows: PiReviewRow[], selectedPiName: string, targetLabel: string): void {
  const csvContent = exportPiReviewRowsToCsv(rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  const normalizedTargetLabel = createPiReviewDownloadNameSegment(targetLabel);
  downloadAnchor.href = objectUrl;
  downloadAnchor.download = `pi-review-${normalizedTargetLabel || 'team'}-${createPiReviewDownloadNameSegment(selectedPiName) || 'export'}.csv`;
  downloadAnchor.click();
  URL.revokeObjectURL(objectUrl);
}

function readOptionalColumnsFromBinding(tableBinding: PiReviewTableBinding): Set<OptionalPiReviewColumnKey> {
  return new Set(
    OPTIONAL_PI_REVIEW_COLUMN_KEYS.filter((columnKey) => tableBinding.columnOrder.includes(columnKey)),
  );
}

function formatCapacityValue(capacityValue: number): string {
  return Number.isInteger(capacityValue) ? String(capacityValue) : String(Number(capacityValue.toFixed(1)));
}

function formatPiReviewCellValue(columnKey: PiReviewColumnKey, cellValue: string): string {
  if (CHECKBOX_COLUMNS.has(columnKey)) {
    return cellValue === 'Yes' ? 'Yes' : 'No';
  }

  return cellValue.trim() === '' ? '—' : cellValue;
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(' ');
}

function readFeatureDatePillToneClassName(featureDateLabel: string): string {
  if (featureDateLabel === 'Target Start') {
    return styles.featureDatePillStart;
  }

  if (featureDateLabel === 'Target End') {
    return styles.featureDatePillEnd;
  }

  if (featureDateLabel === 'Fix Version') {
    return styles.featureDatePillFixVersion;
  }

  return styles.featureDatePillDue;
}

function renderPiReviewCheckboxDisplay(columnKey: PiReviewColumnKey, cellValue: string) {
  const isChecked = cellValue === 'Yes';
  return (
    <span
      aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]}: ${isChecked ? 'Yes' : 'No'}`}
      className={joinClassNames(styles.checkboxDisplayValue, isChecked && styles.checkboxDisplayValueChecked)}
      role="img"
    >
      {isChecked ? CHECKBOX_YES_SYMBOL : ''}
    </span>
  );
}

function moveItemInList<ItemType>(items: ItemType[], startIndex: number, endIndex: number): ItemType[] {
  if (startIndex === endIndex || startIndex < 0 || endIndex < 0 || startIndex >= items.length || endIndex >= items.length) {
    return items;
  }

  const reorderedItems = [...items];
  const [movedItem] = reorderedItems.splice(startIndex, 1);
  if (movedItem === undefined) {
    return items;
  }

  reorderedItems.splice(endIndex, 0, movedItem);
  return reorderedItems;
}

function adjustCommitmentBoundaryAfterRowMove(
  commitmentBoundaryIndex: number | null,
  currentRowIndex: number,
  nextRowIndex: number,
): number | null {
  if (commitmentBoundaryIndex === null) {
    return null;
  }

  if (nextRowIndex < commitmentBoundaryIndex && currentRowIndex >= commitmentBoundaryIndex) {
    return commitmentBoundaryIndex + 1;
  }
  if (currentRowIndex < commitmentBoundaryIndex && nextRowIndex >= commitmentBoundaryIndex) {
    return commitmentBoundaryIndex - 1;
  }
  return commitmentBoundaryIndex;
}

function normalizeHexColor(hexColor: string): string {
  const trimmedHexColor = hexColor.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmedHexColor) ? trimmedHexColor : DEFAULT_CUSTOM_GROUPING_LINE_COLOR;
}

function convertHexColorToRgba(hexColor: string, alphaValue: number): string {
  const normalizedHexColor = normalizeHexColor(hexColor);
  const redValue = Number.parseInt(normalizedHexColor.slice(1, 3), 16);
  const greenValue = Number.parseInt(normalizedHexColor.slice(3, 5), 16);
  const blueValue = Number.parseInt(normalizedHexColor.slice(5, 7), 16);
  return `rgba(${redValue}, ${greenValue}, ${blueValue}, ${alphaValue})`;
}

function adjustGroupingLineAfterRowMove(
  afterRowIndex: number,
  currentRowIndex: number,
  nextRowIndex: number,
): number {
  return adjustCommitmentBoundaryAfterRowMove(afterRowIndex, currentRowIndex, nextRowIndex) ?? afterRowIndex;
}

function isPiReviewRowCommitted(row: PiReviewRow): boolean {
  return row.committed.trim().toLowerCase() === 'yes';
}

function parsePiReviewPointEstimate(pointEstimate: string): number {
  const parsedPointEstimate = Number(pointEstimate);
  return Number.isFinite(parsedPointEstimate) ? parsedPointEstimate : 0;
}

function isConfluenceVersionConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Version must be incremented on update');
}

function normalizeCommitmentBoundaryIndex(commitmentBoundaryIndex: number | null, rowCount: number): number | null {
  return commitmentBoundaryIndex !== null && commitmentBoundaryIndex > 0 && commitmentBoundaryIndex <= rowCount
    ? commitmentBoundaryIndex
    : null;
}

function adjustCommitmentBoundaryAfterRowRemoval(
  commitmentBoundaryIndex: number | null,
  removedRowIndex: number,
  nextRowCount: number,
): number | null {
  if (commitmentBoundaryIndex === null || removedRowIndex < 0) {
    return normalizeCommitmentBoundaryIndex(commitmentBoundaryIndex, nextRowCount);
  }

  const nextCommitmentBoundaryIndex = commitmentBoundaryIndex > removedRowIndex
    ? commitmentBoundaryIndex - 1
    : commitmentBoundaryIndex;

  return normalizeCommitmentBoundaryIndex(nextCommitmentBoundaryIndex, nextRowCount);
}

function adjustGroupingLineAfterRowRemoval(
  afterRowIndex: number,
  removedRowIndex: number,
  nextRowCount: number,
): number | null {
  return adjustCommitmentBoundaryAfterRowRemoval(afterRowIndex, removedRowIndex, nextRowCount);
}

function cloneGroupingLines(customGroupingLines: PiReviewCustomGroupingLine[]): PiReviewCustomGroupingLine[] {
  return customGroupingLines.map((groupingLine) => ({ ...groupingLine }));
}

function cloneRows<RowType extends { rowId: string }>(rows: RowType[]): RowType[] {
  return rows.map((row) => ({ ...row }));
}

function findCustomGroupingLineAtRow(
  customGroupingLines: PiReviewCustomGroupingLine[],
  afterRowIndex: number,
): PiReviewCustomGroupingLine | null {
  return customGroupingLines.find((groupingLine) => groupingLine.afterRowIndex === afterRowIndex) ?? null;
}

function createCustomGroupingLine(afterRowIndex: number, lineNumber: number): PiReviewCustomGroupingLine {
  return {
    lineId: `custom-line-${Date.now()}-${lineNumber}`,
    afterRowIndex,
    label: DEFAULT_CUSTOM_GROUPING_LINE_LABEL,
    color: DEFAULT_CUSTOM_GROUPING_LINE_COLOR,
  };
}

function createPiReviewTableBindingWithColumns(
  currentTableBinding: PiReviewTableBinding,
  columnOrder: PiReviewColumnKey[],
): PiReviewTableBinding {
  return {
    ...currentTableBinding,
    columnOrder,
    columnIndexes: columnOrder.map((_columnKey, columnIndex) => columnIndex),
    headerLabels: columnOrder.reduce(
      (headerLabels, columnKey) => ({
        ...headerLabels,
        [columnKey]: PI_REVIEW_COLUMN_LABELS[columnKey],
      }),
      {} as Record<PiReviewColumnKey, string>,
    ),
  };
}

function clampConfidenceVote(confidenceVote: number): number {
  return Math.min(CONFIDENCE_VOTE_MAX, Math.max(CONFIDENCE_VOTE_MIN, confidenceVote));
}

function formatConfidenceVoteNumber(confidenceVote: number): string {
  const roundedConfidenceVote = Math.round(confidenceVote / CONFIDENCE_VOTE_STEP) * CONFIDENCE_VOTE_STEP;
  return Number.isInteger(roundedConfidenceVote) ? String(roundedConfidenceVote) : roundedConfidenceVote.toFixed(1);
}

function parseConfidenceVoteValue(value: string): number | null {
  const trimmedValue = value.trim();
  if (trimmedValue === '') {
    return null;
  }

  const parsedValue = Number(trimmedValue);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return clampConfidenceVote(parsedValue);
}

function sanitizeConfidenceVoteValue(value: string): string {
  const parsedValue = parseConfidenceVoteValue(value);
  return parsedValue === null ? '' : formatConfidenceVoteNumber(parsedValue);
}

function readConfidenceVoteDisplayValue(value: string): string {
  return sanitizeConfidenceVoteValue(value);
}

function FistOfFiveIcon({ value }: { value: string }) {
  const parsedConfidenceVote = parseConfidenceVoteValue(value) ?? 0;

  function readFingerFillAmount(fingerIndex: number): number {
    return Math.min(1, Math.max(0, parsedConfidenceVote - fingerIndex));
  }

  return (
    <svg aria-hidden="true" className={styles.fistIcon} viewBox="0 0 64 64">
      <rect className={styles.palmShape} height="26" rx="8" width="34" x="15" y="28" />
      {[0, 1, 2, 3, 4].map((fingerIndex) => {
        const fingerFillAmount = readFingerFillAmount(fingerIndex);
        const fingerXPosition = 18 + fingerIndex * 7;

        return (
          <Fragment key={fingerIndex}>
            {fingerFillAmount <= 0 ? (
              <rect
                className={styles.fingerFolded}
                height={FINGER_FOLDED_HEIGHT}
                rx="3"
                width="5"
                x={fingerXPosition}
                y={FINGER_FOLDED_Y}
              />
            ) : fingerFillAmount >= 1 ? (
              <rect
                className={styles.fingerRaised}
                height={FINGER_FULL_HEIGHT}
                rx="3"
                width="5"
                x={fingerXPosition}
                y={FINGER_RAISED_Y}
              />
            ) : (
              <>
                <rect
                  className={styles.fingerPartialBase}
                  height={FINGER_FULL_HEIGHT}
                  rx="3"
                  width="5"
                  x={fingerXPosition}
                  y={FINGER_RAISED_Y}
                />
                <rect
                  className={styles.fingerRaised}
                  height={FINGER_FULL_HEIGHT * fingerFillAmount}
                  rx="3"
                  width="5"
                  x={fingerXPosition}
                  y={FINGER_RAISED_Y + (FINGER_FULL_HEIGHT * (1 - fingerFillAmount))}
                />
                <line
                  className={styles.fingerPartialDivider}
                  x1={fingerXPosition}
                  x2={fingerXPosition + 5}
                  y1={FINGER_RAISED_Y + (FINGER_FULL_HEIGHT * (1 - fingerFillAmount))}
                  y2={FINGER_RAISED_Y + (FINGER_FULL_HEIGHT * (1 - fingerFillAmount))}
                />
              </>
            )}
          </Fragment>
        );
      })}
      <rect className={styles.thumbShape} height="10" rx="4" width="12" x="7" y="35" />
    </svg>
  );
}

function ConfidenceVoteSelector({
  row,
  rowIndex,
  teamLabel,
  onChange,
}: {
  row: ConfidenceVoteRow;
  rowIndex: number;
  teamLabel: string;
  onChange: (nextValue: string) => void;
}) {
  const normalizedConfidenceVote = readConfidenceVoteDisplayValue(row.confidenceVote);

  return (
    <div className={styles.confidenceVoteEditor}>
      <div className={styles.fistSelector}>
        {FIST_OF_FIVE_VALUES.map((value) => {
          const isSelected = normalizedConfidenceVote === value;
          return (
            <button
              aria-label={`Set fist of five vote to ${value} for ${teamLabel} confidence row ${rowIndex + 1}`}
              className={`${styles.fistOption} ${isSelected ? styles.fistOptionSelected : ''}`.trim()}
              key={value}
              onClick={() => onChange(value)}
              type="button"
            >
              <FistOfFiveIcon value={value} />
              <span className={styles.fistOptionLabel}>{value}</span>
            </button>
          );
        })}
      </div>
      <label className={styles.confidenceVoteInputLabel}>
        Exact vote (0-5 in tenths)
        <input
          aria-label={`Exact fist of five vote for ${teamLabel} confidence row ${rowIndex + 1}`}
          className={styles.confidenceVoteNumberInput}
          inputMode="decimal"
          max={CONFIDENCE_VOTE_MAX}
          min={CONFIDENCE_VOTE_MIN}
          onChange={(event) => onChange(sanitizeConfidenceVoteValue(event.target.value))}
          step={CONFIDENCE_VOTE_STEP}
          type="number"
          value={normalizedConfidenceVote}
        />
      </label>
    </div>
  );
}

function PiReviewFeatureDatePills({ jiraIssue }: { jiraIssue: JiraIssue | undefined }) {
  const featureDatePills = readPiReviewFeatureDatePills(jiraIssue);
  if (featureDatePills.length === 0) {
    return null;
  }

  return (
      <div className={styles.featureDatePillList}>
        {featureDatePills.map((featureDatePill) => (
          <span
            className={joinClassNames(styles.featureDatePill, readFeatureDatePillToneClassName(featureDatePill.label))}
            key={featureDatePill.label}
          >
            {featureDatePill.label}: {featureDatePill.value}
          </span>
        ))}
      </div>
  );
}

function PiReviewPagePanel({
  target,
  selectedPiName,
  mode,
  capacitySummaryOverride,
  carryOverSourceTargets,
}: PiReviewPagePanelProps) {
  // Each page belongs to its own PI; fall back to the ambient selection only for legacy unnamed pages.
  const effectivePiName = target.piName.trim() || selectedPiName;
  const { showToast } = useToast();
  const confluenceBaseUrl = useSettingsStore((storeState) => storeState.confluenceUrl);
  const [rows, setRows] = useState<PiReviewRow[]>([]);
  const [confidenceRows, setConfidenceRows] = useState<ConfidenceVoteRow[]>([]);
  const [savedCapacitySummary, setSavedCapacitySummary] = useState<CapacitySummary | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [resolvedPageId, setResolvedPageId] = useState('');
  const [pageVersionNumber, setPageVersionNumber] = useState<number | null>(null);
  const [storageValue, setStorageValue] = useState('');
  const [tableBinding, setTableBinding] = useState<PiReviewTableBinding | null>(null);
  const [confidenceTableBinding, setConfidenceTableBinding] = useState<ConfidenceVoteTableBinding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [isTemplateDraftConfirmationVisible, setIsTemplateDraftConfirmationVisible] = useState(false);
  const [isJiraDatePasteVisible, setIsJiraDatePasteVisible] = useState(false);
  const [jiraDatePasteValue, setJiraDatePasteValue] = useState('');
  const [isUpdatingJiraDates, setIsUpdatingJiraDates] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  // ── "Pull Features from Jira" controls ──
  // A pull is scoped by the page's PI plus the team's Product Owner(s), read from the imported roster.
  const rosterMembers = useStandupRosterStore((storeState) => storeState.rosterMembers);
  const [isPullingFeatures, setIsPullingFeatures] = useState(false);
  // When on, a pull includes Features assigned to ANY roster member, not just the Product Owner(s) —
  // for teams where Features sit with the person doing the work rather than the PO.
  const [includeFullRoster, setIncludeFullRoster] = useState(false);
  // ── "Carry over from a previous PI" controls ──
  const [carryOverSourceKey, setCarryOverSourceKey] = useState('');
  const [isCarryingOver, setIsCarryingOver] = useState(false);
  const [transitionOptionsByFeatureKey, setTransitionOptionsByFeatureKey] = useState<Record<string, JiraTransition[]>>({});
  const [isStatusPickerOpenByFeatureKey, setIsStatusPickerOpenByFeatureKey] = useState<Record<string, boolean>>({});
  const [isLoadingTransitionByFeatureKey, setIsLoadingTransitionByFeatureKey] = useState<Record<string, boolean>>({});
  const [isSavingTransitionByFeatureKey, setIsSavingTransitionByFeatureKey] = useState<Record<string, boolean>>({});
  const [pendingTransitionIdByFeatureKey, setPendingTransitionIdByFeatureKey] = useState<Record<string, string>>({});
  const [requiredTransitionFieldsByFeatureKey, setRequiredTransitionFieldsByFeatureKey] = useState<Record<string, Record<string, PiReviewTransitionField>>>({});
  const [requiredTransitionFieldIdsByFeatureKey, setRequiredTransitionFieldIdsByFeatureKey] = useState<Record<string, string[]>>({});
  const [requiredTransitionFieldValuesByFeatureKey, setRequiredTransitionFieldValuesByFeatureKey] = useState<Record<string, Record<string, string>>>({});
  const [isRetryingTransitionByFeatureKey, setIsRetryingTransitionByFeatureKey] = useState<Record<string, boolean>>({});
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<OptionalPiReviewColumnKey>>(new Set());
  const [commitmentBoundaryIndex, setCommitmentBoundaryIndex] = useState<number | null>(null);
  const [customGroupingLines, setCustomGroupingLines] = useState<PiReviewCustomGroupingLine[]>([]);
  const [jiraIssueMap, setJiraIssueMap] = useState<Record<string, JiraIssue>>({});
  const [focusedCustomGroupingLineId, setFocusedCustomGroupingLineId] = useState<string | null>(null);
  const [expandedCustomGroupingLineId, setExpandedCustomGroupingLineId] = useState<string | null>(null);
  const [jiraLoadDeltaDetails, setJiraLoadDeltaDetails] = useState<PiReviewJiraFieldChange[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const lastAutoLoadKeyRef = useRef('');
  const loadedSnapshotRef = useRef<PiReviewLoadedSnapshot | null>(null);
  const [hasLoadedSnapshot, setHasLoadedSnapshot] = useState(false);
  const pagePanelRef = useRef<HTMLElement>(null);
  const liveCapacitySummary = capacitySummaryOverride;
  const displayedCapacitySummary = liveCapacitySummary ?? savedCapacitySummary;
  const committedPointTotal = useMemo(
    () => rows.reduce(
      (runningTotal, row) => runningTotal + (isPiReviewRowCommitted(row) ? parsePiReviewPointEstimate(row.pointEstimate) : 0),
      0,
    ),
    [rows],
  );
  // The team's Product Owner(s) — roster members flagged with the Product Owner capability. Their
  // Jira assignee query values scope a Feature pull to just this team's work.
  const productOwners = useMemo(
    () => rosterMembers.filter((rosterMember) => rosterMember.roleCapabilities?.canProductOwner === true),
    [rosterMembers],
  );
  const isReadoutMode = mode === 'readout';
  const canEditContent = !isReadoutMode && isEditMode;
  const canShowAuthoringToolbar = !isReadoutMode;
  const visiblePiReviewColumnKeys = useMemo<PiReviewColumnKey[]>(
    () => [
      ...CORE_PI_REVIEW_COLUMN_KEYS,
      ...OPTIONAL_PI_REVIEW_COLUMN_KEYS.filter((columnKey) => visibleOptionalColumns.has(columnKey)),
    ],
    [visibleOptionalColumns],
  );
  const canExportPanelImage = rows.length > 0 || confidenceRows.length > 0 || displayedCapacitySummary !== null;
  const isPiReviewTemplateRequired = canShowAuthoringToolbar && !tableBinding;

  function applyLoadedSnapshot(loadedSnapshot: PiReviewLoadedSnapshot) {
    setRows(cloneRows(loadedSnapshot.rows));
    setConfidenceRows(cloneRows(loadedSnapshot.confidenceRows));
    setSavedCapacitySummary(loadedSnapshot.savedCapacitySummary);
    setTableBinding(loadedSnapshot.tableBinding);
    setConfidenceTableBinding(loadedSnapshot.confidenceTableBinding);
    setVisibleOptionalColumns(new Set(loadedSnapshot.visibleOptionalColumns));
    setCommitmentBoundaryIndex(loadedSnapshot.commitmentBoundaryIndex);
    setCustomGroupingLines(cloneGroupingLines(loadedSnapshot.customGroupingLines));
    setJiraIssueMap(loadedSnapshot.jiraIssueMap);
    setTransitionOptionsByFeatureKey({});
    setIsStatusPickerOpenByFeatureKey({});
    setPendingTransitionIdByFeatureKey({});
    setRequiredTransitionFieldsByFeatureKey({});
    setRequiredTransitionFieldIdsByFeatureKey({});
    setRequiredTransitionFieldValuesByFeatureKey({});
    setIsLoadingTransitionByFeatureKey({});
    setIsSavingTransitionByFeatureKey({});
    setIsRetryingTransitionByFeatureKey({});
    setHasUnsavedChanges(loadedSnapshot.hasUnsavedChanges);
    setFocusedCustomGroupingLineId(null);
    setExpandedCustomGroupingLineId(null);
  }

  const loadPiReviewPage = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const resolvedPageIdFromReference = resolveConfluencePageIdFromReference(target.pageReference) || '';
    let hasLoadedConfluencePage = false;
    setResolvedPageId(resolvedPageIdFromReference);
    try {
      const confluencePage = await fetchConfluencePageByReference(target.pageReference);
      hasLoadedConfluencePage = true;
      setStorageValue(confluencePage.body.storage.value);
      setPageTitle(confluencePage.title);
      setResolvedPageId(confluencePage.id || resolvedPageIdFromReference);
      setPageVersionNumber(confluencePage.version.number);

      const parsedPiReviewTable = parsePiReviewTable(confluencePage.body.storage.value);
      const parsedConfidenceTable = parseConfidenceVoteTable(confluencePage.body.storage.value);
      const parsedCapacitySummary = parsePiReviewCapacitySummary(confluencePage.body.storage.value);
      const nextJiraIssueMap = await fetchPiReviewFeatureIssues(parsedPiReviewTable.rows);
      const jiraReconciliationResult = reconcilePiReviewRowsWithJira(parsedPiReviewTable.rows, nextJiraIssueMap);
      const nextVisibleOptionalColumns = readOptionalColumnsFromBinding(parsedPiReviewTable.tableBinding);
      const nextLoadedSnapshot: PiReviewLoadedSnapshot = {
        rows: jiraReconciliationResult.rows,
        confidenceRows: parsedConfidenceTable.rows,
        savedCapacitySummary: parsedCapacitySummary,
        tableBinding: parsedPiReviewTable.tableBinding,
        confidenceTableBinding: parsedConfidenceTable.tableBinding,
        visibleOptionalColumns: nextVisibleOptionalColumns,
        commitmentBoundaryIndex: parsedPiReviewTable.commitmentBoundaryIndex,
        customGroupingLines: parsedPiReviewTable.customGroupingLines,
        jiraIssueMap: nextJiraIssueMap,
        hasUnsavedChanges: jiraReconciliationResult.hasChanges,
      };
      loadedSnapshotRef.current = nextLoadedSnapshot;
      setHasLoadedSnapshot(true);
      applyLoadedSnapshot(nextLoadedSnapshot);
      setJiraLoadDeltaDetails(jiraReconciliationResult.fieldChanges);
      setLastLoadedAt(new Date().toLocaleTimeString());
      setIsEditMode(false);
      setIsTemplateDraftConfirmationVisible(false);
    } catch (error) {
      setRows([]);
      setConfidenceRows([]);
      setTableBinding(null);
      setConfidenceTableBinding(null);
      setSavedCapacitySummary(null);
      setVisibleOptionalColumns(new Set());
      setCommitmentBoundaryIndex(null);
      setCustomGroupingLines([]);
      setJiraIssueMap({});
      setTransitionOptionsByFeatureKey({});
      setIsStatusPickerOpenByFeatureKey({});
      setPendingTransitionIdByFeatureKey({});
      setRequiredTransitionFieldsByFeatureKey({});
      setRequiredTransitionFieldIdsByFeatureKey({});
      setRequiredTransitionFieldValuesByFeatureKey({});
      setIsLoadingTransitionByFeatureKey({});
      setIsSavingTransitionByFeatureKey({});
      setIsRetryingTransitionByFeatureKey({});
      setIsEditMode(false);
      setHasUnsavedChanges(false);
      if (!hasLoadedConfluencePage) {
        setPageTitle('');
        setPageVersionNumber(null);
      }
      setLoadError(error instanceof Error ? error.message : 'Failed to load the PI Review page');
    } finally {
      setIsLoading(false);
    }
  }, [target.pageReference]);

  useEffect(() => {
    const autoLoadKey = `${target.targetKey}|${target.pageReference}|${effectivePiName}`;
    if (lastAutoLoadKeyRef.current === autoLoadKey) {
      return;
    }

    lastAutoLoadKeyRef.current = autoLoadKey;
    void loadPiReviewPage();
  }, [loadPiReviewPage, effectivePiName, target.pageReference, target.targetKey]);

  function handleCellChange(rowId: string, columnKey: PiReviewColumnKey, nextValue: string) {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.rowId === rowId
          ? { ...row, [columnKey]: nextValue }
          : row,
      ),
    );
    setHasUnsavedChanges(true);
  }

  function handleLoadToolboxTemplateDraft() {
    if (pageVersionNumber === null || resolvedPageId === '') {
      showToast('Load the Confluence page before starting a Toolbox PI Review draft.', 'error');
      return;
    }

    setLoadError(null);
    try {
      const draftStorageValue = createInitialPiReviewPageStorage(liveCapacitySummary);
      const parsedPiReviewTable = parsePiReviewTable(draftStorageValue);
      const parsedConfidenceTable = parseConfidenceVoteTable(draftStorageValue);
      setRows([createEmptyPiReviewRow()]);
      setConfidenceRows(parsedConfidenceTable.rows);
      setSavedCapacitySummary(liveCapacitySummary);
      setTableBinding(parsedPiReviewTable.tableBinding);
      setConfidenceTableBinding(parsedConfidenceTable.tableBinding);
      setStorageValue(draftStorageValue);
      setVisibleOptionalColumns(new Set());
      setCommitmentBoundaryIndex(null);
      setCustomGroupingLines([]);
      setJiraIssueMap({});
      setTransitionOptionsByFeatureKey({});
      setIsStatusPickerOpenByFeatureKey({});
      setPendingTransitionIdByFeatureKey({});
      setRequiredTransitionFieldsByFeatureKey({});
      setRequiredTransitionFieldIdsByFeatureKey({});
      setRequiredTransitionFieldValuesByFeatureKey({});
      setIsLoadingTransitionByFeatureKey({});
      setIsSavingTransitionByFeatureKey({});
      setIsRetryingTransitionByFeatureKey({});
      setFocusedCustomGroupingLineId(null);
      setExpandedCustomGroupingLineId(null);
      setHasUnsavedChanges(true);
      setIsEditMode(true);
      setIsTemplateDraftConfirmationVisible(false);
      showToast(`${target.targetLabel} PI Review template loaded locally. Save when ready.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load the Toolbox PI Review template';
      setLoadError(errorMessage);
      showToast(errorMessage, 'error');
    }
  }

  function handleMoveRow(rowId: string, directionOffset: -1 | 1) {
    setRows((currentRows) => {
      const currentRowIndex = currentRows.findIndex((row) => row.rowId === rowId);
      const nextRowIndex = currentRowIndex + directionOffset;
      setCommitmentBoundaryIndex((currentCommitmentBoundaryIndex) =>
        adjustCommitmentBoundaryAfterRowMove(currentCommitmentBoundaryIndex, currentRowIndex, nextRowIndex),
      );
      setCustomGroupingLines((currentGroupingLines) =>
        currentGroupingLines.map((groupingLine) => ({
          ...groupingLine,
          afterRowIndex: adjustGroupingLineAfterRowMove(groupingLine.afterRowIndex, currentRowIndex, nextRowIndex),
        })),
      );
      return moveItemInList(currentRows, currentRowIndex, nextRowIndex);
    });
    setHasUnsavedChanges(true);
  }

  function handleToggleOptionalColumn(columnKey: OptionalPiReviewColumnKey) {
    const nextVisibleOptionalColumns = new Set(visibleOptionalColumns);
    if (nextVisibleOptionalColumns.has(columnKey)) {
      nextVisibleOptionalColumns.delete(columnKey);
    } else {
      nextVisibleOptionalColumns.add(columnKey);
    }

    const nextColumnOrder: PiReviewColumnKey[] = [
      ...CORE_PI_REVIEW_COLUMN_KEYS,
      ...OPTIONAL_PI_REVIEW_COLUMN_KEYS.filter((optionalColumnKey) =>
        nextVisibleOptionalColumns.has(optionalColumnKey),
      ),
    ];
    setVisibleOptionalColumns(nextVisibleOptionalColumns);
    setTableBinding((currentTableBinding) =>
      currentTableBinding
        ? createPiReviewTableBindingWithColumns(currentTableBinding, nextColumnOrder)
        : currentTableBinding,
    );
    setHasUnsavedChanges(true);
  }

  /**
   * Pulls every Feature for this team's PI that is assigned to the team's Product Owner(s) into the
   * table, then reconciles the new rows with Jira so priority, estimate, dependencies, and risks fill
   * in as on a page load. The PI and Product Owner together scope the pull; both are required.
   */
  /**
   * Applies one accepted AI suggestion to its row, limited to the fields the reviewer kept ticked.
   * The panel reviews; the tab writes — and only ever to Point Estimate, Implementation Notes, Dev
   * Work and Test Support (see ai/piReviewAiApply.ts). This marks the page dirty; publishing stays a
   * deliberate Save to Confluence click.
   */
  function handleApplyAiSuggestion(suggestion: PiReviewAiSuggestion, selection: PiReviewSuggestionFieldSelection) {
    setRows((currentRows) => currentRows.map((row) => (
      extractPiReviewFeatureKey(row.feature) === suggestion.issueKey
        ? applyPiReviewSuggestion(row, suggestion, selection)
        : row
    )));
    setHasUnsavedChanges(true);
    showToast(`Applied the AI suggestion for ${suggestion.issueKey}. Save to Confluence when ready.`, 'success');
  }

  async function handlePullFeatures() {
    if (!tableBinding) {
      return;
    }
    // Full-roster mode widens the pull to every roster member, catching Features assigned to whoever
    // is doing the work rather than only the nominated Product Owner(s).
    const pullSourceMembers = includeFullRoster ? rosterMembers : productOwners;
    const pullAssigneeQueryValues = pullSourceMembers
      .map((rosterMember) => rosterMember.assigneeQueryValue.trim())
      .filter((assigneeQueryValue) => assigneeQueryValue !== '');
    if (pullAssigneeQueryValues.length === 0) {
      showToast(
        includeFullRoster
          ? 'The team roster is empty — import a roster before pulling Features.'
          : 'Flag a Product Owner in the team roster, or turn on “Include full roster”, before pulling Features.',
        'error',
      );
      return;
    }
    if (effectivePiName.trim() === '') {
      showToast('This page has no PI selected — set the PI before pulling Features.', 'error');
      return;
    }
    setIsPullingFeatures(true);
    try {
      const pullResult = await pullPiReviewFeatures(effectivePiName, pullAssigneeQueryValues, rows);
      if (pullResult.addedCount === 0) {
        showToast(
          pullResult.discoveredCount === 0
            ? 'No Features found for this team and PI.'
            : 'All matching Features are already in the table.',
          'info',
        );
        return;
      }

      const nextRows = [...rows, ...pullResult.rows];
      const nextJiraIssueMap = await fetchPiReviewFeatureIssues(nextRows);
      const reconciliationResult = reconcilePiReviewRowsWithJira(nextRows, nextJiraIssueMap);
      setRows(reconciliationResult.rows);
      setJiraIssueMap(nextJiraIssueMap);
      setHasUnsavedChanges(true);
      showToast(
        `Added ${pullResult.addedCount} Feature${pullResult.addedCount === 1 ? '' : 's'} for ${effectivePiName || 'this PI'}. Save to Confluence when ready.`,
        'success',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to pull Features from Jira.';
      showToast(errorMessage, 'error');
    } finally {
      setIsPullingFeatures(false);
    }
  }

  function handleRemoveRow(rowId: string) {
    const removedRowIndex = rows.findIndex((row) => row.rowId === rowId);
    setRows((currentRows) => currentRows.filter((row) => row.rowId !== rowId));
    setCommitmentBoundaryIndex((currentCommitmentBoundaryIndex) =>
      adjustCommitmentBoundaryAfterRowRemoval(
        currentCommitmentBoundaryIndex,
        removedRowIndex,
        rows.length - 1,
      ),
    );
    setCustomGroupingLines((currentGroupingLines) =>
      currentGroupingLines
        .map((groupingLine) => ({
          ...groupingLine,
          afterRowIndex: adjustGroupingLineAfterRowRemoval(groupingLine.afterRowIndex, removedRowIndex, rows.length - 1),
        }))
        .filter((groupingLine): groupingLine is PiReviewCustomGroupingLine => groupingLine.afterRowIndex !== null),
    );
    setHasUnsavedChanges(true);
  }

  function handleToggleCommitmentBoundaryAfterRow(rowIndex: number) {
    const nextBoundaryIndex = rowIndex + 1;
    setCommitmentBoundaryIndex((currentBoundaryIndex) =>
      currentBoundaryIndex === nextBoundaryIndex
        ? null
        : normalizeCommitmentBoundaryIndex(nextBoundaryIndex, rows.length));
    setHasUnsavedChanges(true);
  }

  function handleToggleCustomGroupingLineAfterRow(rowIndex: number) {
    const nextAfterRowIndex = rowIndex + 1;
    const existingGroupingLine = findCustomGroupingLineAtRow(customGroupingLines, nextAfterRowIndex);
    if (existingGroupingLine) {
      setCustomGroupingLines((currentGroupingLines) =>
        currentGroupingLines.filter((groupingLine) => groupingLine.lineId !== existingGroupingLine.lineId));
      setFocusedCustomGroupingLineId(null);
      setExpandedCustomGroupingLineId((currentLineId) =>
        currentLineId === existingGroupingLine.lineId ? null : currentLineId);
      setHasUnsavedChanges(true);
      return;
    }

    const nextGroupingLine = createCustomGroupingLine(nextAfterRowIndex, customGroupingLines.length + 1);
    setCustomGroupingLines((currentGroupingLines) => [...currentGroupingLines, nextGroupingLine]);
    setFocusedCustomGroupingLineId(nextGroupingLine.lineId);
    setExpandedCustomGroupingLineId(nextGroupingLine.lineId);
    setHasUnsavedChanges(true);
  }

  function handleUpdateCustomGroupingLine(
    lineId: string,
    patch: Partial<Omit<PiReviewCustomGroupingLine, 'lineId'>>,
  ) {
    setCustomGroupingLines((currentGroupingLines) =>
      currentGroupingLines.map((groupingLine) => {
        if (groupingLine.lineId !== lineId) {
          return groupingLine;
        }

        const nextColor = patch.color ? normalizeHexColor(patch.color) : groupingLine.color;
        if (nextColor === STRETCH_GOALS_LINE_COLOR) {
          showToast('Stretch Goals keeps the reserved highlight color. Choose a different custom line color.', 'error');
          return groupingLine;
        }

        return {
          ...groupingLine,
          ...patch,
          color: nextColor,
          label: patch.label !== undefined ? patch.label : groupingLine.label,
        };
      }),
    );
    setHasUnsavedChanges(true);
  }

  function handleToggleCustomGroupingLineMenu(lineId: string) {
    setExpandedCustomGroupingLineId((currentLineId) => currentLineId === lineId ? null : lineId);
  }

  function handleConfidenceRowChange(rowId: string, fieldName: keyof ConfidenceVoteRow, nextValue: string) {
    const normalizedNextValue = fieldName === 'confidenceVote'
      ? sanitizeConfidenceVoteValue(nextValue)
      : nextValue;

    setConfidenceRows((currentRows) =>
      currentRows.map((row) =>
        row.rowId === rowId
          ? { ...row, [fieldName]: normalizedNextValue }
          : row,
      ),
    );
    setHasUnsavedChanges(true);
  }

  function handleAddConfidenceRow() {
    const nextRow = createEmptyConfidenceVoteRow();
    nextRow.weekOf = createTodayDateValue();
    setConfidenceRows((currentRows) => [...currentRows, nextRow]);
    setHasUnsavedChanges(true);
  }

  /** Appends a blank Feature row for the user to fill in by hand — for items not pulled from Jira. */
  function handleAddRow() {
    setRows((currentRows) => [...currentRows, createEmptyPiReviewRow()]);
    setHasUnsavedChanges(true);
  }

  /**
   * Brings the Carry-Over-marked Features from a previously-configured PI page onto this one.
   *
   * The prior PI's Confluence page is loaded and parsed with the same reader used everywhere else,
   * so nothing new is invented; only the rows the team ticked as carrying over are appended, each as
   * a fresh row with its Carry-Over box reset. Features already on this page are skipped.
   */
  async function handleCarryOverFromPreviousPi() {
    const sourceTarget = carryOverSourceTargets.find((candidate) => candidate.targetKey === carryOverSourceKey);
    if (!sourceTarget) {
      showToast('Pick which PI to carry Features over from.', 'error');
      return;
    }
    setIsCarryingOver(true);
    try {
      const sourcePage = await fetchConfluencePageByReference(sourceTarget.pageReference);
      const parsedSourceTable = parsePiReviewTable(sourcePage.body.storage.value);
      const carriedRows = buildCarryOverRows(parsedSourceTable?.rows ?? [], rows);
      if (carriedRows.length === 0) {
        showToast(`No Carry-Over items on ${sourceTarget.targetLabel} that aren’t already here.`, 'info');
        return;
      }
      setRows((currentRows) => [...currentRows, ...carriedRows]);
      setHasUnsavedChanges(true);
      showToast(
        `Carried over ${carriedRows.length} Feature${carriedRows.length === 1 ? '' : 's'} from `
          + `${sourceTarget.targetLabel}. Save to Confluence when ready.`,
        'success',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load the previous PI page.';
      showToast(errorMessage, 'error');
    } finally {
      setIsCarryingOver(false);
    }
  }

  function handleRemoveConfidenceRow(rowId: string) {
    setConfidenceRows((currentRows) => currentRows.filter((row) => row.rowId !== rowId));
    setHasUnsavedChanges(true);
  }

  function handleIgnoreEdits() {
    const loadedSnapshot = loadedSnapshotRef.current;
    if (!loadedSnapshot) {
      showToast('Reload the Confluence page before discarding edits for this team.', 'error');
      return;
    }

    applyLoadedSnapshot(loadedSnapshot);
    setLoadError(null);
    setJiraLoadDeltaDetails([]);
    setIsTemplateDraftConfirmationVisible(false);
    setIsEditMode(false);
    showToast(`${target.targetLabel} PI Review edits were discarded.`, 'success');
  }

  function handleToggleJiraDatePasteCard() {
    setIsJiraDatePasteVisible((currentIsJiraDatePasteVisible) => !currentIsJiraDatePasteVisible);
  }

  function updateLoadedSnapshotJiraIssueMap(nextJiraIssueMap: Record<string, JiraIssue>) {
    const loadedSnapshot = loadedSnapshotRef.current;
    if (!loadedSnapshot) {
      return;
    }

    loadedSnapshotRef.current = {
      ...loadedSnapshot,
      jiraIssueMap: nextJiraIssueMap,
    };
  }

  async function refreshVisibleJiraIssueMap() {
    const nextJiraIssueMap = await fetchPiReviewFeatureIssues(rows);
    setJiraIssueMap(nextJiraIssueMap);
    updateLoadedSnapshotJiraIssueMap(nextJiraIssueMap);
  }

  async function loadPiReviewFeatureTransitions(featureKey: string) {
    if (
      (transitionOptionsByFeatureKey[featureKey]?.length ?? 0) > 0
      || isLoadingTransitionByFeatureKey[featureKey]
    ) {
      return;
    }

    setIsLoadingTransitionByFeatureKey((currentLoadingMap) => ({
      ...currentLoadingMap,
      [featureKey]: true,
    }));
    try {
      const transitions = await fetchPiReviewFeatureTransitions(featureKey);
      setTransitionOptionsByFeatureKey((currentTransitionMap) => ({
        ...currentTransitionMap,
        [featureKey]: transitions,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load Jira transitions';
      showToast(errorMessage, 'error');
    } finally {
      setIsLoadingTransitionByFeatureKey((currentLoadingMap) => ({
        ...currentLoadingMap,
        [featureKey]: false,
      }));
    }
  }

  function readMatchingRequiredTransitionFieldIds(
    transitionFields: Record<string, PiReviewTransitionField>,
    missingFieldLabels: string[],
  ): string[] {
    const normalizedMissingLabels = new Set(missingFieldLabels.map((fieldLabel) => normalizeTransitionFieldLabel(fieldLabel)));
    const matchedFieldIds = Object.entries(transitionFields)
      .filter(([, transitionField]) => transitionField.required)
      .filter(([fieldId, transitionField]) =>
        normalizedMissingLabels.has(normalizeTransitionFieldLabel(transitionField.name ?? ''))
        || normalizedMissingLabels.has(normalizeTransitionFieldLabel(fieldId)))
      .map(([fieldId]) => fieldId);
    
    // If no specific matches found, fall back to showing all required fields
    // This handles cases where field name normalization doesn't match Jira's metadata
    if (matchedFieldIds.length === 0) {
      return Object.entries(transitionFields)
        .filter(([, transitionField]) => transitionField.required)
        .map(([fieldId]) => fieldId);
    }
    
    return matchedFieldIds;
  }

  async function refreshFeatureIssueAfterStatusUpdate(featureKey: string) {
    const refreshedIssueMap = await fetchPiReviewFeatureIssues([{ ...createEmptyPiReviewRow(), feature: featureKey }]);
    const refreshedIssue = refreshedIssueMap[featureKey];
    if (!refreshedIssue) {
      return;
    }

    setJiraIssueMap((currentIssueMap) => {
      const nextIssueMap = {
        ...currentIssueMap,
        [featureKey]: refreshedIssue,
      };
      updateLoadedSnapshotJiraIssueMap(nextIssueMap);
      return nextIssueMap;
    });
  }

  function handleToggleStatusPicker(featureKey: string) {
    setIsStatusPickerOpenByFeatureKey((currentOpenState) => {
      const isNextOpen = !currentOpenState[featureKey];
      if (isNextOpen) {
        void loadPiReviewFeatureTransitions(featureKey);
      }

      return {
        ...currentOpenState,
        [featureKey]: isNextOpen,
      };
    });
  }

  function handleRequiredTransitionFieldValueChange(featureKey: string, fieldId: string, nextValue: string) {
    setRequiredTransitionFieldValuesByFeatureKey((currentFieldValuesByFeatureKey) => ({
      ...currentFieldValuesByFeatureKey,
      [featureKey]: {
        ...(currentFieldValuesByFeatureKey[featureKey] ?? {}),
        [fieldId]: nextValue,
      },
    }));
  }

  async function handleTransitionSelection(featureKey: string, transitionId: string) {
    if (transitionId.trim() === '') {
      return;
    }

    setIsSavingTransitionByFeatureKey((currentSavingMap) => ({
      ...currentSavingMap,
      [featureKey]: true,
    }));
    setPendingTransitionIdByFeatureKey((currentPendingMap) => ({
      ...currentPendingMap,
      [featureKey]: transitionId,
    }));
    setRequiredTransitionFieldIdsByFeatureKey((currentFieldIdMap) => ({
      ...currentFieldIdMap,
      [featureKey]: [],
    }));
    setRequiredTransitionFieldValuesByFeatureKey((currentFieldValueMap) => ({
      ...currentFieldValueMap,
      [featureKey]: {},
    }));

    try {
      await savePiReviewFeatureTransition(featureKey, transitionId);
      await refreshFeatureIssueAfterStatusUpdate(featureKey);
      const refreshedTransitions = await fetchPiReviewFeatureTransitions(featureKey);
      setTransitionOptionsByFeatureKey((currentTransitionMap) => ({
        ...currentTransitionMap,
        [featureKey]: refreshedTransitions,
      }));
      setPendingTransitionIdByFeatureKey((currentPendingMap) => ({
        ...currentPendingMap,
        [featureKey]: '',
      }));
      showToast(`${featureKey} status updated.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update Jira status';
      const missingFieldLabels = readMissingFieldLabelsFromTransitionError(errorMessage);
      console.error(`[PiReview] Transition error for ${featureKey}:`, { errorMessage, missingFieldLabels });
      if (missingFieldLabels.length === 0) {
        showToast(errorMessage, 'error');
        return;
      }

      let transitionFields: Record<string, PiReviewTransitionField> = {};
      try {
        transitionFields = await fetchPiReviewTransitionFields(featureKey, transitionId);
        console.error(`[PiReview] Fetched transition fields for ${featureKey}:`, Object.keys(transitionFields));
      } catch (fetchError) {
        console.error(`[PiReview] Failed to fetch transition fields for ${featureKey}:`, fetchError);
        showToast(errorMessage, 'error');
        return;
      }
      const requiredTransitionFieldIds = readMatchingRequiredTransitionFieldIds(transitionFields, missingFieldLabels);
      console.error(`[PiReview] Required field IDs for ${featureKey}:`, requiredTransitionFieldIds);
      if (requiredTransitionFieldIds.length === 0) {
        showToast(errorMessage, 'error');
        return;
      }

      setRequiredTransitionFieldsByFeatureKey((currentTransitionFieldMap) => ({
        ...currentTransitionFieldMap,
        [featureKey]: transitionFields,
      }));
      setRequiredTransitionFieldIdsByFeatureKey((currentFieldIdMap) => ({
        ...currentFieldIdMap,
        [featureKey]: requiredTransitionFieldIds,
      }));
      showToast(`Jira requires ${missingFieldLabels.join(', ')} before moving ${featureKey}.`, 'error');
    } finally {
      setIsSavingTransitionByFeatureKey((currentSavingMap) => ({
        ...currentSavingMap,
        [featureKey]: false,
      }));
    }
  }

  async function handleApplyMissingTransitionFields(featureKey: string) {
    const pendingTransitionId = pendingTransitionIdByFeatureKey[featureKey] ?? '';
    if (pendingTransitionId.trim() === '') {
      showToast('Choose a status before applying required Jira fields.', 'error');
      return;
    }

    const requiredFieldIds = requiredTransitionFieldIdsByFeatureKey[featureKey] ?? [];
    const fieldValuesForFeature = requiredTransitionFieldValuesByFeatureKey[featureKey] ?? {};
    const hasMissingInput = requiredFieldIds.some((fieldId) => (fieldValuesForFeature[fieldId] ?? '').trim() === '');
    if (hasMissingInput) {
      showToast('Fill each required Jira field before retrying the status move.', 'error');
      return;
    }

    setIsRetryingTransitionByFeatureKey((currentRetryState) => ({
      ...currentRetryState,
      [featureKey]: true,
    }));
    try {
      await savePiReviewTransitionRequiredFields(
        featureKey,
        fieldValuesForFeature,
        requiredTransitionFieldsByFeatureKey[featureKey] ?? {},
      );
      await savePiReviewFeatureTransition(featureKey, pendingTransitionId);
      await refreshFeatureIssueAfterStatusUpdate(featureKey);
      const refreshedTransitions = await fetchPiReviewFeatureTransitions(featureKey);
      setTransitionOptionsByFeatureKey((currentTransitionMap) => ({
        ...currentTransitionMap,
        [featureKey]: refreshedTransitions,
      }));
      setRequiredTransitionFieldIdsByFeatureKey((currentFieldIdMap) => ({
        ...currentFieldIdMap,
        [featureKey]: [],
      }));
      setRequiredTransitionFieldValuesByFeatureKey((currentFieldValueMap) => ({
        ...currentFieldValueMap,
        [featureKey]: {},
      }));
      setPendingTransitionIdByFeatureKey((currentPendingMap) => ({
        ...currentPendingMap,
        [featureKey]: '',
      }));
      showToast(`${featureKey} status updated.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update Jira status';
      showToast(errorMessage, 'error');
    } finally {
      setIsRetryingTransitionByFeatureKey((currentRetryState) => ({
        ...currentRetryState,
        [featureKey]: false,
      }));
    }
  }

  /**
   * Renders the Jira status pill and its transition editor for one feature row.
   *
   * Shared by the view and edit renderings of the Feature cell. Editing is precisely when a PO needs
   * this context — they are deciding what to write BECAUSE of where the feature currently stands —
   * so hiding it behind edit mode forced them to leave the row to find out.
   *
   * `rowContextLabel` only distinguishes the accessible names when several rows are on screen.
   */
  function renderFeatureStatusActions(
    featureKey: string | null,
    jiraIssue: JiraIssue | undefined,
    rowContextLabel: string,
  ): React.JSX.Element | null {
    if (!featureKey || !jiraIssue) {
      return null;
    }

    const requiredFieldIds = requiredTransitionFieldIdsByFeatureKey[featureKey] ?? [];

    return (
      <div className={styles.featureStatusActions} data-export-exclude="true">
        <button
          className={styles.featureStatusPillButton}
          disabled={isToolbarBusy || isSavingTransitionByFeatureKey[featureKey]}
          onClick={() => handleToggleStatusPicker(featureKey)}
          type="button"
        >
          Status: {jiraIssue.fields.status.name}
        </button>
        {isStatusPickerOpenByFeatureKey[featureKey] ? (
          <div className={styles.featureStatusControlRow}>
            <label className={styles.featureStatusLabel}>
              <span>Change Status</span>
              <select
                aria-label={`Change Jira status for ${featureKey} in ${rowContextLabel}`}
                className={styles.featureStatusSelect}
                disabled={isToolbarBusy || isSavingTransitionByFeatureKey[featureKey] || isLoadingTransitionByFeatureKey[featureKey]}
                onChange={(event) => void handleTransitionSelection(featureKey, event.target.value)}
                onFocus={() => void loadPiReviewFeatureTransitions(featureKey)}
                value=""
              >
                <option value="">{isLoadingTransitionByFeatureKey[featureKey] ? 'Loading transitions…' : 'Select transition…'}</option>
                {(transitionOptionsByFeatureKey[featureKey] ?? []).map((jiraTransition) => (
                  <option key={jiraTransition.id} value={jiraTransition.id}>
                    {jiraTransition.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {requiredFieldIds.length > 0 ? (
          <div className={styles.requiredTransitionFieldCard}>
            <strong className={styles.requiredTransitionTitle}>Jira missing required fields</strong>
            {requiredFieldIds.map((fieldId) => {
              const transitionField = requiredTransitionFieldsByFeatureKey[featureKey]?.[fieldId];
              const fieldLabel = transitionField?.name ?? fieldId;
              const allowedValueOptions = (transitionField?.allowedValues ?? [])
                .map((allowedValue) => readTransitionAllowedValueOption(allowedValue))
                .filter((option): option is { label: string; value: string } => option !== null);
              const currentValue = requiredTransitionFieldValuesByFeatureKey[featureKey]?.[fieldId] ?? '';
              return (
                <label className={styles.featureStatusLabel} key={fieldId}>
                  <span>{fieldLabel}</span>
                  {allowedValueOptions.length > 0 ? (
                    <select
                      aria-label={`${fieldLabel} for ${featureKey}`}
                      className={styles.featureStatusSelect}
                      disabled={isToolbarBusy || isRetryingTransitionByFeatureKey[featureKey]}
                      onChange={(event) => handleRequiredTransitionFieldValueChange(featureKey, fieldId, event.target.value)}
                      value={currentValue}
                    >
                      <option value="">Select {fieldLabel}…</option>
                      {allowedValueOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`${fieldLabel} for ${featureKey}`}
                      className={styles.featureStatusInput}
                      disabled={isToolbarBusy || isRetryingTransitionByFeatureKey[featureKey]}
                      onChange={(event) => handleRequiredTransitionFieldValueChange(featureKey, fieldId, event.target.value)}
                      placeholder={fieldId === 'parent' ? 'Issue key (for example ART-1234)' : `Enter ${fieldLabel}`}
                      type="text"
                      value={currentValue}
                    />
                  )}
                </label>
              );
            })}
            <button
              className={styles.rowToolButton}
              disabled={isToolbarBusy || isRetryingTransitionByFeatureKey[featureKey]}
              onClick={() => void handleApplyMissingTransitionFields(featureKey)}
              type="button"
            >
              {isRetryingTransitionByFeatureKey[featureKey] ? 'Applying…' : 'Apply Fields & Retry'}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function buildNextPiReviewStorageValue(
    baseStorageValue: string,
    nextPiReviewTableBinding: PiReviewTableBinding,
    nextConfidenceTableBinding: ConfidenceVoteTableBinding | null,
    capacitySummaryForSave: CapacitySummary | null,
    rowsForSave: PiReviewRow[],
    confidenceRowsForSave: ConfidenceVoteRow[],
    commitmentBoundaryIndexForSave: number | null,
    customGroupingLinesForSave: PiReviewCustomGroupingLine[],
  ): string {
    let nextStorageValue = writePiReviewCapacitySummary(baseStorageValue, capacitySummaryForSave);
    nextStorageValue = writePiReviewTable(
      nextStorageValue,
      nextPiReviewTableBinding,
      rowsForSave,
      commitmentBoundaryIndexForSave,
      customGroupingLinesForSave,
    );
    if (confidenceRowsForSave.length > 0 || nextConfidenceTableBinding !== null) {
      nextStorageValue = writeConfidenceVoteTable(nextStorageValue, nextConfidenceTableBinding, confidenceRowsForSave);
    }
    return nextStorageValue;
  }

  async function handleSaveToConfluence() {
    if (pageVersionNumber === null || resolvedPageId === '') {
      showToast('Load the Confluence page before saving changes from Toolbox.', 'error');
      return;
    }

    if (!tableBinding) {
      setLoadError(PI_REVIEW_TEMPLATE_REQUIRED_MESSAGE);
      showToast(PI_REVIEW_TEMPLATE_REQUIRED_MESSAGE, 'error');
      return;
    }

    const capacitySummaryForSave = liveCapacitySummary ?? savedCapacitySummary;
    setIsSaving(true);
    setLoadError(null);
    try {
      const latestJiraIssueMap = await fetchPiReviewFeatureIssues(rows);
      const saveReconciliationResult = reconcilePiReviewRowsWithJira(rows, latestJiraIssueMap, {
        shouldQueueEstimateUpdates: true,
      });
      if (saveReconciliationResult.pendingEstimateUpdates.length > 0) {
        await savePiReviewFeatureEstimates(saveReconciliationResult.pendingEstimateUpdates);
      }

      const finalJiraIssueMap = { ...latestJiraIssueMap };
      for (const estimateUpdate of saveReconciliationResult.pendingEstimateUpdates) {
        const currentIssue = finalJiraIssueMap[estimateUpdate.featureKey];
        if (!currentIssue) {
          continue;
        }

        // Reflect the just-written estimate into the primary story-points field so the final
        // reconcile sees Jira as now populated — the SAME field the reader checks, not the old
        // numeric one it no longer reads.
        finalJiraIssueMap[estimateUpdate.featureKey] = {
          ...currentIssue,
          fields: {
            ...currentIssue.fields,
            [getStoryPointsCandidateFieldIds()[0]]: estimateUpdate.estimate,
          },
        };
      }
      const finalReconciliationResult = reconcilePiReviewRowsWithJira(
        saveReconciliationResult.rows,
        finalJiraIssueMap,
      );
      const rowsForSave = finalReconciliationResult.rows;

      let updatedPage;
      try {
        updatedPage = await updateConfluencePage({
          pageId: resolvedPageId,
          pageTitle: pageTitle || target.targetLabel,
          storageValue: buildNextPiReviewStorageValue(
            storageValue,
            tableBinding,
            confidenceTableBinding,
            capacitySummaryForSave,
            rowsForSave,
            confidenceRows,
            commitmentBoundaryIndex,
            customGroupingLines,
          ),
          nextVersionNumber: pageVersionNumber + 1,
        });
      } catch (error) {
        if (!isConfluenceVersionConflictError(error)) {
          throw error;
        }

        const latestConfluencePage = await fetchConfluencePageByReference(target.pageReference);
        const latestPiReviewTable = parsePiReviewTable(latestConfluencePage.body.storage.value);
        const latestConfidenceTable = parseConfidenceVoteTable(latestConfluencePage.body.storage.value);
        updatedPage = await updateConfluencePage({
          pageId: latestConfluencePage.id || resolvedPageId,
          pageTitle: latestConfluencePage.title || pageTitle || target.targetLabel,
          storageValue: buildNextPiReviewStorageValue(
            latestConfluencePage.body.storage.value,
            latestPiReviewTable.tableBinding,
            latestConfidenceTable.tableBinding,
            capacitySummaryForSave,
            rowsForSave,
            confidenceRows,
            commitmentBoundaryIndex,
            customGroupingLines,
          ),
          nextVersionNumber: latestConfluencePage.version.number + 1,
        });
      }

      const parsedPiReviewTable = parsePiReviewTable(updatedPage.body.storage.value);
      const parsedConfidenceTable = parseConfidenceVoteTable(updatedPage.body.storage.value);
      const parsedCapacitySummary = parsePiReviewCapacitySummary(updatedPage.body.storage.value);
      const refreshedJiraIssueMap = await fetchPiReviewFeatureIssues(parsedPiReviewTable.rows);
      const refreshedReconciliationResult = reconcilePiReviewRowsWithJira(parsedPiReviewTable.rows, refreshedJiraIssueMap);
      const refreshedSnapshot: PiReviewLoadedSnapshot = {
        rows: refreshedReconciliationResult.rows,
        confidenceRows: parsedConfidenceTable.rows,
        savedCapacitySummary: parsedCapacitySummary,
        tableBinding: parsedPiReviewTable.tableBinding,
        confidenceTableBinding: parsedConfidenceTable.tableBinding,
        visibleOptionalColumns: readOptionalColumnsFromBinding(parsedPiReviewTable.tableBinding),
        commitmentBoundaryIndex: parsedPiReviewTable.commitmentBoundaryIndex,
        customGroupingLines: parsedPiReviewTable.customGroupingLines,
        jiraIssueMap: refreshedJiraIssueMap,
        hasUnsavedChanges: refreshedReconciliationResult.hasChanges,
      };
      loadedSnapshotRef.current = refreshedSnapshot;
      setHasLoadedSnapshot(true);
      applyLoadedSnapshot(refreshedSnapshot);
      setStorageValue(updatedPage.body.storage.value);
      setPageTitle(updatedPage.title);
      setResolvedPageId(updatedPage.id);
      setPageVersionNumber(updatedPage.version.number);
      setIsEditMode(false);
      setJiraLoadDeltaDetails([]);
      showToast(`${target.targetLabel} PI Review saved to Confluence ✓`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save the PI Review page';
      setLoadError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApplyPastedJiraDates() {
    if (jiraDatePasteValue.trim() === '') {
      showToast('Paste a Jira date table before applying updates.', 'error');
      return;
    }

    setIsUpdatingJiraDates(true);
    try {
      const dateUpdates = parsePiReviewFeatureDateUpdates(jiraDatePasteValue);
      await savePiReviewFeatureDates(dateUpdates);
      await refreshVisibleJiraIssueMap();
      setIsJiraDatePasteVisible(false);
      setJiraDatePasteValue('');
      showToast(`Updated Jira dates for ${dateUpdates.length} feature(s).`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update Jira dates';
      showToast(errorMessage, 'error');
    } finally {
      setIsUpdatingJiraDates(false);
    }
  }

  const isExportingPanel = isExportingImage;
  const isToolbarBusy = isLoading || isSaving || isExportingPanel || isUpdatingJiraDates
    || isPullingFeatures || isCarryingOver;
  const hasPendingConfluenceRewrite = useMemo(() => {
    if (!tableBinding || pageVersionNumber === null || resolvedPageId === '') {
      return false;
    }

    try {
      return buildNextPiReviewStorageValue(
        storageValue,
        tableBinding,
        confidenceTableBinding,
        liveCapacitySummary ?? savedCapacitySummary,
        rows,
        confidenceRows,
        commitmentBoundaryIndex,
        customGroupingLines,
      ) !== storageValue;
    } catch {
      return false;
    }
  }, [
    commitmentBoundaryIndex,
    confidenceRows,
    confidenceTableBinding,
    customGroupingLines,
    liveCapacitySummary,
    pageVersionNumber,
    resolvedPageId,
    rows,
    savedCapacitySummary,
    storageValue,
    tableBinding,
  ]);
  const canSaveToConfluence = hasUnsavedChanges || (isEditMode && hasPendingConfluenceRewrite);
  const isSaveToConfluenceDisabled =
    isToolbarBusy
    || !canSaveToConfluence
    || pageVersionNumber === null
    || resolvedPageId === ''
    || !tableBinding;

  async function handleExportPanelImage() {
    const pagePanelElement = pagePanelRef.current;
    if (!pagePanelElement) {
      showToast('Load the PI Review panel before exporting the PNG screenshot.', 'error');
      return;
    }

    const wasEditMode = !isReadoutMode && isEditMode;
    setIsExportingImage(true);

    try {
      // Export the clean document view so shared snapshots look like the Confluence document, not the editor.
      if (wasEditMode) {
        flushSync(() => {
          setIsEditMode(false);
        });
        await waitForNextPaint();
        await waitForNextPaint();
      }

      if (!pagePanelRef.current) {
        throw new Error('The PI Review panel is no longer available to export.');
      }

      const exportFileName = createPiReviewExportFileName(effectivePiName, target.targetLabel);
      await downloadPiReviewPanelImage(pagePanelRef.current, exportFileName);
      showToast(`${target.targetLabel} PI Review PNG downloaded.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : 'Failed to export the PI Review PNG';
      showToast(errorMessage, 'error');
    } finally {
      if (wasEditMode) {
        flushSync(() => {
          setIsEditMode(true);
        });
      }
      setIsExportingImage(false);
    }
  }

  return (
    <section aria-label={`${target.targetLabel} PI Review`} className={styles.pagePanel} ref={pagePanelRef}>
      <div className={styles.statusRow}>
        <div>
          <h3>{target.targetLabel}</h3>
          <p className={styles.summaryValue}>
            {canEditContent
              ? 'Edit mode is on. Structural table tools are available below.'
              : isReadoutMode
                ? 'Readout mode is on. Use Team Dashboard to create or maintain this document.'
                : 'View mode is on. Switch to Edit PI Review to change the document.'}
          </p>
        </div>
        <div className={styles.panelStatusActions} data-export-exclude="true">
          {canShowAuthoringToolbar && hasUnsavedChanges && <span className={styles.dirtyBadge}>Unsaved changes</span>}
          {canShowAuthoringToolbar ? (
            <button
              aria-pressed={isEditMode}
              className={joinClassNames(styles.actionButton, styles.actionButtonPrimary)}
              disabled={isToolbarBusy || !tableBinding}
              onClick={() => {
                setIsEditMode((currentIsEditMode) => !currentIsEditMode);
                setIsJiraDatePasteVisible(false);
              }}
              type="button"
            >
              {isEditMode ? 'Done Editing' : 'Edit PI Review'}
            </button>
          ) : (
            <a
              className={styles.authoringLink}
              href={TEAM_DASHBOARD_ROUTE}
              onClick={() => openTeamDashboardPiReviewWorkspace(target.team)}
            >
              Edit in Team Dashboard
            </a>
          )}
        </div>
      </div>

      <div className={styles.pageSummaryCard}>
        <div>
          <div className={styles.summaryLabel}>Selected PI</div>
          <div className={styles.summaryValue}>{effectivePiName.trim() || 'No PI selected'}</div>
        </div>
        <div>
          <div className={styles.summaryLabel}>Configured page URL or ID</div>
          <div className={styles.summaryValue}>
            {buildConfluencePageUrl(target.pageReference, resolvedPageId, confluenceBaseUrl) ? (
              <a
                className={styles.confluencePageReferenceLink}
                href={buildConfluencePageUrl(target.pageReference, resolvedPageId, confluenceBaseUrl) ?? '#'}
                rel="noreferrer"
                target="_blank"
              >
                {target.pageReference}
              </a>
            ) : (
              target.pageReference
            )}
          </div>
        </div>
        <div>
          <div className={styles.summaryLabel}>Resolved page ID</div>
          <div className={styles.summaryValue}>{resolvedPageId || 'Not resolved yet'}</div>
        </div>
        <div>
          <div className={styles.summaryLabel}>Page title</div>
          <div className={styles.summaryValue}>{pageTitle || 'Not loaded yet'}</div>
        </div>
        <div>
          <div className={styles.summaryLabel}>Page version</div>
          <div className={styles.summaryValue}>{pageVersionNumber ?? 'Not loaded yet'}</div>
        </div>
        {lastLoadedAt !== null && (
          <div>
            <div className={styles.summaryLabel}>Last synced from Confluence</div>
            <div className={styles.summaryValue}>
              <span className={styles.lastSyncedPill}>{lastLoadedAt}</span>
            </div>
          </div>
        )}
      </div>

        <div className={styles.toolbar} data-export-exclude="true">
          <button
            className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
            disabled={isToolbarBusy}
            onClick={() => void loadPiReviewPage()}
            title="Pull the latest content from Confluence. Note: Priority, Dependencies, Risks, and Points are always refreshed from Jira."
            type="button"
          >
          {isLoading ? 'Loading…' : 'Reload from Confluence'}
          </button>

          <button
            className={joinClassNames(styles.actionButton, styles.actionButtonExport)}
            disabled={rows.length === 0 || isToolbarBusy}
            onClick={() => downloadPiReviewCsv(rows, effectivePiName, target.targetLabel)}
            type="button"
          >
            Export PI Review CSV
          </button>
          <button
            className={joinClassNames(styles.actionButton, styles.actionButtonExport)}
            disabled={!canExportPanelImage || isToolbarBusy}
            onClick={() => void handleExportPanelImage()}
            type="button"
          >
            {isExportingImage ? 'Exporting PNG…' : 'Export PI Review PNG'}
          </button>
        {canShowAuthoringToolbar && (
          <>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSuccess)}
              disabled={isSaveToConfluenceDisabled}
              onClick={() => void handleSaveToConfluence()}
              type="button"
            >
              {isSaving ? 'Saving…' : 'Save to Confluence'}
            </button>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonDanger)}
              disabled={isToolbarBusy || !hasUnsavedChanges || !hasLoadedSnapshot}
              onClick={handleIgnoreEdits}
              type="button"
            >
              Ignore Edits
            </button>
          </>
        )}
        {canEditContent && (
          <>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
              disabled={isToolbarBusy || !tableBinding
                || (includeFullRoster ? rosterMembers.length === 0 : productOwners.length === 0)}
              onClick={() => void handlePullFeatures()}
              type="button"
            >
              {isPullingFeatures ? 'Pulling…' : 'Pull Features from Jira'}
            </button>
            <label className={styles.pullFeaturesHint} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={includeFullRoster}
                disabled={isToolbarBusy}
                onChange={(changeEvent) => setIncludeFullRoster(changeEvent.target.checked)}
              />
              Include full roster
            </label>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
              disabled={isToolbarBusy || !tableBinding}
              onClick={handleAddRow}
              type="button"
            >
              Add row
            </button>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
              disabled={isToolbarBusy || !tableBinding}
              onClick={handleToggleJiraDatePasteCard}
              type="button"
            >
              {isJiraDatePasteVisible ? 'Hide Jira Date Paste' : 'Paste & Update Jira Dates'}
            </button>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
              disabled={isToolbarBusy || !tableBinding}
              onClick={handleAddConfidenceRow}
              type="button"
            >
              Add Confidence Week
            </button>
            {carryOverSourceTargets.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <select
                  aria-label="Carry over Features from a previous PI"
                  value={carryOverSourceKey}
                  disabled={isToolbarBusy}
                  onChange={(changeEvent) => setCarryOverSourceKey(changeEvent.target.value)}
                >
                  <option value="">Carry over from…</option>
                  {carryOverSourceTargets.map((sourceTarget) => (
                    <option key={sourceTarget.targetKey} value={sourceTarget.targetKey}>
                      {sourceTarget.targetLabel}
                    </option>
                  ))}
                </select>
                <button
                  className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
                  disabled={isToolbarBusy || !tableBinding || carryOverSourceKey === ''}
                  onClick={() => void handleCarryOverFromPreviousPi()}
                  type="button"
                >
                  {isCarryingOver ? 'Carrying over…' : 'Carry over'}
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {canEditContent && (
        <p className={styles.pullFeaturesHint} data-export-exclude="true">
          {includeFullRoster ? (
            rosterMembers.length > 0 ? (
              <>
                <strong>Pull Features from Jira</strong> adds every Feature in{' '}
                <strong>{effectivePiName.trim() || 'the selected PI'}</strong> assigned to <strong>any of the
                {' '}{rosterMembers.length} roster members</strong> — including Features held by whoever is doing the
                work, not just the Product Owner. Safe to re-run: new Features are appended and your Carry-Over,
                Committed and Notes entries are never touched.
              </>
            ) : (
              'The team roster is empty. Import a roster to enable Pull Features from Jira.'
            )
          ) : productOwners.length > 0 ? (
            <>
              <strong>Pull Features from Jira</strong> adds every Feature in{' '}
              <strong>{effectivePiName.trim() || 'the selected PI'}</strong> assigned to{' '}
              <strong>{productOwners.map((productOwner) => productOwner.displayName).join(', ')}</strong>. Missing
              Features assigned to others? Tick <strong>Include full roster</strong>. Safe to re-run: new Features
              are appended and your Carry-Over, Committed and Notes entries are never touched.
            </>
          ) : (
            'No Product Owner is flagged in the team roster. Mark a roster member as Product Owner, or tick “Include full roster”, to enable Pull Features from Jira.'
          )}
        </p>
      )}
      {canShowAuthoringToolbar && <PiReviewSizingCard />}
      {canEditContent && (
        <div data-export-exclude="true">
          <PiReviewAiPanel
            columnAvailability={{
              // Dev Work and Test Support are optional columns — only ask the model for a verdict
              // this page's table can actually record.
              hasDevWorkColumn: visibleOptionalColumns.has('devWork'),
              hasTestSupportColumn: visibleOptionalColumns.has('testSupport'),
            }}
            onApplySuggestion={handleApplyAiSuggestion}
            rows={rows}
          />
        </div>
      )}
      {jiraLoadDeltaDetails.length > 0 && (
        <details className={styles.deltaBanner} data-export-exclude="true">
          <summary className={styles.deltaBannerSummary}>
            {`Jira updated ${jiraLoadDeltaDetails.length} field${jiraLoadDeltaDetails.length !== 1 ? 's' : ''} across ${new Set(jiraLoadDeltaDetails.map((change) => change.featureKey)).size} feature${new Set(jiraLoadDeltaDetails.map((change) => change.featureKey)).size !== 1 ? 's' : ''} on load — click to see details`}
          </summary>
          <p className={styles.deltaBannerHint}>
            These fields are always read from Jira. Use <strong>Save to Confluence</strong> to write these Jira values back to Confluence.
          </p>
          <ul className={styles.deltaChangeList}>
            {jiraLoadDeltaDetails.map((change, changeIndex) => (
              <li
                className={styles.deltaChangeItem}
                key={`${change.featureKey}-${change.fieldLabel}-${changeIndex}`}
              >
                <span className={styles.deltaFeatureKey}>{change.featureKey}</span>
                <span className={styles.deltaFieldLabel}>{change.fieldLabel}</span>
                {change.oldValue.trim() !== '' && (
                  <span className={styles.deltaOldValue} title="Previous Confluence value">{change.oldValue}</span>
                )}
                <span className={styles.deltaArrow}>→</span>
                <span className={styles.deltaNewValue} title="New value from Jira">{change.newValue || '(cleared)'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {tableBinding && canEditContent && isJiraDatePasteVisible && (
        <fieldset className={styles.tableTools} data-export-exclude="true">
          <legend>Jira date updates</legend>
          <p className={styles.summaryValue}>
            Paste a markdown table or a direct Excel tab paste with Jira Key, Target Start, Target End, and Due Date.
            Toolbox will update Jira immediately using the PI Review date field IDs already configured in ART Settings.
          </p>
          <textarea
            aria-label={`Jira date paste for ${target.targetLabel}`}
            className={styles.cellTextarea}
            onChange={(event) => setJiraDatePasteValue(event.target.value)}
            placeholder={JIRA_DATE_PASTE_PLACEHOLDER}
            value={jiraDatePasteValue}
          />
          <div className={styles.confirmActions}>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSuccess)}
              disabled={isToolbarBusy}
              onClick={() => void handleApplyPastedJiraDates()}
              type="button"
            >
              {isUpdatingJiraDates ? 'Updating Jira Dates…' : 'Apply Jira Date Updates'}
            </button>
            <button
              className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
              disabled={isToolbarBusy}
              onClick={() => {
                setJiraDatePasteValue('');
                setIsJiraDatePasteVisible(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {isPiReviewTemplateRequired ? (
        <p className={styles.syncedHelperText}>{PI_REVIEW_TEMPLATE_REQUIRED_MESSAGE}</p>
      ) : null}

      <div className={styles.documentStats}>
        <span className={styles.statBadge}>
          Stretch Goals line: {commitmentBoundaryIndex === null ? 'Not set' : `after row ${commitmentBoundaryIndex}`}
        </span>
        <span className={styles.statBadge}>Custom lines: {customGroupingLines.length}</span>
        <span className={styles.statBadge}>Committed points: {formatCapacityValue(committedPointTotal)}</span>
      </div>

      {tableBinding && canEditContent && (
        <fieldset className={styles.tableTools} data-export-exclude="true">
          <legend>Table tools</legend>
          <span className={styles.summaryValue}>Optional checkbox columns:</span>
          {OPTIONAL_PI_REVIEW_COLUMN_KEYS.map((columnKey) => {
            const hasColumnVisible = visibleOptionalColumns.has(columnKey);
            return (
              <button
                aria-pressed={hasColumnVisible}
                className={`${styles.columnToggleButton} ${hasColumnVisible ? styles.columnToggleButtonActive : ''}`.trim()}
                disabled={isLoading || isSaving}
                key={columnKey}
                onClick={() => handleToggleOptionalColumn(columnKey)}
                type="button"
              >
                {hasColumnVisible ? 'Remove' : 'Add'} {PI_REVIEW_COLUMN_LABELS[columnKey]}
              </button>
            );
          })}
        </fieldset>
      )}

      <section className={styles.capacityPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <h4 className={styles.capacityTitle}>Team Capacity</h4>
            <p className={styles.summaryValue}>
              This snapshot comes from the PI Review planning workspace and is saved into Confluence above the PI Review table.
            </p>
          </div>
        </div>
        {displayedCapacitySummary ? (
          <>
            <div className={styles.capacitySummaryGrid}>
              <div className={styles.capacitySummaryCard}>
                <span className={styles.summaryLabel}>Plan</span>
                <strong>{displayedCapacitySummary.summaryLabel}</strong>
              </div>
              <div className={styles.capacitySummaryCard}>
                <span className={styles.summaryLabel}>Date Range</span>
                <strong>{displayedCapacitySummary.startDate || 'Not set'} to {displayedCapacitySummary.endDate || 'Not set'}</strong>
              </div>
              <div className={styles.capacitySummaryCard}>
                <span className={styles.summaryLabel}>Work Days</span>
                <strong>{formatCapacityValue(displayedCapacitySummary.workDayCount)}</strong>
              </div>
              <div className={styles.capacitySummaryCard}>
                <span className={styles.summaryLabel}>100% Capacity (pts)</span>
                <strong>{formatCapacityValue(displayedCapacitySummary.totalCapacityPoints)}</strong>
              </div>
              <div className={styles.capacitySummaryCard}>
                <span className={styles.summaryLabel}>80% Capacity (pts)</span>
                <strong>{formatCapacityValue(displayedCapacitySummary.recommendedCapacityPoints)}</strong>
              </div>
            </div>
            <div className={styles.capacityRoleList}>
              {Object.entries(displayedCapacitySummary.roleCapacities)
                .filter(([, capacityValue]) => capacityValue > 0)
                .map(([teamRole, capacityValue]) => (
                  <span className={styles.capacityRoleBadge} key={teamRole}>
                    {teamRole}: {formatCapacityValue(capacityValue)} pts
                  </span>
                ))}
            </div>
          </>
        ) : (
          <p className={styles.summaryValue}>
            No capacity plan has been saved for {target.targetLabel} yet. Use the Team Dashboard PI Review workspace to publish one here.
          </p>
        )}
      </section>

      {loadError && (
        <div className={styles.recoveryCard}>
          <p className={styles.errorText}>{loadError}</p>
          {canShowAuthoringToolbar && (
            <>
              <p className={styles.summaryValue}>
                If this page should be managed by Toolbox, load the canonical PI Review template locally first.
                Your Confluence page will not change until you save the completed table.
              </p>
              <button
                className={joinClassNames(styles.actionButton, styles.actionButtonPrimary)}
                disabled={isLoading || isSaving || pageVersionNumber === null || resolvedPageId === ''}
                onClick={() => setIsTemplateDraftConfirmationVisible(true)}
                type="button"
              >
                Load Toolbox PI Review template locally
              </button>
            </>
          )}
        </div>
      )}

      {canShowAuthoringToolbar && isTemplateDraftConfirmationVisible && (
        <div className={styles.confirmCard}>
          <strong>Start a local Toolbox PI Review draft?</strong>
          <p className={styles.summaryValue}>
            Toolbox will load a blank PI Review table and confidence tracking table in this tab.
            The Confluence page will only be overwritten after you fill out the draft and click Save to Confluence.
          </p>
          <div className={styles.confirmActions}>
            <button className={joinClassNames(styles.actionButton, styles.actionButtonPrimary)} disabled={isSaving} onClick={handleLoadToolboxTemplateDraft} type="button">
              Start local draft
            </button>
            <button className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)} disabled={isSaving} onClick={() => setIsTemplateDraftConfirmationVisible(false)} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isLoading && rows.length === 0 && !loadError && (
        <p className={styles.summaryValue}>
          {canEditContent
            ? 'No PI Review rows yet. Use Pull Features from Jira to bring in this PI’s Features.'
            : canShowAuthoringToolbar
              ? 'No PI Review rows have been added yet. Switch to Edit PI Review to start building this page from Toolbox.'
              : 'No PI Review rows have been added yet. Open this team in Team Dashboard to build the document.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className={styles.tableShell} data-export-expand="true">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                {visiblePiReviewColumnKeys.map((columnKey) => (
                  <th key={columnKey} scope="col">{PI_REVIEW_COLUMN_LABELS[columnKey]}</th>
                ))}
                {canEditContent && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const isBoundaryBelowRow = commitmentBoundaryIndex === rowIndex + 1;
                const customGroupingLineBelowRow = findCustomGroupingLineAtRow(customGroupingLines, rowIndex + 1);
                const canSetBoundaryBelowRow = rowIndex < rows.length;
                const canMoveRowUp = rowIndex > 0;
                const canMoveRowDown = rowIndex < rows.length - 1;
                const featureKey = extractPiReviewFeatureKey(row.feature);
                const jiraIssue = featureKey ? jiraIssueMap[featureKey] : undefined;

                return (
                  <Fragment key={row.rowId}>
                    <tr>
                      {visiblePiReviewColumnKeys.map((columnKey) => {
                        const isLongTextColumn = LONG_TEXT_COLUMNS.has(columnKey);
                        const isCheckboxColumn = CHECKBOX_COLUMNS.has(columnKey);
                        const isJiraSyncedColumn = columnKey === 'priority' || columnKey === 'dependency' || columnKey === 'risks';
                        // Dependency/Risks are long columns but read-only in edit mode — give them a compact
                        // width there so the editable columns and Actions keep the table inside the window.
                        const isSyncedReadOnlyLongColumn = canEditContent && isJiraSyncedColumn && isLongTextColumn;
                        const cellClassName = columnKey === FEATURE_COLUMN_KEY
                          ? styles.featureCell
                          : isSyncedReadOnlyLongColumn
                            ? styles.syncedLongCell
                            : isLongTextColumn
                              ? styles.longCell
                              : styles.shortCell;

                        return (
                          <td className={cellClassName} key={columnKey}>
                            {canEditContent && isCheckboxColumn ? (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                checked={row[columnKey] === 'Yes'}
                                className={styles.checkboxInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.checked ? 'Yes' : '')}
                                type="checkbox"
                              />
                            ) : canEditContent && columnKey === FEATURE_COLUMN_KEY ? (
                              <div className={styles.featureEditor}>
                                <input
                                  aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                  className={styles.cellInput}
                                  onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                  type="text"
                                  value={row[columnKey]}
                                />
                                {jiraIssue?.fields.summary && (
                                  <span className={styles.syncedHelperText}>View mode will show: {jiraIssue.key} - {jiraIssue.fields.summary}</span>
                                )}
                                <PiReviewFeatureDatePills jiraIssue={jiraIssue} />
                                {renderFeatureStatusActions(featureKey, jiraIssue, `${target.targetLabel} row ${rowIndex + 1}`)}
                              </div>
                            ) : canEditContent && isJiraSyncedColumn ? (
                              <div className={styles.syncedValueBox}>
                                <div className={isLongTextColumn ? styles.readOnlyMultilineValue : styles.readOnlyValue}>
                                  {formatPiReviewCellValue(columnKey, row[columnKey])}
                                </div>
                                <span className={styles.syncedHelperText}>Synced from Jira issue links and priority.</span>
                              </div>
                            ) : canEditContent && isLongTextColumn ? (
                              <textarea
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellTextarea}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                value={row[columnKey]}
                              />
                            ) : canEditContent && columnKey === 'pointEstimate' && jiraIssue?.fields.customfield_10111 !== null && jiraIssue?.fields.customfield_10111 !== undefined ? (
                              <div className={styles.featureEditor}>
                                <input
                                  aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                  className={styles.cellInput}
                                  onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                  type="text"
                                  value={row[columnKey]}
                                />
                                <span className={styles.syncedHelperText}>Jira already has the feature estimate and will remain the source of truth.</span>
                              </div>
                            ) : canEditContent ? (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                type="text"
                                value={row[columnKey]}
                              />
                            ) : (
                              columnKey === FEATURE_COLUMN_KEY ? (
                                <div className={styles.featureDisplayValue}>
                                  <div className={styles.readOnlyValue}>
                                    {featureKey ? (
                                      <span>
                                        <a
                                          className={styles.featureIssueLink}
                                          href={createPiReviewIssueBrowseUrl(featureKey)}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {featureKey}
                                        </a>
                                        {jiraIssue?.fields.summary ? ` - ${jiraIssue.fields.summary}` : ''}
                                      </span>
                                    ) : (
                                      formatPiReviewFeatureDisplayValue(row.feature, jiraIssue)
                                    )}
                                  </div>
                                  <PiReviewFeatureDatePills jiraIssue={jiraIssue} />
                                  {renderFeatureStatusActions(featureKey, jiraIssue, `${target.targetLabel} row ${rowIndex + 1}`)}
                                </div>
                              ) : isCheckboxColumn ? (
                                renderPiReviewCheckboxDisplay(columnKey, row[columnKey])
                              ) : (
                                <div className={isLongTextColumn ? styles.readOnlyMultilineValue : styles.readOnlyValue}>
                                  {formatPiReviewCellValue(columnKey, row[columnKey])}
                                </div>
                              )
                            )}
                          </td>
                        );
                      })}
                      {canEditContent && (
                        <td className={styles.rowActionCell}>
                          <div className={styles.rowActionGroup}>
                            <button
                              className={styles.rowToolButton}
                              disabled={isSaving || !canMoveRowUp}
                              onClick={() => handleMoveRow(row.rowId, -1)}
                              type="button"
                            >
                              Move up
                            </button>
                            <button
                              className={styles.rowToolButton}
                              disabled={isSaving || !canMoveRowDown}
                              onClick={() => handleMoveRow(row.rowId, 1)}
                              type="button"
                            >
                              Move down
                            </button>
                            {canSetBoundaryBelowRow && (
                              <button
                                aria-pressed={isBoundaryBelowRow}
                                className={`${styles.boundaryButton} ${isBoundaryBelowRow ? styles.boundaryButtonActive : ''}`.trim()}
                                disabled={isSaving}
                                onClick={() => handleToggleCommitmentBoundaryAfterRow(rowIndex)}
                                type="button"
                              >
                                {isBoundaryBelowRow ? 'Remove Stretch Goals line' : 'Set Stretch Goals line below'}
                              </button>
                            )}
                            {canSetBoundaryBelowRow && (
                              <button
                                aria-pressed={customGroupingLineBelowRow !== null}
                                className={`${styles.rowToolButton} ${customGroupingLineBelowRow ? styles.rowToolButtonActive : ''}`.trim()}
                                disabled={isSaving}
                                onClick={() => handleToggleCustomGroupingLineAfterRow(rowIndex)}
                                type="button"
                              >
                                {customGroupingLineBelowRow ? 'Remove custom line below' : 'Add custom line below'}
                              </button>
                            )}
                            <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveRow(row.rowId)} type="button">
                              Remove
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {customGroupingLineBelowRow && (
                      <tr className={styles.customGroupingLineRow} key={customGroupingLineBelowRow.lineId}>
                        <td
                          colSpan={visiblePiReviewColumnKeys.length + (canEditContent ? 1 : 0)}
                          style={{
                            borderTopColor: customGroupingLineBelowRow.color,
                            borderBottomColor: customGroupingLineBelowRow.color,
                            backgroundColor: convertHexColorToRgba(customGroupingLineBelowRow.color, 0.18),
                            color: customGroupingLineBelowRow.color,
                          }}
                        >
                          {canEditContent ? (
                            <div className={styles.inlineGroupingLineEditor}>
                              <input
                                aria-label={`Custom line text for ${target.targetLabel} row ${rowIndex + 1}`}
                                autoFocus={focusedCustomGroupingLineId === customGroupingLineBelowRow.lineId}
                                className={styles.inlineGroupingLineInput}
                                onChange={(event) =>
                                  handleUpdateCustomGroupingLine(customGroupingLineBelowRow.lineId, { label: event.target.value })}
                                type="text"
                                value={customGroupingLineBelowRow.label}
                              />
                              <div className={styles.inlineGroupingLineMenu}>
                                <button
                                  aria-expanded={expandedCustomGroupingLineId === customGroupingLineBelowRow.lineId}
                                  className={styles.inlineGroupingLineMenuButton}
                                  onClick={() => handleToggleCustomGroupingLineMenu(customGroupingLineBelowRow.lineId)}
                                  type="button"
                                >
                                  <span
                                    className={styles.inlineGroupingLineSwatch}
                                    style={{ backgroundColor: customGroupingLineBelowRow.color }}
                                  />
                                  Color
                                  <span aria-hidden="true">▾</span>
                                </button>
                                {expandedCustomGroupingLineId === customGroupingLineBelowRow.lineId && (
                                  <div className={styles.inlineGroupingLinePalette}>
                                    {CUSTOM_GROUPING_LINE_COLOR_OPTIONS.map((colorOption) => (
                                      <button
                                        className={`${styles.inlineGroupingLineColorOption} ${customGroupingLineBelowRow.color === colorOption.value ? styles.inlineGroupingLineColorOptionActive : ''}`.trim()}
                                        key={colorOption.value}
                                        onClick={() => handleUpdateCustomGroupingLine(customGroupingLineBelowRow.lineId, { color: colorOption.value })}
                                        type="button"
                                      >
                                        <span
                                          className={styles.inlineGroupingLineSwatch}
                                          style={{ backgroundColor: colorOption.value }}
                                        />
                                        {colorOption.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <strong>{customGroupingLineBelowRow.label}</strong>
                          )}
                        </td>
                      </tr>
                    )}
                    {isBoundaryBelowRow && (
                      <tr className={styles.commitmentBoundaryRow}>
                        <td colSpan={visiblePiReviewColumnKeys.length + (canEditContent ? 1 : 0)}>
                          <span>Hard commits above</span>
                          <strong>Stretch Goals below</strong>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.confidenceSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h4 className={styles.confidenceTitle}>Week-over-week Confidence Tracking</h4>
            <p className={styles.summaryValue}>
              Capture a fist-of-five confidence vote for each team every week and keep the history on the same Confluence page.
            </p>
          </div>
          {canShowAuthoringToolbar ? (
            <div className={styles.panelStatusActions} data-export-exclude="true">
              {canEditContent ? (
                <>
                  <button
                    className={joinClassNames(styles.actionButton, styles.actionButtonSuccess)}
                    disabled={isSaveToConfluenceDisabled}
                    onClick={() => void handleSaveToConfluence()}
                    type="button"
                  >
                    {isSaving ? 'Saving…' : SAVE_CONFIDENCE_VOTES_BUTTON_LABEL}
                  </button>
                  <button
                    className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
                    disabled={isLoading || isSaving || isExportingPanel || !confidenceTableBinding}
                    onClick={handleAddConfidenceRow}
                    type="button"
                  >
                    Add Weekly Confidence Vote
                  </button>
                </>
              ) : (
                <button
                  className={joinClassNames(styles.actionButton, styles.actionButtonSecondary)}
                  disabled={isLoading || isSaving || isExportingPanel || !confidenceTableBinding}
                  onClick={() => setIsEditMode(true)}
                  type="button"
                >
                  Edit Confidence Votes
                </button>
              )}
            </div>
          ) : null}
        </div>

        {confidenceRows.length === 0 ? (
          <p className={styles.summaryValue}>No confidence votes are tracked yet for this team.</p>
        ) : (
          <div className={styles.confidenceList}>
            {confidenceRows.map((row, rowIndex) => (
              <article className={styles.confidenceCard} key={row.rowId}>
                <div className={styles.confidenceCardHeader}>
                  <strong>Week {rowIndex + 1}</strong>
                  {canEditContent && (
                    <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveConfidenceRow(row.rowId)} type="button">
                      Remove
                    </button>
                  )}
                </div>
                {canEditContent ? (
                  <>
                    <label className={styles.confidenceFieldLabel}>
                      {CONFIDENCE_VOTE_COLUMN_LABELS.weekOf}
                      <input
                        aria-label={`${CONFIDENCE_VOTE_COLUMN_LABELS.weekOf} for ${target.targetLabel} confidence row ${rowIndex + 1}`}
                        className={styles.cellInput}
                        onChange={(event) => handleConfidenceRowChange(row.rowId, 'weekOf', event.target.value)}
                        type="date"
                        value={row.weekOf}
                      />
                    </label>
                    <div className={styles.confidenceFieldLabel}>
                      {CONFIDENCE_VOTE_COLUMN_LABELS.confidenceVote}
                      <ConfidenceVoteSelector
                        onChange={(nextValue) => handleConfidenceRowChange(row.rowId, 'confidenceVote', nextValue)}
                        row={row}
                        rowIndex={rowIndex}
                        teamLabel={target.targetLabel}
                      />
                    </div>
                    <label className={styles.confidenceFieldLabel}>
                      {CONFIDENCE_VOTE_COLUMN_LABELS.notes}
                      <textarea
                        aria-label={`${CONFIDENCE_VOTE_COLUMN_LABELS.notes} for ${target.targetLabel} confidence row ${rowIndex + 1}`}
                        className={styles.cellTextarea}
                        onChange={(event) => handleConfidenceRowChange(row.rowId, 'notes', event.target.value)}
                        value={row.notes}
                      />
                    </label>
                  </>
                ) : (
                  <div className={styles.confidenceReadOnlyGrid}>
                    <div>
                      <div className={styles.summaryLabel}>{CONFIDENCE_VOTE_COLUMN_LABELS.weekOf}</div>
                      <div className={styles.readOnlyValue}>{row.weekOf || 'Not set'}</div>
                    </div>
                    <div>
                      <div className={styles.summaryLabel}>{CONFIDENCE_VOTE_COLUMN_LABELS.confidenceVote}</div>
                      <div className={styles.readOnlyVote}>
                        <FistOfFiveIcon value={row.confidenceVote || '0'} />
                        <span>{readConfidenceVoteDisplayValue(row.confidenceVote) || 'Not set'}</span>
                      </div>
                    </div>
                    <div>
                      <div className={styles.summaryLabel}>{CONFIDENCE_VOTE_COLUMN_LABELS.notes}</div>
                      <div className={styles.readOnlyMultilineValue}>{row.notes.trim() === '' ? '—' : row.notes}</div>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** PI Review tab: renders one Confluence-backed PI Review section per configured team page. */
export default function PiReviewTab({
  selectedPiName,
  teams,
  mode = 'authoring',
  teamCapacitySummaries = {},
}: PiReviewTabProps) {
  const allConfiguredTargets = useMemo(() => readConfiguredPiReviewTargets(teams), [teams]);
  // Authoring (Team Dashboard) is driven by that view's PI selector; readout (ART) shows every page.
  const configuredTargets = useMemo(
    () => (mode === 'authoring' ? selectTargetsForSelectedPi(allConfiguredTargets, selectedPiName) : allConfiguredTargets),
    [allConfiguredTargets, mode, selectedPiName],
  );
  const [requestedActiveTargetKey, setRequestedActiveTargetKey] = useState<string>(() => readDefaultPiReviewTargetKey(configuredTargets));
  const teamTabOptions = useMemo(
    () => configuredTargets.map((target) => ({ key: target.targetKey, label: target.targetLabel })),
    [configuredTargets],
  );
  const activeTargetKey = useMemo(
    () => readActivePiReviewTargetKey(requestedActiveTargetKey, configuredTargets),
    [configuredTargets, requestedActiveTargetKey],
  );

  if (configuredTargets.length === 0) {
    // The team has pages, just none for the PI the dashboard is showing — say so precisely, since
    // "configure a page" would be misleading advice when pages already exist for other PIs.
    const hasPagesForOtherPis = allConfiguredTargets.length > 0;
    return (
        <div className={styles.piReviewTab}>
          <p className={styles.summaryValue}>
            {hasPagesForOtherPis
              ? `No PI Review page is configured for ${selectedPiName.trim()}. Add one in Settings → Saved Dashboard Teams → PI Review Pages, or pick a PI that has a page.`
              : mode === 'readout'
                ? 'Add an explicit PI Review Page URL to each ART team in Settings, then use Team Dashboard for PI Review authoring.'
                : 'Add an explicit PI Review Page URL to each ART team in Settings. PI Review pages no longer fall back to a shared default page.'}
          </p>
        </div>
      );
  }

  return (
    <div className={styles.piReviewTab}>
      <div className={styles.statusRow}>
        <h3>PI Review</h3>
        <span className={styles.summaryValue}>{configuredTargets.length} Confluence page{configuredTargets.length === 1 ? '' : 's'} configured</span>
      </div>
      {configuredTargets.length > 1 && (
        <div className={styles.teamTabsSection}>
          <PrimaryTabs
            activeTab={activeTargetKey}
            ariaLabel="PI Review team tabs"
            idPrefix={PI_REVIEW_TEAM_TABS_ID_PREFIX}
            onChange={setRequestedActiveTargetKey}
            tabs={teamTabOptions}
          />
        </div>
      )}
      {configuredTargets.map((target) => {
        const isActiveTarget = configuredTargets.length === 1 || target.targetKey === activeTargetKey;
        return (
          <div
            aria-labelledby={`${PI_REVIEW_TEAM_TABS_ID_PREFIX}-${target.targetKey}-tab`}
            className={styles.teamPanelShell}
            hidden={!isActiveTarget}
            id={`${PI_REVIEW_TEAM_TABS_ID_PREFIX}-${target.targetKey}-panel`}
            key={target.targetKey}
            role="tabpanel"
          >
            {/* Keep each team panel mounted so loaded pages and unsaved edits survive tab switches. */}
            <PiReviewPagePanel
              capacitySummaryOverride={teamCapacitySummaries[target.teamId] ?? null}
              carryOverSourceTargets={allConfiguredTargets.filter(
                (candidate) => candidate.teamId === target.teamId && candidate.targetKey !== target.targetKey,
              )}
              mode={mode}
              selectedPiName={selectedPiName}
              target={target}
            />
          </div>
        );
      })}
    </div>
  );
}
