// releasePageStorage.ts — The release document as a Confluence page: written from the document, read back (GH #395).
//
// The page is the system of record for what people type — deployment steps and item notes — so every save reads
// the page back first. Tables are found by their header labels: Confluence strips `data-` attributes, so a marker
// would vanish, while a header row is what the reader sees and stays put (the PI Review precedent).

import type { EpicGroup, ReleaseItem } from './releaseGather.ts';

/** One hand-entered deploy step for the release, in the user's order. */
export interface DeploymentStep {
  id: string;
  pr: string;
  repo: string;
  workflowRun: string;
  branch: string;
  jobType: string;
  application: string;
  environment: string;
  repository: string;
  tag: string;
  task: string;
  module: string;
  logLevel: string;
}

/** Everything one release page shows. */
export interface ReleaseDocument {
  groups: EpicGroup[];
  deploymentSteps: DeploymentStep[];
  /** When the Jira half was last refreshed, already formatted for people. */
  lastSyncedLabel: string;
}

/** What the page holds that only people supply. */
export interface ParsedReleasePage {
  deploymentSteps: DeploymentStep[];
  notesByKey: Map<string, string>;
}

type DeploymentStepField = Exclude<keyof DeploymentStep, 'id'>;

/** The deployment steps columns, in page order, with their headers. */
export const DEPLOYMENT_STEP_COLUMNS: ReadonlyArray<{ field: DeploymentStepField; header: string }> = [
  { field: 'pr', header: 'PR' },
  { field: 'repo', header: 'Repo' },
  { field: 'workflowRun', header: 'Workflow run' },
  { field: 'branch', header: 'Branch' },
  { field: 'jobType', header: 'Job type' },
  { field: 'application', header: 'Application' },
  { field: 'environment', header: 'Environment' },
  { field: 'repository', header: 'Repository' },
  { field: 'tag', header: 'Tag' },
  { field: 'task', header: 'Task' },
  { field: 'module', header: 'Module' },
  { field: 'logLevel', header: 'Log level' },
];

const RELEASE_ITEM_HEADERS = ['Key', 'Summary', 'Type', 'Status', 'Assignee', 'Release check', 'Notes'];
const RELEASE_ITEMS_HEADING = 'Release items';
const DEPLOYMENT_STEPS_HEADING = 'Deployment Steps';
const NO_EPIC_LABEL = 'No Epic';
const UNREADABLE_EPIC_LABEL = 'Epic not readable';
const CHILD_ROW_PREFIX = '↳ ';
// The two cells a deployment step may link from, when their value is a web address.
const LINKABLE_STEP_FIELDS: ReadonlySet<DeploymentStepField> = new Set(['pr', 'workflowRun']);
const ISSUE_KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/;

let deploymentStepSequence = 0;

/** A blank deployment step with a fresh id, ready to fill in. */
export function createEmptyDeploymentStep(): DeploymentStep {
  deploymentStepSequence += 1;
  return {
    id: `deployment-step-${Date.now()}-${deploymentStepSequence}`,
    pr: '', repo: '', workflowRun: '', branch: '', jobType: '', application: '',
    environment: '', repository: '', tag: '', task: '', module: '', logLevel: '',
  };
}

// ── Writing ──

/** Escapes text for Confluence storage (XHTML), so a value can never break the page markup. */
function escapeStorageText(rawText: string): string {
  return rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** True for a value that is a web address, which the page shows as a link. */
function isWebAddress(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** A table header row. */
function renderHeaderRow(headers: readonly string[]): string {
  return `<tr>${headers.map((header) => `<th>${escapeStorageText(header)}</th>`).join('')}</tr>`;
}

/** A row of already-escaped cells. */
function renderRow(cellsHtml: readonly string[]): string {
  return `<tr>${cellsHtml.map((cellHtml) => `<td>${cellHtml}</td>`).join('')}</tr>`;
}

/** An issue key linked to Jira. */
function renderIssueLink(issueKey: string, buildIssueUrl: (issueKey: string) => string): string {
  return `<a href="${escapeStorageText(buildIssueUrl(issueKey))}">${escapeStorageText(issueKey)}</a>`;
}

/** The Epic's own row: bold, carrying the group's release-check flags. */
function renderEpicRow(group: EpicGroup, buildIssueUrl: (issueKey: string) => string): string {
  const releaseCheck = escapeStorageText(group.misalignments.map((misalignment) => misalignment.message).join(' '));
  if (group.epicKey === null) {
    return renderRow([`<strong>${NO_EPIC_LABEL}</strong>`, '', '', '', '', releaseCheck, '']);
  }
  const epic = group.epic;
  return renderRow([
    `<strong>${renderIssueLink(group.epicKey, buildIssueUrl)}</strong>`,
    `<strong>${escapeStorageText(epic ? epic.summary : UNREADABLE_EPIC_LABEL)}</strong>`,
    escapeStorageText(epic?.issueTypeName ?? ''),
    escapeStorageText(epic?.statusName ?? ''),
    escapeStorageText(epic?.assigneeName ?? ''),
    releaseCheck,
    escapeStorageText(epic?.notes ?? ''),
  ]);
}

/** A child's row, indented under its Epic. */
function renderChildRow(item: ReleaseItem, buildIssueUrl: (issueKey: string) => string): string {
  return renderRow([
    `${CHILD_ROW_PREFIX}${renderIssueLink(item.key, buildIssueUrl)}`,
    escapeStorageText(item.summary),
    escapeStorageText(item.issueTypeName),
    escapeStorageText(item.statusName),
    escapeStorageText(item.assigneeName),
    '',
    escapeStorageText(item.notes),
  ]);
}

/** One deployment step row; PR and workflow run become links when they are web addresses. */
function renderDeploymentStepRow(step: DeploymentStep): string {
  return renderRow(DEPLOYMENT_STEP_COLUMNS.map(({ field }) => {
    const value = step[field];
    return LINKABLE_STEP_FIELDS.has(field) && isWebAddress(value)
      ? `<a href="${escapeStorageText(value.trim())}">${escapeStorageText(value.trim())}</a>`
      : escapeStorageText(value);
  }));
}

/**
 * The whole page: when it was last synced, the release items (each Epic then its children, "No Epic" last),
 * and the deployment steps.
 */
export function buildReleasePageStorage(
  document: ReleaseDocument,
  buildIssueUrl: (issueKey: string) => string,
): string {
  const itemRows = document.groups.flatMap((group) => [
    renderEpicRow(group, buildIssueUrl),
    ...group.items.map((item) => renderChildRow(item, buildIssueUrl)),
  ]);
  const stepRows = document.deploymentSteps.map((step) => renderDeploymentStepRow(step));
  return [
    `<p><em>Last synced from Jira: ${escapeStorageText(document.lastSyncedLabel)}</em></p>`,
    `<h2>${RELEASE_ITEMS_HEADING}</h2>`,
    `<table><tbody>${renderHeaderRow(RELEASE_ITEM_HEADERS)}${itemRows.join('')}</tbody></table>`,
    `<h2>${DEPLOYMENT_STEPS_HEADING}</h2>`,
    `<table><tbody>${renderHeaderRow(DEPLOYMENT_STEP_COLUMNS.map((column) => column.header))}${stepRows.join('')}</tbody></table>`,
  ].join('');
}

// ── Reading ──

/** Parses storage into a document; injectable so it can run without a browser. */
export type StorageDocumentParser = (storageValue: string) => Document;

const parseWithBrowser: StorageDocumentParser = (storageValue) =>
  new DOMParser().parseFromString(`<div>${storageValue}</div>`, 'text/html');

/** The text of a cell, paragraphs joined by line breaks. */
function readCellText(cell: Element): string {
  const paragraphs = [...cell.querySelectorAll('p')];
  const text = paragraphs.length > 0 ? paragraphs.map((paragraph) => paragraph.textContent ?? '').join('\n') : cell.textContent ?? '';
  return text.trim();
}

/** A deployment-step cell's value: a link's address when the cell is a link, otherwise its text. */
function readStepCellValue(cell: Element): string {
  const link = cell.querySelector('a');
  return link?.getAttribute('href')?.trim() || readCellText(cell);
}

/** The header labels of a table's first row, lower-cased for matching. */
function readHeaderLabels(table: Element): string[] {
  const firstRow = table.querySelector('tr');
  return firstRow ? [...firstRow.children].map((cell) => (cell.textContent ?? '').trim().toLowerCase()) : [];
}

/** Every row after a table's header row. */
function readBodyRows(table: Element): Element[] {
  return [...table.querySelectorAll('tr')].slice(1);
}

/** Notes by issue key, from the release items table. */
function readNotesByKey(table: Element, headerLabels: readonly string[]): Map<string, string> {
  const keyIndex = headerLabels.indexOf('key');
  const notesIndex = headerLabels.indexOf('notes');
  const notesByKey = new Map<string, string>();
  readBodyRows(table).forEach((row) => {
    const cells = [...row.children];
    const issueKey = ISSUE_KEY_PATTERN.exec(cells[keyIndex]?.textContent ?? '')?.[0];
    const notes = cells[notesIndex] ? readCellText(cells[notesIndex]) : '';
    if (issueKey && notes) notesByKey.set(issueKey, notes);
  });
  return notesByKey;
}

/** Deployment steps, from the deployment steps table, matched to columns by header. */
function readDeploymentSteps(table: Element, headerLabels: readonly string[]): DeploymentStep[] {
  return readBodyRows(table).map((row) => {
    const cells = [...row.children];
    const step = createEmptyDeploymentStep();
    DEPLOYMENT_STEP_COLUMNS.forEach(({ field, header }) => {
      const cell = cells[headerLabels.indexOf(header.toLowerCase())];
      if (cell) step[field] = readStepCellValue(cell);
    });
    return step;
  });
}

/**
 * What people typed on a release page: its deployment steps and each item's notes. A page without those
 * tables yields nothing rather than an error — it may be brand new, or edited by hand.
 */
export function parseReleasePageStorage(
  storageValue: string,
  parseStorage: StorageDocumentParser = parseWithBrowser,
): ParsedReleasePage {
  const parsed: ParsedReleasePage = { deploymentSteps: [], notesByKey: new Map() };
  for (const table of parseStorage(storageValue).querySelectorAll('table')) {
    const headerLabels = readHeaderLabels(table);
    if (headerLabels.includes('key') && headerLabels.includes('notes')) {
      parsed.notesByKey = readNotesByKey(table, headerLabels);
    } else if (headerLabels.includes('pr') && headerLabels.includes('log level')) {
      parsed.deploymentSteps = readDeploymentSteps(table, headerLabels);
    }
  }
  return parsed;
}
