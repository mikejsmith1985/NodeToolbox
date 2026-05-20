// PiReviewTab.tsx — Editable ART PI Review workspace that syncs one Confluence-backed section per team.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '../../components/Toast/ToastProvider.tsx';
import {
  fetchConfluencePageByReference,
  resolveConfluencePageIdFromReference,
  updateConfluencePage,
} from '../../services/confluenceApi.ts';
import { buildCapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { CapacitySummary } from '../SprintDashboard/capacityModel.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { useArtCapacityStore } from './hooks/useArtCapacityStore.ts';
import type { ArtCapacityTeamConfig } from './hooks/useArtCapacityStore.ts';
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
  type PiReviewRow,
  type PiReviewSpreadsheetCellValue,
  type PiReviewTableBinding,
  type ConfidenceVoteRow,
  type ConfidenceVoteTableBinding,
  writeConfidenceVoteTable,
  writePiReviewCapacitySummary,
  writePiReviewTable,
} from './piReviewTable.ts';
import styles from './PiReviewTab.module.css';

const LONG_TEXT_COLUMNS = new Set<PiReviewColumnKey>(['dependency', 'risks', 'notes']);
const CHECKBOX_COLUMNS = new Set<PiReviewColumnKey>(['committed', 'devWork', 'testSupport']);
const FEATURE_COLUMN_KEY = 'feature';
const FIST_OF_FIVE_VALUES = ['1', '2', '3', '4', '5'] as const;
const SPREADSHEET_IMPORT_ACCEPT = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

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

function downloadPiReviewCsv(rows: PiReviewRow[], selectedPiName: string, targetLabel: string): void {
  const csvContent = exportPiReviewRowsToCsv(rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  const normalizedTargetLabel = targetLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  downloadAnchor.href = objectUrl;
  downloadAnchor.download = `pi-review-${normalizedTargetLabel || 'team'}-${selectedPiName.trim() || 'export'}.csv`;
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
  const [isTemplateDraftConfirmationVisible, setIsTemplateDraftConfirmationVisible] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<OptionalPiReviewColumnKey>>(new Set());
  const [commitmentBoundaryIndex, setCommitmentBoundaryIndex] = useState<number | null>(null);
  const lastAutoLoadKeyRef = useRef('');
  const importFileInputRef = useRef<HTMLInputElement>(null);
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
      setRows(parsedPiReviewTable.rows);
      setConfidenceRows(parsedConfidenceTable.rows);
      setSavedCapacitySummary(parsedCapacitySummary);
      setTableBinding(parsedPiReviewTable.tableBinding);
      setConfidenceTableBinding(parsedConfidenceTable.tableBinding);
      setVisibleOptionalColumns(readOptionalColumnsFromBinding(parsedPiReviewTable.tableBinding));
      setCommitmentBoundaryIndex(parsedPiReviewTable.commitmentBoundaryIndex);
      setHasUnsavedChanges(false);
      setIsTemplateDraftConfirmationVisible(false);
    } catch (error) {
      setRows([]);
      setConfidenceRows([]);
      setTableBinding(null);
      setConfidenceTableBinding(null);
      setSavedCapacitySummary(null);
      setVisibleOptionalColumns(new Set());
      setCommitmentBoundaryIndex(null);
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
      setHasUnsavedChanges(true);
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

  function buildNextPiReviewStorageValue(
    baseStorageValue: string,
    nextPiReviewTableBinding: PiReviewTableBinding,
    nextConfidenceTableBinding: ConfidenceVoteTableBinding | null,
    capacitySummaryForSave: CapacitySummary | null,
  ): string {
    let nextStorageValue = writePiReviewCapacitySummary(baseStorageValue, capacitySummaryForSave);
    nextStorageValue = writePiReviewTable(nextStorageValue, nextPiReviewTableBinding, rows, commitmentBoundaryIndex);
    if (confidenceRows.length > 0 || nextConfidenceTableBinding !== null) {
      nextStorageValue = writeConfidenceVoteTable(nextStorageValue, nextConfidenceTableBinding, confidenceRows);
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
      let updatedPage;
      try {
        updatedPage = await updateConfluencePage({
          pageId: resolvedPageId,
          pageTitle: pageTitle || target.targetLabel,
          storageValue: buildNextPiReviewStorageValue(storageValue, tableBinding, confidenceTableBinding, capacitySummaryForSave),
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
          ),
          nextVersionNumber: latestConfluencePage.version.number + 1,
        });
      }

      const parsedPiReviewTable = parsePiReviewTable(updatedPage.body.storage.value);
      const parsedConfidenceTable = parseConfidenceVoteTable(updatedPage.body.storage.value);
      const parsedCapacitySummary = parsePiReviewCapacitySummary(updatedPage.body.storage.value);
      setRows(parsedPiReviewTable.rows);
      setConfidenceRows(parsedConfidenceTable.rows);
      setSavedCapacitySummary(parsedCapacitySummary);
      setTableBinding(parsedPiReviewTable.tableBinding);
      setConfidenceTableBinding(parsedConfidenceTable.tableBinding);
      setVisibleOptionalColumns(readOptionalColumnsFromBinding(parsedPiReviewTable.tableBinding));
      setCommitmentBoundaryIndex(parsedPiReviewTable.commitmentBoundaryIndex);
      setStorageValue(updatedPage.body.storage.value);
      setPageTitle(updatedPage.title);
      setResolvedPageId(updatedPage.id);
      setPageVersionNumber(updatedPage.version.number);
      setHasUnsavedChanges(false);
      showToast(`${target.targetLabel} PI Review saved to Confluence ✓`, 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save the PI Review page';
      setLoadError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section aria-label={`${target.targetLabel} PI Review`} className={styles.pagePanel}>
      <div className={styles.statusRow}>
        <h3>{target.targetLabel}</h3>
        {hasUnsavedChanges && <span className={styles.dirtyBadge}>Unsaved changes</span>}
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

      <div className={styles.toolbar}>
        <button disabled={isLoading || isSaving} onClick={() => void loadPiReviewPage()} type="button">
          {isLoading ? 'Loading…' : 'Reload from Confluence'}
        </button>
        <button disabled={isLoading || isSaving || !tableBinding} onClick={handleAddRow} type="button">Add PI Review Row</button>
        <button disabled={rows.length === 0} onClick={() => downloadPiReviewCsv(rows, selectedPiName, target.targetLabel)} type="button">Export PI Review CSV</button>
        <input
          ref={importFileInputRef}
          accept={SPREADSHEET_IMPORT_ACCEPT}
          aria-label={`Import PI Review XLSX for ${target.targetLabel}`}
          className={styles.hiddenFileInput}
          disabled={isLoading || isSaving || !tableBinding}
          onChange={(event) => void handleImportPiReviewFile(event)}
          type="file"
        />
        <button
          disabled={isLoading || isSaving || !tableBinding}
          onClick={() => importFileInputRef.current?.click()}
          type="button"
        >
          Import PI Review XLSX
        </button>
        <button disabled={isLoading || isSaving || !tableBinding} onClick={handleAddConfidenceRow} type="button">Add Confidence Week</button>
        <button
          disabled={isLoading || isSaving || !hasUnsavedChanges || pageVersionNumber === null || resolvedPageId === ''}
          onClick={() => void handleSaveToConfluence()}
          type="button"
        >
          {isSaving ? 'Saving…' : 'Save to Confluence'}
        </button>
      </div>

      {tableBinding && (
        <fieldset className={styles.tableTools}>
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
          <span className={styles.summaryValue}>
            Commitment line: {commitmentBoundaryIndex === null ? 'Not set' : `after row ${commitmentBoundaryIndex}`}
          </span>
          <span className={styles.summaryValue}>Committed points: {formatCapacityValue(committedPointTotal)}</span>
          <button
            className={styles.columnToggleButton}
            disabled={isLoading || isSaving || commitmentBoundaryIndex === null}
            onClick={handleClearCommitmentBoundary}
            type="button"
          >
            Clear commitment line
          </button>
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
          No PI Review rows have been added yet. Use Add PI Review Row to start building this page from Toolbox.
        </p>
      )}

      {rows.length > 0 && (
        <div className={styles.tableShell}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                {visiblePiReviewColumnKeys.map((columnKey) => (
                  <th key={columnKey} scope="col">{PI_REVIEW_COLUMN_LABELS[columnKey]}</th>
                ))}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const isBoundaryBelowRow = commitmentBoundaryIndex === rowIndex + 1;
                const canSetBoundaryBelowRow = rowIndex < rows.length;
                const canMoveRowUp = rowIndex > 0;
                const canMoveRowDown = rowIndex < rows.length - 1;

                return (
                  <Fragment key={row.rowId}>
                    <tr>
                      {visiblePiReviewColumnKeys.map((columnKey) => {
                        const isLongTextColumn = LONG_TEXT_COLUMNS.has(columnKey);
                        const isCheckboxColumn = CHECKBOX_COLUMNS.has(columnKey);
                        const cellClassName = columnKey === FEATURE_COLUMN_KEY
                          ? styles.featureCell
                          : isLongTextColumn
                            ? styles.longCell
                            : styles.shortCell;

                        return (
                          <td className={cellClassName} key={columnKey}>
                            {isCheckboxColumn ? (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                checked={row[columnKey] === 'Yes'}
                                className={styles.checkboxInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.checked ? 'Yes' : '')}
                                type="checkbox"
                              />
                            ) : isLongTextColumn ? (
                              <textarea
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellTextarea}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                value={row[columnKey]}
                              />
                            ) : (
                              <input
                                aria-label={`${PI_REVIEW_COLUMN_LABELS[columnKey]} for ${target.targetLabel} row ${rowIndex + 1}`}
                                className={styles.cellInput}
                                onChange={(event) => handleCellChange(row.rowId, columnKey, event.target.value)}
                                type="text"
                                value={row[columnKey]}
                              />
                            )}
                          </td>
                        );
                      })}
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
                              {isBoundaryBelowRow ? 'Commit line below' : 'Set commit line below'}
                            </button>
                          )}
                          <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveRow(row.rowId)} type="button">
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isBoundaryBelowRow && (
                      <tr className={styles.commitmentBoundaryRow}>
                        <td colSpan={visiblePiReviewColumnKeys.length + 1}>
                          <span>Hard commits above</span>
                          <strong>Stretch goals below</strong>
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
                  <button className={styles.removeButton} disabled={isSaving} onClick={() => handleRemoveConfidenceRow(row.rowId)} type="button">
                    Remove
                  </button>
                </div>
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
