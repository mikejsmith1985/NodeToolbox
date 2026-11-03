// TestStoryBackfillPanel.tsx — Admin Hub clean-up that fills empty Description / Acceptance Criteria on open
// [QE] and [SL] issues from the [DEV] story, linked Defect, or parent they were made from.
//
// A Jira automation created these test issues without cloning the description and acceptance criteria.
// This panel previews every planned field write first, writes only when Apply is pressed, re-reads each
// issue immediately before writing it, and never overwrites a field that already has content.

import React, { useState } from 'react';

import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import {
  FIELD_MAPPING_ENTRIES,
  readFieldMappingOverrides,
  resolveFieldMapping,
  type FieldMappingResolution,
} from '../../services/jiraFieldMapping.ts';
import type { JiraField } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';
import { describeJiraFailure } from './subtaskStoryPromotion.ts';
import {
  DEFAULT_BACKFILL_PROJECT_KEYS,
  DESCRIPTION_FIELD_ID,
  buildBackfillPlan,
  buildKeyLookupJql,
  buildSourceTiers,
  buildTargetSearchJql,
  buildUpdateFields,
  collectSourceKeys,
  countPlannedWrites,
  describeFieldDecision,
  isBackfillTargetSummary,
  parseProjectKeys,
  type BackfillFieldConfig,
  type BackfillIssue,
  type BackfillPlanRow,
} from './testStoryBackfill.ts';
import { fetchSearchAdaptively } from './testStoryBackfillSearch.ts';

// ── Named constants ──

/** Issues requested per page of the summaries-only scan, which is light enough for a large page. */
const SCAN_PAGE_SIZE = 100;
/** The most open issues one run will scan; a run that hits this says so rather than looking complete. */
const MAX_SCANNED_ISSUES = 10000;
/** Keys per `key in (…)` lookup. These rows carry links and long text, so each request is kept small. */
const KEY_LOOKUP_BATCH_SIZE = 20;
/** The smallest page tried after a gateway refusal; a refusal at this size is not about request size. */
const MINIMUM_PAGE_SIZE = 5;
/** The only field the scan needs, since the [QE]/[SL] match is made on the summary. */
const SCAN_FIELDS = ['summary'];
/** Fields every target needs for planning besides the instance-specific ones. */
const BASE_TARGET_FIELDS = ['summary', 'status', 'issuelinks', 'parent', DESCRIPTION_FIELD_ID];

/** Everything one preview run produced. */
interface BackfillPreview {
  fieldConfig: BackfillFieldConfig;
  warnings: string[];
  plan: BackfillPlanRow[];
  summaryMessage: string;
}

/** Lets a running search report progress and any page-size reduction back to the preview. */
interface SearchReporter {
  onProgress?: (retrievedCount: number, totalMatchingCount: number) => void;
  onPageSizeReduced: (nextPageSize: number) => void;
}

/** What happened when one target was written. */
interface ApplyOutcome {
  targetKey: string;
  message: string;
  isFailure: boolean;
}

/** Reads a message off an unknown thrown value, keeping only the part a person can act on. */
function toMessage(error: unknown): string {
  return describeJiraFailure(error instanceof Error ? error.message : String(error));
}

/** Finds one logical field's resolution (chosen override, discovered by name, or default). */
function resolveLogicalField(
  settingsKey: 'acFieldId' | 'epicLinkFieldId',
  availableFields: readonly JiraField[],
): FieldMappingResolution {
  const mappingEntry = FIELD_MAPPING_ENTRIES.find((entry) => entry.settingsKey === settingsKey)!;
  return resolveFieldMapping(mappingEntry, availableFields, readFieldMappingOverrides(window.localStorage));
}

/** Resolves the AC and Epic Link fields for this Jira and any warning worth showing about them. */
async function loadFieldConfig(): Promise<{ fieldConfig: BackfillFieldConfig; warnings: string[] }> {
  const availableFields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const fieldList = Array.isArray(availableFields) ? availableFields : [];
  const acResolution = resolveLogicalField('acFieldId', fieldList);
  const epicLinkResolution = resolveLogicalField('epicLinkFieldId', fieldList);
  return {
    fieldConfig: {
      acWriteFieldId: acResolution.effectiveFieldId,
      acReadFieldIds: acResolution.discoveredFieldIds,
      epicLinkFieldId: epicLinkResolution.effectiveFieldId,
    },
    warnings: [acResolution.riskNote, epicLinkResolution.riskNote].filter((note): note is string => Boolean(note)),
  };
}

/** Reads a whole search, asking for smaller pages if a gateway refuses a large one. */
function searchIssues(
  jql: string,
  fieldIds: readonly string[],
  pageOptions: { initialPageSize: number; ceiling: number },
  reporter: SearchReporter,
) {
  const fieldsParam = encodeURIComponent([...new Set(fieldIds)].filter(Boolean).join(','));
  return fetchSearchAdaptively<BackfillIssue>(
    (startAt, pageSize) => jiraGet<{ issues?: BackfillIssue[]; total?: number }>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldsParam}&startAt=${startAt}&maxResults=${pageSize}`,
    ),
    { ...pageOptions, minimumPageSize: MINIMUM_PAGE_SIZE, ...reporter },
  );
}

/** Reads specific issues in small `key in (…)` batches, reporting how many of them are done. */
async function lookUpIssuesByKey(
  issueKeys: readonly string[],
  fieldIds: readonly string[],
  reporter: SearchReporter,
): Promise<BackfillIssue[]> {
  const foundIssues: BackfillIssue[] = [];
  for (let i = 0; i < issueKeys.length; i += KEY_LOOKUP_BATCH_SIZE) {
    const keyBatch = issueKeys.slice(i, i + KEY_LOOKUP_BATCH_SIZE);
    const outcome = await searchIssues(
      buildKeyLookupJql(keyBatch),
      fieldIds,
      { initialPageSize: KEY_LOOKUP_BATCH_SIZE, ceiling: keyBatch.length },
      { onPageSizeReduced: reporter.onPageSizeReduced },
    );
    foundIssues.push(...outcome.issues);
    reporter.onProgress?.(i + keyBatch.length, issueKeys.length);
  }
  return foundIssues;
}

/**
 * Runs one stage of the preview, and on failure names the stage and shows the full request.
 * The request is decoded so that someone reading the message can see the actual JQL that failed.
 */
async function runPreviewStep<StepResult>(stepLabel: string, runStep: () => Promise<StepResult>): Promise<StepResult> {
  try {
    return await runStep();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed during ${stepLabel}: ${decodeFailureMessage(rawMessage)}`, { cause: error });
  }
}

/** Makes a percent-encoded request readable, leaving any text that is not validly encoded as it was. */
function decodeFailureMessage(rawMessage: string): string {
  try {
    return decodeURIComponent(rawMessage);
  } catch {
    return rawMessage;
  }
}

/** Builds the line under the preview: what was found, plus anything that makes the result less than complete. */
function buildSummaryMessage(
  counts: { targetCount: number; scannedCount: number; totalOpenCount: number; plannedWriteCount: number },
  projectKeys: readonly string[],
  wasPageSizeReduced: boolean,
): string {
  const notes = [
    `${counts.targetCount} open [QE]/[SL] issues found in ${projectKeys.join(', ')}; ${counts.plannedWriteCount} empty fields can be filled.`,
  ];
  if (counts.totalOpenCount > counts.scannedCount) {
    notes.push(`Warning: only ${counts.scannedCount} of ${counts.totalOpenCount} open issues were scanned, so some [QE]/[SL] issues may be missing.`);
  }
  if (wasPageSizeReduced) notes.push('A gateway refused larger requests, so smaller ones were used.');
  return notes.join(' ');
}

/** Turns a stage name into a progress callback, so a long preview visibly keeps moving. */
function buildStageReporter(reportStatus: (message: string) => void) {
  return (stageLabel: string) => (retrievedCount: number, totalCount: number): void => {
    reportStatus(`${stageLabel}: ${retrievedCount} of ${totalCount}…`);
  };
}

/**
 * Builds the whole preview using reads only: resolve the fields, scan summaries for targets, then read
 * full details for the targets and their sources. Heavy fields are requested only for issues that need
 * them, and any failed stage stops the run because a missing source could put the wrong text in a field.
 */
async function loadBackfillPreview(projectKeys: readonly string[], reportStatus: (message: string) => void): Promise<BackfillPreview> {
  let wasPageSizeReduced = false;
  const onPageSizeReduced = (nextPageSize: number): void => {
    wasPageSizeReduced = true;
    reportStatus(`A gateway refused a large request; retrying with ${nextPageSize} issues per request…`);
  };
  const reportStage = buildStageReporter(reportStatus);

  const loaded = await runPreviewStep('field list', loadFieldConfig);
  const acFieldIds = [loaded.fieldConfig.acWriteFieldId, ...loaded.fieldConfig.acReadFieldIds];
  const scan = await runPreviewStep('target search', () => searchIssues(
    buildTargetSearchJql(projectKeys),
    SCAN_FIELDS,
    { initialPageSize: SCAN_PAGE_SIZE, ceiling: MAX_SCANNED_ISSUES },
    { onProgress: reportStage('Scanning open issues'), onPageSizeReduced },
  ));
  const targetKeys = scan.issues.filter((issue) => isBackfillTargetSummary(issue.fields.summary)).map((issue) => issue.key);
  const targets = await runPreviewStep('target details', () => lookUpIssuesByKey(
    targetKeys,
    [...BASE_TARGET_FIELDS, ...acFieldIds, loaded.fieldConfig.epicLinkFieldId],
    { onProgress: reportStage('Reading [QE]/[SL] issues'), onPageSizeReduced },
  ));
  const sourceKeys = collectSourceKeys(targets.map((target) => buildSourceTiers(target, loaded.fieldConfig.epicLinkFieldId)));
  const sources = await runPreviewStep('source lookup', () => lookUpIssuesByKey(
    sourceKeys,
    ['summary', DESCRIPTION_FIELD_ID, ...acFieldIds],
    { onProgress: reportStage('Reading source issues'), onPageSizeReduced },
  ));
  const plan = buildBackfillPlan(targets, sources, loaded.fieldConfig);

  return {
    ...loaded,
    plan,
    summaryMessage: buildSummaryMessage(
      { targetCount: targets.length, scannedCount: scan.issues.length, totalOpenCount: scan.totalMatchingCount, plannedWriteCount: countPlannedWrites(plan) },
      projectKeys,
      wasPageSizeReduced,
    ),
  };
}

/** The preview table: one row per target, one cell per field decision, plus the apply result. */
function BackfillPreviewTable({
  plan, outcomeByKey,
}: { plan: readonly BackfillPlanRow[]; outcomeByKey: Record<string, ApplyOutcome> }): React.ReactElement {
  return (
    <table className={styles.installationsTable}>
      <thead>
        <tr><th>Issue</th><th>Summary</th><th>Status</th><th>Description</th><th>Acceptance Criteria</th><th>Result</th></tr>
      </thead>
      <tbody>
        {plan.map((row) => {
          const outcome = outcomeByKey[row.targetKey];
          return (
            <tr key={row.targetKey}>
              <td>{row.targetKey}</td>
              <td>{row.summary}</td>
              <td>{row.statusName}</td>
              <td>{describeFieldDecision(row.description)}</td>
              <td>{describeFieldDecision(row.acceptanceCriteria)}</td>
              <td>
                {outcome && (
                  <span className={outcome.isFailure ? styles.sectionErrorText : undefined}>{outcome.message}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The Admin Hub [QE]/[SL] description + Acceptance Criteria backfill panel. */
export function TestStoryBackfillPanel(): React.ReactElement {
  const [projectText, setProjectText] = useState(DEFAULT_BACKFILL_PROJECT_KEYS.join(', '));
  const [plan, setPlan] = useState<BackfillPlanRow[]>([]);
  const [fieldConfig, setFieldConfig] = useState<BackfillFieldConfig | null>(null);
  const [fieldWarnings, setFieldWarnings] = useState<string[]>([]);
  const [outcomeByKey, setOutcomeByKey] = useState<Record<string, ApplyOutcome>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const plannedWriteCount = countPlannedWrites(plan);
  const hasApplied = Object.keys(outcomeByKey).length > 0;

  /** Finds every open [QE]/[SL] issue, fetches its candidate sources, and builds the plan. */
  async function handlePreview(): Promise<void> {
    const projectKeys = parseProjectKeys(projectText);
    if (projectKeys.length === 0) {
      setStatusMessage('Enter at least one project key.');
      return;
    }
    setIsBusy(true);
    setOutcomeByKey({});
    setPlan([]);
    setStatusMessage('Loading…');
    try {
      const preview = await loadBackfillPreview(projectKeys, setStatusMessage);
      setFieldConfig(preview.fieldConfig);
      setFieldWarnings(preview.warnings);
      setPlan(preview.plan);
      setStatusMessage(preview.summaryMessage);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `Failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  /** Re-reads one target and writes only the planned fields that are still empty. */
  async function applyOneRow(row: BackfillPlanRow, activeFieldConfig: BackfillFieldConfig): Promise<ApplyOutcome> {
    const readFieldIds = [DESCRIPTION_FIELD_ID, activeFieldConfig.acWriteFieldId, ...activeFieldConfig.acReadFieldIds];
    try {
      const freshIssue = await jiraGet<BackfillIssue>(
        `/rest/api/2/issue/${encodeURIComponent(row.targetKey)}?fields=${encodeURIComponent([...new Set(readFieldIds)].join(','))}`,
      );
      const updateFields = buildUpdateFields(row, freshIssue.fields ?? {}, activeFieldConfig);
      const writtenFieldCount = Object.keys(updateFields).length;
      if (writtenFieldCount === 0) {
        return { targetKey: row.targetKey, message: 'Skipped — filled in since the preview', isFailure: false };
      }
      await jiraPut(`/rest/api/2/issue/${encodeURIComponent(row.targetKey)}`, { fields: updateFields });
      return { targetKey: row.targetKey, message: `✓ ${writtenFieldCount} field(s) filled`, isFailure: false };
    } catch (error) {
      return { targetKey: row.targetKey, message: toMessage(error), isFailure: true };
    }
  }

  /** Writes every planned field, one issue at a time, reporting each result as it lands. */
  async function handleApply(): Promise<void> {
    if (!fieldConfig) return;
    setIsBusy(true);
    setStatusMessage('Writing…');
    const collectedOutcomes: Record<string, ApplyOutcome> = {};

    for (const row of plan) {
      const hasPlannedWrite = row.description.action === 'write' || row.acceptanceCriteria.action === 'write';
      if (!hasPlannedWrite) continue;
      collectedOutcomes[row.targetKey] = await applyOneRow(row, fieldConfig);
      setOutcomeByKey({ ...collectedOutcomes });
    }

    const outcomes = Object.values(collectedOutcomes);
    const failureCount = outcomes.filter((outcome) => outcome.isFailure).length;
    setStatusMessage(`Done: ${outcomes.length - failureCount} issues processed, ${failureCount} failed.`);
    setIsBusy(false);
  }

  return (
    <div className={styles.panelCard} data-testid="test-story-backfill-panel">
      <h3 className={styles.sectionTitle}>Backfill [QE] / [SL] description and acceptance criteria</h3>
      <p className={styles.adminDescription}>
        Finds open issues with [QE] or [SL] in the summary and fills an EMPTY Description or Acceptance
        Criteria from, in order: a linked [DEV] issue, a linked Defect, then the parent (sub-task parent,
        else Epic Link). Fields that already have content are never changed. Nothing is written until you
        press Apply.
      </p>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel} htmlFor="test-story-backfill-projects">Project keys (comma-separated)</label>
        <input
          className={styles.inputField}
          id="test-story-backfill-projects"
          onChange={(changeEvent) => setProjectText(changeEvent.target.value)}
          value={projectText}
        />
        <div className={styles.actionRow}>
          <button className={styles.actionButton} disabled={isBusy} onClick={() => void handlePreview()} type="button">
            Preview
          </button>
        </div>
      </div>

      {fieldConfig && (
        <div className={styles.panelSection}>
          <p className={styles.panelStatusLine}>
            Acceptance Criteria field: <strong>{fieldConfig.acWriteFieldId}</strong> · Epic Link field:{' '}
            <strong>{fieldConfig.epicLinkFieldId || 'none'}</strong>
          </p>
          {fieldWarnings.map((warning) => (
            <p className={styles.sectionErrorText} key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {plan.length > 0 && (
        <div className={styles.panelSection}>
          <BackfillPreviewTable outcomeByKey={outcomeByKey} plan={plan} />
          <div className={styles.actionRow}>
            <button
              className={styles.actionButton}
              disabled={isBusy || plannedWriteCount === 0 || hasApplied}
              onClick={() => void handleApply()}
              type="button"
            >
              Apply — fill {plannedWriteCount} empty fields
            </button>
          </div>
        </div>
      )}

      {statusMessage && <p className={styles.panelStatusLine}>{statusMessage}</p>}
    </div>
  );
}
