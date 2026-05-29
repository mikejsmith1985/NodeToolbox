// useHygieneState.ts — State, persistence, and Jira loading for the Hygiene view.
//
// The hook owns the standalone Hygiene workflow: keep the user's project/filter
// choices across refreshes, run one Jira search through the existing proxy helper,
// and compose the pure health checks into summary and drill-down state for the view.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraField } from '../../../types/jira.ts';
import {
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
  readEnabledEnterpriseCheckDefinitions,
  readEnabledRequiredFieldRules,
} from '../../AdminHub/enterpriseRules.ts';
import {
  evaluateHygieneIssue,
  isFeatureLikeIssue,
  resolveHygieneFieldConfig,
  summarizeHygieneFindings,
  type HygieneEvaluationContext,
  type HygieneFieldConfig,
  type HygieneFinding,
  type HygieneSummary,
  type JiraIssue,
} from '../checks/hygieneChecks.ts';

const BASE_HYGIENE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'issuetype',
  'priority',
  'created',
  'updated',
  'description',
  'customfield_10028',
  'customfield_10016',
  'customfield_10020',
  'duedate',
  'fixVersions',
  'parent',
];
const HYGIENE_MAX_RESULTS = 200;
const DEFAULT_ASSIGNEE_CLAUSE = 'assignee = currentUser()';
const EMPTY_FILTER = null;
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const DEFAULT_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_TARGET_END_FIELD_ID = 'customfield_10102';
const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';

export const HYGIENE_PROJECT_KEY_STORAGE_KEY = 'tbxHygieneProjectKey';
export const HYGIENE_FILTER_STORAGE_KEY = 'tbxHygieneFilter';

export interface JiraSearchResponse {
  issues?: JiraIssue[];
}

interface ArtSettings {
  featureLinkField?: string;
  piFieldId?: string;
  piReviewTargetStartFieldId?: string;
  piReviewTargetEndFieldId?: string;
}

export interface HygieneState {
  projectKey: string;
  extraJql: string;
  findings: HygieneFinding[];
  filteredFindings: HygieneFinding[];
  summary: HygieneSummary;
  selectedFilter: string | null;
  availableCheckIds: string[];
  checkLabelsById: Record<string, string>;
  isLoading: boolean;
  loadError: string | null;
}

export interface HygieneActions {
  setProjectKey: (projectKey: string) => void;
  setExtraJql: (extraJql: string) => void;
  selectFilter: (checkId: string | null) => void;
  loadHygiene: () => Promise<void>;
}

/** Builds the single Jira search URL required by the standalone Hygiene view. */
export function buildHygieneSearchPath(projectKey: string, extraJql: string, requestedFields: string[] = BASE_HYGIENE_FIELDS): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const extraJqlClause = extraJql.trim();
  const jqlText = `project=${normalizedProjectKey} AND statusCategory != Done AND ${DEFAULT_ASSIGNEE_CLAUSE}${extraJqlClause ? ` ${extraJqlClause}` : ''}`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${encodeURIComponent(buildUniqueFieldIds(requestedFields).join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
}

/** Converts a Jira issue into a finding, returning only issues that violate at least one Hygiene check. */
export function mapJiraIssueToHygieneFinding(
  issue: JiraIssue,
  evaluationContext: HygieneEvaluationContext = {},
): HygieneFinding | null {
  const flags = evaluateHygieneIssue(issue, evaluationContext);
  if (flags.length === 0) {
    return null;
  }
  const programIncrement = readProgramIncrementValue(issue, evaluationContext.fieldConfig);
  return { issue, flags, programIncrement };
}

export function readProgramIncrementValue(issue: JiraIssue, fieldConfig?: Partial<HygieneFieldConfig>): string | null {
  if (!fieldConfig?.programIncrementFieldIds) {
    return null;
  }
  for (const fieldId of fieldConfig.programIncrementFieldIds) {
    const value = issue.fields[fieldId];
    if (value !== null && value !== undefined) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            const trimmed = item.trim();
            if (trimmed) return trimmed;
          }
          if (item && typeof item === 'object') {
            const piObj = item as { value?: string; name?: string };
            const name = piObj.name?.trim() || piObj.value?.trim();
            if (name) return name;
          }
        }
      }
      if (value && typeof value === 'object') {
        const piObj = value as { value?: string; name?: string };
        const name = piObj.name?.trim() || piObj.value?.trim();
        if (name) return name;
      }
    }
  }
  return null;
}

/** Owns Hygiene view state and actions so the render layer can stay declarative. */
export function useHygieneState(): HygieneState & HygieneActions {
  const [projectKey, setProjectKey] = useState<string>(() => readStoredProjectKey());
  const [extraJql, setExtraJql] = useState<string>('');
  const [findings, setFindings] = useState<HygieneFinding[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string | null>(() => readStoredFilter());
  const [availableCheckIds, setAvailableCheckIds] = useState<string[]>(() => readEnabledEnterpriseCheckDefinitions().map((checkDefinition) => checkDefinition.checkId));
  const [checkLabelsById, setCheckLabelsById] = useState<Record<string, string>>(() => buildCheckLabelsById(readEnabledEnterpriseCheckDefinitions()));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, projectKey);
  }, [projectKey]);

  useEffect(() => {
    if (selectedFilter === null) {
      window.localStorage.removeItem(HYGIENE_FILTER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(HYGIENE_FILTER_STORAGE_KEY, selectedFilter);
  }, [selectedFilter]);

  const summary = useMemo(() => summarizeHygieneFindings(findings, availableCheckIds), [availableCheckIds, findings]);
  const filteredFindings = useMemo(
    () => filterFindingsByCheck(findings, selectedFilter),
    [findings, selectedFilter],
  );

  const selectFilter = useCallback((checkId: string | null) => {
    setSelectedFilter((currentFilter) => (currentFilter === checkId ? EMPTY_FILTER : checkId));
  }, []);

  const loadHygiene = useCallback(async () => {
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      setFindings([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const enterpriseRules = loadEnterpriseRulesFromStorage();
      const enabledCheckDefinitions = readEnabledEnterpriseCheckDefinitions(enterpriseRules);
      const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);
      const enabledBuiltInCheckIds = readEnabledBuiltInCheckIds(enterpriseRules);
      const hygieneFieldConfig = await loadHygieneFieldConfig();
      setAvailableCheckIds(enabledCheckDefinitions.map((checkDefinition) => checkDefinition.checkId));
      setCheckLabelsById(buildCheckLabelsById(enabledCheckDefinitions));
      const jiraSearchResponse = await jiraGet<JiraSearchResponse>(
        buildHygieneSearchPath(normalizedProjectKey, extraJql, buildRequestedHygieneFields(hygieneFieldConfig, enabledCustomRules)),
      );
      const loadedIssues = jiraSearchResponse.issues ?? [];
      const featureKeysWithPointedStories = await loadFeatureKeysWithPointedStories(loadedIssues, hygieneFieldConfig);
      setFindings(mapIssuesToFindings(loadedIssues, {
        customRules: enabledCustomRules,
        enabledBuiltInCheckIds,
        fieldConfig: hygieneFieldConfig,
        featureKeysWithPointedStories,
      }));
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load Hygiene results';
      setLoadError(errorMessage);
      setFindings([]);
    } finally {
      setIsLoading(false);
    }
  }, [extraJql, projectKey]);

  return {
    projectKey,
    extraJql,
    findings,
    filteredFindings,
    summary,
    selectedFilter,
    availableCheckIds,
    checkLabelsById,
    isLoading,
    loadError,
    setProjectKey,
    setExtraJql,
    selectFilter,
    loadHygiene,
  };
}

function mapIssuesToFindings(issues: JiraIssue[], evaluationContext: HygieneEvaluationContext): HygieneFinding[] {
  return issues
    .map((issue) => mapJiraIssueToHygieneFinding(issue, evaluationContext))
    .filter((finding): finding is HygieneFinding => finding !== null);
}

function filterFindingsByCheck(findings: HygieneFinding[], selectedFilter: string | null): HygieneFinding[] {
  if (selectedFilter === null) return findings;
  return findings.filter((finding) => finding.flags.some((flag) => flag.checkId === selectedFilter));
}

function readStoredProjectKey(): string {
  return window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY) ?? '';
}

function readStoredFilter(): string | null {
  const storedFilter = window.localStorage.getItem(HYGIENE_FILTER_STORAGE_KEY);
  return storedFilter && storedFilter.trim() !== '' ? storedFilter : null;
}

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function buildRequestedHygieneFields(fieldConfig: HygieneFieldConfig, customRules = readEnabledRequiredFieldRules()): string[] {
  return buildUniqueFieldIds([
    ...BASE_HYGIENE_FIELDS,
    ...customRules.map((customRule) => customRule.fieldId),
    ...fieldConfig.acceptanceCriteriaFieldIds,
    ...fieldConfig.applicationFieldIds,
    ...fieldConfig.featureLinkFieldIds,
    ...fieldConfig.initiativeTypeFieldIds,
    ...fieldConfig.parentLinkFieldIds.filter((fieldId) => fieldId !== 'parent'),
    ...fieldConfig.productOwnerFieldIds,
    ...fieldConfig.programIncrementFieldIds,
    ...fieldConfig.targetStartFieldIds,
    ...fieldConfig.targetEndFieldIds,
  ]);
}

function buildCheckLabelsById(checkDefinitions: Array<{ checkId: string; label: string }>): Record<string, string> {
  return checkDefinitions.reduce<Record<string, string>>(
    (labelLookup, checkDefinition) => ({ ...labelLookup, [checkDefinition.checkId]: checkDefinition.label }),
    {},
  );
}

async function loadHygieneFieldConfig(): Promise<HygieneFieldConfig> {
  const availableFields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const artSettings = readArtSettings();

  return resolveHygieneFieldConfig({
    acceptanceCriteriaFieldIds: matchFieldIdsByName(availableFields, ['Acceptance Criteria']),
    applicationFieldIds: matchFieldIdsByName(availableFields, ['Application']),
    featureLinkFieldIds: [
      artSettings.featureLinkField || DEFAULT_FEATURE_LINK_FIELD,
      ...matchFieldIdsByName(availableFields, ['Feature Link', 'Epic Link']),
    ],
    initiativeTypeFieldIds: matchFieldIdsByName(availableFields, ['Initiative Type']),
    parentLinkFieldIds: ['parent', ...matchFieldIdsByName(availableFields, ['Parent Link'])],
    productOwnerFieldIds: matchFieldIdsByName(availableFields, ['Product Owner']),
    programIncrementFieldIds: [
      artSettings.piFieldId || DEFAULT_PI_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['PI', 'Program Increment']),
    ],
    targetStartFieldIds: [
      artSettings.piReviewTargetStartFieldId || DEFAULT_TARGET_START_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['Target Start']),
    ],
    targetEndFieldIds: [
      artSettings.piReviewTargetEndFieldId || DEFAULT_TARGET_END_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['Target End']),
    ],
  });
}

function readArtSettings(): ArtSettings {
  try {
    return JSON.parse(window.localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as ArtSettings;
  } catch {
    return {};
  }
}

function matchFieldIdsByName(availableFields: JiraField[], fieldNames: string[]): string[] {
  const normalizedFieldNames = fieldNames.map((fieldName) => normalizeFieldName(fieldName));
  return availableFields
    .filter((availableField) => {
      const normalizedAvailableFieldName = normalizeFieldName(availableField.name);
      return normalizedFieldNames.some((normalizedFieldName) => normalizedAvailableFieldName === normalizedFieldName || normalizedAvailableFieldName.includes(normalizedFieldName));
    })
    .map((availableField) => availableField.id);
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function loadFeatureKeysWithPointedStories(
  issues: JiraIssue[],
  fieldConfig: HygieneFieldConfig,
): Promise<Set<string>> {
  const featureKeys = issues.filter(isFeatureLikeIssue).map((issue) => issue.key);
  if (featureKeys.length === 0) {
    return new Set<string>();
  }

  const childFeatureLinkFieldId = fieldConfig.featureLinkFieldIds.find((fieldId) => fieldId !== 'parent') ?? DEFAULT_FEATURE_LINK_FIELD;
  const childIssueJqlField = buildJqlFieldReference(childFeatureLinkFieldId);
  const encodedFeatureKeys = featureKeys.map((featureKey) => `"${featureKey}"`).join(',');
  const childIssueJql = `${childIssueJqlField} in (${encodedFeatureKeys}) AND issuetype = Story`;
  const childIssueFields = buildUniqueFieldIds([
    MODERN_STORY_POINTS_FIELD,
    LEGACY_STORY_POINTS_FIELD,
    ...fieldConfig.featureLinkFieldIds,
  ]);
  const childIssueSearchPath =
    `/rest/api/2/search?jql=${encodeURIComponent(childIssueJql)}&fields=${encodeURIComponent(childIssueFields.join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
  const childIssueResponse = await jiraGet<JiraSearchResponse>(childIssueSearchPath);

  return (childIssueResponse.issues ?? []).reduce((featureKeySet, childIssue) => {
    const linkedFeatureKey = readLinkedFeatureKey(childIssue, fieldConfig.featureLinkFieldIds);
    const hasPointedStory = hasPositiveStoryPoints(childIssue.fields.customfield_10028) || hasPositiveStoryPoints(childIssue.fields.customfield_10016);
    if (linkedFeatureKey && hasPointedStory) {
      featureKeySet.add(linkedFeatureKey);
    }
    return featureKeySet;
  }, new Set<string>());
}

function buildJqlFieldReference(fieldId: string): string {
  const customFieldMatch = /^customfield_(\d+)$/.exec(fieldId);
  if (customFieldMatch) {
    return `cf[${customFieldMatch[1]}]`;
  }

  return fieldId.includes(' ') ? `"${fieldId}"` : fieldId;
}

function readLinkedFeatureKey(issue: JiraIssue, fieldIds: string[]): string | null {
  for (const fieldId of fieldIds) {
    const rawValue = issue.fields[fieldId];
    const linkedKey = readIssueKeyValue(rawValue);
    if (linkedKey) {
      return linkedKey;
    }
  }

  return issue.fields.parent?.key ?? null;
}

function readIssueKeyValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' && rawValue.includes('-')) {
    return rawValue;
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const keyRecord = rawValue as { key?: string; data?: { key?: string } };
  return keyRecord.key ?? keyRecord.data?.key ?? null;
}

function hasPositiveStoryPoints(fieldValue: unknown): boolean {
  return typeof fieldValue === 'number' && fieldValue > 0;
}
