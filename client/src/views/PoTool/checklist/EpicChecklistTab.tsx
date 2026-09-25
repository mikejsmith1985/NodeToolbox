// EpicChecklistTab.tsx — Validates an Epic against the team's Definition of Ready and Definition of Done, and
// reports what is satisfied, what is only half-there, and what is missing.
//
// The report is the product. A PO asking "is this Epic ready?" needs the reasons, the evidence, and the list of
// things still to write down — something they can paste into a refinement agenda or a Jira comment. Ticking the
// Epic's Smart Checklist is offered afterwards, and only when the checklist is genuinely readable and writable
// on this instance; it is a convenience, not the point.
//
// Nothing here touches the shared checklist template the Epic was created from.

import { useState } from 'react';

import BatchReadinessPanel from './BatchReadinessPanel.tsx';
import PoAiPanel from '../ai/PoAiPanel.tsx';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import { jiraGet } from '../../../services/jiraApi.ts';
import { buildChecklistPrompt, parseChecklistIngest } from './checklistAiAssist.ts';
import {
  fetchChecklistFromIssueProperties,
  fetchEpicChecklistSource,
  fetchRawDescription,
  loadChecklistField,
  saveEpicChecklist,
  saveEpicDescription,
  type EpicChecklistSource,
} from './checklistField.ts';
import { appendReviewToDescription, describeWriteRefusal } from './reviewToDescription.ts';
import { DEFINITION_LABELS, resolveCriteria, type ReadinessCriterion, type ReadinessDefinition } from './dorCriteria.ts';
import { FLAVOUR_LABELS, type ReportFlavour } from './reportMarkup.ts';
import {
  buildReadinessReport,
  describeDefinitionVerdict,
  formatReadinessReport,
  STATUS_LABELS,
  type ReadinessReport,
  type ReportRow,
} from './readinessReport.ts';
import { applyChecklistCompletions, listOpenItems, parseSmartChecklist, type ParsedChecklist } from './smartChecklist.ts';
import styles from './EpicChecklistTab.module.css';

/** How many children to list as evidence. A long Epic's tail says nothing the first thirty do not. */
const MAX_CHILDREN_LISTED = 30;

/** What the screen is working from once an Epic is loaded. */
interface LoadedEpic {
  source: EpicChecklistSource;
  checklist: ParsedChecklist;
  criteria: ReadinessCriterion[];
  criteriaSource: 'issueChecklist' | 'standardTemplate';
  /** The field the checklist text came out of, or null when it could not be found. */
  checklistFieldId: string | null;
  /** What the instance calls the field that was looked for, for saying where Toolbox looked. */
  searchedFieldName: string | null;
  childSummaryLines: string[];
}

/** Reads the Epic's children as evidence lines, and says nothing rather than failing when it cannot. */
async function fetchChildSummaryLines(issueKey: string): Promise<string[]> {
  try {
    const searchResult = await jiraGet<{ issues?: Array<{ key: string; fields: Record<string, unknown> }> }>(
      `/rest/api/2/search?jql=${encodeURIComponent(`parent = ${issueKey} ORDER BY key ASC`)}`
        + `&fields=summary,status&maxResults=${MAX_CHILDREN_LISTED}`,
    );
    return (searchResult.issues ?? []).map((childIssue) => {
      const status = (childIssue.fields.status as { name?: string } | undefined)?.name ?? 'unknown';
      return `  ${childIssue.key} — ${status} — ${String(childIssue.fields.summary ?? '')}`;
    });
  } catch {
    // An instance that will not answer this query is not a reason to refuse the whole review.
    return [];
  }
}

/** Which question is being asked: about one Epic, or about everything a query returns. */
type ReviewMode = 'singleEpic' | 'jqlBatch';

/** The Product Owner's readiness review. */
export default function EpicChecklistTab() {
  const [reviewMode, setReviewMode] = useState<ReviewMode>('singleEpic');
  const [issueKeyInput, setIssueKeyInput] = useState('');
  const [loadedEpic, setLoadedEpic] = useState<LoadedEpic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [criterionIdsToTick, setCriterionIdsToTick] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isWritingToDescription, setIsWritingToDescription] = useState(false);
  const [copiedFlavour, setCopiedFlavour] = useState<ReportFlavour | null>(null);
  // One definition at a time: "ready to start?" and "finished?" are different questions, asked at different
  // moments, and a report answering both leaves the reader to sort out which half they wanted.
  const [checkedDefinition, setCheckedDefinition] = useState<ReadinessDefinition>('dor');

  /** Whether ticking is possible at all: the checklist has to have been found in a writable field. */
  const canTickChecklist = Boolean(loadedEpic?.checklistFieldId) && loadedEpic?.criteriaSource === 'issueChecklist';

  /** Loads the Epic, works out which criteria to judge it against, and clears any previous review. */
  async function handleLoadEpic(): Promise<void> {
    const normalizedIssueKey = issueKeyInput.trim().toUpperCase();
    if (normalizedIssueKey === '') {
      setLoadError('Enter an Epic key, for example DENP-1436.');
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setStatusMessage(null);
    setReport(null);
    setCriterionIdsToTick([]);
    setCopiedFlavour(null);

    try {
      const checklistField = await loadChecklistField();
      const hygieneFieldConfig = await loadHygieneFieldConfig();
      const [acceptanceCriteriaFieldId] = hygieneFieldConfig.acceptanceCriteriaFieldIds;

      const source = await fetchEpicChecklistSource(
        normalizedIssueKey,
        checklistField.fieldId,
        acceptanceCriteriaFieldId ?? null,
      );

      // A checklist that is not on any field may still be in the issue's properties on some versions.
      const checklistText = source.checklistText !== ''
        ? source.checklistText
        : await fetchChecklistFromIssueProperties(normalizedIssueKey);
      const checklist = parseSmartChecklist(checklistText);
      // Only the chosen definition's criteria: never both at once.
      const { criteria: allCriteria, source: criteriaSource } = resolveCriteria(checklist.items);
      const criteria = allCriteria.filter((criterion) => criterion.definition === checkedDefinition);

      setLoadedEpic({
        source,
        checklist,
        criteria,
        criteriaSource,
        checklistFieldId: source.checklistLocation.fieldId,
        searchedFieldName: checklistField.fieldName,
        childSummaryLines: await fetchChildSummaryLines(normalizedIssueKey),
      });
    } catch (unknownError) {
      setLoadedEpic(null);
      setLoadError(unknownError instanceof Error ? unknownError.message : `Could not load ${normalizedIssueKey}.`);
    } finally {
      setIsLoading(false);
    }
  }

  /** Turns the reviewed answer into the report. */
  function handleIngest(responseText: string): { acceptedCount: number; errors: string[] } {
    if (!loadedEpic) {
      return { acceptedCount: 0, errors: ['Load an Epic first.'] };
    }
    const { verdicts, errors } = parseChecklistIngest(responseText, loadedEpic.criteria.map((criterion) => criterion.id));

    const builtReport = buildReadinessReport({
      issueKey: loadedEpic.source.issueKey,
      issueSummary: loadedEpic.source.summary,
      criteria: loadedEpic.criteria,
      verdicts,
      criteriaSource: loadedEpic.criteriaSource,
    });
    setReport(builtReport);
    setCriterionIdsToTick(canTickChecklist ? listTickableCriterionIds(builtReport, loadedEpic.checklist) : []);
    setStatusMessage(null);
    setCopiedFlavour(null);

    return { acceptedCount: verdicts.length, errors };
  }

  /** The satisfied criteria that are also unticked checklist items — the only ones a save could tick. */
  function listTickableCriterionIds(builtReport: ReadinessReport, checklist: ParsedChecklist): string[] {
    const openItemIds = new Set(listOpenItems(checklist).map((item) => item.id));
    return builtReport.rows
      .filter((row) => row.verdict?.status === 'satisfied' && openItemIds.has(row.criterion.id))
      .map((row) => row.criterion.id);
  }

  /** Includes or excludes one proposed tick. The PO's judgement outranks the review. */
  function handleToggleCriterion(criterionId: string): void {
    setCriterionIdsToTick((previousIds) => (
      previousIds.includes(criterionId)
        ? previousIds.filter((selectedId) => selectedId !== criterionId)
        : [...previousIds, criterionId]
    ));
  }

  /** Copies the report in the markup of wherever it is being pasted. */
  async function handleCopyReport(flavour: ReportFlavour): Promise<void> {
    if (!report) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatReadinessReport(report, flavour));
      setCopiedFlavour(flavour);
    } catch {
      // Clipboard access can be denied; the report is on screen and selectable either way.
      setCopiedFlavour(null);
    }
  }

  /** Writes the ticked checklist back in one save, keeping every line it did not tick. */
  async function handleApplyTicks(): Promise<void> {
    if (!loadedEpic?.checklistFieldId || criterionIdsToTick.length === 0) {
      return;
    }
    setIsSaving(true);
    setStatusMessage(null);

    try {
      const updatedChecklistText = applyChecklistCompletions(loadedEpic.checklist, criterionIdsToTick);
      await saveEpicChecklist(loadedEpic.source.issueKey, loadedEpic.checklistFieldId, updatedChecklistText);

      const tickedCount = criterionIdsToTick.length;
      setLoadedEpic({ ...loadedEpic, checklist: parseSmartChecklist(updatedChecklistText) });
      setCriterionIdsToTick([]);
      setStatusMessage(`${tickedCount} checklist item(s) ticked on ${loadedEpic.source.issueKey}.`);
    } catch (unknownError) {
      setStatusMessage(
        unknownError instanceof Error
          ? `Nothing was saved: ${unknownError.message}`
          : 'Nothing was saved. Jira refused the change.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Writes the review onto the end of the Epic's own description.
   *
   * The description is re-read first and written whole, so everything the Epic already said survives and a
   * review written earlier is replaced rather than stacked (GH #387).
   */
  async function handleWriteToDescription(): Promise<void> {
    if (!report || !loadedEpic) {
      return;
    }
    setIsWritingToDescription(true);
    setStatusMessage(null);

    try {
      const currentDescription = await fetchRawDescription(loadedEpic.source.issueKey);
      const reviewHtml = formatReadinessReport(report, 'html');
      const refusal = describeWriteRefusal(currentDescription, reviewHtml);

      if (refusal) {
        setStatusMessage(`Nothing was written. ${refusal}`);
        return;
      }
      await saveEpicDescription(
        loadedEpic.source.issueKey,
        appendReviewToDescription(currentDescription, reviewHtml),
      );
      setStatusMessage(`The review is now at the end of ${loadedEpic.source.issueKey}'s description.`);
    } catch (unknownError) {
      setStatusMessage(
        unknownError instanceof Error
          ? `Nothing was written: ${unknownError.message}`
          : 'Nothing was written. Jira refused the change.',
      );
    } finally {
      setIsWritingToDescription(false);
    }
  }

  /** One criterion in the report: the verdict, the evidence, and what is still needed. */
  function renderReportRow(row: ReportRow) {
    const { criterion, verdict } = row;
    const isTickable = canTickChecklist && verdict?.status === 'satisfied';

    return (
      <li className={styles.reviewRow} key={criterion.id}>
        <div className={styles.reviewRowHeader}>
          {isTickable ? (
            <input
              aria-label={`Tick ${criterion.text}`}
              checked={criterionIdsToTick.includes(criterion.id)}
              onChange={() => handleToggleCriterion(criterion.id)}
              type="checkbox"
            />
          ) : null}
          <span className={verdict ? styles[`status_${verdict.status}`] : styles.status_unanswered}>
            {verdict ? STATUS_LABELS[verdict.status] : 'Not answered'}
          </span>
          <span>{criterion.text}</span>
        </div>
        {verdict?.evidence ? <p className={styles.reviewRowMeta}>{`Evidence: ${verdict.evidence}`}</p> : null}
        {verdict?.whatIsMissing ? (
          <p className={styles.reviewRowMeta}>{`Still needed: ${verdict.whatIsMissing}`}</p>
        ) : null}
      </li>
    );
  }

  /** One definition's section of the report: its verdict line, then its criteria. */
  function renderDefinitionSection(definition: ReadinessDefinition) {
    if (!report) {
      return null;
    }
    const definitionRows = report.rows.filter((row) => row.criterion.definition === definition);
    if (definitionRows.length === 0) {
      return null;
    }

    return (
      <section key={definition}>
        <h4 className={styles.panelTitle}>{DEFINITION_LABELS[definition]}</h4>
        <p className={styles.verdictLine}>{describeDefinitionVerdict(report.totals[definition], definition)}</p>
        <ul className={styles.reviewList}>{definitionRows.map(renderReportRow)}</ul>
      </section>
    );
  }

  return (
    <section className={styles.checklistTab}>
      <h3 className={styles.panelTitle}>Readiness Review</h3>
      <p className={styles.panelHint}>
        Check Epics against the team&apos;s Definition of Ready and Definition of Done. The review says what is
        satisfied, what is only partly there, and what still has to be written down — with the evidence for each.
      </p>

      <div className={styles.modeSwitch} role="group" aria-label="What to review">
        <button
          aria-pressed={reviewMode === 'singleEpic'}
          className={reviewMode === 'singleEpic' ? styles.modeButtonActive : styles.modeButton}
          onClick={() => setReviewMode('singleEpic')}
          type="button"
        >
          One Epic
        </button>
        <button
          aria-pressed={reviewMode === 'jqlBatch'}
          className={reviewMode === 'jqlBatch' ? styles.modeButtonActive : styles.modeButton}
          onClick={() => setReviewMode('jqlBatch')}
          type="button"
        >
          A JQL query
        </button>
      </div>

      {reviewMode === 'jqlBatch' ? <BatchReadinessPanel /> : null}

      {reviewMode === 'singleEpic' ? (
      <div className={styles.loadBar}>
        <label className={styles.loadField}>
          <span className={styles.fieldLabel}>Epic key</span>
          <input
            aria-label="Epic key"
            className={styles.textInput}
            disabled={isLoading}
            onChange={(event) => setIssueKeyInput(event.target.value.toUpperCase())}
            placeholder="DENP-1436"
            value={issueKeyInput}
          />
        </label>
        <label className={styles.loadField}>
          <span className={styles.fieldLabel}>Check</span>
          <select
            aria-label="Which definition to check"
            className={styles.textInput}
            onChange={(event) => setCheckedDefinition(event.target.value as ReadinessDefinition)}
            value={checkedDefinition}
          >
            <option value="dor">{DEFINITION_LABELS.dor}</option>
            <option value="dod">{DEFINITION_LABELS.dod}</option>
          </select>
        </label>
        <button className={styles.primaryButton} disabled={isLoading} onClick={() => void handleLoadEpic()} type="button">
          {isLoading ? 'Loading…' : 'Load Epic'}
        </button>
      </div>
      ) : null}

      {reviewMode === 'singleEpic' && loadError ? <p className={styles.errorBanner} role="alert">{loadError}</p> : null}

      {reviewMode === 'singleEpic' && loadedEpic ? (
        <>
          <div className={styles.epicSummary}>
            <strong>{`${loadedEpic.source.issueKey} — ${loadedEpic.source.summary}`}</strong>
            <span>{`${loadedEpic.criteria.length} ${DEFINITION_LABELS[checkedDefinition]} criteria to check`}</span>
            <span>
              {loadedEpic.criteriaSource === 'issueChecklist'
                ? 'Using this Epic’s own checklist'
                : 'Using the team’s standard Definition of Ready and Done'}
            </span>
          </div>

          {loadedEpic.criteriaSource === 'standardTemplate' ? (
            <p className={styles.panelHint}>
              {`This Epic’s checklist could not be read as text${loadedEpic.searchedFieldName ? ` (looked in “${loadedEpic.searchedFieldName}” and every other field)` : ''}`}
              {' — most likely because it comes from a linked template. The review still runs against the team’s '}
              standard criteria; ticking items in Jira stays manual for this Epic.
            </p>
          ) : null}

          <PoAiPanel
            buildPrompt={() => buildChecklistPrompt(loadedEpic.source, loadedEpic.criteria, loadedEpic.childSummaryLines)}
            helpText={
              'Every criterion comes back with a verdict, the words in the Epic that support it, and what is still '
              + 'needed. Nothing is written to Jira by this panel.'
            }
            onIngest={handleIngest}
            title="Review this Epic against Definition of Ready and Done"
          />

          {report ? (
            <>
              <div className={styles.reportActions}>
                <button
                  className={styles.primaryButton}
                  disabled={isWritingToDescription}
                  onClick={() => void handleWriteToDescription()}
                  type="button"
                >
                  {isWritingToDescription
                    ? 'Writing…'
                    : `Add review to ${loadedEpic.source.issueKey} description`}
                </button>
                {(['jira', 'markdown'] as const).map((flavour) => (
                  <button
                    className={styles.primaryButton}
                    key={flavour}
                    onClick={() => void handleCopyReport(flavour)}
                    type="button"
                  >
                    {copiedFlavour === flavour ? '✓ Copied' : FLAVOUR_LABELS[flavour]}
                  </button>
                ))}
                {canTickChecklist ? (
                  <button
                    className={styles.primaryButton}
                    disabled={criterionIdsToTick.length === 0 || isSaving}
                    onClick={() => void handleApplyTicks()}
                    type="button"
                  >
                    {isSaving ? 'Saving…' : `Tick ${criterionIdsToTick.length} item(s) on ${loadedEpic.source.issueKey}`}
                  </button>
                ) : null}
              </div>
              {renderDefinitionSection('dor')}
              {renderDefinitionSection('dod')}
            </>
          ) : null}

          {statusMessage ? <p className={styles.infoBanner} role="status">{statusMessage}</p> : null}
        </>
      ) : null}
    </section>
  );
}
