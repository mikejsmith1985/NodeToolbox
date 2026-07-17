// hygieneScan.ts — The ONE hygiene scan pipeline: scope JQL, field discovery, enabled checks,
// Jira search, child-story rollup, and evaluation.
//
// Every surface that reports hygiene numbers for a scope (the Hygiene tab, the Today dashboard's
// team cards) MUST run this same pipeline with the same inputs. Two surfaces computing "hygiene"
// through different fetches or different configs will disagree — that exact drift produced 58
// phantom commitment gaps beside a Hygiene tab showing 1 (GH #177). Counting and rendering may
// differ per surface; the scan may not.

import { jiraGet } from '../../../services/jiraApi.ts';
import { buildJqlFieldReference, loadHygieneFieldConfig } from '../checks/hygieneFieldConfig.ts';
import {
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
  readEnabledEnterpriseCheckDefinitions,
  readEnabledRequiredFieldRules,
} from '../../AdminHub/enterpriseRules.ts';
import { loadDashboardConfigFromStorage } from '../../SprintDashboard/hooks/useDashboardConfig.ts';
import {
  evaluateHygieneIssue,
  isFeatureLikeIssue,
  type HygieneEvaluationContext,
  type HygieneFieldConfig,
  type HygieneFinding,
  type JiraIssue,
} from '../checks/hygieneChecks.ts';

// Fields every scan needs regardless of configuration; instance-resolved fields are appended.
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
const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';

export const DEFAULT_ASSIGNEE_CLAUSE = 'assignee = currentUser()';

export interface JiraSearchResponse {
  issues?: JiraIssue[];
}

/** The check definitions (id + label) the enterprise rules say are enabled for this instance. */
export type EnabledCheckDefinitions = ReturnType<typeof readEnabledEnterpriseCheckDefinitions>;

/** Everything a single hygiene scan needs to be reproducible across surfaces. */
export interface HygieneScanOptions {
  /** Project to audit; empty string drops the project clause (all-projects personal scope). */
  projectKey: string;
  /** Extra scope clause, e.g. the team dashboard's PI/sprint/fix-version selection. */
  extraJql: string;
  /** null audits every in-scope issue (team mode); a clause scopes to one person's issues. */
  assigneeClause: string | null;
  /** Team profile whose saved dashboard config supplies the SP field and stale threshold. */
  activeTeamProfileId: string;
}

/** The complete result of one scan — findings plus the configuration that produced them. */
export interface HygieneScanOutcome {
  findings: HygieneFinding[];
  scannedIssueCount: number;
  fieldConfig: HygieneFieldConfig;
  enabledCheckDefinitions: EnabledCheckDefinitions;
}

/**
 * Builds the single Jira search URL required by a hygiene scan.
 *
 * `assigneeClause` may be null/empty to scope the search to every in-scope issue
 * regardless of who it is assigned to — the team-mode behaviour, which keeps Hygiene
 * aligned with the dashboard's issue list (the dashboard is not assignee-filtered).
 *
 * `projectKey` may be empty for the "All my projects" scope: the project clause is
 * dropped so the search matches the Today tab's cross-project personal count. That
 * scope is only ever used with the assignee clause, which keeps the query bounded.
 */
export function buildHygieneSearchPath(
  projectKey: string,
  extraJql: string,
  requestedFields: string[] = BASE_HYGIENE_FIELDS,
  assigneeClause: string | null = DEFAULT_ASSIGNEE_CLAUSE,
): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const extraJqlClause = extraJql.trim();
  const assigneeFilter = assigneeClause && assigneeClause.trim() ? ` AND ${assigneeClause.trim()}` : '';
  const projectClause = normalizedProjectKey ? `project=${normalizedProjectKey} AND ` : '';
  const jqlText = `${projectClause}statusCategory != Done${assigneeFilter}${extraJqlClause ? ` ${extraJqlClause}` : ''}`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${encodeURIComponent(buildUniqueFieldIds(requestedFields).join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
}

/**
 * Runs the full hygiene pipeline for one scope and returns findings plus the resolved config.
 *
 * This is the shared engine behind the Hygiene tab AND the Today dashboard's team cards: same
 * enterprise rule set, same instance-resolved field config, same team dashboard config (story
 * points field, stale threshold), same search, same rollup, same evaluation. Callers that want
 * per-check counts derive them from the returned findings — never from a second computation.
 */
export async function runHygieneScan(options: HygieneScanOptions): Promise<HygieneScanOutcome> {
  const enterpriseRules = loadEnterpriseRulesFromStorage();
  const enabledCheckDefinitions = readEnabledEnterpriseCheckDefinitions(enterpriseRules);
  const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);
  const enabledBuiltInCheckIds = readEnabledBuiltInCheckIds(enterpriseRules);
  const hygieneFieldConfig = await loadHygieneFieldConfig();

  // Read the team's configured story-points field so the missing-SP check uses the right field,
  // and the same stale threshold the Blockers tab uses so every surface agrees on "stale".
  const dashboardConfig = loadDashboardConfigFromStorage(options.activeTeamProfileId);
  const customStoryPointsFieldId = dashboardConfig.customStoryPointsFieldId || '';
  const staleDaysThreshold = dashboardConfig.staleDaysThreshold;

  const jiraSearchResponse = await jiraGet<JiraSearchResponse>(
    buildHygieneSearchPath(
      options.projectKey,
      options.extraJql,
      buildRequestedHygieneFields(hygieneFieldConfig, enabledCustomRules, customStoryPointsFieldId),
      options.assigneeClause,
    ),
  );
  const loadedIssues = jiraSearchResponse.issues ?? [];

  // The child-story rollup is a SECONDARY query over instance-matched fields; a surprise on it
  // (an unexpected 400, a permission gap) must not take down the whole run. On failure the
  // missing-pointed-child-story check is skipped for this run — an empty rollup set would
  // instead flag every Feature as unpointed, which is worse than saying nothing (GH #167).
  let featureKeysWithPointedStories = new Set<string>();
  let runCheckIds = enabledBuiltInCheckIds;
  try {
    featureKeysWithPointedStories = await loadFeatureKeysWithPointedStories(loadedIssues, hygieneFieldConfig, customStoryPointsFieldId);
  } catch {
    runCheckIds = new Set([...enabledBuiltInCheckIds].filter((checkId) => checkId !== 'missing-child-story-points'));
  }

  return {
    findings: mapIssuesToFindings(loadedIssues, {
      customRules: enabledCustomRules,
      enabledBuiltInCheckIds: runCheckIds,
      fieldConfig: hygieneFieldConfig,
      featureKeysWithPointedStories,
      customStoryPointsFieldId,
      staleDaysThreshold,
    }),
    scannedIssueCount: loadedIssues.length,
    fieldConfig: hygieneFieldConfig,
    enabledCheckDefinitions,
  };
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

/** Reads the first non-empty Program Increment value from the configured PI fields. */
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

// ── Private helpers ──

function mapIssuesToFindings(issues: JiraIssue[], evaluationContext: HygieneEvaluationContext): HygieneFinding[] {
  return issues
    .map((issue) => mapJiraIssueToHygieneFinding(issue, evaluationContext))
    .filter((finding): finding is HygieneFinding => finding !== null);
}

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function buildRequestedHygieneFields(
  fieldConfig: HygieneFieldConfig,
  customRules = readEnabledRequiredFieldRules(),
  customStoryPointsFieldId = '',
): string[] {
  return buildUniqueFieldIds([
    ...BASE_HYGIENE_FIELDS,
    ...(customStoryPointsFieldId ? [customStoryPointsFieldId] : []),
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

async function loadFeatureKeysWithPointedStories(
  issues: JiraIssue[],
  fieldConfig: HygieneFieldConfig,
  customStoryPointsFieldId: string,
): Promise<Set<string>> {
  const featureKeys = issues.filter(isFeatureLikeIssue).map((issue) => issue.key);
  if (featureKeys.length === 0) {
    return new Set<string>();
  }

  const encodedFeatureKeys = featureKeys.map((featureKey) => `"${featureKey}"`).join(',');
  // Build an OR clause covering every possible feature-link field (the configured default may differ
  // from the field the Jira instance actually uses) plus the native Jira parent relationship, so
  // child stories are found regardless of which field stores the link.
  const featureLinkJqlClauses = fieldConfig.featureLinkFieldIds
    .filter((fieldId) => fieldId !== 'parent')
    .map((fieldId) => `${buildJqlFieldReference(fieldId)} in (${encodedFeatureKeys})`);
  const childIssueJql = `(${[...featureLinkJqlClauses, `parent in (${encodedFeatureKeys})`].join(' OR ')}) AND issuetype = Story`;

  // Include the configured story-points field so Select-type values are available for the check.
  const isRealCustomField = customStoryPointsFieldId.startsWith('customfield_');
  const childIssueFields = buildUniqueFieldIds([
    MODERN_STORY_POINTS_FIELD,
    LEGACY_STORY_POINTS_FIELD,
    ...(isRealCustomField ? [customStoryPointsFieldId] : []),
    ...fieldConfig.featureLinkFieldIds,
  ]);
  const childIssueSearchPath =
    `/rest/api/2/search?jql=${encodeURIComponent(childIssueJql)}&fields=${encodeURIComponent(childIssueFields.join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
  const childIssueResponse = await jiraGet<JiraSearchResponse>(childIssueSearchPath);

  return (childIssueResponse.issues ?? []).reduce((featureKeySet, childIssue) => {
    const linkedFeatureKey = readLinkedFeatureKey(childIssue, fieldConfig.featureLinkFieldIds);
    // When a real custom field is configured, it is the authoritative source — consistent with
    // the pointing queue and Hygiene missing-SP check. Fall back to legacy fields otherwise.
    const hasPointedStory = isRealCustomField
      ? hasPositiveStoryPoints((childIssue.fields as Record<string, unknown>)[customStoryPointsFieldId])
      : hasPositiveStoryPoints(childIssue.fields[MODERN_STORY_POINTS_FIELD])
        || hasPositiveStoryPoints(childIssue.fields[LEGACY_STORY_POINTS_FIELD]);
    if (linkedFeatureKey && hasPointedStory) {
      featureKeySet.add(linkedFeatureKey);
    }
    return featureKeySet;
  }, new Set<string>());
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

  // Jira multi-value feature-link fields return an array of issue references.
  // typeof [] === 'object' so we must check for arrays BEFORE the object branch.
  if (Array.isArray(rawValue)) {
    for (const item of rawValue) {
      const issueKey = readIssueKeyValue(item);
      if (issueKey) return issueKey;
    }
    return null;
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const keyRecord = rawValue as { key?: string; data?: { key?: string } };
  return keyRecord.key ?? keyRecord.data?.key ?? null;
}

function hasPositiveStoryPoints(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return false;
  if (typeof fieldValue === 'number') return fieldValue > 0;
  // Non-numeric strings like "None" have no story points; numeric strings like "5" do.
  if (typeof fieldValue === 'string') {
    const parsedNumber = Number(fieldValue);
    return Number.isFinite(parsedNumber) && parsedNumber > 0;
  }
  // Jira Select-type fields return {id, value} objects — recurse into the value.
  if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    return hasPositiveStoryPoints((fieldValue as Record<string, unknown>).value);
  }
  return false;
}
