// piReviewTable.ts — Parsing and storage helpers for the Confluence-backed PI Review and confidence tracking tables.

const STORAGE_WRAPPER_ID = 'pi-review-storage-wrapper';
const REQUIRED_PI_REVIEW_COLUMN_COUNT = 8;
const REQUIRED_CONFIDENCE_VOTE_COLUMN_COUNT = 3;
const MIN_SPREADSHEET_IMPORT_COLUMN_COUNT = 4;
const TOOLBOX_PI_REVIEW_TITLE = 'NodeToolbox PI Review';
const TOOLBOX_PI_REVIEW_DESCRIPTION = 'This page section is managed by NodeToolbox so PI Review data can sync reliably.';
const CONFIDENCE_VOTE_SECTION_TITLE = 'Confidence Vote Tracking';

export type PiReviewColumnKey =
  | 'carryOver'
  | 'priority'
  | 'feature'
  | 'pointEstimate'
  | 'dependency'
  | 'risks'
  | 'committed'
  | 'notes'
  | 'devWork'
  | 'testSupport';

export type OptionalPiReviewColumnKey = 'devWork' | 'testSupport';

export interface PiReviewRow {
  rowId: string;
  carryOver: string;
  priority: string;
  feature: string;
  pointEstimate: string;
  dependency: string;
  risks: string;
  committed: string;
  notes: string;
  devWork: string;
  testSupport: string;
}

export type PiReviewSpreadsheetCellValue = string | number | boolean | Date | null | undefined;

export interface PiReviewSpreadsheetSheet {
  sheetName: string;
  rows: PiReviewSpreadsheetCellValue[][];
}

export interface PiReviewSpreadsheetImportResult {
  sheetName: string;
  rows: PiReviewRow[];
  importedColumnKeys: PiReviewColumnKey[];
}

export interface PiReviewTableBinding {
  tableIndex: number;
  headerRowIndex: number;
  columnOrder: PiReviewColumnKey[];
  columnIndexes: number[];
  headerLabels: Record<PiReviewColumnKey, string>;
}

export type ConfidenceVoteColumnKey = 'weekOf' | 'confidenceVote' | 'notes';

export interface ConfidenceVoteRow {
  rowId: string;
  weekOf: string;
  confidenceVote: string;
  notes: string;
}

export interface ConfidenceVoteTableBinding {
  tableIndex: number;
  headerRowIndex: number;
  columnOrder: ConfidenceVoteColumnKey[];
  columnIndexes: number[];
  headerLabels: Record<ConfidenceVoteColumnKey, string>;
}

export const PI_REVIEW_COLUMN_LABELS: Record<PiReviewColumnKey, string> = {
  carryOver: 'Carry-Over',
  priority: 'Priority',
  feature: 'Feature',
  pointEstimate: 'Point Estimate',
  dependency: 'Dependency',
  risks: 'Risks',
  committed: 'Committed to PI?',
  notes: 'Implementation Notes',
  devWork: 'Dev Work',
  testSupport: 'Test Support',
};

export const CONFIDENCE_VOTE_COLUMN_LABELS: Record<ConfidenceVoteColumnKey, string> = {
  weekOf: 'Week Of',
  confidenceVote: 'Fist of Five',
  notes: 'Notes',
};

export const CORE_PI_REVIEW_COLUMN_KEYS: PiReviewColumnKey[] = [
  'carryOver',
  'priority',
  'feature',
  'pointEstimate',
  'dependency',
  'risks',
  'committed',
  'notes',
];

export const OPTIONAL_PI_REVIEW_COLUMN_KEYS: OptionalPiReviewColumnKey[] = [
  'devWork',
  'testSupport',
];

const CONFIDENCE_VOTE_COLUMN_KEYS: ConfidenceVoteColumnKey[] = [
  'weekOf',
  'confidenceVote',
  'notes',
];

function createHeaderRowHtml<ColumnKey extends string>(
  columnKeys: ColumnKey[],
  columnLabels: Record<ColumnKey, string>,
): string {
  return columnKeys.map((columnKey) => `<th>${columnLabels[columnKey]}</th>`).join('');
}

function createEmptyTableHtml<ColumnKey extends string>(
  columnKeys: ColumnKey[],
  columnLabels: Record<ColumnKey, string>,
): string {
  const headerRowHtml = createHeaderRowHtml(columnKeys, columnLabels);
  return `<table><thead><tr>${headerRowHtml}</tr></thead><tbody></tbody></table>`;
}

/** Creates the canonical Confluence storage body used when Toolbox initializes a PI Review page. */
export function createInitialPiReviewPageStorage(): string {
  return [
    `<h1>${TOOLBOX_PI_REVIEW_TITLE}</h1>`,
    `<p>${TOOLBOX_PI_REVIEW_DESCRIPTION}</p>`,
    createEmptyTableHtml(CORE_PI_REVIEW_COLUMN_KEYS, PI_REVIEW_COLUMN_LABELS),
    `<h2>${CONFIDENCE_VOTE_SECTION_TITLE}</h2>`,
    createEmptyTableHtml(CONFIDENCE_VOTE_COLUMN_KEYS, CONFIDENCE_VOTE_COLUMN_LABELS),
  ].join('\n');
}

function createRowId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Creates a blank row ready for the user to fill in from Toolbox. */
export function createEmptyPiReviewRow(): PiReviewRow {
  return {
    rowId: createRowId(),
    carryOver: '',
    priority: '',
    feature: '',
    pointEstimate: '',
    dependency: '',
    risks: '',
    committed: '',
    notes: '',
    devWork: '',
    testSupport: '',
  };
}

/** Creates a blank confidence row ready for week-over-week fist-of-five tracking. */
export function createEmptyConfidenceVoteRow(): ConfidenceVoteRow {
  return {
    rowId: createRowId(),
    weekOf: '',
    confidenceVote: '3',
    notes: '',
  };
}

function formatSpreadsheetCellValue(cellValue: PiReviewSpreadsheetCellValue): string {
  if (cellValue === null || cellValue === undefined) {
    return '';
  }
  if (cellValue instanceof Date) {
    return cellValue.toISOString().slice(0, 10);
  }
  if (typeof cellValue === 'number') {
    return Number.isInteger(cellValue) ? String(cellValue) : String(cellValue);
  }
  if (typeof cellValue === 'boolean') {
    return cellValue ? 'Yes' : '';
  }
  return cellValue.replace(/\s+/g, ' ').trim();
}

function isSpreadsheetCheckboxValue(cellValue: string): boolean {
  const normalizedCellValue = normalizeHeaderText(cellValue);
  return [
    '',
    'yes',
    'no',
    'true',
    'false',
    'y',
    'n',
    'x',
    'checked',
    'unchecked',
  ].includes(normalizedCellValue);
}

function shouldTreatCommittedColumnAsNotes(
  spreadsheetRows: PiReviewSpreadsheetCellValue[][],
  headerRowIndex: number,
  cellIndex: number,
): boolean {
  const sampleValues = spreadsheetRows
    .slice(headerRowIndex + 1, headerRowIndex + 8)
    .map((row) => formatSpreadsheetCellValue(row[cellIndex]))
    .filter((cellValue) => cellValue !== '');

  if (sampleValues.length === 0) {
    return false;
  }

  return sampleValues.some((cellValue) => cellValue.length > 12 || !isSpreadsheetCheckboxValue(cellValue));
}

function readSpreadsheetColumnKey(
  headerText: string,
  spreadsheetRows: PiReviewSpreadsheetCellValue[][],
  headerRowIndex: number,
  cellIndex: number,
  usedColumnKeys: Set<PiReviewColumnKey>,
  hasDedicatedNotesColumn: boolean,
): PiReviewColumnKey | null {
  const columnKey = readPiReviewColumnKeyFromHeader(headerText);
  if (columnKey !== 'committed') {
    return columnKey;
  }

  if (
    !hasDedicatedNotesColumn
    && !usedColumnKeys.has('notes')
    && shouldTreatCommittedColumnAsNotes(spreadsheetRows, headerRowIndex, cellIndex)
  ) {
    return 'notes';
  }

  return columnKey;
}

function readSpreadsheetTableBinding(
  spreadsheetRows: PiReviewSpreadsheetCellValue[][],
): { headerRowIndex: number; columnKeysByIndex: Map<number, PiReviewColumnKey>; importedColumnKeys: PiReviewColumnKey[] } | null {
  for (const [headerRowIndex, spreadsheetRow] of spreadsheetRows.entries()) {
    const columnKeysByIndex = new Map<number, PiReviewColumnKey>();
    const importedColumnKeys: PiReviewColumnKey[] = [];
    const usedColumnKeys = new Set<PiReviewColumnKey>();
    const hasDedicatedNotesColumn = spreadsheetRow.some((cellValue) =>
      readPiReviewColumnKeyFromHeader(formatSpreadsheetCellValue(cellValue)) === 'notes',
    );

    spreadsheetRow.forEach((cellValue, cellIndex) => {
      const headerText = formatSpreadsheetCellValue(cellValue);
      const columnKey = readSpreadsheetColumnKey(
        headerText,
        spreadsheetRows,
        headerRowIndex,
        cellIndex,
        usedColumnKeys,
        hasDedicatedNotesColumn,
      );
      if (!columnKey || usedColumnKeys.has(columnKey)) {
        return;
      }

      usedColumnKeys.add(columnKey);
      importedColumnKeys.push(columnKey);
      columnKeysByIndex.set(cellIndex, columnKey);
    });

    if (usedColumnKeys.has('feature') && usedColumnKeys.size >= MIN_SPREADSHEET_IMPORT_COLUMN_COUNT) {
      return { headerRowIndex, columnKeysByIndex, importedColumnKeys };
    }
  }

  return null;
}

function parsePiReviewRowsFromSpreadsheetRows(
  spreadsheetRows: PiReviewSpreadsheetCellValue[][],
  sheetName: string,
): PiReviewSpreadsheetImportResult {
  const tableBinding = readSpreadsheetTableBinding(spreadsheetRows);
  if (!tableBinding) {
    throw new Error(`Worksheet "${sheetName}" does not contain a PI Review table`);
  }

  const rows = spreadsheetRows
    .slice(tableBinding.headerRowIndex + 1)
    .map((spreadsheetRow, rowIndex) => {
      const row = createEmptyPiReviewRow();
      row.rowId = `imported-row-${rowIndex + 1}`;
      tableBinding.columnKeysByIndex.forEach((columnKey, cellIndex) => {
        row[columnKey] = formatSpreadsheetCellValue(spreadsheetRow[cellIndex]);
      });
      return row;
    })
    .filter((row) => tableBinding.importedColumnKeys.some((columnKey) => row[columnKey].trim() !== ''));

  if (rows.length === 0) {
    throw new Error(`Worksheet "${sheetName}" does not contain any importable PI Review rows`);
  }

  return { sheetName, rows, importedColumnKeys: tableBinding.importedColumnKeys };
}

/** Imports PI Review rows from the first worksheet that contains a recognizable PI Review table. */
export function parsePiReviewRowsFromSpreadsheetSheets(
  spreadsheetSheets: PiReviewSpreadsheetSheet[],
): PiReviewSpreadsheetImportResult {
  for (const spreadsheetSheet of spreadsheetSheets) {
    try {
      return parsePiReviewRowsFromSpreadsheetRows(spreadsheetSheet.rows, spreadsheetSheet.sheetName);
    } catch {
      // Confluence exports can include empty helper sheets; keep looking for the real table.
    }
  }

  throw new Error('No imported worksheet contained a PI Review table');
}

function normalizeHeaderText(headerText: string): string {
  return headerText.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readPiReviewColumnKeyFromHeader(headerText: string): PiReviewColumnKey | null {
  const normalizedHeaderText = normalizeHeaderText(headerText);
  if ((normalizedHeaderText.startsWith('yes') && normalizedHeaderText.includes('carry')) || normalizedHeaderText.includes('carryover')) {
    return 'carryOver';
  }
  if (normalizedHeaderText.includes('priority')) {
    return 'priority';
  }
  if (normalizedHeaderText.includes('feature')) {
    return 'feature';
  }
  if (
    normalizedHeaderText.includes('pointestimate')
    || normalizedHeaderText.includes('storypoint')
    || normalizedHeaderText === 'estimate'
      || normalizedHeaderText === 'points'
  ) {
    return 'pointEstimate';
  }
  if (
    normalizedHeaderText === 'devwork'
    || normalizedHeaderText.includes('developmentwork')
    || normalizedHeaderText.includes('engineeringwork')
  ) {
    return 'devWork';
  }
  if (
    normalizedHeaderText === 'testsupport'
    || normalizedHeaderText.includes('testingonly')
    || normalizedHeaderText.includes('qatest')
  ) {
    return 'testSupport';
  }
  if (
    normalizedHeaderText.includes('dependency')
    || normalizedHeaderText.includes('dependencies')
    || normalizedHeaderText.includes('blocker')
  ) {
    return 'dependency';
  }
  if (normalizedHeaderText.includes('risk')) {
    return 'risks';
  }
  if (normalizedHeaderText.includes('committed')) {
    return 'committed';
  }
  if (normalizedHeaderText.includes('note') || normalizedHeaderText.includes('comment')) {
    return 'notes';
  }

  return null;
}

function readConfidenceVoteColumnKeyFromHeader(headerText: string): ConfidenceVoteColumnKey | null {
  const normalizedHeaderText = normalizeHeaderText(headerText);
  if (normalizedHeaderText === 'weekof' || normalizedHeaderText === 'week') {
    return 'weekOf';
  }
  if (
    normalizedHeaderText === 'fistoffive'
    || normalizedHeaderText === 'confidencevote'
    || normalizedHeaderText === 'confidence'
  ) {
    return 'confidenceVote';
  }
  if (normalizedHeaderText === 'notes') {
    return 'notes';
  }

  return null;
}

function buildStorageDocument(storageValue: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(`<div id="${STORAGE_WRAPPER_ID}">${storageValue}</div>`, 'text/html');
}

function readStorageWrapperElement(documentNode: Document): HTMLElement {
  const wrapperElement = documentNode.getElementById(STORAGE_WRAPPER_ID);
  if (!wrapperElement) {
    throw new Error('PI Review storage wrapper could not be created');
  }

  return wrapperElement;
}

function readTableRows(tableElement: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(tableElement.querySelectorAll('tr')).filter(
    (rowElement): rowElement is HTMLTableRowElement => rowElement instanceof HTMLTableRowElement,
  );
}

function readRowCells(rowElement: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(rowElement.children).filter(
    (cellElement): cellElement is HTMLTableCellElement => cellElement instanceof HTMLTableCellElement,
  );
}

function readRowCellValue(rowElement: HTMLTableRowElement, cellIndex: number): string {
  const cellElement = rowElement.children.item(cellIndex);
  if (!(cellElement instanceof HTMLTableCellElement)) {
    return '';
  }

  return cellElement.textContent?.trim() ?? '';
}

function readBodyRowsAfterHeader(
  tableElement: HTMLTableElement,
  headerRowIndex: number,
): HTMLTableRowElement[] {
  return readTableRows(tableElement).slice(headerRowIndex + 1);
}

function readPiReviewTableBinding(
  tableElement: HTMLTableElement,
  tableIndex: number,
): PiReviewTableBinding | null {
  const tableRows = readTableRows(tableElement);

  for (const [headerRowIndex, headerRowElement] of tableRows.entries()) {
    const headerCells = readRowCells(headerRowElement);
    if (headerCells.length < REQUIRED_PI_REVIEW_COLUMN_COUNT) {
      continue;
    }

    const columnOrder: PiReviewColumnKey[] = [];
    const columnIndexes: number[] = [];
    const headerLabels = {} as Record<PiReviewColumnKey, string>;
    const usedColumnKeys = new Set<PiReviewColumnKey>();

    for (const [cellIndex, headerCell] of headerCells.entries()) {
      const headerText = headerCell.textContent?.trim() ?? '';
      const columnKey = readPiReviewColumnKeyFromHeader(headerText);
      if (!columnKey) {
        continue;
      }
      if (usedColumnKeys.has(columnKey)) {
        columnOrder.length = 0;
        columnIndexes.length = 0;
        break;
      }

      usedColumnKeys.add(columnKey);
      columnOrder.push(columnKey);
      columnIndexes.push(cellIndex);
      headerLabels[columnKey] = headerText;
    }

    const hasAllCoreColumns = CORE_PI_REVIEW_COLUMN_KEYS.every((columnKey) => usedColumnKeys.has(columnKey));
    if (hasAllCoreColumns) {
      return { tableIndex, headerRowIndex, columnOrder, columnIndexes, headerLabels };
    }
  }

  return null;
}

function readConfidenceVoteTableBinding(
  tableElement: HTMLTableElement,
  tableIndex: number,
): ConfidenceVoteTableBinding | null {
  const tableRows = readTableRows(tableElement);

  for (const [headerRowIndex, headerRowElement] of tableRows.entries()) {
    const headerCells = readRowCells(headerRowElement);
    if (headerCells.length < REQUIRED_CONFIDENCE_VOTE_COLUMN_COUNT) {
      continue;
    }

    const columnOrder: ConfidenceVoteColumnKey[] = [];
    const columnIndexes: number[] = [];
    const headerLabels = {} as Record<ConfidenceVoteColumnKey, string>;
    const usedColumnKeys = new Set<ConfidenceVoteColumnKey>();

    for (const [cellIndex, headerCell] of headerCells.entries()) {
      const headerText = headerCell.textContent?.trim() ?? '';
      const columnKey = readConfidenceVoteColumnKeyFromHeader(headerText);
      if (!columnKey) {
        continue;
      }
      if (usedColumnKeys.has(columnKey)) {
        columnOrder.length = 0;
        columnIndexes.length = 0;
        break;
      }

      usedColumnKeys.add(columnKey);
      columnOrder.push(columnKey);
      columnIndexes.push(cellIndex);
      headerLabels[columnKey] = headerText;
    }

    if (usedColumnKeys.size === REQUIRED_CONFIDENCE_VOTE_COLUMN_COUNT) {
      return { tableIndex, headerRowIndex, columnOrder, columnIndexes, headerLabels };
    }
  }

  return null;
}

function locatePiReviewTableBinding(documentNode: Document): PiReviewTableBinding | null {
  const tableElements = Array.from(documentNode.querySelectorAll('table'));
  for (const [tableIndex, tableElement] of tableElements.entries()) {
    const tableBinding = readPiReviewTableBinding(tableElement as HTMLTableElement, tableIndex);
    if (tableBinding) {
      return tableBinding;
    }
  }

  return null;
}

function locateConfidenceVoteTableBinding(documentNode: Document): ConfidenceVoteTableBinding | null {
  const tableElements = Array.from(documentNode.querySelectorAll('table'));
  for (const [tableIndex, tableElement] of tableElements.entries()) {
    const tableBinding = readConfidenceVoteTableBinding(tableElement as HTMLTableElement, tableIndex);
    if (tableBinding) {
      return tableBinding;
    }
  }

  return null;
}

/** Parses the first matching PI Review table from a Confluence storage body. */
export function parsePiReviewTable(storageValue: string): { rows: PiReviewRow[]; tableBinding: PiReviewTableBinding } {
  const documentNode = buildStorageDocument(storageValue);
  const tableBinding = locatePiReviewTableBinding(documentNode);
  if (!tableBinding) {
    throw new Error('No Confluence table was found with the required PI Review headers');
  }

  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The PI Review table could not be reloaded from the Confluence page');
  }

  const rows = readBodyRowsAfterHeader(tableElement, tableBinding.headerRowIndex)
    .map((rowElement, rowIndex) => {
      const row = createEmptyPiReviewRow();
      row.rowId = `row-${rowIndex + 1}`;
      tableBinding.columnOrder.forEach((columnKey, columnOrderIndex) => {
        row[columnKey] = readRowCellValue(rowElement, tableBinding.columnIndexes[columnOrderIndex] ?? columnOrderIndex);
      });
      return row;
    })
    .filter((row) => tableBinding.columnOrder.some((columnKey) => row[columnKey].trim() !== ''));

  return { rows, tableBinding };
}

function replaceRowsAfterHeader<RowType extends Record<string, string>>(
  documentNode: Document,
  tableElement: HTMLTableElement,
  headerRowIndex: number,
  columnOrder: string[],
  columnIndexes: number[],
  columnLabels: Record<string, string>,
  rows: RowType[],
): void {
  const tableRows = readTableRows(tableElement);
  const headerRowElement = tableRows[headerRowIndex];
  if (!headerRowElement) {
    throw new Error('The PI Review table does not contain the matched header row anymore');
  }

  const headerParentElement = headerRowElement.parentElement;
  if (!(headerParentElement instanceof HTMLElement)) {
    throw new Error('The PI Review table header row is not attached to a writable section');
  }

  const totalColumnCount = Math.max(...columnIndexes, columnOrder.length - 1) + 1;
  headerRowElement.replaceChildren();
  for (let cellIndex = 0; cellIndex < totalColumnCount; cellIndex += 1) {
    const headerCellElement = documentNode.createElement('th');
    const columnOrderIndex = columnIndexes.indexOf(cellIndex);
    if (columnOrderIndex >= 0) {
      const columnKey = columnOrder[columnOrderIndex];
      headerCellElement.textContent = columnLabels[columnKey] ?? columnKey;
    }
    headerRowElement.appendChild(headerCellElement);
  }

  tableRows.slice(headerRowIndex + 1).forEach((rowElement) => rowElement.remove());

  let insertAfterNode: ChildNode = headerRowElement;
  for (const row of rows) {
    const rowElement = documentNode.createElement('tr');
    for (let cellIndex = 0; cellIndex < totalColumnCount; cellIndex += 1) {
      const cellElement = documentNode.createElement('td');
      const columnOrderIndex = columnIndexes.indexOf(cellIndex);
      if (columnOrderIndex >= 0) {
        const columnKey = columnOrder[columnOrderIndex];
        cellElement.textContent = row[columnKey] ?? '';
      }
      rowElement.appendChild(cellElement);
    }
    headerParentElement.insertBefore(rowElement, insertAfterNode.nextSibling);
    insertAfterNode = rowElement;
  }
}

/** Writes the current Toolbox PI Review rows back into the matched Confluence table. */
export function writePiReviewTable(
  storageValue: string,
  tableBinding: PiReviewTableBinding,
  rows: PiReviewRow[],
): string {
  const documentNode = buildStorageDocument(storageValue);
  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The PI Review table could not be found while preparing the Confluence update');
  }

  replaceRowsAfterHeader(
    documentNode,
    tableElement,
    tableBinding.headerRowIndex,
    tableBinding.columnOrder,
    tableBinding.columnIndexes,
    PI_REVIEW_COLUMN_LABELS,
    rows as unknown as Record<string, string>[],
  );
  return readStorageWrapperElement(documentNode).innerHTML;
}

/** Parses the optional confidence-vote table from a Confluence storage body. */
export function parseConfidenceVoteTable(
  storageValue: string,
): { rows: ConfidenceVoteRow[]; tableBinding: ConfidenceVoteTableBinding | null } {
  const documentNode = buildStorageDocument(storageValue);
  const tableBinding = locateConfidenceVoteTableBinding(documentNode);
  if (!tableBinding) {
    return { rows: [], tableBinding: null };
  }

  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The confidence vote table could not be reloaded from the Confluence page');
  }

  const rows = readBodyRowsAfterHeader(tableElement, tableBinding.headerRowIndex)
    .map((rowElement, rowIndex) => {
      const row = createEmptyConfidenceVoteRow();
      row.rowId = `confidence-row-${rowIndex + 1}`;
      tableBinding.columnOrder.forEach((columnKey, columnOrderIndex) => {
        row[columnKey] = readRowCellValue(rowElement, tableBinding.columnIndexes[columnOrderIndex] ?? columnOrderIndex);
      });
      return row;
    })
    .filter((row) => CONFIDENCE_VOTE_COLUMN_KEYS.some((columnKey) => row[columnKey].trim() !== ''));

  return { rows, tableBinding };
}

function createConfidenceVoteTableElement(
  documentNode: Document,
  rows: ConfidenceVoteRow[],
): HTMLTableElement {
  const tableElement = documentNode.createElement('table');
  const tableHead = documentNode.createElement('thead');
  const headerRow = documentNode.createElement('tr');
  for (const columnKey of CONFIDENCE_VOTE_COLUMN_KEYS) {
    const headerCell = documentNode.createElement('th');
    headerCell.textContent = CONFIDENCE_VOTE_COLUMN_LABELS[columnKey];
    headerRow.appendChild(headerCell);
  }
  tableHead.appendChild(headerRow);
  tableElement.appendChild(tableHead);

  replaceRowsAfterHeader(
    documentNode,
    tableElement,
    0,
    CONFIDENCE_VOTE_COLUMN_KEYS,
    [0, 1, 2],
    CONFIDENCE_VOTE_COLUMN_LABELS,
    rows as unknown as Record<string, string>[],
  );
  return tableElement;
}

/** Writes the confidence-vote rows back into the page, creating the section if it does not exist yet. */
export function writeConfidenceVoteTable(
  storageValue: string,
  tableBinding: ConfidenceVoteTableBinding | null,
  rows: ConfidenceVoteRow[],
): string {
  const documentNode = buildStorageDocument(storageValue);
  if (!tableBinding) {
    const wrapperElement = readStorageWrapperElement(documentNode);
    const sectionHeading = documentNode.createElement('h2');
    sectionHeading.textContent = CONFIDENCE_VOTE_SECTION_TITLE;
    wrapperElement.appendChild(sectionHeading);
    wrapperElement.appendChild(createConfidenceVoteTableElement(documentNode, rows));
    return wrapperElement.innerHTML;
  }

  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The confidence vote table could not be found while preparing the Confluence update');
  }

  replaceRowsAfterHeader(
    documentNode,
    tableElement,
    tableBinding.headerRowIndex,
    tableBinding.columnOrder,
    tableBinding.columnIndexes,
    CONFIDENCE_VOTE_COLUMN_LABELS,
    rows as unknown as Record<string, string>[],
  );
  return readStorageWrapperElement(documentNode).innerHTML;
}

/** Converts the current PI Review rows into a CSV string for download. */
export function exportPiReviewRowsToCsv(rows: PiReviewRow[]): string {
  const headerRow = CORE_PI_REVIEW_COLUMN_KEYS.map((columnKey) => PI_REVIEW_COLUMN_LABELS[columnKey]).join(',');
  const dataRows = rows.map((row) =>
    CORE_PI_REVIEW_COLUMN_KEYS
      .map((columnKey) => `"${row[columnKey].replace(/"/g, '""')}"`)
      .join(','),
  );
  return [headerRow, ...dataRows].join('\n');
}
