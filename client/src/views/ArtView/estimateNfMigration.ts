// estimateNfMigration.ts — Moves each Epic's story points into Estimate (NF), then clears story points (GH #449).
//
// Estimate (NF) replaces story points as an Epic's size in the PI Review. This reconciliation finds the Epics the
// team's Product Owners own — in every PI — and, for each one still holding story points, copies the value into
// Estimate (NF), reads it back to prove it landed, and only then clears story points. A value is never lost:
// story points are cleared only after the copy is confirmed, and an Epic whose Estimate (NF) already holds a
// DIFFERENT value is left alone for a person to decide.

import { fetchIssuesPaged } from '../../services/fetchIssuesPaged.ts';
import { jiraGet } from '../../services/jiraApi.ts';
import { resolveConfiguredFieldIds } from '../../services/jiraFieldMapping.ts';
import { buildIssueTypeClause, loadFeatureIssueTypeNames } from '../../services/jiraIssueTypes.ts';
import {
  clearFeatureReviewFields,
  fetchFeatureReviewEditMeta,
  getStoryPointsCandidateFieldIds,
  readEstimateNfFieldId,
  readIssueEstimateNfValue,
  saveFeatureEstimateNf,
} from '../SprintDashboard/featureReviewFixes.ts';
import { buildProductOwnerClause, resolvePiReviewPullSettings } from './piReviewPullFeatures.ts';

/** What the reconciliation does with one Epic. */
export type EstimateNfMigrationAction = 'move' | 'clear' | 'conflict' | 'none';

/** One Epic, what it holds, and what the reconciliation will do with it. */
export interface EstimateNfMigrationPlan {
  issueKey: string;
  summary: string;
  storyPointsValue: string;
  estimateNfValue: string;
  /** Every story-points field holding a value — all of them are cleared, so no copy of the old size lingers. */
  storyPointFieldIdsToClear: string[];
  action: EstimateNfMigrationAction;
}

/** What happened to one Epic. */
export interface EstimateNfMigrationResult {
  issueKey: string;
  outcome: 'moved' | 'cleared' | 'skipped' | 'failed';
  message: string;
}

/** The Jira writes the reconciliation makes, passed in so the steps can be proven without Jira. */
export interface EstimateNfMigrationWriters {
  saveEstimateNf: (issueKey: string, estimate: string) => Promise<void>;
  readEstimateNf: (issueKey: string) => Promise<string>;
  clearStoryPoints: (issueKey: string, fieldIds: readonly string[]) => Promise<void>;
}

/** An Epic as the search returns it. */
interface MigrationIssue {
  key: string;
  fields: Record<string, unknown>;
}

// Enough for every Epic a team's Product Owners have ever owned; past it the panel says the list is incomplete.
const MIGRATION_SEARCH_CEILING = 1000;
const MIGRATION_SEARCH_PAGE_SIZE = 100;

// ── Planning (pure) ──

/** A field's value as text: a number, a string, or a dropdown option's label; '' when empty. */
function readFieldText(rawFieldValue: unknown): string {
  if (typeof rawFieldValue === 'number') return String(rawFieldValue);
  if (typeof rawFieldValue === 'string') return rawFieldValue.trim();
  if (rawFieldValue !== null && typeof rawFieldValue === 'object' && !Array.isArray(rawFieldValue)) {
    const optionRecord = rawFieldValue as { value?: unknown; name?: unknown };
    return String(optionRecord.value ?? optionRecord.name ?? '').trim();
  }
  return '';
}

/** True when two sizes are the same number ("5" and "5.0"), or the same text when either is not a number. */
function isSameEstimate(leftValue: string, rightValue: string): boolean {
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber === rightNumber : leftValue === rightValue;
}

/** The action for an Epic with story points: move into an empty Estimate (NF), clear a match, flag a difference. */
function chooseAction(storyPointsValue: string, estimateNfValue: string): EstimateNfMigrationAction {
  if (storyPointsValue === '') return 'none';
  if (estimateNfValue === '') return 'move';
  return isSameEstimate(storyPointsValue, estimateNfValue) ? 'clear' : 'conflict';
}

/** What the reconciliation will do with one Epic, read from the fields the search returned. Pure. */
export function planEstimateNfMigration(
  issue: MigrationIssue,
  storyPointFieldIds: readonly string[],
  estimateNfFieldId: string,
): EstimateNfMigrationPlan {
  const storyPointFieldIdsToClear = storyPointFieldIds.filter((fieldId) => readFieldText(issue.fields[fieldId]) !== '');
  const storyPointsValue = storyPointFieldIdsToClear.length > 0 ? readFieldText(issue.fields[storyPointFieldIdsToClear[0]]) : '';
  const estimateNfValue = readFieldText(issue.fields[estimateNfFieldId]);
  return {
    issueKey: issue.key,
    summary: readFieldText(issue.fields.summary),
    storyPointsValue,
    estimateNfValue,
    storyPointFieldIdsToClear,
    action: chooseAction(storyPointsValue, estimateNfValue),
  };
}

/**
 * The search for the Epics the team's Product Owners own, in every PI — the same owner rule Pull Features uses,
 * without its PI filter. Null when no owner is given, because an unscoped search would touch other teams' Epics.
 */
export function buildEstimateNfMigrationJql(
  ownerQueryValues: readonly string[],
  productOwnerFieldId: string | null,
  issueTypeNames: readonly string[],
): string | null {
  const ownerClause = buildProductOwnerClause(ownerQueryValues, productOwnerFieldId);
  if (ownerClause === null) return null;
  const scopeJql = [buildIssueTypeClause([...issueTypeNames]), ownerClause].filter((clause) => clause !== '').join(' AND ');
  return `${scopeJql} ORDER BY key`;
}

// ── Running ──

/** Copies, confirms, then clears one Epic whose Estimate (NF) is empty. */
async function moveEstimate(plan: EstimateNfMigrationPlan, writers: EstimateNfMigrationWriters): Promise<EstimateNfMigrationResult> {
  await writers.saveEstimateNf(plan.issueKey, plan.storyPointsValue);
  const readBackValue = await writers.readEstimateNf(plan.issueKey);
  if (!isSameEstimate(readBackValue, plan.storyPointsValue)) {
    return {
      issueKey: plan.issueKey,
      outcome: 'failed',
      message: `Estimate (NF) did not read back as ${plan.storyPointsValue} (it shows "${readBackValue}"), so story points were left in place.`,
    };
  }
  await writers.clearStoryPoints(plan.issueKey, plan.storyPointFieldIdsToClear);
  return { issueKey: plan.issueKey, outcome: 'moved', message: `Moved ${plan.storyPointsValue} to Estimate (NF) and cleared story points.` };
}

/** Carries out one Epic's plan; a failure is reported for that Epic and never stops the rest. */
async function runOnePlan(plan: EstimateNfMigrationPlan, writers: EstimateNfMigrationWriters): Promise<EstimateNfMigrationResult> {
  try {
    if (plan.action === 'move') return await moveEstimate(plan, writers);
    if (plan.action === 'clear') {
      await writers.clearStoryPoints(plan.issueKey, plan.storyPointFieldIdsToClear);
      return { issueKey: plan.issueKey, outcome: 'cleared', message: `Estimate (NF) already held ${plan.estimateNfValue}; cleared story points.` };
    }
    if (plan.action === 'conflict') {
      return {
        issueKey: plan.issueKey,
        outcome: 'skipped',
        message: `Estimate (NF) already holds ${plan.estimateNfValue} but story points say ${plan.storyPointsValue} — left for you to decide.`,
      };
    }
    return { issueKey: plan.issueKey, outcome: 'skipped', message: 'No story points to move.' };
  } catch (runError) {
    return { issueKey: plan.issueKey, outcome: 'failed', message: runError instanceof Error ? runError.message : String(runError) };
  }
}

/** Runs every plan in turn — one Epic at a time, so a Jira refusal is tied to the Epic that caused it. */
export async function runEstimateNfMigration(
  plans: readonly EstimateNfMigrationPlan[],
  writers: EstimateNfMigrationWriters,
): Promise<EstimateNfMigrationResult[]> {
  const results: EstimateNfMigrationResult[] = [];
  for (const plan of plans) {
    results.push(await runOnePlan(plan, writers));
  }
  return results;
}

// ── Jira wiring ──

/** Every field story points may sit in: Field Mapping's chain and the PI Review's own candidates. */
function readStoryPointFieldIds(): string[] {
  return [...new Set([...resolveConfiguredFieldIds('spFieldId', window.localStorage), ...getStoryPointsCandidateFieldIds()])];
}

/** Finds the team's Epics and plans each one; only Epics with something to do are returned. */
export async function loadEstimateNfMigrationPlans(
  ownerQueryValues: readonly string[],
): Promise<{ plans: EstimateNfMigrationPlan[]; isTruncated: boolean }> {
  const [pullSettings, issueTypeNames] = await Promise.all([resolvePiReviewPullSettings(), loadFeatureIssueTypeNames()]);
  const migrationJql = buildEstimateNfMigrationJql(ownerQueryValues, pullSettings.productOwnerFieldId, issueTypeNames);
  if (migrationJql === null) {
    throw new Error('Flag a Product Owner in the team roster (or tick "Include full roster") so Toolbox knows whose Epics to check.');
  }
  const storyPointFieldIds = readStoryPointFieldIds();
  const estimateNfFieldId = readEstimateNfFieldId();
  const requestedFields = ['summary', ...storyPointFieldIds, estimateNfFieldId].join(',');
  const searchOutcome = await fetchIssuesPaged<MigrationIssue>(
    (startAt, pageSize) => jiraGet(`/rest/api/2/search?jql=${encodeURIComponent(migrationJql)}`
      + `&fields=${encodeURIComponent(requestedFields)}&startAt=${startAt}&maxResults=${pageSize}`),
    { pageSize: MIGRATION_SEARCH_PAGE_SIZE, ceiling: MIGRATION_SEARCH_CEILING },
  );
  const plans = searchOutcome.issues
    .map((issue) => planEstimateNfMigration(issue, storyPointFieldIds, estimateNfFieldId))
    .filter((plan) => plan.action !== 'none');
  return { plans, isTruncated: searchOutcome.isTruncated };
}

/**
 * The real Jira writes. Story points are cleared only in the fields the Epic's edit screen offers: clearing a
 * field Jira does not let you edit would refuse the whole request.
 */
export function createEstimateNfMigrationWriters(): EstimateNfMigrationWriters {
  return {
    saveEstimateNf: saveFeatureEstimateNf,
    readEstimateNf: async (issueKey) => {
      const estimateNfFieldId = readEstimateNfFieldId();
      const issue = await jiraGet<MigrationIssue>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${estimateNfFieldId}`);
      return readIssueEstimateNfValue(issue);
    },
    clearStoryPoints: async (issueKey, fieldIds) => {
      const editMeta = await fetchFeatureReviewEditMeta(issueKey);
      const editableFieldIds = fieldIds.filter((fieldId) => editMeta[fieldId] !== undefined);
      if (editableFieldIds.length === 0) {
        throw new Error('Estimate (NF) was copied, but story points are not on the edit screen, so they could not be cleared.');
      }
      await clearFeatureReviewFields(issueKey, editableFieldIds);
    },
  };
}
