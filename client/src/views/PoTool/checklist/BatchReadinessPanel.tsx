// BatchReadinessPanel.tsx — Readiness review across everything a JQL query returns.
//
// The question this answers is the one asked before a planning session rather than during refinement: "of these
// twenty Epics, which are ready, and what is missing from the ones that are not?". So the output is one document
// — a summary table over every Epic, then each Epic's detail — copied out in a single click.
//
// Report only. Ticking checklists in bulk would mean writing to twenty Epics off one reply, which is a great deal
// of trust to place in a single paste; single-Epic mode keeps that action, where the PO is looking at what they
// are about to change.

import { useMemo, useState } from 'react';

import PoAiPanel from '../ai/PoAiPanel.tsx';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import {
  buildBatchReadinessPrompts,
  DEFAULT_MAX_VERDICTS_PER_PART,
  buildBatchReadinessReport,
  buildBatchSummary,
  formatBatchReportMarkdown,
  parseBatchReadinessIngest,
  type BatchEpic,
  type BatchReadinessReport,
} from './batchReadiness.ts';
import { fetchEpicsForReview, MAX_EPICS_PER_REVIEW } from './batchReadinessFetch.ts';
import { loadChecklistField } from './checklistField.ts';
import { DEFAULT_READINESS_CRITERIA, type ReadinessCriterion } from './dorCriteria.ts';
import { describeDefinitionVerdict, STATUS_LABELS, type CriterionVerdict } from './readinessReport.ts';
import styles from './EpicChecklistTab.module.css';

/** The criteria one Epic is judged against, and where they came from. */
type CriteriaByIssueKey = Record<string, { criteria: ReadinessCriterion[]; source: 'issueChecklist' | 'standardTemplate' }>;

/** What the query returned, once loaded. */
interface LoadedBatch {
  jql: string;
  epics: BatchEpic[];
  criteriaByIssueKey: CriteriaByIssueKey;
  /** Every criterion id offered across the batch, for rejecting anything invented. */
  allCriterionIds: string[];
  totalMatching: number;
  wasTruncated: boolean;
}

/** Readiness across a whole query. */
export default function BatchReadinessPanel() {
  const [jqlInput, setJqlInput] = useState('');
  const [loadedBatch, setLoadedBatch] = useState<LoadedBatch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [verdictsByIssueKey, setVerdictsByIssueKey] = useState<Record<string, CriterionVerdict[]>>({});
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [hasCopiedReport, setHasCopiedReport] = useState(false);
  // How many Epics one reply must cover. The binding limit is what the assistant will write in one go, not what
  // it will read, so this is the control that matters when replies come back cut off (GH #387).
  const [epicsPerPrompt, setEpicsPerPrompt] = useState(
    Math.max(1, Math.floor(DEFAULT_MAX_VERDICTS_PER_PART / DEFAULT_READINESS_CRITERIA.length)),
  );

  /**
   * The prompts, packed once per loaded batch.
   *
   * Memoised on the batch rather than rebuilt per render, so ingesting part one's reply cannot re-pack the
   * remaining Epics and make part two's panel move out from under an in-flight review.
   */
  const prompts = useMemo(
    () => (loadedBatch
      ? buildBatchReadinessPrompts(
        loadedBatch.epics,
        DEFAULT_READINESS_CRITERIA,
        epicsPerPrompt * DEFAULT_READINESS_CRITERIA.length,
      )
      : []),
    [loadedBatch, epicsPerPrompt],
  );

  /** The report, rebuilt whenever a reply lands. */
  const batchReport: BatchReadinessReport | null = useMemo(() => {
    if (!loadedBatch) {
      return null;
    }
    return buildBatchReadinessReport({
      jql: loadedBatch.jql,
      epics: loadedBatch.epics,
      criteriaByIssueKey: loadedBatch.criteriaByIssueKey,
      verdictsByIssueKey,
    });
  }, [loadedBatch, verdictsByIssueKey]);

  const summaryRows = batchReport ? buildBatchSummary(batchReport) : [];

  /** Runs the query and works out what each Epic will be judged against. */
  async function handleRunQuery(): Promise<void> {
    const trimmedJql = jqlInput.trim();
    if (trimmedJql === '') {
      setLoadError('Enter a JQL query, for example: project = DENP AND issuetype = Epic AND statusCategory != Done');
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setVerdictsByIssueKey({});
    setExpandedIssueKey(null);
    setHasCopiedReport(false);

    try {
      const checklistField = await loadChecklistField();
      const hygieneFieldConfig = await loadHygieneFieldConfig();
      const [acceptanceCriteriaFieldId] = hygieneFieldConfig.acceptanceCriteriaFieldIds;

      const fetched = await fetchEpicsForReview(
        trimmedJql,
        checklistField.fieldId,
        acceptanceCriteriaFieldId ?? null,
      );

      if (fetched.epics.length === 0) {
        setLoadedBatch(null);
        setLoadError('That query returned no issues.');
        return;
      }

      // Every Epic is judged against the SAME criteria in this mode, deliberately. Each Epic's own checklist
      // words differ slightly, and a summary table comparing twenty Epics against twenty slightly different
      // rubrics compares nothing. Single-Epic mode still prefers that Epic's own checklist.
      const criteriaByIssueKey: CriteriaByIssueKey = Object.fromEntries(fetched.epics.map((epic) => [
        epic.source.issueKey,
        { criteria: [...DEFAULT_READINESS_CRITERIA], source: 'standardTemplate' as const },
      ]));

      setLoadedBatch({
        jql: trimmedJql,
        epics: fetched.epics,
        criteriaByIssueKey,
        allCriterionIds: DEFAULT_READINESS_CRITERIA.map((criterion) => criterion.id),
        totalMatching: fetched.totalMatching,
        wasTruncated: fetched.wasTruncated,
      });
    } catch (unknownError) {
      setLoadedBatch(null);
      setLoadError(unknownError instanceof Error ? unknownError.message : 'That query could not be run.');
    } finally {
      setIsLoading(false);
    }
  }

  /** Reads one part's reply, merging its verdicts into what earlier parts already produced. */
  function handleIngest(responseText: string): { acceptedCount: number; errors: string[] } {
    if (!loadedBatch) {
      return { acceptedCount: 0, errors: ['Run a query first.'] };
    }
    const { verdictsByIssueKey: partVerdicts, errors } = parseBatchReadinessIngest(
      responseText,
      loadedBatch.epics.map((epic) => epic.source.issueKey),
      loadedBatch.allCriterionIds,
    );

    setVerdictsByIssueKey((previousVerdicts) => ({ ...previousVerdicts, ...partVerdicts }));
    setHasCopiedReport(false);

    return { acceptedCount: Object.values(partVerdicts).flat().length, errors };
  }

  /** Copies the whole review as one markdown document. */
  async function handleCopyReport(): Promise<void> {
    if (!batchReport) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatBatchReportMarkdown(batchReport));
      setHasCopiedReport(true);
    } catch {
      // Clipboard access can be denied; the report is on screen and selectable either way.
      setHasCopiedReport(false);
    }
  }

  /** One Epic's detail, shown when its summary row is opened. */
  function renderEpicDetail(issueKey: string) {
    const report = batchReport?.reports.find((candidate) => candidate.issueKey === issueKey);
    if (!report) {
      return null;
    }

    return (
      <ul className={styles.reviewList}>
        {report.rows.map((row) => (
          <li className={styles.reviewRow} key={row.criterion.id}>
            <div className={styles.reviewRowHeader}>
              <span className={row.verdict ? styles[`status_${row.verdict.status}`] : styles.status_unanswered}>
                {row.verdict ? STATUS_LABELS[row.verdict.status] : 'Not answered'}
              </span>
              <span>{row.criterion.text}</span>
            </div>
            {row.verdict?.evidence ? <p className={styles.reviewRowMeta}>{`Evidence: ${row.verdict.evidence}`}</p> : null}
            {row.verdict?.whatIsMissing ? (
              <p className={styles.reviewRowMeta}>{`Still needed: ${row.verdict.whatIsMissing}`}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={styles.checklistTab}>
      <p className={styles.panelHint}>
        Review every Epic a query returns. The result is one document: a table of where each Epic stands, then each
        Epic&apos;s criteria with the evidence and what is still needed. Checklists are not changed in this mode.
      </p>

      <div className={styles.loadBar}>
        <label className={`${styles.loadField} ${styles.jqlField}`}>
          <span className={styles.fieldLabel}>JQL</span>
          <input
            aria-label="JQL query"
            className={styles.textInput}
            disabled={isLoading}
            onChange={(event) => setJqlInput(event.target.value)}
            placeholder="project = DENP AND issuetype = Epic AND statusCategory != Done"
            value={jqlInput}
          />
        </label>
        <label className={styles.loadField}>
          <span className={styles.fieldLabel}>Epics per prompt</span>
          <select
            aria-label="Epics per prompt"
            className={styles.textInput}
            onChange={(event) => setEpicsPerPrompt(Number(event.target.value))}
            value={epicsPerPrompt}
          >
            {[1, 2, 3, 5].map((epicCount) => (
              <option key={epicCount} value={epicCount}>
                {`${epicCount} (${epicCount * DEFAULT_READINESS_CRITERIA.length} answers per reply)`}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.primaryButton} disabled={isLoading} onClick={() => void handleRunQuery()} type="button">
          {isLoading ? 'Running…' : 'Run query'}
        </button>
      </div>

      {loadError ? <p className={styles.errorBanner} role="alert">{loadError}</p> : null}

      {loadedBatch ? (
        <>
          <div className={styles.epicSummary}>
            <strong>{`${loadedBatch.epics.length} Epic(s) to review`}</strong>
            {loadedBatch.wasTruncated ? (
              <span>{`The query matched ${loadedBatch.totalMatching}; the first ${MAX_EPICS_PER_REVIEW} are reviewed. Narrow the query to cover the rest.`}</span>
            ) : null}
          </div>

          {prompts.length > 1 ? (
            <p className={styles.panelHint}>
              {`This batch is split into ${prompts.length} parts, each asking for `}
              {`${epicsPerPrompt * DEFAULT_READINESS_CRITERIA.length} answers. Run each part and paste every reply `}
              back — an Epic whose part was never pasted is reported as not reviewed. If a reply still comes back
              cut off, lower &quot;Epics per prompt&quot; and run the parts again.
            </p>
          ) : null}

          {prompts.map((promptText, partIndex) => (
            <PoAiPanel
              buildPrompt={() => promptText}
              helpText={
                'Every Epic comes back with a verdict per criterion, the words that support it, and what is still '
                + 'needed. Nothing is written to Jira in this mode.'
              }
              key={`readiness-part-${partIndex}`}
              onIngest={handleIngest}
              title={prompts.length === 1
                ? 'Review these Epics against Definition of Ready and Done'
                : `Review these Epics — part ${partIndex + 1} of ${prompts.length}`}
            />
          ))}

          {summaryRows.length > 0 ? (
            <>
              <div className={styles.reportActions}>
                <button className={styles.primaryButton} onClick={() => void handleCopyReport()} type="button">
                  {hasCopiedReport ? '✓ Copied' : 'Copy full report'}
                </button>
              </div>

              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th scope="col">Epic</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Definition of Ready</th>
                    <th scope="col">Definition of Done</th>
                    <th scope="col">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((summaryRow) => (
                    <tr key={summaryRow.issueKey}>
                      <td>
                        <button
                          className={styles.linkButton}
                          onClick={() => setExpandedIssueKey(
                            expandedIssueKey === summaryRow.issueKey ? null : summaryRow.issueKey,
                          )}
                          type="button"
                        >
                          {summaryRow.issueKey}
                        </button>
                      </td>
                      <td>{summaryRow.issueSummary}</td>
                      <td>{summaryRow.dorVerdict}</td>
                      <td>{summaryRow.dodVerdict}</td>
                      <td>{summaryRow.outstandingCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {expandedIssueKey && batchReport ? (
                <section>
                  <h4 className={styles.panelTitle}>{expandedIssueKey}</h4>
                  {(['dor', 'dod'] as const).map((definition) => {
                    const report = batchReport.reports.find((candidate) => candidate.issueKey === expandedIssueKey);
                    if (!report || report.totals[definition].total === 0) {
                      return null;
                    }
                    return (
                      <p className={styles.verdictLine} key={definition}>
                        {describeDefinitionVerdict(report.totals[definition], definition)}
                      </p>
                    );
                  })}
                  {renderEpicDetail(expandedIssueKey)}
                </section>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
