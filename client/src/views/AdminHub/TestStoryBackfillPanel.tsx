// TestStoryBackfillPanel.tsx — Admin Hub clean-up that fills empty Description / Acceptance Criteria on open
// [QE] and [SL] issues from the [DEV] story, linked Defect, or parent they were made from.
//
// A Jira automation created these test issues without cloning the description and acceptance criteria.
// This panel previews every planned field write first, writes only when Apply is pressed, re-reads each
// issue immediately before writing it, and never overwrites a field that already has content.

import React, { useState } from 'react';

import { fetchIssuesPaged } from '../../services/fetchIssuesPaged.ts';
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

// ── Named constants ──

/** Issues requested per search page. */
const SEARCH_PAGE_SIZE = 100;
/** The most targets one run will hold; well above the expected backlog, low enough to stay responsive. */
const MAX_TARGETS_PER_RUN = 2000;
/** Keys per `key in (…)` source lookup, kept short so the JQL stays well under URL length limits. */
const SOURCE_KEY_BATCH_SIZE = 50;
/** Fields every target search needs besides the instance-specific ones. */
const BASE_TARGET_FIELDS = ['summary', 'status', 'issuelinks', 'parent', DESCRIPTION_FIELD_ID];

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

/** Runs a search page by page and returns every issue it found. */
async function searchAllIssues(jql: string, fieldIds: readonly string[]): Promise<BackfillIssue[]> {
  const fieldsParam = encodeURIComponent([...new Set(fieldIds)].filter(Boolean).join(','));
  const outcome = await fetchIssuesPaged<BackfillIssue>(
    (startAt, pageSize) => jiraGet<{ issues?: BackfillIssue[]; total?: number }>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldsParam}&startAt=${startAt}&maxResults=${pageSize}`,
    ),
    { pageSize: SEARCH_PAGE_SIZE, ceiling: MAX_TARGETS_PER_RUN },
  );
  return outcome.issues;
}

/** Fetches every candidate source issue in small `key in (…)` batches. */
async function fetchSourceIssues(sourceKeys: readonly string[], fieldIds: readonly string[]): Promise<BackfillIssue[]> {
  const sourceIssues: BackfillIssue[] = [];
  for (let i = 0; i < sourceKeys.length; i += SOURCE_KEY_BATCH_SIZE) {
    const keyBatch = sourceKeys.slice(i, i + SOURCE_KEY_BATCH_SIZE);
    sourceIssues.push(...await searchAllIssues(`key in (${keyBatch.join(',')})`, fieldIds));
  }
  return sourceIssues;
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
      const loaded = await loadFieldConfig();
      const acFieldIds = [loaded.fieldConfig.acWriteFieldId, ...loaded.fieldConfig.acReadFieldIds];
      const searchHits = await searchAllIssues(
        buildTargetSearchJql(projectKeys),
        [...BASE_TARGET_FIELDS, ...acFieldIds, loaded.fieldConfig.epicLinkFieldId],
      );
      const targets = searchHits.filter((issue) => isBackfillTargetSummary(issue.fields.summary));
      const sourceKeys = collectSourceKeys(
        targets.map((target) => buildSourceTiers(target, loaded.fieldConfig.epicLinkFieldId)),
      );
      const sources = await fetchSourceIssues(sourceKeys, ['summary', DESCRIPTION_FIELD_ID, ...acFieldIds]);
      const nextPlan = buildBackfillPlan(targets, sources, loaded.fieldConfig);

      setFieldConfig(loaded.fieldConfig);
      setFieldWarnings(loaded.warnings);
      setPlan(nextPlan);
      setStatusMessage(
        `${targets.length} open [QE]/[SL] issues found in ${projectKeys.join(', ')}; `
        + `${countPlannedWrites(nextPlan)} empty fields can be filled.`,
      );
    } catch (error) {
      setStatusMessage(`Failed: ${toMessage(error)}`);
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
