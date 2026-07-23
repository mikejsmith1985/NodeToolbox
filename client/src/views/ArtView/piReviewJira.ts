// piReviewJira.ts — Jira-backed PI Review reconciliation helpers for feature summaries, links, and estimates.

import { jiraGet, jiraPost, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraIssueLink, JiraTransition } from '../../types/jira.ts';
import type { PiReviewRow } from './piReviewTable.ts';
import {
  getStoryPointsCandidateFieldIds,
  readIssueStoryPointsDisplayValue,
  saveFeatureReviewStoryPoints,
} from '../SprintDashboard/featureReviewFixes.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_DEPENDENCY_LINK_TYPES = ['blocks', 'is blocked by', 'depends on', 'is depended on by', 'relates to'];
const FEATURE_QUERY_BATCH_SIZE = 50;
const FEATURE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/i;
const BLANKISH_TEXT_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--']);
const BLOCKED_RISK_KEYWORDS = ['block', 'impediment', 'risk'];
const MARKDOWN_SEPARATOR_CELL_PATTERN = /^:?-{2,}:?$/;
const DEFAULT_PI_REVIEW_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_PI_REVIEW_TARGET_END_FIELD_ID = 'customfield_10102';
const DEFAULT_LINK_FIELDS = [
  'summary',
  'priority',
  'updated',
  'status',
  'labels',
  'issuelinks',
  'duedate',
  'fixVersions',
];
const TARGET_START_LABEL = 'Target Start';
const TARGET_END_LABEL = 'Target End';
const DUE_DATE_LABEL = 'Due Date';
const FIX_VERSION_LABEL = 'Fix Version';

interface ArtAdvancedSettings {
  depLinkTypes?: string[];
  piReviewTargetStartFieldId?: string;
  piReviewTargetEndFieldId?: string;
}

export interface PiReviewEstimateUpdate {
  featureKey: string;
  /** The estimate as text — a dropdown story-points field needs the option label ("5"), not a number. */
  estimate: string;
}

export interface PiReviewFeatureDateUpdate {
  featureKey: string;
  targetStart: string | null;
  targetEnd: string | null;
  dueDate: string | null;
}

export interface PiReviewFeatureDatePill {
  label: string;
  value: string;
}

export interface PiReviewTransitionAllowedValue {
  accountId?: string;
  displayName?: string;
  id?: string;
  key?: string;
  name?: string;
  value?: string;
}

export interface PiReviewTransitionField {
  allowedValues?: PiReviewTransitionAllowedValue[];
  name?: string;
  required?: boolean;
  schema?: {
    items?: string;
    type?: string;
  };
}

/** Describes a single field that Jira overwrote during PI Review reconciliation (for the load-delta notification). */
export interface PiReviewJiraFieldChange {
  featureKey: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
}

export interface PiReviewJiraReconciliationResult {
  rows: PiReviewRow[];
  hasChanges: boolean;
  pendingEstimateUpdates: PiReviewEstimateUpdate[];
  /** Per-field change details so the UI can show the user exactly what Jira updated on load. */
  fieldChanges: PiReviewJiraFieldChange[];
}

function normalizeFreeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isMeaningfulFreeText(value: string): boolean {
  return !BLANKISH_TEXT_VALUES.has(normalizeFreeText(value));
}

function buildJiraUserPayload(userIdentifier: string): { accountId: string } | { key: string } | { name: string } {
  const [identifierType, ...identifierValueParts] = userIdentifier.split(':');
  const identifierValue = identifierValueParts.join(':').trim();
  if (identifierType === 'accountId' && identifierValue !== '') {
    return { accountId: identifierValue };
  }

  if (identifierType === 'key' && identifierValue !== '') {
    return { key: identifierValue };
  }

  if (identifierType === 'name' && identifierValue !== '') {
    return { name: identifierValue };
  }

  const trimmedUserIdentifier = userIdentifier.trim();
  if (trimmedUserIdentifier !== '' && !trimmedUserIdentifier.includes(':')) {
    return { accountId: trimmedUserIdentifier };
  }

  throw new Error('Select a Jira user before saving.');
}

function resolveAllowedValuePayload(
  selectedValue: string,
  transitionField: PiReviewTransitionField | undefined,
): PiReviewTransitionAllowedValue | string {
  const matchedAllowedValue = transitionField?.allowedValues?.find((allowedValue) =>
    [
      allowedValue.id,
      allowedValue.value,
      allowedValue.name,
      allowedValue.key,
      allowedValue.accountId,
      allowedValue.displayName,
    ].some((candidateValue) => candidateValue === selectedValue),
  );
  if (!matchedAllowedValue) {
    return selectedValue;
  }

  if (matchedAllowedValue.id) {
    return { id: matchedAllowedValue.id };
  }
  if (matchedAllowedValue.value) {
    return { value: matchedAllowedValue.value };
  }
  if (matchedAllowedValue.name) {
    return { name: matchedAllowedValue.name };
  }
  if (matchedAllowedValue.key) {
    return { key: matchedAllowedValue.key };
  }
  if (matchedAllowedValue.accountId) {
    return { accountId: matchedAllowedValue.accountId };
  }
  return selectedValue;
}

function readArtSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

function readConfiguredFieldId(fieldValue: string | undefined): string | null {
  const trimmedFieldValue = fieldValue?.trim() ?? '';
  return trimmedFieldValue === '' ? null : trimmedFieldValue;
}

function readDefaultedFieldId(fieldValue: string | undefined, defaultFieldId: string): string {
  return readConfiguredFieldId(fieldValue) ?? defaultFieldId;
}

function normalizeTableHeaderText(headerValue: string): string {
  return headerValue.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readPiReviewDateFieldIds(): { targetStartFieldId: string | null; targetEndFieldId: string | null } {
  const artSettings = readArtSettings();
  return {
    targetStartFieldId: readDefaultedFieldId(
      artSettings.piReviewTargetStartFieldId,
      DEFAULT_PI_REVIEW_TARGET_START_FIELD_ID,
    ),
    targetEndFieldId: readDefaultedFieldId(
      artSettings.piReviewTargetEndFieldId,
      DEFAULT_PI_REVIEW_TARGET_END_FIELD_ID,
    ),
  };
}

function createFeatureQueryFields(): string {
  const { targetStartFieldId, targetEndFieldId } = readPiReviewDateFieldIds();
  // The point estimate is the app-wide Story Points (Selection) field, wherever this instance keeps
  // it — requested here so the same field the estimate is written to is the field it is read back from.
  return Array.from(
    new Set([
      ...DEFAULT_LINK_FIELDS,
      ...getStoryPointsCandidateFieldIds(),
      targetStartFieldId,
      targetEndFieldId,
    ].filter((fieldName): fieldName is string => Boolean(fieldName))),
  ).join(',');
}

function createIssueSearchPath(issueKeys: string[]): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(`key in (${issueKeys.join(',')})`)}&fields=${encodeURIComponent(createFeatureQueryFields())}&maxResults=${Math.max(200, issueKeys.length)}`;
}

function normalizeLinkTypeNames(issueLink: JiraIssueLink): string[] {
  return [issueLink.type?.name, issueLink.type?.inward, issueLink.type?.outward]
    .filter((linkTypeName): linkTypeName is string => Boolean(linkTypeName))
    .map((linkTypeName) => normalizeFreeText(linkTypeName));
}

function readLinkedIssue(issueLink: JiraIssueLink): JiraIssueLink['inwardIssue'] | JiraIssueLink['outwardIssue'] | null {
  return issueLink.outwardIssue ?? issueLink.inwardIssue ?? null;
}

function normalizeJiraDateValue(rawDateValue: unknown): string | null {
  if (typeof rawDateValue !== 'string') {
    return null;
  }

  const trimmedDateValue = rawDateValue.trim();
  if (trimmedDateValue === '') {
    return null;
  }

  const matchedIsoDate = trimmedDateValue.match(/^\d{4}-\d{2}-\d{2}/);
  return matchedIsoDate ? matchedIsoDate[0] : trimmedDateValue;
}

function normalizeImportedDateValue(rawDateValue: string, rowNumber: number, columnLabel: string): string | null {
  const normalizedDateValue = normalizeJiraDateValue(rawDateValue);
  if (normalizedDateValue === null) {
    return null;
  }

  const matchedSlashDate = normalizedDateValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (matchedSlashDate) {
    const [, monthValue, dayValue, yearValue] = matchedSlashDate;
    return `${yearValue}-${monthValue.padStart(2, '0')}-${dayValue.padStart(2, '0')}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateValue)) {
    return normalizedDateValue;
  }

  throw new Error(`Row ${rowNumber}: ${columnLabel} must use M/D/YYYY or YYYY-MM-DD.`);
}

function readConfiguredDateFieldValue(jiraIssue: JiraIssue, fieldId: string | null): string | null {
  if (!fieldId) {
    return null;
  }

  return normalizeJiraDateValue((jiraIssue.fields as Record<string, unknown>)[fieldId]);
}

function formatLinkedIssue(issueLink: JiraIssueLink): string | null {
  const linkedIssue = readLinkedIssue(issueLink);
  if (!linkedIssue) {
    return null;
  }

  const linkedIssueSummary = linkedIssue.fields?.summary?.trim();
  const linkedIssueStatus = linkedIssue.fields?.status?.name?.trim();
  const summarySegment = linkedIssueSummary ? ` - ${linkedIssueSummary}` : '';
  const statusSegment = linkedIssueStatus ? ` (${linkedIssueStatus})` : '';
  return `${linkedIssue.key}${summarySegment}${statusSegment}`;
}

/**
 * Appends a labelled note line, unless the value is blank-ish or the line is already present.
 *
 * Exported so the PI Review AI Assist panel writes notes with the SAME convention this file uses when
 * it migrates Dependency/Risks text into the notes cell — a second implementation would drift from
 * this one. Format: `Label: value`, lines joined with 
.
 */
export function appendUniqueNoteLine(existingNotes: string, prefixLabel: string, sourceValue: string): string {
  if (!isMeaningfulFreeText(sourceValue)) {
    return existingNotes;
  }

  const nextLine = `${prefixLabel}: ${sourceValue.trim()}`;
  const normalizedNotes = normalizeFreeText(existingNotes);
  if (normalizedNotes.includes(normalizeFreeText(nextLine))) {
    return existingNotes;
  }

  return existingNotes.trim() === '' ? nextLine : `${existingNotes.trim()}\n${nextLine}`;
}

function parseDateImportLine(rawLine: string): string[] {
  const trimmedLine = rawLine.trim();
  if (trimmedLine === '') {
    return [];
  }

  if (trimmedLine.includes('\t')) {
    return trimmedLine.split('\t').map((cellValue) => cellValue.trim());
  }

  const normalizedPipeLine = trimmedLine.replace(/^\|/, '').replace(/\|$/, '');
  return normalizedPipeLine.split('|').map((cellValue) => cellValue.trim());
}

function isMarkdownSeparatorRow(cellValues: string[]): boolean {
  return cellValues.length > 0
    && cellValues.every((cellValue) => cellValue === '' || MARKDOWN_SEPARATOR_CELL_PATTERN.test(cellValue.replace(/\s+/g, '')));
}

function readMappedDateImportColumns(headerRow: string[]): {
  jiraKeyColumnIndex: number;
  targetStartColumnIndex: number | null;
  targetEndColumnIndex: number | null;
  dueDateColumnIndex: number | null;
} {
  const normalizedHeaderMap = headerRow.reduce<Record<string, number>>((headerMap, headerValue, columnIndex) => {
    const normalizedHeaderValue = normalizeTableHeaderText(headerValue);
    if (normalizedHeaderValue !== '') {
      headerMap[normalizedHeaderValue] = columnIndex;
    }
    return headerMap;
  }, {});

  const jiraKeyColumnIndex = normalizedHeaderMap.jirakey
    ?? normalizedHeaderMap.issuekey
    ?? normalizedHeaderMap.key
    ?? normalizedHeaderMap.featurekey
    ?? -1;
  const targetStartColumnIndex = normalizedHeaderMap.targetstart ?? null;
  const targetEndColumnIndex = normalizedHeaderMap.targetend ?? null;
  const dueDateColumnIndex = normalizedHeaderMap.duedate ?? null;

  if (jiraKeyColumnIndex < 0) {
    throw new Error('Paste a table with a Jira Key column.');
  }

  if (targetStartColumnIndex === null && targetEndColumnIndex === null && dueDateColumnIndex === null) {
    throw new Error('Paste a table with at least one of Target Start, Target End, or Due Date.');
  }

  return {
    jiraKeyColumnIndex,
    targetStartColumnIndex,
    targetEndColumnIndex,
    dueDateColumnIndex,
  };
}

function readImportedCellValue(cellValues: string[], columnIndex: number | null): string {
  return columnIndex === null ? '' : cellValues[columnIndex] ?? '';
}

function readConfiguredDependencyLinkTypes(): Set<string> {
  const configuredDependencyLinkTypes = readArtSettings().depLinkTypes ?? DEFAULT_DEPENDENCY_LINK_TYPES;
  return new Set(configuredDependencyLinkTypes.map((linkTypeName) => normalizeFreeText(linkTypeName)));
}

function isDependencyLink(issueLink: JiraIssueLink, dependencyLinkTypes: Set<string>): boolean {
  return normalizeLinkTypeNames(issueLink).some((linkTypeName) => dependencyLinkTypes.has(linkTypeName));
}

function isRiskLink(issueLink: JiraIssueLink): boolean {
  const linkedIssue = readLinkedIssue(issueLink);
  const linkTypeNames = normalizeLinkTypeNames(issueLink);
  const linkedIssueStatus = normalizeFreeText(linkedIssue?.fields?.status?.name ?? '');
  const linkedIssueLabels = (linkedIssue?.fields?.labels ?? []).map((label) => normalizeFreeText(label));

  return BLOCKED_RISK_KEYWORDS.some((riskKeyword) =>
    linkTypeNames.some((linkTypeName) => linkTypeName.includes(riskKeyword))
    || linkedIssueStatus.includes(riskKeyword)
    || linkedIssueLabels.some((linkedIssueLabel) => linkedIssueLabel.includes(riskKeyword)));
}

function dedupeAndFormatLinkedIssues(issueLinks: JiraIssueLink[], matcher: (issueLink: JiraIssueLink) => boolean): string {
  const formattedLinks = new Set<string>();
  for (const issueLink of issueLinks) {
    if (!matcher(issueLink)) {
      continue;
    }

    const formattedLink = formatLinkedIssue(issueLink);
    if (formattedLink) {
      formattedLinks.add(formattedLink);
    }
  }

  return Array.from(formattedLinks).join('\n');
}

function reconcileSinglePiReviewRow(
  row: PiReviewRow,
  jiraIssue: JiraIssue | undefined,
  dependencyLinkTypes: Set<string>,
  shouldQueueEstimateUpdates: boolean,
): { row: PiReviewRow; changed: boolean; pendingEstimateUpdate: PiReviewEstimateUpdate | null; fieldChanges: PiReviewJiraFieldChange[] } {
  if (!jiraIssue) {
    return { row, changed: false, pendingEstimateUpdate: null, fieldChanges: [] };
  }

  const derivedDependencies = dedupeAndFormatLinkedIssues(
    jiraIssue.fields.issuelinks ?? [],
    (issueLink) => isDependencyLink(issueLink, dependencyLinkTypes),
  );
  const derivedRisks = dedupeAndFormatLinkedIssues(
    jiraIssue.fields.issuelinks ?? [],
    isRiskLink,
  );
  const nextNotesAfterDependencyMigration = normalizeFreeText(derivedDependencies) === normalizeFreeText(row.dependency)
    ? row.notes
    : appendUniqueNoteLine(row.notes, 'Dependency note', row.dependency);
  const nextNotes = normalizeFreeText(derivedRisks) === normalizeFreeText(row.risks)
    ? nextNotesAfterDependencyMigration
    : appendUniqueNoteLine(nextNotesAfterDependencyMigration, 'Risk note', row.risks);

  // Read the point estimate from the app-wide Story Points (Selection) field — the SAME field the
  // whole app reads and writes — not the raw numeric field the PI Review used to target. That
  // mismatch was why an estimate typed in Toolbox left Jira's story-points field blank.
  const jiraStoryPoints = readIssueStoryPointsDisplayValue(jiraIssue);
  const jiraHasStoryPoints = jiraStoryPoints.trim() !== '';
  const nextPointEstimate = jiraHasStoryPoints ? jiraStoryPoints : row.pointEstimate;
  const parsedRowEstimate = Number(row.pointEstimate);
  // Backfill is one-way and only when Jira is blank: correct an empty Jira field from Toolbox, never
  // the reverse. The value must parse to a finite number so it can match a dropdown option like "5".
  const pendingEstimateUpdate = shouldQueueEstimateUpdates
    && !jiraHasStoryPoints
    && row.pointEstimate.trim() !== ''
    && Number.isFinite(parsedRowEstimate)
    ? { featureKey: jiraIssue.key, estimate: row.pointEstimate.trim() }
    : null;

  const nextRow: PiReviewRow = {
    ...row,
    priority: jiraIssue.fields.priority?.name?.trim() ?? '',
    pointEstimate: nextPointEstimate,
    dependency: derivedDependencies,
    risks: derivedRisks,
    notes: nextNotes,
  };

  const changed = Object.keys(nextRow).some((fieldName) =>
    nextRow[fieldName as keyof PiReviewRow] !== row[fieldName as keyof PiReviewRow]);

  // Collect field-level changes so the UI can show users what Jira updated on load.
  const fieldChanges: PiReviewJiraFieldChange[] = [];
  const fieldLabelsByKey: Record<string, string> = {
    priority: 'Priority',
    pointEstimate: 'Points',
    dependency: 'Dependencies',
    risks: 'Risks',
    notes: 'Notes',
  };
  for (const fieldKey of Object.keys(fieldLabelsByKey)) {
    const oldValue = row[fieldKey as keyof PiReviewRow] as string;
    const newValue = nextRow[fieldKey as keyof PiReviewRow] as string;
    if (oldValue !== newValue) {
      fieldChanges.push({ featureKey: jiraIssue.key, fieldLabel: fieldLabelsByKey[fieldKey], oldValue, newValue });
    }
  }

  return { row: nextRow, changed, pendingEstimateUpdate, fieldChanges };
}

/** Extracts the Jira feature key from a PI Review feature cell, even when the cell already contains summary text. */
export function extractPiReviewFeatureKey(featureCellValue: string): string | null {
  const matchedFeatureKey = featureCellValue.trim().match(FEATURE_KEY_PATTERN);
  return matchedFeatureKey ? matchedFeatureKey[0].toUpperCase() : null;
}

/** Formats the read-only PI Review feature cell so users see the Jira key and current summary together. */
export function formatPiReviewFeatureDisplayValue(featureCellValue: string, jiraIssue: JiraIssue | undefined): string {
  const featureKey = extractPiReviewFeatureKey(featureCellValue);
  if (!featureKey) {
    return featureCellValue.trim() === '' ? '—' : featureCellValue;
  }

  const jiraSummary = jiraIssue?.fields.summary?.trim();
  return jiraSummary ? `${featureKey} - ${jiraSummary}` : featureKey;
}

/** Builds the Feature-column date pills from Jira so PI Review can surface planned dates without extra board-hopping. */
export function readPiReviewFeatureDatePills(jiraIssue: JiraIssue | undefined): PiReviewFeatureDatePill[] {
  if (!jiraIssue) {
    return [];
  }

  const { targetStartFieldId, targetEndFieldId } = readPiReviewDateFieldIds();
  const firstFixVersionName = jiraIssue.fields.fixVersions?.find((fixVersion) => fixVersion.name.trim() !== '')?.name ?? null;
  const datePills = [
    { label: TARGET_START_LABEL, value: readConfiguredDateFieldValue(jiraIssue, targetStartFieldId) },
    { label: TARGET_END_LABEL, value: readConfiguredDateFieldValue(jiraIssue, targetEndFieldId) },
    { label: DUE_DATE_LABEL, value: normalizeJiraDateValue(jiraIssue.fields.duedate) },
    { label: FIX_VERSION_LABEL, value: firstFixVersionName },
  ];

  return datePills.filter((datePill): datePill is PiReviewFeatureDatePill => datePill.value !== null);
}

/** Parses pasted markdown or tab-separated Jira date tables into normalized issue updates. */
export function parsePiReviewFeatureDateUpdates(pastedText: string): PiReviewFeatureDateUpdate[] {
  const parsedRows = pastedText
    .split(/\r?\n/)
    .map(parseDateImportLine)
    .filter((cellValues) => cellValues.length > 0);
  if (parsedRows.length === 0) {
    throw new Error('Paste a Jira date table before applying updates.');
  }

  const [headerRow, ...dataRows] = parsedRows;
  const {
    jiraKeyColumnIndex,
    targetStartColumnIndex,
    targetEndColumnIndex,
    dueDateColumnIndex,
  } = readMappedDateImportColumns(headerRow);
  const uniqueDateUpdates = new Map<string, PiReviewFeatureDateUpdate>();
  let parsedRowNumber = 1;

  for (const cellValues of dataRows) {
    if (isMarkdownSeparatorRow(cellValues)) {
      continue;
    }

    parsedRowNumber += 1;
    const rowNumber = parsedRowNumber;
    const featureKey = extractPiReviewFeatureKey(readImportedCellValue(cellValues, jiraKeyColumnIndex));
    if (!featureKey) {
      throw new Error(`Row ${rowNumber}: Jira Key is required.`);
    }

    const nextDateUpdate: PiReviewFeatureDateUpdate = {
      featureKey,
      targetStart: normalizeImportedDateValue(readImportedCellValue(cellValues, targetStartColumnIndex), rowNumber, TARGET_START_LABEL),
      targetEnd: normalizeImportedDateValue(readImportedCellValue(cellValues, targetEndColumnIndex), rowNumber, TARGET_END_LABEL),
      dueDate: normalizeImportedDateValue(readImportedCellValue(cellValues, dueDateColumnIndex), rowNumber, DUE_DATE_LABEL),
    };

    if (nextDateUpdate.targetStart === null && nextDateUpdate.targetEnd === null && nextDateUpdate.dueDate === null) {
      continue;
    }

    uniqueDateUpdates.set(featureKey, nextDateUpdate);
  }

  if (uniqueDateUpdates.size === 0) {
    throw new Error('Paste at least one Jira row with a Target Start, Target End, or Due Date value.');
  }

  return Array.from(uniqueDateUpdates.values());
}

/** Fetches the Jira feature issues referenced by the current PI Review rows in small search batches. */
export async function fetchPiReviewFeatureIssues(rows: PiReviewRow[]): Promise<Record<string, JiraIssue>> {
  const featureKeys = Array.from(new Set(
    rows
      .map((row) => extractPiReviewFeatureKey(row.feature))
      .filter((featureKey): featureKey is string => featureKey !== null),
  ));
  if (featureKeys.length === 0) {
    return {};
  }

  const featureIssueMap: Record<string, JiraIssue> = {};
  for (let currentIndex = 0; currentIndex < featureKeys.length; currentIndex += FEATURE_QUERY_BATCH_SIZE) {
    const currentBatch = featureKeys.slice(currentIndex, currentIndex + FEATURE_QUERY_BATCH_SIZE);
    const jiraResponse = await jiraGet<{ issues?: JiraIssue[] }>(createIssueSearchPath(currentBatch));
    for (const jiraIssue of jiraResponse.issues ?? []) {
      featureIssueMap[jiraIssue.key.toUpperCase()] = jiraIssue;
    }
  }

  return featureIssueMap;
}

/** Reconciles PI Review rows with Jira-backed feature metadata without mutating the original row objects. */
export function reconcilePiReviewRowsWithJira(
  rows: PiReviewRow[],
  jiraIssueMap: Record<string, JiraIssue>,
  options?: { shouldQueueEstimateUpdates?: boolean },
): PiReviewJiraReconciliationResult {
  const dependencyLinkTypes = readConfiguredDependencyLinkTypes();
  const shouldQueueEstimateUpdates = options?.shouldQueueEstimateUpdates ?? false;
  const pendingEstimateUpdates: PiReviewEstimateUpdate[] = [];
  const fieldChanges: PiReviewJiraFieldChange[] = [];
  let hasChanges = false;

  const reconciledRows = rows.map((row) => {
    const featureKey = extractPiReviewFeatureKey(row.feature);
    const jiraIssue = featureKey ? jiraIssueMap[featureKey] : undefined;
    const reconciliationResult = reconcileSinglePiReviewRow(
      row,
      jiraIssue,
      dependencyLinkTypes,
      shouldQueueEstimateUpdates,
    );
    if (reconciliationResult.changed) {
      hasChanges = true;
    }
    if (reconciliationResult.pendingEstimateUpdate) {
      pendingEstimateUpdates.push(reconciliationResult.pendingEstimateUpdate);
    }
    for (const fieldChange of reconciliationResult.fieldChanges) {
      fieldChanges.push(fieldChange);
    }
    return reconciliationResult.row;
  });

  return {
    rows: reconciledRows,
    hasChanges,
    pendingEstimateUpdates,
    fieldChanges,
  };
}

/**
 * Saves any backfilled PI Review estimates into Jira so future PI Review loads can trust Jira as the
 * source of truth.
 *
 * Delegates to `saveFeatureReviewStoryPoints` — the one app-wide helper that discovers the right
 * story-points field for this instance AND writes the correct shape (a dropdown option object where
 * the field is a Select, a raw number where it is numeric). Writing a bare number to the wrong field,
 * as this used to, left Jira's story-points field untouched.
 */
export async function savePiReviewFeatureEstimates(estimateUpdates: PiReviewEstimateUpdate[]): Promise<void> {
  const uniqueEstimateUpdates = new Map<string, PiReviewEstimateUpdate>();
  for (const estimateUpdate of estimateUpdates) {
    uniqueEstimateUpdates.set(estimateUpdate.featureKey, estimateUpdate);
  }

  for (const estimateUpdate of uniqueEstimateUpdates.values()) {
    await saveFeatureReviewStoryPoints(estimateUpdate.featureKey, estimateUpdate.estimate);
  }
}

/** Loads the workflow transitions PI Review can offer for a Jira feature status update. */
export async function fetchPiReviewFeatureTransitions(issueKey: string): Promise<JiraTransition[]> {
  const transitionResponse = await jiraGet<{ transitions?: JiraTransition[] }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  return transitionResponse.transitions ?? [];
}

/** Saves a Jira workflow transition from PI Review so ART teams can update feature status inline. */
export async function savePiReviewFeatureTransition(issueKey: string, transitionId: string): Promise<void> {
  if (transitionId.trim() === '') {
    throw new Error('Select a Jira transition before saving.');
  }

  await jiraPost<void>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: transitionId.trim() },
  });
}

/**
 * Loads the Jira transition metadata (including required fields) for a specific workflow transition.
 * PI Review uses this to render only the fields Jira requires when a transition fails with missing-field errors.
 */
export async function fetchPiReviewTransitionFields(
  issueKey: string,
  transitionId: string,
): Promise<Record<string, PiReviewTransitionField>> {
  const transitionResponse = await jiraGet<{
    transitions?: Array<{ id?: string; fields?: Record<string, PiReviewTransitionField> }>;
  }>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`);
  const transitionDetails = (transitionResponse.transitions ?? [])
    .find((candidateTransition) => candidateTransition.id === transitionId.trim());
  return transitionDetails?.fields ?? {};
}

/**
 * Saves required Jira fields before retrying a blocked PI Review transition.
 * Supports parent-link issue keys, Jira user fields, option fields, and plain text values.
 */
export async function savePiReviewTransitionRequiredFields(
  issueKey: string,
  fieldValuesByFieldId: Record<string, string>,
  transitionFields: Record<string, PiReviewTransitionField>,
): Promise<void> {
  const fields: Record<string, unknown> = {};
  for (const [fieldId, fieldValue] of Object.entries(fieldValuesByFieldId)) {
    const trimmedFieldValue = fieldValue.trim();
    if (trimmedFieldValue === '') {
      continue;
    }

    const transitionField = transitionFields[fieldId];
    if (fieldId === 'parent') {
      fields.parent = { key: trimmedFieldValue.toUpperCase() };
      continue;
    }

    if (transitionField?.schema?.type === 'user') {
      fields[fieldId] = buildJiraUserPayload(trimmedFieldValue);
      continue;
    }

    const optionPayload = resolveAllowedValuePayload(trimmedFieldValue, transitionField);
    if (transitionField?.schema?.type === 'array') {
      fields[fieldId] = [optionPayload];
    } else {
      fields[fieldId] = optionPayload;
    }
  }

  if (Object.keys(fields).length === 0) {
    throw new Error('Fill the required Jira fields before retrying the status move.');
  }
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields });
}

/** Saves pasted PI Review target dates back into Jira using the configured PI Review date fields. */
export async function savePiReviewFeatureDates(dateUpdates: PiReviewFeatureDateUpdate[]): Promise<void> {
  const { targetStartFieldId, targetEndFieldId } = readPiReviewDateFieldIds();
  const uniqueDateUpdates = new Map<string, PiReviewFeatureDateUpdate>();
  for (const dateUpdate of dateUpdates) {
    uniqueDateUpdates.set(dateUpdate.featureKey, dateUpdate);
  }

  for (const dateUpdate of uniqueDateUpdates.values()) {
    const fields: Record<string, string> = {};
    if (dateUpdate.targetStart !== null) {
      if (!targetStartFieldId) {
        throw new Error('Set the PI Review Target Start field ID before saving Target Start updates.');
      }
      fields[targetStartFieldId] = dateUpdate.targetStart;
    }
    if (dateUpdate.targetEnd !== null) {
      if (!targetEndFieldId) {
        throw new Error('Set the PI Review Target End field ID before saving Target End updates.');
      }
      fields[targetEndFieldId] = dateUpdate.targetEnd;
    }
    if (dateUpdate.dueDate !== null) {
      fields.duedate = dateUpdate.dueDate;
    }
    if (Object.keys(fields).length === 0) {
      continue;
    }

    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(dateUpdate.featureKey)}`, { fields });
  }
}
