// piReviewTable.ts — Parsing and storage helpers for the Confluence-backed PI Review and confidence tracking tables.

import type { CapacitySummary } from '../SprintDashboard/capacityModel.ts';

// ── DOM host abstraction ──
// This parse/serialize engine runs in two homes: the browser (real DOM) and a Node scheduler
// (headless DOM via linkedom). Two seams keep it a single shared engine: (1) an injectable DOMParser
// so Node can supply linkedom's parser, and (2) tag/nodeType predicates instead of
// `instanceof HTML*Element` (linkedom does not expose browser-identity element constructors). The
// browser injects nothing and uses its native `DOMParser`.

/** Minimal DOMParser shape the engine needs — satisfied by both the browser's and linkedom's. */
interface DomParserLike {
  parseFromString(markup: string, mimeType: 'text/html'): Document;
}

let injectedDomParser: DomParserLike | null = null;

/**
 * Supplies the DOMParser the engine should use (e.g. linkedom's on the server). Pass `null` to fall
 * back to the browser's native `DOMParser`. Call once before using the engine server-side.
 */
export function setPiReviewDomParser(domParser: DomParserLike | null): void {
  injectedDomParser = domParser;
}

/** True when the node is an element (nodeType 1). Replaces `instanceof HTMLElement`. */
function isElementNode(node: unknown): node is HTMLElement {
  return node != null && (node as Node).nodeType === 1;
}

/** True when the node is a table row. Replaces `instanceof HTMLTableRowElement`. */
function isTableRowElement(node: unknown): node is HTMLTableRowElement {
  return isElementNode(node) && (node as Element).tagName.toLowerCase() === 'tr';
}

/** True when the node is a table cell (td/th). Replaces `instanceof HTMLTableCellElement`. */
function isTableCellElement(node: unknown): node is HTMLTableCellElement {
  const tagName = isElementNode(node) ? (node as Element).tagName.toLowerCase() : '';
  return tagName === 'td' || tagName === 'th';
}

const STORAGE_WRAPPER_ID = 'pi-review-storage-wrapper';
const REQUIRED_PI_REVIEW_COLUMN_COUNT = 8;
const REQUIRED_CONFIDENCE_VOTE_COLUMN_COUNT = 3;
const TOOLBOX_PI_REVIEW_TITLE = 'NodeToolbox PI Review';
const TOOLBOX_PI_REVIEW_DESCRIPTION = 'This page section is managed by NodeToolbox so PI Review data can sync reliably.';
const TEAM_CAPACITY_SECTION_TITLE = 'Team Capacity';
const TEAM_CAPACITY_SECTION_DESCRIPTION = 'Snapshot pulled from the NodeToolbox Capacity tab.';
const TEAM_CAPACITY_EMPTY_MESSAGE = 'Capacity from the Toolbox Capacity tab appears here after you save from NodeToolbox.';
const CONFIDENCE_VOTE_SECTION_TITLE = 'Confidence Vote Tracking';
const PI_REVIEW_COMMITMENT_BOUNDARY_ATTRIBUTE = 'data-node-toolbox-pi-review-boundary';
const PI_REVIEW_COMMITMENT_BOUNDARY_VALUE = 'hard-commit';
const PI_REVIEW_COMMITMENT_BOUNDARY_LABEL = 'Hard commits above / Stretch goals below';
const PI_REVIEW_GROUPING_LINE_ATTRIBUTE = 'data-node-toolbox-pi-review-grouping';
const PI_REVIEW_GROUPING_LINE_PAYLOAD_ATTRIBUTE = 'data-node-toolbox-pi-review-grouping-payload';
const PI_REVIEW_CUSTOM_GROUPING_LINE_VALUE = 'custom';
const PI_REVIEW_CAPACITY_SECTION_ATTRIBUTE = 'data-node-toolbox-pi-review-capacity';
const PI_REVIEW_CAPACITY_SECTION_VALUE = 'summary';
const PI_REVIEW_CAPACITY_PAYLOAD_ATTRIBUTE = 'data-node-toolbox-pi-review-capacity-payload';
const FULL_WIDTH_TABLE_STYLE = 'width: 100%; table-layout: fixed;';
const JIRA_BROWSE_URL_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const JIRA_ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/;
const STRETCH_GOALS_LINE_COLOR = '#f5c400';
const DEFAULT_CUSTOM_GROUPING_LINE_COLOR = '#0ea5e9';
const CUSTOM_GROUPING_LINE_BACKGROUND_ALPHA = 0.18;
const RGB_COLOR_PATTERN = /rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i;

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

export interface PiReviewTableBinding {
  tableIndex: number;
  headerRowIndex: number;
  columnOrder: PiReviewColumnKey[];
  columnIndexes: number[];
  headerLabels: Record<PiReviewColumnKey, string>;
}

export interface PiReviewTableParseResult {
  rows: PiReviewRow[];
  tableBinding: PiReviewTableBinding;
  commitmentBoundaryIndex: number | null;
  customGroupingLines: PiReviewCustomGroupingLine[];
}

export interface PiReviewCustomGroupingLine {
  lineId: string;
  afterRowIndex: number;
  label: string;
  color: string;
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
  return `<table style="${FULL_WIDTH_TABLE_STYLE}"><thead><tr>${headerRowHtml}</tr></thead><tbody></tbody></table>`;
}

function formatCapacityValue(capacityValue: number): string {
  return Number.isInteger(capacityValue) ? String(capacityValue) : String(Number(capacityValue.toFixed(1)));
}

function encodeCapacitySummary(capacitySummary: CapacitySummary): string {
  return encodeURIComponent(JSON.stringify(capacitySummary));
}

function decodeCapacitySummary(encodedCapacitySummary: string | null): CapacitySummary | null {
  if (!encodedCapacitySummary) {
    return null;
  }

  try {
    const parsedCapacitySummary = JSON.parse(decodeURIComponent(encodedCapacitySummary)) as CapacitySummary;
    return parsedCapacitySummary;
  } catch {
    return null;
  }
}

function createPiReviewCapacitySectionHtml(capacitySummary: CapacitySummary | null): string {
  if (!capacitySummary) {
    return [
      `<section ${PI_REVIEW_CAPACITY_SECTION_ATTRIBUTE}="${PI_REVIEW_CAPACITY_SECTION_VALUE}">`,
      `<h2>${TEAM_CAPACITY_SECTION_TITLE}</h2>`,
      `<p>${TEAM_CAPACITY_EMPTY_MESSAGE}</p>`,
      '</section>',
    ].join('');
  }

  const visibleRoleSummaries = Object.entries(capacitySummary.roleCapacities)
    .filter(([, capacityValue]) => capacityValue > 0)
    .map(([teamRole, capacityValue]) => `<li><strong>${teamRole}:</strong> ${formatCapacityValue(capacityValue)} pts</li>`)
    .join('');

  return [
    `<section ${PI_REVIEW_CAPACITY_SECTION_ATTRIBUTE}="${PI_REVIEW_CAPACITY_SECTION_VALUE}" ${PI_REVIEW_CAPACITY_PAYLOAD_ATTRIBUTE}="${encodeCapacitySummary(capacitySummary)}">`,
    `<h2>${TEAM_CAPACITY_SECTION_TITLE}</h2>`,
    `<p>${TEAM_CAPACITY_SECTION_DESCRIPTION}</p>`,
    `<p><strong>Plan:</strong> ${capacitySummary.summaryLabel}</p>`,
    `<p><strong>Date Range:</strong> ${capacitySummary.startDate || 'Not set'} to ${capacitySummary.endDate || 'Not set'}</p>`,
    `<p><strong>Work Days:</strong> ${capacitySummary.workDayCount}</p>`,
    `<p><strong>100% Capacity (pts):</strong> ${formatCapacityValue(capacitySummary.totalCapacityPoints)}</p>`,
    `<p><strong>80% Capacity (pts):</strong> ${formatCapacityValue(capacitySummary.recommendedCapacityPoints)}</p>`,
    visibleRoleSummaries ? `<ul>${visibleRoleSummaries}</ul>` : '<p>No capacity role rows are planned yet.</p>',
    '</section>',
  ].join('');
}

/** Creates the canonical Confluence storage body used when Toolbox initializes a PI Review page. */
export function createInitialPiReviewPageStorage(capacitySummary: CapacitySummary | null = null): string {
  return [
    `<h1>${TOOLBOX_PI_REVIEW_TITLE}</h1>`,
    `<p>${TOOLBOX_PI_REVIEW_DESCRIPTION}</p>`,
    createPiReviewCapacitySectionHtml(capacitySummary),
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

function locateFallbackCapacityElements(documentNode: Document): HTMLElement[] {
  const storageWrapperElement = readStorageWrapperElement(documentNode);
  const wrapperChildren = Array.from(storageWrapperElement.children) as HTMLElement[];
  const teamCapacityHeadingIndex = wrapperChildren.findIndex((childElement) =>
    childElement.tagName.toLowerCase().startsWith('h')
    && childElement.textContent?.trim().toLowerCase() === TEAM_CAPACITY_SECTION_TITLE.toLowerCase());
  if (teamCapacityHeadingIndex < 0) {
    return [];
  }

  const fallbackCapacityElements: HTMLElement[] = [wrapperChildren[teamCapacityHeadingIndex]];
  for (let childIndex = teamCapacityHeadingIndex + 1; childIndex < wrapperChildren.length; childIndex += 1) {
    const childElement = wrapperChildren[childIndex];
    const childTagName = childElement.tagName.toLowerCase();
    if (childTagName === 'table' || childTagName.startsWith('h')) {
      break;
    }

    fallbackCapacityElements.push(childElement);
  }

  return fallbackCapacityElements;
}

/**
 * Collects every Team Capacity block on the page in document order — both canonical `<section>`
 * wrappers and legacy "loose" blocks (a bare Team Capacity heading followed by its paragraphs/list).
 * Each inner array is one block's elements. The writer uses this to de-duplicate: a page that
 * accreted several capacity blocks across older formats collapses back to a single section.
 */
function collectCapacityBlocks(documentNode: Document): HTMLElement[][] {
  const storageWrapperElement = readStorageWrapperElement(documentNode);
  const wrapperChildren = Array.from(storageWrapperElement.children) as HTMLElement[];
  const capacitySelector = `[${PI_REVIEW_CAPACITY_SECTION_ATTRIBUTE}="${PI_REVIEW_CAPACITY_SECTION_VALUE}"]`;
  const capacityBlocks: HTMLElement[][] = [];

  for (let childIndex = 0; childIndex < wrapperChildren.length; childIndex += 1) {
    const childElement = wrapperChildren[childIndex];

    // A canonical section is self-contained — the one element is the whole block.
    if (childElement.matches(capacitySelector)) {
      capacityBlocks.push([childElement]);
      continue;
    }

    // A legacy loose block starts at a bare "Team Capacity" heading and runs until the next
    // heading, table, or canonical section.
    const isTeamCapacityHeading = childElement.tagName.toLowerCase().startsWith('h')
      && childElement.textContent?.trim().toLowerCase() === TEAM_CAPACITY_SECTION_TITLE.toLowerCase();
    if (!isTeamCapacityHeading) {
      continue;
    }

    const looseBlockElements: HTMLElement[] = [childElement];
    let lookaheadIndex = childIndex + 1;
    for (; lookaheadIndex < wrapperChildren.length; lookaheadIndex += 1) {
      const followingElement = wrapperChildren[lookaheadIndex];
      const followingTagName = followingElement.tagName.toLowerCase();
      if (followingTagName === 'table' || followingTagName.startsWith('h') || followingElement.matches(capacitySelector)) {
        break;
      }
      looseBlockElements.push(followingElement);
    }
    capacityBlocks.push(looseBlockElements);
    childIndex = lookaheadIndex - 1; // resume after the block we just consumed
  }

  return capacityBlocks;
}

function parseCapacityNumber(paragraphText: string): number {
  const matchedNumber = paragraphText.match(/:\s*(-?\d+(\.\d+)?)\s*(pts)?\s*$/i);
  return matchedNumber ? Number(matchedNumber[1]) : 0;
}

function parseFallbackCapacitySummary(fallbackCapacityElements: HTMLElement[]): CapacitySummary | null {
  if (fallbackCapacityElements.length === 0) {
    return null;
  }

  const paragraphTexts = fallbackCapacityElements
    .filter((element) => element.tagName.toLowerCase() === 'p')
    .map((element) => element.textContent?.trim() ?? '');
  if (paragraphTexts.some((paragraphText) => paragraphText === TEAM_CAPACITY_EMPTY_MESSAGE)) {
    return null;
  }

  const planParagraph = paragraphTexts.find((paragraphText) => paragraphText.startsWith('Plan:'));
  const dateRangeParagraph = paragraphTexts.find((paragraphText) => paragraphText.startsWith('Date Range:'));
  const workDaysParagraph = paragraphTexts.find((paragraphText) => paragraphText.startsWith('Work Days:'));
  const fullCapacityParagraph = paragraphTexts.find((paragraphText) => paragraphText.startsWith('100% Capacity'));
  const recommendedCapacityParagraph = paragraphTexts.find((paragraphText) => paragraphText.startsWith('80% Capacity'));
  if (!planParagraph || !dateRangeParagraph || !workDaysParagraph || !fullCapacityParagraph || !recommendedCapacityParagraph) {
    return null;
  }

  const matchedDateRange = dateRangeParagraph.match(/Date Range:\s*(.+?)\s+to\s+(.+)$/i);
  const roleCapacities: Record<string, number> = {};
  const roleListElement = fallbackCapacityElements.find((element) => element.tagName.toLowerCase() === 'ul');
  for (const roleElement of Array.from(roleListElement?.querySelectorAll('li') ?? [])) {
    const roleText = roleElement.textContent?.trim() ?? '';
    const matchedRole = roleText.match(/^(.+?):\s*(-?\d+(\.\d+)?)\s*pts$/i);
    if (!matchedRole) {
      continue;
    }

    roleCapacities[matchedRole[1].trim()] = Number(matchedRole[2]);
  }

  return {
    summaryLabel: planParagraph.replace(/^Plan:\s*/i, '').trim(),
    startDate: matchedDateRange?.[1]?.trim() ?? '',
    endDate: matchedDateRange?.[2]?.trim() ?? '',
    workDayCount: parseCapacityNumber(workDaysParagraph),
    totalCapacityPoints: parseCapacityNumber(fullCapacityParagraph),
    recommendedCapacityPoints: parseCapacityNumber(recommendedCapacityParagraph),
    roleCapacities,
  };
}

/** Reads the saved Team Capacity snapshot from a Confluence PI Review page when one exists. */
export function parsePiReviewCapacitySummary(storageValue: string): CapacitySummary | null {
  const documentNode = buildStorageDocument(storageValue);
  const capacitySectionElement = documentNode.querySelector(
    `[${PI_REVIEW_CAPACITY_SECTION_ATTRIBUTE}="${PI_REVIEW_CAPACITY_SECTION_VALUE}"]`,
  );
  if (isElementNode(capacitySectionElement)) {
    return decodeCapacitySummary(capacitySectionElement.getAttribute(PI_REVIEW_CAPACITY_PAYLOAD_ATTRIBUTE));
  }

  return parseFallbackCapacitySummary(locateFallbackCapacityElements(documentNode));
}

/** Writes the Team Capacity snapshot into the Confluence PI Review page above the PI Review table. */
export function writePiReviewCapacitySummary(storageValue: string, capacitySummary: CapacitySummary | null): string {
  const documentNode = buildStorageDocument(storageValue);
  const storageWrapperElement = readStorageWrapperElement(documentNode);
  const capacitySectionElement = readStorageWrapperElement(
    buildStorageDocument(createPiReviewCapacitySectionHtml(capacitySummary)),
  ).firstElementChild;
  if (!isElementNode(capacitySectionElement)) {
    throw new Error('The PI Review capacity section could not be created');
  }

  // Replace the first existing capacity block with the fresh section and delete every other one, so
  // duplicate blocks accreted from older page formats collapse back to a single canonical section.
  const capacityBlocks = collectCapacityBlocks(documentNode);
  if (capacityBlocks.length > 0) {
    const [firstBlock, ...remainingBlocks] = capacityBlocks;
    const [firstElement, ...trailingElements] = firstBlock;
    firstElement.replaceWith(capacitySectionElement);
    trailingElements.forEach((trailingElement) => trailingElement.remove());
    remainingBlocks.forEach((block) => block.forEach((blockElement) => blockElement.remove()));
    return storageWrapperElement.innerHTML;
  }

  const piReviewTableBinding = locatePiReviewTableBinding(documentNode);
  const piReviewTableElement = piReviewTableBinding
    ? documentNode.querySelectorAll('table').item(piReviewTableBinding.tableIndex)
    : null;
  if (isElementNode(piReviewTableElement)) {
    piReviewTableElement.parentElement?.insertBefore(capacitySectionElement, piReviewTableElement);
  } else {
    storageWrapperElement.appendChild(capacitySectionElement);
  }

  return storageWrapperElement.innerHTML;
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
  const parser = injectedDomParser ?? new DOMParser();
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
    (rowElement): rowElement is HTMLTableRowElement => isTableRowElement(rowElement),
  );
}

function readRowCells(rowElement: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(rowElement.children).filter(
    (cellElement): cellElement is HTMLTableCellElement => isTableCellElement(cellElement),
  );
}

function readRowCellValue(rowElement: HTMLTableRowElement, cellIndex: number): string {
  const cellElement = rowElement.children.item(cellIndex);
  if (!isTableCellElement(cellElement)) {
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

function readNormalizedBoundaryText(rowElement: HTMLTableRowElement): string {
  return (rowElement.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeHexColor(hexColor: string): string {
  const trimmedHexColor = hexColor.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmedHexColor) ? trimmedHexColor : STRETCH_GOALS_LINE_COLOR;
}

function convertRgbColorToHex(redValue: number, greenValue: number, blueValue: number): string {
  return `#${[redValue, greenValue, blueValue]
    .map((colorChannelValue) => Math.max(0, Math.min(255, colorChannelValue)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function readNormalizedColorFromStyle(styleValue: string | null): string | null {
  if (!styleValue) {
    return null;
  }

  const matchedHexColor = styleValue.match(/#[0-9a-f]{6}/i);
  if (matchedHexColor) {
    return normalizeHexColor(matchedHexColor[0]);
  }

  const matchedRgbColor = styleValue.match(RGB_COLOR_PATTERN);
  if (!matchedRgbColor) {
    return null;
  }

  return convertRgbColorToHex(
    Number.parseInt(matchedRgbColor[1], 10),
    Number.parseInt(matchedRgbColor[2], 10),
    Number.parseInt(matchedRgbColor[3], 10),
  );
}

function convertHexColorToRgba(hexColor: string, alphaValue: number): string {
  const normalizedHexColor = normalizeHexColor(hexColor);
  const redValue = Number.parseInt(normalizedHexColor.slice(1, 3), 16);
  const greenValue = Number.parseInt(normalizedHexColor.slice(3, 5), 16);
  const blueValue = Number.parseInt(normalizedHexColor.slice(5, 7), 16);
  return `rgba(${redValue}, ${greenValue}, ${blueValue}, ${alphaValue})`;
}

function isPiReviewCommitmentBoundaryRow(rowElement: HTMLTableRowElement): boolean {
  const boundaryValue = rowElement.getAttribute(PI_REVIEW_COMMITMENT_BOUNDARY_ATTRIBUTE);
  if (boundaryValue === PI_REVIEW_COMMITMENT_BOUNDARY_VALUE) {
    return true;
  }

  return readNormalizedBoundaryText(rowElement) === PI_REVIEW_COMMITMENT_BOUNDARY_LABEL.toLowerCase();
}

function parsePiReviewCustomGroupingLineRow(
  rowElement: HTMLTableRowElement,
  afterRowIndex: number,
  lineIndex: number,
): PiReviewCustomGroupingLine | null {
  const rawPayload = rowElement.getAttribute(PI_REVIEW_GROUPING_LINE_PAYLOAD_ATTRIBUTE);
  if (rowElement.getAttribute(PI_REVIEW_GROUPING_LINE_ATTRIBUTE) === PI_REVIEW_CUSTOM_GROUPING_LINE_VALUE && rawPayload) {
    try {
      const parsedPayload = JSON.parse(rawPayload) as { lineId?: string; label?: string; color?: string };
      const normalizedLabel = parsedPayload.label?.trim() ?? '';
      if (normalizedLabel === '') {
        return null;
      }

      return {
        lineId: parsedPayload.lineId?.trim() || `grouping-line-${lineIndex}`,
        afterRowIndex,
        label: normalizedLabel,
        color: normalizeHexColor(parsedPayload.color ?? STRETCH_GOALS_LINE_COLOR),
      };
    } catch {
      return null;
    }
  }

  const rowCells = rowElement.querySelectorAll('td,th');
  if (rowCells.length !== 1) {
    return null;
  }

  const groupingLineCell = rowCells.item(0);
  if (!isTableCellElement(groupingLineCell)) {
    return null;
  }

  const colspanValue = Number.parseInt(groupingLineCell.getAttribute('colspan') ?? '1', 10);
  const groupingLineLabel = groupingLineCell.textContent?.trim() ?? '';
  if (groupingLineLabel === '' || colspanValue < REQUIRED_PI_REVIEW_COLUMN_COUNT) {
    return null;
  }

  if (readNormalizedBoundaryText(rowElement) === PI_REVIEW_COMMITMENT_BOUNDARY_LABEL.toLowerCase()) {
    return null;
  }

  return {
    lineId: `grouping-line-${lineIndex}`,
    afterRowIndex,
    label: groupingLineLabel,
    color: readNormalizedColorFromStyle(groupingLineCell.getAttribute('style'))
      ?? readNormalizedColorFromStyle(rowElement.getAttribute('style'))
      ?? DEFAULT_CUSTOM_GROUPING_LINE_COLOR,
  };
}

function normalizePiReviewCommitmentBoundaryIndex(
  commitmentBoundaryIndex: number | null | undefined,
  rowCount: number,
): number | null {
  if (commitmentBoundaryIndex === null || commitmentBoundaryIndex === undefined) {
    return null;
  }

  return commitmentBoundaryIndex > 0 && commitmentBoundaryIndex <= rowCount
    ? commitmentBoundaryIndex
    : null;
}

function createPiReviewCommitmentBoundaryRow(
  documentNode: Document,
  totalColumnCount: number,
): HTMLTableRowElement {
  const rowElement = documentNode.createElement('tr');
  rowElement.setAttribute(PI_REVIEW_COMMITMENT_BOUNDARY_ATTRIBUTE, PI_REVIEW_COMMITMENT_BOUNDARY_VALUE);
  rowElement.setAttribute('class', 'node-toolbox-pi-review-boundary');
  rowElement.setAttribute('style', 'background-color: #fff3bf; color: #7a4f00; font-weight: 700;');

  const cellElement = documentNode.createElement('td');
  cellElement.setAttribute('colspan', String(totalColumnCount));
  cellElement.setAttribute('style', 'border-top: 4px solid #f5c400; border-bottom: 4px solid #f5c400; text-align: center;');
  cellElement.textContent = PI_REVIEW_COMMITMENT_BOUNDARY_LABEL;
  rowElement.appendChild(cellElement);

  return rowElement;
}

function createPiReviewCustomGroupingRow(
  documentNode: Document,
  totalColumnCount: number,
  groupingLine: PiReviewCustomGroupingLine,
): HTMLTableRowElement {
  const rowElement = documentNode.createElement('tr');
  rowElement.setAttribute(PI_REVIEW_GROUPING_LINE_ATTRIBUTE, PI_REVIEW_CUSTOM_GROUPING_LINE_VALUE);
  rowElement.setAttribute(
    PI_REVIEW_GROUPING_LINE_PAYLOAD_ATTRIBUTE,
    JSON.stringify({
      lineId: groupingLine.lineId,
      label: groupingLine.label,
      color: normalizeHexColor(groupingLine.color),
    }),
  );
  rowElement.setAttribute('class', 'node-toolbox-pi-review-grouping-line');
  rowElement.setAttribute(
    'style',
    `background-color: ${convertHexColorToRgba(groupingLine.color, CUSTOM_GROUPING_LINE_BACKGROUND_ALPHA)}; color: ${normalizeHexColor(groupingLine.color)}; font-weight: 600;`,
  );

  const cellElement = documentNode.createElement('td');
  cellElement.setAttribute('colspan', String(totalColumnCount));
  cellElement.setAttribute(
    'style',
    `border-top: 3px solid ${normalizeHexColor(groupingLine.color)}; border-bottom: 3px solid ${normalizeHexColor(groupingLine.color)}; text-align: center;`,
  );
  cellElement.textContent = groupingLine.label;
  rowElement.appendChild(cellElement);
  return rowElement;
}

function normalizePiReviewCustomGroupingLines(
  customGroupingLines: PiReviewCustomGroupingLine[],
  rowCount: number,
): PiReviewCustomGroupingLine[] {
  return customGroupingLines
    .filter((groupingLine) => groupingLine.afterRowIndex > 0 && groupingLine.afterRowIndex <= rowCount && groupingLine.label.trim() !== '')
    .map((groupingLine, groupingLineIndex) => ({
      lineId: groupingLine.lineId.trim() || `grouping-line-${groupingLineIndex + 1}`,
      afterRowIndex: groupingLine.afterRowIndex,
      label: groupingLine.label.trim(),
      color: normalizeHexColor(groupingLine.color),
    }));
}

function readJiraIssueKeyFromFeatureValue(featureValue: string): string | null {
  return featureValue.trim().match(JIRA_ISSUE_KEY_PATTERN)?.[0] ?? null;
}

function appendPiReviewCellValue(
  documentNode: Document,
  cellElement: HTMLTableCellElement,
  columnKey: string,
  cellValue: string,
): void {
  if (columnKey !== 'feature') {
    cellElement.textContent = cellValue;
    return;
  }

  const featureIssueKey = readJiraIssueKeyFromFeatureValue(cellValue);
  if (!featureIssueKey) {
    cellElement.textContent = cellValue;
    return;
  }

  // Confluence should keep the feature text readable while letting teams jump straight into Jira from the saved page.
  const linkElement = documentNode.createElement('a');
  linkElement.setAttribute('href', `${JIRA_BROWSE_URL_PREFIX}${featureIssueKey}`);
  linkElement.textContent = cellValue;
  cellElement.appendChild(linkElement);
}

/** Parses the first matching PI Review table from a Confluence storage body. */
export function parsePiReviewTable(storageValue: string): PiReviewTableParseResult {
  const documentNode = buildStorageDocument(storageValue);
  const tableBinding = locatePiReviewTableBinding(documentNode);
  if (!tableBinding) {
    throw new Error('No Confluence table was found with the required PI Review headers');
  }

  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The PI Review table could not be reloaded from the Confluence page');
  }

  const rows: PiReviewRow[] = [];
  let commitmentBoundaryIndex: number | null = null;
  const customGroupingLines: PiReviewCustomGroupingLine[] = [];
  for (const rowElement of readBodyRowsAfterHeader(tableElement, tableBinding.headerRowIndex)) {
    if (isPiReviewCommitmentBoundaryRow(rowElement)) {
      if (commitmentBoundaryIndex === null) {
        commitmentBoundaryIndex = rows.length;
      }
      continue;
    }

    const customGroupingLine = parsePiReviewCustomGroupingLineRow(
      rowElement,
      rows.length,
      customGroupingLines.length + 1,
    );
    if (customGroupingLine) {
      customGroupingLines.push(customGroupingLine);
      continue;
    }

    const row = createEmptyPiReviewRow();
    row.rowId = `row-${rows.length + 1}`;
    tableBinding.columnOrder.forEach((columnKey, columnOrderIndex) => {
      row[columnKey] = readRowCellValue(rowElement, tableBinding.columnIndexes[columnOrderIndex] ?? columnOrderIndex);
    });
    if (tableBinding.columnOrder.some((columnKey) => row[columnKey].trim() !== '')) {
      rows.push(row);
    }
  }

  return {
    rows,
    tableBinding,
    commitmentBoundaryIndex: normalizePiReviewCommitmentBoundaryIndex(commitmentBoundaryIndex, rows.length),
    customGroupingLines: normalizePiReviewCustomGroupingLines(customGroupingLines, rows.length),
  };
}

function replaceRowsAfterHeader<RowType extends Record<string, string>>(
  documentNode: Document,
  tableElement: HTMLTableElement,
  headerRowIndex: number,
  columnOrder: string[],
  columnIndexes: number[],
  columnLabels: Record<string, string>,
  rows: RowType[],
  commitmentBoundaryIndex?: number | null,
  customGroupingLines: PiReviewCustomGroupingLine[] = [],
): void {
  const tableRows = readTableRows(tableElement);
  const headerRowElement = tableRows[headerRowIndex];
  if (!headerRowElement) {
    throw new Error('The PI Review table does not contain the matched header row anymore');
  }

  const headerParentElement = headerRowElement.parentElement;
  if (!isElementNode(headerParentElement)) {
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

  const normalizedCommitmentBoundaryIndex = normalizePiReviewCommitmentBoundaryIndex(
    commitmentBoundaryIndex,
    rows.length,
  );
  const normalizedCustomGroupingLines = normalizePiReviewCustomGroupingLines(customGroupingLines, rows.length);

  let insertAfterNode: ChildNode = headerRowElement;
  for (const [rowIndex, row] of rows.entries()) {
    const rowElement = documentNode.createElement('tr');
    for (let cellIndex = 0; cellIndex < totalColumnCount; cellIndex += 1) {
      const cellElement = documentNode.createElement('td');
      const columnOrderIndex = columnIndexes.indexOf(cellIndex);
      if (columnOrderIndex >= 0) {
        const columnKey = columnOrder[columnOrderIndex];
        appendPiReviewCellValue(documentNode, cellElement, columnKey, row[columnKey] ?? '');
      }
      rowElement.appendChild(cellElement);
    }
    headerParentElement.insertBefore(rowElement, insertAfterNode.nextSibling);
    insertAfterNode = rowElement;

    const insertedRowCount = rowIndex + 1;
    const linesAfterCurrentRow = normalizedCustomGroupingLines.filter(
      (groupingLine) => groupingLine.afterRowIndex === insertedRowCount,
    );
    for (const groupingLine of linesAfterCurrentRow) {
      const groupingRowElement = createPiReviewCustomGroupingRow(documentNode, totalColumnCount, groupingLine);
      headerParentElement.insertBefore(groupingRowElement, insertAfterNode.nextSibling);
      insertAfterNode = groupingRowElement;
    }
    if (normalizedCommitmentBoundaryIndex === insertedRowCount) {
      const boundaryRowElement = createPiReviewCommitmentBoundaryRow(documentNode, totalColumnCount);
      headerParentElement.insertBefore(boundaryRowElement, insertAfterNode.nextSibling);
      insertAfterNode = boundaryRowElement;
    }
  }
}

function applyFullWidthTableLayout(tableElement: HTMLTableElement): void {
  tableElement.setAttribute('style', FULL_WIDTH_TABLE_STYLE);
}

/** Writes the current Toolbox PI Review rows back into the matched Confluence table. */
export function writePiReviewTable(
  storageValue: string,
  tableBinding: PiReviewTableBinding,
  rows: PiReviewRow[],
  commitmentBoundaryIndex?: number | null,
  customGroupingLines: PiReviewCustomGroupingLine[] = [],
): string {
  const documentNode = buildStorageDocument(storageValue);
  const tableElement = documentNode.querySelectorAll('table').item(tableBinding.tableIndex) as HTMLTableElement | null;
  if (!tableElement) {
    throw new Error('The PI Review table could not be found while preparing the Confluence update');
  }

  applyFullWidthTableLayout(tableElement);
  replaceRowsAfterHeader(
    documentNode,
    tableElement,
    tableBinding.headerRowIndex,
    tableBinding.columnOrder,
    tableBinding.columnIndexes,
    PI_REVIEW_COLUMN_LABELS,
    rows as unknown as Record<string, string>[],
    commitmentBoundaryIndex,
    customGroupingLines,
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
