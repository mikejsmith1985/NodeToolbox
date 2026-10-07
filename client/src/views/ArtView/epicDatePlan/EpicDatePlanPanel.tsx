// EpicDatePlanPanel.tsx — Plans each PI Epic's Target Start and Target End from its points and the team's capacity.
//
// The page's Epics, in page order (or an order AI Assist proposed), are run through the date rule: the team's
// 80% capacity per working day, shared by up to N Epics at once. Each proposed date pair is shown beside what
// Jira holds now; only the rows the Product Owner accepts are written to Jira.

import { useMemo, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';
import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx';
import type { CapacitySummary } from '../../SprintDashboard/capacityModel.ts';
import { extractPiReviewFeatureKey, readPiReviewTargetDates, type PiReviewFeatureDateUpdate } from '../piReviewJira.ts';
import type { PiReviewRow } from '../piReviewTable.ts';
import styles from '../PiReviewTab.module.css';
import { buildEpicsToSchedule } from './epicDatePlanInputs.ts';
import { readDailyCapacityPoints, scheduleEpicDates, type EpicDateProposal, type EpicToSchedule } from './epicDateSchedule.ts';
import { buildEpicOrderPrompt, parseEpicOrderReply } from './epicOrderAiAssist.ts';

interface EpicDatePlanPanelProps {
  rows: readonly PiReviewRow[];
  jiraIssueMap: Readonly<Record<string, JiraIssue>>;
  piName: string;
  /** The PI's first and last day; null when the PI's dates are not known. */
  piWindow: { startIso: string; endIso: string } | null;
  capacitySummary: CapacitySummary | null;
  /** Today as 'YYYY-MM-DD' — injected so a plan is reproducible. */
  todayIso: string;
  onWriteDates: (dateUpdates: PiReviewFeatureDateUpdate[]) => Promise<void>;
}

const DEFAULT_PARALLEL_EPICS = 3;
const MIN_PARALLEL_EPICS = 1;
const MAX_PARALLEL_EPICS = 10;
const WEEKENDS_ONLY_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };
const NOTE_BY_STATUS: Readonly<Record<EpicDateProposal['status'], string>> = {
  scheduled: '',
  'no-points': 'No point estimate — give it points to plan it.',
  'no-capacity': 'No team capacity to plan with.',
  'beyond-horizon': 'Does not finish within a year at this capacity.',
};

/** "1 Epic's", "3 Epics'". */
function describeEpicCount(count: number): string {
  return count === 1 ? '1 Epic\'s' : `${count} Epics'`;
}

/** The Epics in the AI-proposed order when there is one, otherwise in page order. */
function applyOrder(epics: readonly EpicToSchedule[], order: readonly string[] | null): EpicToSchedule[] {
  if (order === null) {
    return [...epics];
  }
  const epicByKey = new Map(epics.map((epic) => [epic.epicKey, epic]));
  const orderedEpics = order.map((epicKey) => epicByKey.get(epicKey)).filter((epic): epic is EpicToSchedule => epic !== undefined);
  return [...orderedEpics, ...epics.filter((epic) => !order.includes(epic.epicKey))];
}

/** Each Epic's Dependency and Risks cells, so the order proposal can respect what blocks what. */
function buildDependencyTextByKey(rows: readonly PiReviewRow[]): Record<string, string> {
  const dependencyTextByKey: Record<string, string> = {};
  rows.forEach((row) => {
    const epicKey = extractPiReviewFeatureKey(row.feature);
    if (epicKey !== null) dependencyTextByKey[epicKey] = [row.dependency, row.risks].filter((text) => text.trim() !== '').join('; ');
  });
  return dependencyTextByKey;
}

/** True when a proposal would actually change what Jira holds. */
function isChange(proposal: EpicDateProposal, currentDates: { targetStart: string | null; targetEnd: string | null }): boolean {
  return proposal.status === 'scheduled'
    && (proposal.targetStart !== currentDates.targetStart || proposal.targetEnd !== currentDates.targetEnd);
}

/** One Epic's row: what Jira holds, what the plan proposes, and whether to write it. */
function ProposalRow({ proposal, currentDates, note, isAccepted, isWritten, onToggle }: {
  proposal: EpicDateProposal;
  currentDates: { targetStart: string | null; targetEnd: string | null };
  note: string;
  isAccepted: boolean;
  isWritten: boolean;
  onToggle: () => void;
}) {
  const canAccept = isChange(proposal, currentDates) && !isWritten;
  return (
    <tr>
      <td>{`${proposal.epicKey} — ${proposal.summary}`}</td>
      <td>{proposal.points ?? '—'}</td>
      <td>{`${currentDates.targetStart ?? '—'} → ${currentDates.targetEnd ?? '—'}`}</td>
      <td data-testid="proposed-start">{proposal.targetStart ?? '—'}</td>
      <td data-testid="proposed-end">{proposal.targetEnd ?? '—'}</td>
      <td>{[note, proposal.isPastPiEnd ? '⚠ Lands in INT after the PI ends.' : ''].filter(Boolean).join(' ')}</td>
      <td>
        {isWritten ? '✓ Written' : (
          <input aria-label={`Accept dates for ${proposal.epicKey}`} checked={isAccepted} disabled={!canAccept} onChange={onToggle} type="checkbox" />
        )}
      </td>
    </tr>
  );
}

/** Plans the PI's Epic dates, lets AI Assist propose the order, and writes the accepted dates to Jira. */
export function EpicDatePlanPanel({ rows, jiraIssueMap, piName, piWindow, capacitySummary, todayIso, onWriteDates }: EpicDatePlanPanelProps) {
  const [maxParallelEpics, setMaxParallelEpics] = useState(DEFAULT_PARALLEL_EPICS);
  const [aiOrder, setAiOrder] = useState<string[] | null>(null);
  const [rationaleByKey, setRationaleByKey] = useState<Record<string, string>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set());
  const [writtenKeys, setWrittenKeys] = useState<Set<string>>(new Set());
  const [isWriting, setIsWriting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const piStart = piWindow?.startIso ?? capacitySummary?.startDate ?? '';
  const piEnd = piWindow?.endIso ?? capacitySummary?.endDate ?? '';
  const dailyCapacityPoints = capacitySummary ? readDailyCapacityPoints(capacitySummary.recommendedCapacityPoints, capacitySummary.workDayCount) : 0;
  const epics = useMemo(() => buildEpicsToSchedule(rows, jiraIssueMap), [rows, jiraIssueMap]);
  const orderedEpics = useMemo(() => applyOrder(epics, aiOrder), [epics, aiOrder]);
  const proposals = useMemo(() => scheduleEpicDates(orderedEpics, {
    piStartDate: piStart, piEndDate: piEnd, today: todayIso, dailyCapacityPoints, maxParallelEpics, calendar: WEEKENDS_ONLY_CALENDAR,
  }), [orderedEpics, piStart, piEnd, todayIso, dailyCapacityPoints, maxParallelEpics]);

  if (capacitySummary === null || dailyCapacityPoints <= 0 || piStart === '') {
    return (
      <section className={styles.capacityPanel} data-export-exclude="true">
        <h4 className={styles.sectionHeader}>📅 Plan Epic dates</h4>
        <p className={styles.summaryValue}>Planning Epic dates needs the Team Capacity for this PI — set it above, then come back.</p>
      </section>
    );
  }

  const handleIngestOrder = (replyText: string) => {
    try {
      const orderReply = parseEpicOrderReply(replyText, epics.map((epic) => epic.epicKey));
      setAiOrder(orderReply.order);
      setRationaleByKey(orderReply.rationaleByKey);
      if (orderReply.maxParallelEpics !== null) setMaxParallelEpics(orderReply.maxParallelEpics);
      setAcceptedKeys(new Set());
      setAiError(orderReply.rejectedKeys.length > 0 ? `Ignored keys not on this page: ${orderReply.rejectedKeys.join(', ')}.` : null);
    } catch (parseError) {
      setAiError(parseError instanceof Error ? parseError.message : 'The pasted order could not be read.');
    }
  };

  const handleToggle = (epicKey: string) => setAcceptedKeys((currentKeys) => {
    const nextKeys = new Set(currentKeys);
    if (nextKeys.has(epicKey)) nextKeys.delete(epicKey); else nextKeys.add(epicKey);
    return nextKeys;
  });

  const handleWrite = async () => {
    const dateUpdates = proposals
      .filter((proposal) => acceptedKeys.has(proposal.epicKey))
      .map((proposal) => ({ featureKey: proposal.epicKey, targetStart: proposal.targetStart, targetEnd: proposal.targetEnd, dueDate: null }));
    setIsWriting(true);
    setErrorMessage('');
    try {
      await onWriteDates(dateUpdates);
      setWrittenKeys((currentKeys) => new Set([...currentKeys, ...dateUpdates.map((update) => update.featureKey)]));
      setAcceptedKeys(new Set());
      setStatusMessage(`Wrote dates for ${dateUpdates.length} Epic${dateUpdates.length === 1 ? '' : 's'} to Jira.`);
    } catch (writeError) {
      setErrorMessage(writeError instanceof Error ? writeError.message : 'Jira did not accept the dates.');
    } finally {
      setIsWriting(false);
    }
  };

  return (
    <section className={styles.capacityPanel} data-export-exclude="true">
      <h4 className={styles.sectionHeader}>📅 Plan Epic dates</h4>
      <p className={styles.summaryValue}>
        {`The team delivers ${dailyCapacityPoints.toFixed(1)} points per working day (80% capacity, ${capacitySummary.recommendedCapacityPoints} points over `
          + `${capacitySummary.workDayCount} work days). Target Start is when development starts — on or after ${piStart} unless the Epic is already `
          + 'in progress; Target End is the day after development completes, when the code moves to INT.'}
      </p>
      <div className={styles.toolbar}>
        <label className={styles.summaryLabel} htmlFor="epic-date-plan-parallel">Epics worked at once</label>
        <input
          className={styles.confidenceVoteNumberInput}
          id="epic-date-plan-parallel"
          max={MAX_PARALLEL_EPICS}
          min={MIN_PARALLEL_EPICS}
          onChange={(changeEvent) => setMaxParallelEpics(Math.min(MAX_PARALLEL_EPICS, Math.max(MIN_PARALLEL_EPICS, Number(changeEvent.target.value) || MIN_PARALLEL_EPICS)))}
          type="number"
          value={maxParallelEpics}
        />
        {aiOrder !== null ? (
          <button className={`${styles.actionButton} ${styles.actionButtonSecondary}`} onClick={() => { setAiOrder(null); setRationaleByKey({}); }} type="button">
            Use page order
          </button>
        ) : null}
      </div>
      <ReportAiPanel
        error={aiError}
        hint="AI Assist proposes only the order and how many Epics run at once — Toolbox calculates every date."
        ingestLabel="Use this order"
        onIngest={handleIngestOrder}
        prompt={buildEpicOrderPrompt(orderedEpics, {
          piName, piStartDate: piStart, piEndDate: piEnd, dailyCapacityPoints, maxParallelEpics,
          dependencyTextByKey: buildDependencyTextByKey(rows),
        })}
        title="Propose the Epic order"
      />
      <div className={styles.tableShell}>
        <table className={styles.dataTable}>
          <thead>
            <tr><th>Epic</th><th>Points</th><th>Jira now (Start → End)</th><th>Target Start</th><th>Target End (INT)</th><th>Notes</th><th>Accept</th></tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <ProposalRow
                currentDates={readPiReviewTargetDates(jiraIssueMap[proposal.epicKey])}
                isAccepted={acceptedKeys.has(proposal.epicKey)}
                isWritten={writtenKeys.has(proposal.epicKey)}
                key={proposal.epicKey}
                note={[NOTE_BY_STATUS[proposal.status], rationaleByKey[proposal.epicKey] ?? ''].filter(Boolean).join(' ')}
                onToggle={() => handleToggle(proposal.epicKey)}
                proposal={proposal}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.toolbar}>
        <button
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          disabled={acceptedKeys.size === 0 || isWriting}
          onClick={() => void handleWrite()}
          type="button"
        >
          {isWriting ? 'Writing…' : `Write ${describeEpicCount(acceptedKeys.size)} dates to Jira`}
        </button>
      </div>
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
      {statusMessage ? <p className={styles.summaryValue} role="status">{statusMessage}</p> : null}
    </section>
  );
}
