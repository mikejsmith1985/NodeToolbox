// hygieneScan.ts — The ONE hygiene scan pipeline: scope JQL, field discovery, enabled checks,
// Jira search, child-story rollup, and evaluation.
//
// Every surface that reports hygiene numbers for a scope (the Hygiene tab, the Today dashboard's
// team cards) MUST run this same pipeline with the same inputs. Two surfaces computing "hygiene"
// through different fetches or different configs will disagree — that exact drift produced 58
// phantom commitment gaps beside a Hygiene tab showing 1 (GH #177). Counting and rendering may
// differ per surface; the scan may not.

import { resolveStoryPointsFieldIds, resolveStoryPointsWriteFieldId } from '../checks/storyPointsField.ts';
import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchIssuesPaged } from '../../../services/fetchIssuesPaged.ts';
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
  // Decision context the issue panel renders straight off the finding (spec 019 US2):
  // linked issues WITH their statuses, and label chips. No secondary fetch exists.
  'issuelinks',
  'labels',
  // When the issue last changed status category. The Target Start check needs to know how long an
  // issue has sat in Ready to Work, and this is the only elapsed-time signal a search returns —
  // the changelog costs one request per issue, which a 2,000-issue scan cannot afford.
  'statuscategorychangedate',
];
/** Issues requested per search page. */
const HYGIENE_PAGE_SIZE = 200;
/**
 * The most issues one scan will hold.
 *
 * A ceiling rather than no limit: a mis-scoped JQL can match a whole instance, and a scan that
 * quietly tries to pull a hundred thousand issues into the browser is its own kind of failure. Past
 * this the scan STOPS AND SAYS SO — which is the part that was missing, not the limit itself.
 */
const HYGIENE_ISSUE_CEILING = 2_000;
// Story-points field ids are resolved by storyPointsField.ts, never declared here — see that file.

export const DEFAULT_ASSIGNEE_CLAUSE = 'assignee = currentUser()';

export interface JiraSearchResponse {
  issues?: JiraIssue[];
  /** Jira's count of everything matching the JQL, used to tell a full scan from a capped one. */
  total?: number;
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
  /** Everything in scope, whether or not it was scanned — larger than the scanned count when capped. */
  totalMatchingCount: number;
  /** True when in-scope issues were genuinely left unscanned, so every count below is a floor. */
  isTruncated: boolean;
  fieldConfig: HygieneFieldConfig;
  enabledCheckDefinitions: EnabledCheckDefinitions;
  /**
   * The context this run ACTUALLY evaluated with, kept so one issue can be re-checked afterwards.
   *
   * Not the same as the setup's context: a failed child-story rollup removes a check for this run
   * only, and the rollup set itself depends on which issues were loaded. Re-checking a fixed issue
   * against the setup instead of against this would judge it by a different rule set than the row
   * beside it — which is exactly the kind of disagreement a single shared computation exists to
   * prevent.
   */
  evaluationContext: HygieneEvaluationContext;
  /** The `fields=` list this run requested, so a re-read of one issue sees the same fields. */
  requestedFields: string[];
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
/**
 * Builds the scope JQL a hygiene scan runs within (project/personal + not-Done + any extra clause).
 * Single-sourced so the "open in Jira" per-check link (US2, GH #200) reuses the EXACT scope the scan
 * used — the count and the link cannot disagree on scope.
 */
export function buildHygieneScopeJql(
  projectKey: string,
  extraJql: string,
  assigneeClause: string | null = DEFAULT_ASSIGNEE_CLAUSE,
): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const extraJqlClause = extraJql.trim();
  const assigneeFilter = assigneeClause && assigneeClause.trim() ? ` AND ${assigneeClause.trim()}` : '';
  const projectClause = normalizedProjectKey ? `project=${normalizedProjectKey} AND ` : '';
  return `${projectClause}statusCategory != Done${assigneeFilter}${extraJqlClause ? ` ${extraJqlClause}` : ''}`;
}

export function buildHygieneSearchPath(
  projectKey: string,
  extraJql: string,
  requestedFields: string[] = BASE_HYGIENE_FIELDS,
  assigneeClause: string | null = DEFAULT_ASSIGNEE_CLAUSE,
  startAt = 0,
  pageSize: number = HYGIENE_PAGE_SIZE,
): string {
  const jqlText = buildHygieneScopeJql(projectKey, extraJql, assigneeClause);
  const encodedFields = encodeURIComponent(buildUniqueFieldIds(requestedFields).join(','));
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${encodedFields}`
    + `&startAt=${startAt}&maxResults=${pageSize}`;
}

/** Everything needed to evaluate hygiene consistently, independent of WHICH issues are evaluated. */
export interface HygieneEvaluationSetup {
  /** The context every hygiene evaluation must share: field ids, enabled checks, team thresholds. */
  evaluationContext: HygieneEvaluationContext;
  /** The Jira `fields=` list those checks need in order to see anything at all. */
  requestedFields: string[];
  /** The enabled check definitions the Hygiene tab renders its summary tiles from. */
  enabledCheckDefinitions: EnabledCheckDefinitions;
}

/**
 * Loads the shared hygiene evaluation setup: instance field ids, the admin's enabled checks, and
 * the team's own story-points field and stale threshold.
 *
 * Split out of `runHygieneScan` because the scan is not the only evaluator. The Today dashboard's
 * "Due / overdue" card evaluates the viewer's OWN issues from its own cross-project fetch, and it
 * used to do so with no context at all — so it read a hard-coded `customfield_10102` for Target End
 * while the team half resolved the field by name, and it kept counting a rule the admin had turned
 * off. Two halves of one number, answering to two different configurations. Now there is one.
 *
 * `featureKeysWithPointedStories` is deliberately NOT here: it depends on which issues were loaded,
 * so it belongs to a scan run rather than to the setup.
 */
export async function loadHygieneEvaluationSetup(activeTeamProfileId: string): Promise<HygieneEvaluationSetup> {
  const enterpriseRules = loadEnterpriseRulesFromStorage();
  const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);
  const hygieneFieldConfig = await loadHygieneFieldConfig();
  const dashboardConfig = loadDashboardConfigFromStorage(activeTeamProfileId);
  // Resolved rather than taken as-is: the dashboard config's default is the placeholder
  // `story_points`, which is not a Jira field, so an instance that had chosen a field on the ART
  // settings screen was still judged against the built-ins it does not use (GH #375).
  const customStoryPointsFieldId = resolveStoryPointsWriteFieldId(dashboardConfig.customStoryPointsFieldId || '');

  return {
    evaluationContext: {
      customRules: enabledCustomRules,
      enabledBuiltInCheckIds: readEnabledBuiltInCheckIds(enterpriseRules),
      fieldConfig: hygieneFieldConfig,
      customStoryPointsFieldId,
      staleDaysThreshold: dashboardConfig.staleDaysThreshold,
    },
    requestedFields: buildRequestedHygieneFields(hygieneFieldConfig, enabledCustomRules, customStoryPointsFieldId),
    enabledCheckDefinitions: readEnabledEnterpriseCheckDefinitions(enterpriseRules),
  };
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
  // The same setup the Today dashboard's personal half uses — one configuration, so the two halves
  // of a mixed-scope count cannot answer to different field ids or different enabled checks.
  const { evaluationContext, requestedFields, enabledCheckDefinitions } =
    await loadHygieneEvaluationSetup(options.activeTeamProfileId);
  const hygieneFieldConfig = evaluationContext.fieldConfig as HygieneFieldConfig;
  const enabledBuiltInCheckIds = evaluationContext.enabledBuiltInCheckIds ?? new Set<never>();
  const customStoryPointsFieldId = evaluationContext.customStoryPointsFieldId ?? '';

  // Paged, so a project with more open issues than one request returns is scanned in full — and
  // when even the ceiling binds, the outcome says so rather than presenting a partial scan as the scan.
  const searchOutcome = await fetchIssuesPaged<JiraIssue>(
    (startAt, pageSize) => jiraGet<JiraSearchResponse>(
      buildHygieneSearchPath(options.projectKey, options.extraJql, requestedFields, options.assigneeClause, startAt, pageSize),
    ),
    { pageSize: HYGIENE_PAGE_SIZE, ceiling: HYGIENE_ISSUE_CEILING },
  );
  const loadedIssues = searchOutcome.issues;

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

  // Built once and both RETURNED and used, so a later single-issue re-check is judged by the same
  // rules as the scan that produced the row it replaces.
  const runEvaluationContext: HygieneEvaluationContext = {
    ...evaluationContext,
    enabledBuiltInCheckIds: runCheckIds,
    featureKeysWithPointedStories,
  };

  return {
    findings: mapIssuesToFindings(loadedIssues, runEvaluationContext),
    scannedIssueCount: loadedIssues.length,
    totalMatchingCount: searchOutcome.totalMatchingCount,
    isTruncated: searchOutcome.isTruncated,
    fieldConfig: hygieneFieldConfig,
    enabledCheckDefinitions,
    evaluationContext: runEvaluationContext,
    requestedFields,
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
    ...resolveStoryPointsFieldIds(customStoryPointsFieldId),
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
    // No hygiene CHECK reads the sub-status, but the delivery forecast does: an issue is at the PI
    // Definition of Done only when its status is Ready for Testing AND its sub-status is Integration
    // Test. The field was already discovered by name here and simply never asked for, so Today could
    // not tell an INT-ready issue from one that had barely started.
    ...(fieldConfig.subStatusFieldIds ?? []),
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
  const childIssueFields = buildUniqueFieldIds([
    ...resolveStoryPointsFieldIds(customStoryPointsFieldId),
    ...fieldConfig.featureLinkFieldIds,
  ]);
  // Paged for a reason sharper than the parent scan's: a truncated rollup does not merely undercount,
  // it ACCUSES. Every feature whose pointed child story fell past the cap looks unpointed, so the
  // check would flag work that is perfectly healthy. A run that still cannot see everything therefore
  // throws, which routes it into the same "skip this check" degrade path an outright failure takes.
  const childSearchOutcome = await fetchIssuesPaged<JiraIssue>(
    (startAt, pageSize) => jiraGet<JiraSearchResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(childIssueJql)}`
      + `&fields=${encodeURIComponent(childIssueFields.join(','))}`
      + `&startAt=${startAt}&maxResults=${pageSize}`,
    ),
    { pageSize: HYGIENE_PAGE_SIZE, ceiling: HYGIENE_ISSUE_CEILING },
  );
  if (childSearchOutcome.isTruncated) {
    throw new Error(
      `Child-story rollup covered only ${childSearchOutcome.issues.length} of `
      + `${childSearchOutcome.totalMatchingCount} stories — skipping the pointed-child check rather `
      + 'than flagging features whose stories were never read.',
    );
  }

  return childSearchOutcome.issues.reduce((featureKeySet, childIssue) => {
    const linkedFeatureKey = readLinkedFeatureKey(childIssue, fieldConfig.featureLinkFieldIds);
    // When a real custom field is configured, it is the authoritative source — consistent with
    // the pointing queue and Hygiene missing-SP check. Fall back to legacy fields otherwise.
    // Points in ANY resolved field count. Reading only the newest one reported a pointed story as
    // unpointed whenever the estimate sat in the field this instance actually uses.
    const hasPointedStory = resolveStoryPointsFieldIds(customStoryPointsFieldId).some((fieldId) =>
      hasPositiveStoryPoints((childIssue.fields as Record<string, unknown>)[fieldId]));
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

/**
 * Re-reads ONE issue and re-runs the hygiene checks on it.
 *
 * Why this exists: fixing a field used to trigger a full re-scan — hundreds of issues, several
 * seconds, and the whole page redrawn — to update one row. The user's next click landed on a screen
 * that was still rebuilding. One issue is one request.
 *
 * It genuinely RE-READS rather than assuming the write worked. A date write can clear two flags at
 * once, or leave a new mismatch behind, and a row edited by guesswork would drift away from what a
 * later scan says. Returns null when the issue is now clean — the caller drops the row.
 */
export async function rescanSingleHygieneIssue(
  issueKey: string,
  evaluationContext: HygieneEvaluationContext,
  requestedFields: string[],
): Promise<HygieneFinding | null> {
  const encodedFields = encodeURIComponent(buildUniqueFieldIds(requestedFields).join(','));
  const issue = await jiraGet<JiraIssue>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${encodedFields}`,
  );

  return mapJiraIssueToHygieneFinding(issue, evaluationContext);
}
