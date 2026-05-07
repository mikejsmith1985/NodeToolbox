// MetricsView.tsx — Standalone Jira delivery metrics dashboard.
//
// The view exposes the ported ToolBox Metrics workflow at a route-ready component
// without depending on legacy globals or application shell state.

import { useMetricsState, type ThroughputPoint, type UseMetricsState } from './hooks/useMetricsState.ts';
import type { PredictabilityPoint } from './utils/predictability.ts';
import styles from './MetricsView.module.css';

const VIEW_TITLE = 'Metrics';
const VIEW_SUBTITLE = 'Inspect sprint predictability, throughput, and simplified cycle time from Jira.';
const EMPTY_STATE_MESSAGE = 'Enter a numeric board ID, then load Metrics to analyze recent delivery.';
const KANBAN_PREDICTABILITY_MESSAGE = 'Predictability requires sprint commitment data — not applicable for Kanban boards.';
const CYCLE_TIME_DEFERRAL_MESSAGE = 'Cycle time uses created-to-resolution dates; full changelog parsing is deferred.';
const TARGET_COMPLETION_PERCENT = 80;
const DEFAULT_BAR_WIDTH_PERCENT = 0;
const MAX_BAR_WIDTH_PERCENT = 100;
const ONE_DECIMAL_PLACE = 1;

/** Renders the standalone Metrics dashboard and delegates Jira work to `useMetricsState`. */
export default function MetricsView() {
  const metricsState = useMetricsState();
  const hasBoardId = metricsState.boardId.trim().length > 0;
  const shouldShowEmptyState = !metricsState.isLoading && !hasBoardId;
  const shouldShowKanbanMessage = metricsState.boardType === 'kanban';

  return (
    <section className={styles.metricsView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      {renderControls(metricsState)}
      {metricsState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {metricsState.errorMessage}
        </p>
      )}
      {shouldShowEmptyState && <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>}
      {metricsState.isLoading && <div className={styles.emptyState}>Loading Metrics results…</div>}
      {shouldShowKanbanMessage && <div className={styles.infoMessage}>{KANBAN_PREDICTABILITY_MESSAGE}</div>}

      <div className={styles.metricsGrid} aria-label="Metrics result cards">
        {renderPredictabilityCard(metricsState.predictability, metricsState.averageCompletionPct)}
        {renderThroughputCard(metricsState.throughput)}
        {renderCycleTimeCard(metricsState)}
      </div>
    </section>
  );
}

function renderControls(metricsState: UseMetricsState) {
  return (
    <div className={styles.controlsPanel}>
      <label className={styles.fieldLabel}>
        Board ID
        <input
          className={styles.textInput}
          aria-label="Board ID"
          inputMode="numeric"
          placeholder="42"
          value={metricsState.boardId}
          onChange={(changeEvent) => metricsState.setBoardId(changeEvent.target.value)}
        />
      </label>
      <label className={styles.fieldLabel}>
        Project key
        <input
          className={styles.textInput}
          aria-label="Project key"
          placeholder="TBX"
          value={metricsState.projectKey}
          onChange={(changeEvent) => metricsState.setProjectKey(changeEvent.target.value)}
        />
      </label>
      <label className={styles.fieldLabel}>
        Sprint window
        <input
          className={styles.textInput}
          aria-label="Sprint window"
          type="number"
          min={1}
          value={metricsState.sprintWindow}
          onChange={(changeEvent) => metricsState.setSprintWindow(Number(changeEvent.target.value))}
        />
      </label>
      <button
        type="button"
        className={styles.buttonPrimary}
        disabled={metricsState.isLoading || !metricsState.boardId.trim()}
        onClick={() => {
          void metricsState.reload();
        }}
      >
        {metricsState.isLoading ? 'Loading…' : 'Load Metrics'}
      </button>
    </div>
  );
}

function renderPredictabilityCard(predictability: PredictabilityPoint[], averageCompletionPct: number) {
  return (
    <article className={styles.metricCard} aria-label="Predictability">
      <header className={styles.cardHeader}>
        <div>
          <h2>Predictability</h2>
          <p>Average completion: {averageCompletionPct}%</p>
        </div>
        <span className={styles.targetBadge}>{TARGET_COMPLETION_PERCENT}% target</span>
      </header>
      {predictability.length === DEFAULT_BAR_WIDTH_PERCENT ? (
        <p className={styles.cardEmpty}>No sprint commitment data loaded.</p>
      ) : (
        <div className={styles.barList}>{predictability.map(renderPredictabilityBar)}</div>
      )}
    </article>
  );
}

function renderPredictabilityBar(predictabilityPoint: PredictabilityPoint) {
  const barWidthPercent = Math.min(MAX_BAR_WIDTH_PERCENT, Math.max(DEFAULT_BAR_WIDTH_PERCENT, predictabilityPoint.completionPct));
  return (
    <div key={predictabilityPoint.sprintId} className={styles.barRow}>
      <div className={styles.barLabel}>
        <span>{predictabilityPoint.sprintName}</span>
        <strong>{predictabilityPoint.completionPct}%</strong>
      </div>
      <div className={styles.barTrack} aria-label={`${predictabilityPoint.sprintName} completion ${predictabilityPoint.completionPct}%`}>
        <div className={styles.barFill} style={{ width: `${barWidthPercent}%` }} />
        <div className={styles.targetLine} style={{ left: `${TARGET_COMPLETION_PERCENT}%` }} />
      </div>
      <small>
        {predictabilityPoint.completedPoints}/{predictabilityPoint.committedPoints} pts · {predictabilityPoint.completedItems}/
        {predictabilityPoint.committedItems} items
      </small>
    </div>
  );
}

function renderThroughputCard(throughput: ThroughputPoint[]) {
  return (
    <article className={styles.metricCard} aria-label="Throughput">
      <header className={styles.cardHeader}>
        <div>
          <h2>Throughput</h2>
          <p>Completed issues per closed sprint.</p>
        </div>
      </header>
      {throughput.length === DEFAULT_BAR_WIDTH_PERCENT ? (
        <p className={styles.cardEmpty}>No throughput data loaded.</p>
      ) : (
        <ul className={styles.throughputList}>{throughput.map(renderThroughputItem)}</ul>
      )}
    </article>
  );
}

function renderThroughputItem(throughputPoint: ThroughputPoint) {
  return (
    <li key={throughputPoint.sprintId} className={styles.throughputItem}>
      <span>{throughputPoint.sprintName}</span>
      <strong>{throughputPoint.completedIssues} issues</strong>
      <em>{throughputPoint.completedPoints} pts</em>
    </li>
  );
}

function renderCycleTimeCard(metricsState: UseMetricsState) {
  return (
    <article className={styles.metricCard} aria-label="Cycle time">
      <header className={styles.cardHeader}>
        <div>
          <h2>Cycle time</h2>
          <p>{CYCLE_TIME_DEFERRAL_MESSAGE}</p>
        </div>
      </header>
      {metricsState.cycleTime ? renderCycleTimeStats(metricsState.cycleTime) : <p className={styles.cardEmpty}>Enter a project key to load cycle time.</p>}
    </article>
  );
}

function renderCycleTimeStats(cycleTime: NonNullable<UseMetricsState['cycleTime']>) {
  return (
    <dl className={styles.statsGrid}>
      <div>
        <dt>Median</dt>
        <dd>{cycleTime.medianDays.toFixed(ONE_DECIMAL_PLACE)}d</dd>
      </div>
      <div>
        <dt>P90</dt>
        <dd>{cycleTime.p90Days.toFixed(ONE_DECIMAL_PLACE)}d</dd>
      </div>
      <div>
        <dt>Mean</dt>
        <dd>{cycleTime.meanDays.toFixed(ONE_DECIMAL_PLACE)}d</dd>
      </div>
      <div>
        <dt>Sample</dt>
        <dd>{cycleTime.sampleCount}</dd>
      </div>
    </dl>
  );
}
