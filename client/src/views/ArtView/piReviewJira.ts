// piReviewJira.ts — Jira-backed PI Review reconciliation helpers for feature summaries, links, and estimates.

import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraIssueLink } from '../../types/jira.ts';
import type { PiReviewRow } from './piReviewTable.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_DEPENDENCY_LINK_TYPES = ['blocks', 'is blocked by', 'depends on', 'is depended on by', 'relates to'];
const FEATURE_QUERY_BATCH_SIZE = 50;
const FEATURE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/i;
const BLANKISH_TEXT_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--']);
const BLOCKED_RISK_KEYWORDS = ['block', 'impediment', 'risk'];
const DEFAULT_PI_REVIEW_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_PI_REVIEW_TARGET_END_FIELD_ID = 'customfield_10102';
const DEFAULT_LINK_FIELDS = [
  'summary',
  'priority',
  'updated',
  'status',
  'labels',
  'issuelinks',
  'customfield_10111',
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
  estimate: number;
}

export interface PiReviewFeatureDatePill {
  label: string;
  value: string;
}

export interface PiReviewJiraReconciliationResult {
  rows: PiReviewRow[];
  hasChanges: boolean;
  pendingEstimateUpdates: PiReviewEstimateUpdate[];
}

function normalizeFreeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isMeaningfulFreeText(value: string): boolean {
  return !BLANKISH_TEXT_VALUES.has(normalizeFreeText(value));
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
  return Array.from(
    new Set([...DEFAULT_LINK_FIELDS, targetStartFieldId, targetEndFieldId].filter((fieldName): fieldName is string => Boolean(fieldName))),
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

function formatEstimateValue(estimateValue: number): string {
  return Number.isInteger(estimateValue) ? String(estimateValue) : String(Number(estimateValue.toFixed(2)));
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

function appendUniqueNoteLine(existingNotes: string, prefixLabel: string, sourceValue: string): string {
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
): { row: PiReviewRow; changed: boolean; pendingEstimateUpdate: PiReviewEstimateUpdate | null } {
  if (!jiraIssue) {
    return { row, changed: false, pendingEstimateUpdate: null };
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

  const jiraEstimate = jiraIssue.fields.customfield_10111;
  const nextPointEstimate = jiraEstimate === null || jiraEstimate === undefined
    ? row.pointEstimate
    : formatEstimateValue(jiraEstimate);
  const parsedRowEstimate = Number(row.pointEstimate);
  const pendingEstimateUpdate = shouldQueueEstimateUpdates
    && (jiraEstimate === null || jiraEstimate === undefined)
    && row.pointEstimate.trim() !== ''
    && Number.isFinite(parsedRowEstimate)
    ? { featureKey: jiraIssue.key, estimate: parsedRowEstimate }
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

  return { row: nextRow, changed, pendingEstimateUpdate };
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
    return reconciliationResult.row;
  });

  return {
    rows: reconciledRows,
    hasChanges,
    pendingEstimateUpdates,
  };
}

/** Saves any backfilled PI Review estimates into Jira so future PI Review loads can trust Jira as the source of truth. */
export async function savePiReviewFeatureEstimates(estimateUpdates: PiReviewEstimateUpdate[]): Promise<void> {
  const uniqueEstimateUpdates = new Map<string, PiReviewEstimateUpdate>();
  for (const estimateUpdate of estimateUpdates) {
    uniqueEstimateUpdates.set(estimateUpdate.featureKey, estimateUpdate);
  }

  for (const estimateUpdate of uniqueEstimateUpdates.values()) {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(estimateUpdate.featureKey)}`, {
      fields: {
        customfield_10111: estimateUpdate.estimate,
      },
    });
  }
}
