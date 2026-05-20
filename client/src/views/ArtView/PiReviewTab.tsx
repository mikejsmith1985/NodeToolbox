// PiReviewTab.tsx — Editable ART PI Review workspace that syncs one Confluence-backed section per team.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useToast } from '../../components/Toast/ToastProvider.tsx';
import {
  fetchConfluencePageByReference,
  resolveConfluencePageIdFromReference,
  updateConfluencePage,
} from '../../services/confluenceApi.ts';
import { buildCapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { CapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { JiraIssue } from '../../types/jira.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { useArtCapacityStore } from './hooks/useArtCapacityStore.ts';
import type { ArtCapacityTeamConfig } from './hooks/useArtCapacityStore.ts';
import { downloadPiReviewPanelPdf } from './piReviewPdf.ts';
import {
  CONFIDENCE_VOTE_COLUMN_LABELS,
  CORE_PI_REVIEW_COLUMN_KEYS,
  OPTIONAL_PI_REVIEW_COLUMN_KEYS,
  PI_REVIEW_COLUMN_LABELS,
  createInitialPiReviewPageStorage,
  createEmptyConfidenceVoteRow,
  createEmptyPiReviewRow,
  exportPiReviewRowsToCsv,
  parsePiReviewCapacitySummary,
  parseConfidenceVoteTable,
  parsePiReviewTable,
  parsePiReviewRowsFromSpreadsheetSheets,
  type OptionalPiReviewColumnKey,
  type PiReviewColumnKey,
  type PiReviewCustomGroupingLine,
  type PiReviewRow,
  type PiReviewSpreadsheetCellValue,
  type PiReviewTableBinding,
  type ConfidenceVoteRow,
  type ConfidenceVoteTableBinding,
  writeConfidenceVoteTable,
  writePiReviewCapacitySummary,
  writePiReviewTable,
} from './piReviewTable.ts';
import {
  extractPiReviewFeatureKey,
  fetchPiReviewFeatureIssues,
  formatPiReviewFeatureDisplayValue,
  reconcilePiReviewRowsWithJira,
  savePiReviewFeatureEstimates,
} from './piReviewJira.ts';
import styles from './PiReviewTab.module.css';

const LONG_TEXT_COLUMNS = new Set<PiReviewColumnKey>(['dependency', 'risks', 'notes']);
const CHECKBOX_COLUMNS = new Set<PiReviewColumnKey>(['committed', 'devWork', 'testSupport']);
const FEATURE_COLUMN_KEY = 'feature';
const FIST_OF_FIVE_VALUES = ['1', '2', '3', '4', '5'] as const;
const SPREADSHEET_IMPORT_ACCEPT = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const STRETCH_GOALS_LINE_COLOR = '#f5c400';
const DEFAULT_CUSTOM_GROUPING_LINE_COLOR = '#0ea5e9';

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

interface CustomGroupingLineDraft {
  afterRowIndex: number;
  label: string;
  color: string;
}

interface PiReviewTabProps {
  selectedPiName: string;
  teams: ArtTeam[];
}

interface PiReviewLoadTarget {
  teamId: string;
  targetKey: string;
  targetLabel: string;
  pageReference: string;
}

interface PiReviewPagePanelProps {
  target: PiReviewLoadTarget;
  selectedPiName: string;
}

function readConfiguredPiReviewTargets(teams: ArtTeam[]): PiReviewLoadTarget[] {
  return teams
    .filter((team) => (team.piReviewPageUrl ?? '').trim() !== '')
    .map((team) => ({
      teamId: team.id,
      targetKey: team.id,
      targetLabel: team.name,
      pageReference: team.piReviewPageUrl!.trim(),
    }));
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

function createPiReviewPdfFileName(selectedPiName: string, targetLabel: string): string {
  const normalizedTargetLabel = createPiReviewDownloadNameSegment(targetLabel);
  const normalizedPiName = createPiReviewDownloadNameSegment(selectedPiName);
  return `pi-review-${normalizedTargetLabel || 'team'}-${normalizedPiName || 'export'}.pdf`;
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

async function readPiReviewSpreadsheetSheetsFromFile(file: File) {
  const XLSX = await import('xlsx');
  const workbookBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(workbookBuffer, { type: 'array', cellDates: true });

  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<PiReviewSpreadsheetCellValue[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    });
    return { sheetName, rows };
  });
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

function buildPiReviewTeamCapacitySummary(
  target: PiReviewLoadTarget,
  teamConfigs: Record<string, ArtCapacityTeamConfig>,
): CapacitySummary | null {
  const selectedTeamConfig = teamConfigs[target.teamId];
  if (!selectedTeamConfig) {
    return null;
  }

  // Capacity points depend on workday math, so partial dates would produce a misleading zeroed summary.
  const hasCompleteDateRange = selectedTeamConfig.startDate !== '' && selectedTeamConfig.endDate !== '';
  if (!hasCompleteDateRange) {
    return null;
  }

  return buildCapacitySummary(
    `${target.targetLabel} Capacity`,
    selectedTeamConfig.rows,
    selectedTeamConfig.startDate,
    selectedTeamConfig.endDate,
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

function createDefaultCustomGroupingLineDraft(rowCount: number): CustomGroupingLineDraft {
  return {
    afterRowIndex: Math.max(1, rowCount || 1),
    label: '',
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

function FistOfFiveIcon({ value }: { value: string }) {
  const fingerCount = Number(value);
  const isSelectedFinger = (fingerIndex: number) => fingerIndex <= fingerCount;

  return (
    <svg aria-hidden="true" className={styles.fistIcon} viewBox="0 0 64 64">
      <rect className={styles.palmShape} height="26" rx="8" width="34" x="15" y="28" />
      {[0, 1, 2, 3, 4].map((fingerIndex) => (
        <rect
          className={isSelectedFinger(fingerIndex + 1) ? styles.fingerRaised : styles.fingerFolded}
          height={isSelectedFinger(fingerIndex + 1) ? 18 : 8}
          key={fingerIndex}
          rx="3"
          width="5"
          x={18 + fingerIndex * 7}
          y={isSelectedFinger(fingerIndex + 1) ? 10 : 20}
        />
      ))}
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
  return (
    <div className={styles.fistSelector}>
      {FIST_OF_FIVE_VALUES.map((value) => {
        const isSelected = row.confidenceVote === value;
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
  );
}

function PiReviewPagePanel({ target, selectedPiName }: PiReviewPagePanelProps) {
  const { showToast } = useToast();
  const teamConfigs = useArtCapacityStore((state) => state.teamConfigs);
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
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isTemplateDraftConfirmationVisible, setIsTemplateDraftConfirmationVisible] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<OptionalPiReviewColumnKey>>(new Set());
  const [commitmentBoundaryIndex, setCommitmentBoundaryIndex] = useState<number | null>(null);
  const [customGroupingLines, setCustomGroupingLines] = useState<PiReviewCustomGroupingLine[]>([]);
  const [jiraIssueMap, setJiraIssueMap] = useState<Record<string, JiraIssue>>({});
  const [customGroupingLineDraft, setCustomGroupingLineDraft] = useState<CustomGroupingLineDraft>(() =>
    createDefaultCustomGroupingLineDraft(0),
  );
  const lastAutoLoadKeyRef = useRef('');
  const loadedSnapshotRef = useRef<PiReviewLoadedSnapshot | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const pagePanelRef = useRef<HTMLElement>(null);
  const liveCapacitySummary = useMemo(
    () => buildPiReviewTeamCapacitySummary(target, teamConfigs),
    [target, teamConfigs],
  );
  const displayedCapacitySummary = liveCapacitySummary ?? savedCapacitySummary;
  const committedPointTotal = useMemo(
    () => rows.reduce(
      (runningTotal, row) => runningTotal + (isPiReviewRowCommitted(row) ? parsePiReviewPointEstimate(row.pointEstimate) : 0),
      0,
    ),
    [rows],
  );
  const visiblePiReviewColumnKeys = useMemo<PiReviewColumnKey[]>(
    () => [
      ...CORE_PI_REVIEW_COLUMN_KEYS,
      ...OPTIONAL_PI_REVIEW_COLUMN_KEYS.filter((columnKey) => visibleOptionalColumns.has(columnKey)),
    ],
    [visibleOptionalColumns],
  );
  const canExportPdf = rows.length > 0 || confidenceRows.length > 0 || displayedCapacitySummary !== null;

  useEffect(() => {
    setCustomGroupingLineDraft((currentDraft) => ({
      ...currentDraft,
      afterRowIndex: Math.min(Math.max(1, currentDraft.afterRowIndex), Math.max(1, rows.length || 1)),
    }));
  }, [rows.length]);

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
    setHasUnsavedChanges(loadedSnapshot.hasUnsavedChanges);
    setCustomGroupingLineDraft(createDefaultCustomGroupingLineDraft(loadedSnapshot.rows.length));
  }

  const loadPiReviewPage = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const confluencePage = await fetchConfluencePageByReference(target.pageReference);
      setStorageValue(confluencePage.body.storage.value);
      setPageTitle(confluencePage.title);
      setResolvedPageId(confluencePage.id || resolveConfluencePageIdFromReference(target.pageReference) || '');
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
      applyLoadedSnapshot(nextLoadedSnapshot);
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
      setIsEditMode(false);
      setHasUnsavedChanges(false);
      setLoadError(error instanceof Error ? error.message : 'Failed to load the PI Review page');
    } finally {
      setIsLoading(false);
    }
  }, [target.pageReference]);

  useEffect(() => {
    const autoLoadKey = `${target.targetKey}|${target.pageReference}|${selectedPiName}`;
    if (lastAutoLoadKeyRef.current === autoLoadKey) {
      return;
    }

    lastAutoLoadKeyRef.current = autoLoadKey;
    void loadPiReviewPage();
  }, [loadPiReviewPage, selectedPiName, target.pageReference, target.targetKey]);

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
      setCustomGroupingLineDraft(createDefaultCustomGroupingLineDraft(1));
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

  function handleAddRow() {
    setRows((currentRows) => [...currentRows, createEmptyPiReviewRow()]);
    setHasUnsavedChanges(true);
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

  async function handleImportPiReviewFile(changeEvent: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!selectedFile || !tableBinding) {
      return;
    }

    try {
      const spreadsheetSheets = await readPiReviewSpreadsheetSheetsFromFile(selectedFile);
      const importedTable = parsePiReviewRowsFromSpreadsheetSheets(spreadsheetSheets);
      const nextVisibleOptionalColumns = new Set(visibleOptionalColumns);
      for (const columnKey of OPTIONAL_PI_REVIEW_COLUMN_KEYS) {
        if (importedTable.importedColumnKeys.includes(columnKey)) {
          nextVisibleOptionalColumns.add(columnKey);
        }
      }

      const nextColumnOrder: PiReviewColumnKey[] = [
        ...CORE_PI_REVIEW_COLUMN_KEYS,
        ...OPTIONAL_PI_REVIEW_COLUMN_KEYS.filter((columnKey) => nextVisibleOptionalColumns.has(columnKey)),
      ];
      setRows(importedTable.rows);
      setVisibleOptionalColumns(nextVisibleOptionalColumns);
      setTableBinding(createPiReviewTableBindingWithColumns(tableBinding, nextColumnOrder));
      setCommitmentBoundaryIndex(null);
      setCustomGroupingLines([]);
      setJiraIssueMap({});
      setCustomGroupingLineDraft(createDefaultCustomGroupingLineDraft(importedTable.rows.length));
      setLoadError(null);
      setHasUnsavedChanges(true);
      showToast(`Imported ${importedTable.rows.length} PI Review row(s) from ${selectedFile.name}. Save to Confluence when ready.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to import the PI Review spreadsheet';
      showToast(errorMessage, 'error');
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

  function handleSetCommitmentBoundaryAfterRow(rowIndex: number) {
    setCommitmentBoundaryIndex(normalizeCommitmentBoundaryIndex(rowIndex + 1, rows.length));
    setHasUnsavedChanges(true);
  }

  function handleClearCommitmentBoundary() {
    setCommitmentBoundaryIndex(null);
    setHasUnsavedChanges(true);
  }

  function handleAddCustomGroupingLine() {
    if (rows.length === 0) {
      showToast('Add at least one PI Review row before inserting a custom grouping line.', 'error');
      return;
    }

    const normalizedLabel = customGroupingLineDraft.label.trim();
    if (normalizedLabel === '') {
      showToast('Enter grouping line text before adding it.', 'error');
      return;
    }

    const normalizedColor = normalizeHexColor(customGroupingLineDraft.color);
    if (normalizedColor === STRETCH_GOALS_LINE_COLOR) {
      showToast('Stretch Goals keeps the reserved highlight color. Choose a different custom line color.', 'error');
      return;
    }

    setCustomGroupingLines((currentGroupingLines) => [
      ...currentGroupingLines,
      {
        lineId: `custom-line-${Date.now()}-${currentGroupingLines.length + 1}`,
        afterRowIndex: Math.min(Math.max(1, customGroupingLineDraft.afterRowIndex), rows.length),
        label: normalizedLabel,
        color: normalizedColor,
      },
    ]);
    setCustomGroupingLineDraft(createDefaultCustomGroupingLineDraft(rows.length));
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
        return {
          ...groupingLine,
          ...patch,
          color: nextColor === STRETCH_GOALS_LINE_COLOR ? groupingLine.color : nextColor,
          label: patch.label !== undefined ? patch.label : groupingLine.label,
        };
      }),
    );
    setHasUnsavedChanges(true);
  }

  function handleRemoveCustomGroupingLine(lineId: string) {
    setCustomGroupingLines((currentGroupingLines) => currentGroupingLines.filter((groupingLine) => groupingLine.lineId !== lineId));
    setHasUnsavedChanges(true);
  }

  function handleConfidenceRowChange(rowId: string, fieldName: keyof ConfidenceVoteRow, nextValue: string) {
    setConfidenceRows((currentRows) =>
      currentRows.map((row) =>
        row.rowId === rowId
          ? { ...row, [fieldName]: nextValue }
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
    setIsTemplateDraftConfirmationVisible(false);
    setIsEditMode(false);
    showToast(`${target.targetLabel} PI Review edits were discarded.`, 'success');
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
    if (!tableBinding || pageVersionNumber === null || resolvedPageId === '') {
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

        finalJiraIssueMap[estimateUpdate.featureKey] = {
          ...currentIssue,
          fields: {
            ...currentIssue.fields,
            customfield_10111: estimateUpdate.estimate,
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
      applyLoadedSnapshot(refreshedSnapshot);
      setStorageValue(updatedPage.body.storage.value);
      setPageTitle(updatedPage.title);
      setResolvedPageId(updatedPage.id);
      setPageVersionNumber(updatedPage.version.number);
      setIsEditMode(false);
      showToast(`${target.targetLabel} PI Review saved to Confluence ✓`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save the PI Review page';
      setLoadError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportPdf() {
    const pagePanelElement = pagePanelRef.current;
    if (!pagePanelElement) {
      showToast('Load the PI Review panel before exporting a PDF.', 'error');
      return;
    }

    const wasEditMode = isEditMode;
    setIsExportingPdf(true);

    try {
      // Export the clean document view so the PDF reads like the Confluence page rather than an editor.
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

      await downloadPiReviewPanelPdf(
        pagePanelRef.current,
        createPiReviewPdfFileName(selectedPiName, target.targetLabel),
      );
      showToast(`${target.targetLabel} PI Review PDF downloaded.`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export the PI Review PDF';
      showToast(errorMessage, 'error');
    } finally {
      if (wasEditMode) {
        flushSync(() => {
          setIsEditMode(true);
        });
      }
      setIsExportingPdf(false);
    }
  }

  return (
    <section aria-label={`${target.targetLabel} PI Review`} className={styles.pagePanel} ref={pagePanelRef}>
      <div className={styles.statusRow}>
        <div>
          <h3>{target.targetLabel}</h3>
          <p className={styles.summaryValue}>
            {isEditMode ? 'Edit mode is on. Structural table tools are available below.' : 'View mode is on. Switch to Edit PI Review to change the document.'}
          </p>
        </div>
        <div className={styles.panelStatusActions} data-pdf-exclude="true">
          {hasUnsavedChanges && <span className={styles.dirtyBadge}>Unsaved changes</span>}
          <button
            aria-pressed={isEditMode}
            disabled={isLoading || isSaving || isExportingPdf || !tableBinding}
            onClick={() => setIsEditMode((currentIsEditMode) => !currentIsEditMode)}
            type="button"
          >
            {isEditMode ? 'Done Editing' : 'Edit PI Review'}
          </button>
        </div>
      </div>

      <div className={styles.pageSummaryCard}>
        <div>
          <div className={styles.summaryLabel}>Selected PI</div>
          <div className={styles.summaryValue}>{selectedPiName.trim() || 'No PI selected'}</div>
        </div>
        <div>
          <div className={styles.summaryLabel}>Configured page URL or ID</div>
          <div className={styles.summaryValue}>{target.pageReference}</div>
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
      </div>

      <div className={styles.toolbar} data-pdf-exclude="true">
        <button disabled={isLoading || isSaving || isExportingPdf} onClick={() => void loadPiReviewPage()} type="button">
          {isLoading ? 'Loading…' : 'Reload from Confluence'}
        </button>
        <button
          disabled={rows.length === 0 || isLoading || isSaving || isExportingPdf}
          onClick={() => downloadPiReviewCsv(rows, selectedPiName, target.targetLabel)}
          type="button"
        >
          Export PI Review CSV
        </button>
        <button disabled={!canExportPdf || isLoading || isSaving || isExportingPdf} onClick={() => void handleExportPdf()} type="button">
          {isExportingPdf ? 'Exporting PDF…' : 'Export PI Review PDF'}
        </button>
        <button
          disabled={isLoading || isSaving || isExportingPdf || !hasUnsavedChanges || pageVersionNumber === null || resolvedPageId === ''}
          onClick={() => void handleSaveToConfluence()}
          type="button"
        >
          {isSaving ? 'Saving…' : 'Save to Confluence'}
        </button>
        <button
          disabled={isLoading || isSaving || isExportingPdf || !hasUnsavedChanges || loadedSnapshotRef.current === null}
          onClick={handleIgnoreEdits}
          type="button"
        >
          Ignore Edits
        </button>
        {isEditMode && (
          <>
            <button disabled={isLoading || isSaving || isExportingPdf || !tableBinding} onClick={handleAddRow} type="button">Add PI Review Row</button>
            <input
              ref={importFileInputRef}
              accept={SPREADSHEET_IMPORT_ACCEPT}
              aria-label={`Import PI Review XLSX for ${target.targetLabel}`}
              className={styles.hiddenFileInput}
              disabled={isLoading || isSaving || isExportingPdf || !tableBinding}
              onChange={(event) => void handleImportPiReviewFile(event)}
              type="file"
            />
            <button
              disabled={isLoading || isSaving || isExportingPdf || !tableBinding}
              onClick={() => importFileInputRef.current?.click()}
              type="button"
            >
              Import PI Review XLSX
            </button>
            <button disabled={isLoading || isSaving || isExportingPdf || !tableBinding} onClick={handleAddConfidenceRow} type="button">Add Confidence Week</button>
          </>
        )}
      </div>

      <div className={styles.documentStats}>
        <span className={styles.statBadge}>
          Stretch Goals line: {commitmentBoundaryIndex === null ? 'Not set' : `after row ${commitmentBoundaryIndex}`}
        </span>
        <span className={styles.statBadge}>Custom lines: {customGroupingLines.length}</span>
        <span className={styles.statBadge}>Committed points: {formatCapacityValue(committedPointTotal)}</span>
      </div>

      {tableBinding && isEditMode && (
        <fieldset className={styles.tableTools} data-pdf-exclude="true">
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
          <button
            className={styles.columnToggleButton}
            disabled={isLoading || isSaving || commitmentBoundaryIndex === null}
            onClick={handleClearCommitmentBoundary}
            type="button"
          >
            Clear Stretch Goals line
          </button>
          {rows.length > 0 && (
            <div className={styles.groupingLineEditor}>
              <label className={styles.groupingLineField}>
                After row
                <select
                  className={styles.groupingLineSelect}
                  onChange={(event) =>
                    setCustomGroupingLineDraft((currentDraft) => ({
                      ...currentDraft,
                      afterRowIndex: Number(event.target.value),
                    }))}
                  value={String(customGroupingLineDraft.afterRowIndex)}
                >
                  {rows.map((_row, rowIndex) => (
                    <option key={rowIndex} value={rowIndex + 1}>
                      Row {rowIndex + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.groupingLineField}>
                Custom line text
                <input
                  className={styles.cellInput}
                  onChange={(event) =>
                    setCustomGroupingLineDraft((currentDraft) => ({
                      ...currentDraft,
                      label: event.target.value,
                    }))}
                  type="text"
                  value={customGroupingLineDraft.label}
                />
              </label>
              <label className={styles.groupingLineField}>
                Color
                <input
                  className={styles.groupingLineColorInput}
                  onChange={(event) =>
                    setCustomGroupingLineDraft((currentDraft) => ({
                      ...currentDraft,
                      color: event.target.value,
                    }))}
                  type="color"
                  value={customGroupingLineDraft.color}
                />
              </label>
              <button className={styles.rowToolButton} disabled={isLoading || isSaving} onClick={handleAddCustomGroupingLine} type="button">
                Add custom line
              </button>
            </div>
          )}
          {customGroupingLines.length > 0 && (
            <div className={styles.groupingLineList}>
              {customGroupingLines.map((groupingLine) => (
                <div className={styles.groupingLineCard} key={groupingLine.lineId}>
                  <label className={styles.groupingLineField}>
                    Line text
                    <input
                      className={styles.cellInput}
                      onChange={(event) => handleUpdateCustomGroupingLine(groupingLine.lineId, { label: event.target.value })}
                      type="text"
                      value={groupingLine.label}
                    />
                  </label>
                  <label className={styles.groupingLineField}>
                    After row
                    <select
                      className={styles.groupingLineSelect}
                      onChange={(event) =>
                        handleUpdateCustomGroupingLine(groupingLine.lineId, { afterRowIndex: Number(event.target.value) })}
                      value={String(groupingLine.afterRowIndex)}
                    >
                      {rows.map((_row, rowIndex) => (
                        <option key={rowIndex} value={rowIndex + 1}>
                          Row {rowIndex + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.groupingLineField}>
                    Color
                    <input
                      className={styles.groupingLineColorInput}
                      onChange={(event) => handleUpdateCustomGroupingLine(groupingLine.lineId, { color: event.target.value })}
                      type="color"
                      value={groupingLine.color}
                    />
                  </label>
                  <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveCustomGroupingLine(groupingLine.lineId)} type="button">
                    Remove line
                  </button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <section className={styles.capacityPanel}>
        <div className={styles.sectionHeader}>
          <div>
            <h4 className={styles.capacityTitle}>Team Capacity</h4>
            <p className={styles.summaryValue}>
              This snapshot is pulled from the Capacity tab and will be saved into Confluence above the PI Review table.
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
            No capacity plan has been saved for {target.targetLabel} yet. Fill out the Capacity tab to publish it here.
          </p>
        )}
      </section>

      {loadError && (
        <div className={styles.recoveryCard}>
          <p className={styles.errorText}>{loadError}</p>
          <p className={styles.summaryValue}>
            If this page should be managed by Toolbox, load the canonical PI Review template locally first.
            Your Confluence page will not change until you save the completed table.
          </p>
          <button
            disabled={isLoading || isSaving || pageVersionNumber === null || resolvedPageId === ''}
            onClick={() => setIsTemplateDraftConfirmationVisible(true)}
            type="button"
          >
            Load Toolbox PI Review template locally
          </button>
        </div>
      )}

      {isTemplateDraftConfirmationVisible && (
        <div className={styles.confirmCard}>
          <strong>Start a local Toolbox PI Review draft?</strong>
          <p className={styles.summaryValue}>
            Toolbox will load a blank PI Review table and confidence tracking table in this tab.
            The Confluence page will only be overwritten after you fill out the draft and click Save to Confluence.
          </p>
          <div className={styles.confirmActions}>
            <button disabled={isSaving} onClick={handleLoadToolboxTemplateDraft} type="button">
              Start local draft
            </button>
            <button disabled={isSaving} onClick={() => setIsTemplateDraftConfirmationVisible(false)} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isLoading && rows.length === 0 && !loadError && (
        <p className={styles.summaryValue}>
          {isEditMode
            ? 'No PI Review rows have been added yet. Use Add PI Review Row to start building this page from Toolbox.'
            : 'No PI Review rows have been added yet. Switch to Edit PI Review to start building this page from Toolbox.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className={styles.tableShell} data-pdf-expand="true">
          <table className={styles.dataTable}>
            <thead>
              <tr>
                {visiblePiReviewColumnKeys.map((columnKey) => (
                  <th key={columnKey} scope="col">{PI_REVIEW_COLUMN_LABELS[columnKey]}</th>
                ))}
                {isEditMode && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const isBoundaryBelowRow = commitmentBoundaryIndex === rowIndex + 1;
                const canSetBoundaryBelowRow = rowIndex < rows.length;
                const canMoveRowUp = rowIndex > 0;
                const canMoveRowDown = rowIndex < rows.length - 1;
                const featureKey = extractPiReviewFeatureKey(row.feature);
                const jiraIssue = featureKey ? jiraIssueMap[featureKey] : undefined;
                const customLinesBelowRow = customGroupingLines.filter((groupingLine) => groupingLine.afterRowIndex === rowIndex + 1);

                return (
                  <Fragment key={row.rowId}>
                    <tr>
                      {visiblePiReviewColumnKeys.map((columnKey) => {
                        const isLongTextColumn = LONG_TEXT_COLUMNS.has(columnKey);
                        const isCheckboxColumn = CHECKBOX_COLUMNS.has(columnKey);
                        const isJiraSyncedColumn = columnKey === 'priority' || columnKey === 'dependency' || columnKey === 'risks';
                        const cellClassName = columnKey === FEATURE_COLUMN_KEY
                          ? styles.featureCell
                          : isLongTextColumn
                            ? styles.longCell
                            : styles.shortCell;

                        return (
                          <td className={cellClassName} key={columnKey}>
                            {isEditMode && isCheckboxColumn ? (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                checked={row[columnKey] === 'Yes'}
                                className={styles.checkboxInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.checked ? 'Yes' : '')}
                                type="checkbox"
                              />
                            ) : isEditMode && columnKey === FEATURE_COLUMN_KEY ? (
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
                              </div>
                            ) : isEditMode && isJiraSyncedColumn ? (
                              <div className={styles.syncedValueBox}>
                                <div className={isLongTextColumn ? styles.readOnlyMultilineValue : styles.readOnlyValue}>
                                  {formatPiReviewCellValue(columnKey, row[columnKey])}
                                </div>
                                <span className={styles.syncedHelperText}>Synced from Jira issue links and priority.</span>
                              </div>
                            ) : isEditMode && isLongTextColumn ? (
                              <textarea
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellTextarea}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                value={row[columnKey]}
                              />
                            ) : isEditMode && columnKey === 'pointEstimate' && jiraIssue?.fields.customfield_10111 !== null && jiraIssue?.fields.customfield_10111 !== undefined ? (
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
                            ) : isEditMode ? (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                type="text"
                                value={row[columnKey]}
                              />
                            ) : (
                              <div className={isLongTextColumn ? styles.readOnlyMultilineValue : styles.readOnlyValue}>
                                {columnKey === FEATURE_COLUMN_KEY
                                  ? formatPiReviewFeatureDisplayValue(row.feature, jiraIssue)
                                  : formatPiReviewCellValue(columnKey, row[columnKey])}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {isEditMode && (
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
                                onClick={() => handleSetCommitmentBoundaryAfterRow(rowIndex)}
                                type="button"
                              >
                                {isBoundaryBelowRow ? 'Stretch Goals line below' : 'Set Stretch Goals line below'}
                              </button>
                            )}
                            <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveRow(row.rowId)} type="button">
                              Remove
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {customLinesBelowRow.map((groupingLine) => (
                      <tr className={styles.customGroupingLineRow} key={groupingLine.lineId}>
                        <td
                          colSpan={visiblePiReviewColumnKeys.length + (isEditMode ? 1 : 0)}
                          style={{
                            borderTopColor: groupingLine.color,
                            borderBottomColor: groupingLine.color,
                            backgroundColor: convertHexColorToRgba(groupingLine.color, 0.18),
                            color: groupingLine.color,
                          }}
                        >
                          <strong>{groupingLine.label}</strong>
                        </td>
                      </tr>
                    ))}
                    {isBoundaryBelowRow && (
                      <tr className={styles.commitmentBoundaryRow}>
                        <td colSpan={visiblePiReviewColumnKeys.length + (isEditMode ? 1 : 0)}>
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
        </div>

        {confidenceRows.length === 0 ? (
          <p className={styles.summaryValue}>No confidence votes are tracked yet for this team.</p>
        ) : (
          <div className={styles.confidenceList}>
            {confidenceRows.map((row, rowIndex) => (
              <article className={styles.confidenceCard} key={row.rowId}>
                <div className={styles.confidenceCardHeader}>
                  <strong>Week {rowIndex + 1}</strong>
                  {isEditMode && (
                    <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveConfidenceRow(row.rowId)} type="button">
                      Remove
                    </button>
                  )}
                </div>
                {isEditMode ? (
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
                        <span>{row.confidenceVote || 'Not set'}</span>
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
export default function PiReviewTab({ selectedPiName, teams }: PiReviewTabProps) {
  const configuredTargets = useMemo(() => readConfiguredPiReviewTargets(teams), [teams]);

  if (configuredTargets.length === 0) {
    return (
        <div className={styles.piReviewTab}>
          <p className={styles.summaryValue}>
            Add an explicit <strong>PI Review Page URL</strong> to each ART team in Settings. PI Review pages no longer fall back to a shared default page.
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
      {configuredTargets.map((target) => (
        <PiReviewPagePanel key={target.targetKey} selectedPiName={selectedPiName} target={target} />
      ))}
    </div>
  );
}
