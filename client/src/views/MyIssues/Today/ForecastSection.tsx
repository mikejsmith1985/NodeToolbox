// ForecastSection.tsx — The Today panel that answers "what has to start today?"
//
// Every issue the scans returned falls into exactly one group, and the groups are ordered by what
// needs a decision this morning: things that are late or due to start, then things that cannot be
// recovered, then the good news, then everything that is simply fine.
//
// The last three groups are the honest ones. Work nobody sized, work nobody owns and work with no
// deadline at all are not quietly folded into "on track" — they are listed under their own headings
// with the reason, because each needs a different fix and none of them is progress.

import type { IssueForecast, IssueForecastState, ForecastResult } from '../../SprintDashboard/forecast/forecastTypes.ts';
import styles from './ForecastSection.module.css';

/** One group of the forecast, in the order a Scrum Master needs to read them. */
interface ForecastGroup {
  state: IssueForecastState;
  label: string;
  icon: string;
  /** True for the groups that describe a problem, so they can carry the alert tone. */
  isAlert: boolean;
}

/**
 * The groups, in reading order.
 *
 * `on-track` is deliberately LAST and collapsed by weight rather than hidden: a reader scanning for
 * problems should not have to scroll past the work that is fine, but a panel that showed only
 * problems would give no sense of how much of the board they represent.
 */
const FORECAST_GROUPS: readonly ForecastGroup[] = [
  { state: 'behind', label: 'Behind — should already have started', icon: '🔴', isAlert: true },
  { state: 'start-today', label: 'Must start today', icon: '🟠', isAlert: true },
  { state: 'cannot-fit', label: 'Deadline already passed', icon: '⛔', isAlert: true },
  { state: 'ahead', label: 'Ahead of schedule', icon: '🟢', isAlert: false },
  { state: 'on-track', label: 'On track', icon: '⚪', isAlert: false },
  { state: 'unsized', label: 'Unsized — cannot be forecast', icon: '📏', isAlert: false },
  { state: 'unassignable', label: 'No owner — cannot be forecast', icon: '👤', isAlert: false },
  { state: 'unforecastable', label: 'No deadline — cannot be forecast', icon: '📅', isAlert: false },
];

const PANEL_TITLE = 'Daily forecast';
const EMPTY_MESSAGE = 'Nothing has to start today.';
const NOT_READY_MESSAGE = 'The forecast runs once the team scans have loaded.';

export interface ForecastSectionProps {
  /**
   * The computed forecast, or null before the scans land.
   *
   * Optional as well as nullable: a caller that predates this panel supplies neither, and an
   * absent forecast has to read as "not yet" rather than crash the whole Today dashboard on the
   * one screen a Scrum Master opens first.
   */
  forecast?: ForecastResult | null;
  /** Team display names by profile id, so a two-team view can attribute every row. */
  teamNamesByProfileId?: Record<string, string>;
}

/** Formats the slack as a phrase, or nothing when there is no start date to be slack against. */
function describeSlack(forecast: IssueForecast): string {
  if (forecast.slackWorkingDays === null) {
    return '';
  }
  if (forecast.slackWorkingDays === 0) {
    return 'no slack left';
  }
  const dayCount = Math.abs(forecast.slackWorkingDays);
  const dayWord = dayCount === 1 ? 'day' : 'days';
  return forecast.slackWorkingDays > 0
    ? `${dayCount} working ${dayWord} of slack`
    : `${dayCount} working ${dayWord} late`;
}

/** Names how many of the inputs could not be measured, so no total reads as more complete than it is. */
function describeCompleteness(forecast: ForecastResult): string {
  const { completeness } = forecast;
  const caveats = [
    completeness.unsizedIssueCount > 0 ? `${completeness.unsizedIssueCount} unsized` : null,
    completeness.unassignedIssueCount > 0 ? `${completeness.unassignedIssueCount} unassigned` : null,
    completeness.undatedVersionCount > 0 ? `${completeness.undatedVersionCount} undated fix versions` : null,
    completeness.cancelledIssueCount > 0 ? `${completeness.cancelledIssueCount} cancelled` : null,
  ].filter((caveat): caveat is string => caveat !== null);

  const scanned = `${completeness.totalIssueCount} issues scanned`;
  return caveats.length === 0 ? scanned : `${scanned} · ${caveats.join(' · ')}`;
}

/** One issue row: what it is, whose it is, when it must start, and why. */
function ForecastRow({ forecast, teamName }: { forecast: IssueForecast; teamName: string | null }) {
  return (
    <li className={styles.forecastRow}>
      <div className={styles.rowHeadline}>
        <span className={styles.issueKey}>{forecast.issueKey}</span>
        <span className={styles.issueSummary}>{forecast.summary}</span>
      </div>
      <div className={styles.rowMeta}>
        {teamName !== null && <span className={styles.metaChip}>{teamName}</span>}
        <span className={styles.metaChip}>{forecast.assigneeDisplayName ?? 'Unassigned'}</span>
        {forecast.latestStartIso !== null && (
          <span className={styles.metaChip}>Start by {forecast.latestStartIso}</span>
        )}
        {describeSlack(forecast) !== '' && (
          <span className={styles.metaChip}>{describeSlack(forecast)}</span>
        )}
        {forecast.hasStoredDateDisagreement && (
          // Reported, never corrected: changing a date is the operator's explicit action, and a
          // silent overwrite of somebody's deliberate value is worse than a visible disagreement.
          <span className={styles.metaChipWarning}>
            Jira holds {forecast.storedTargetStartIso}
          </span>
        )}
      </div>
      <p className={styles.rowReason}>{forecast.reason}</p>
    </li>
  );
}

/** Renders the daily forecast: every scanned issue in exactly one group, with its workings. */
export function ForecastSection({ forecast, teamNamesByProfileId = {} }: ForecastSectionProps) {
  if (!forecast) {
    return (
      <section className={styles.forecastPanel} data-testid="today-forecast">
        <header className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>{PANEL_TITLE}</h3>
        </header>
        <p className={styles.emptyMessage} role="status">{NOT_READY_MESSAGE}</p>
      </section>
    );
  }

  const forecastsByState = new Map<IssueForecastState, IssueForecast[]>();
  forecast.issueForecasts.forEach((issueForecast) => {
    const existing = forecastsByState.get(issueForecast.state) ?? [];
    existing.push(issueForecast);
    forecastsByState.set(issueForecast.state, existing);
  });

  const populatedGroups = FORECAST_GROUPS
    .map((group) => ({ group, forecasts: forecastsByState.get(group.state) ?? [] }))
    .filter((entry) => entry.forecasts.length > 0);

  const hasAnythingUrgent = populatedGroups.some((entry) => entry.group.isAlert);

  return (
    <section className={styles.forecastPanel} data-testid="today-forecast">
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>{PANEL_TITLE}</h3>
        <span className={styles.completenessLine}>{describeCompleteness(forecast)}</span>
      </header>

      {forecast.rejectedSettings.length > 0 && (
        // A setting that could not be used is shown here rather than swallowed: without it the
        // numbers cannot be reconciled with what the settings screen says.
        <ul className={styles.rejectedSettings} role="status">
          {forecast.rejectedSettings.map((rejected) => (
            <li key={`${rejected.name}-${rejected.storedValue}`}>
              <strong>{rejected.name}</strong> — {rejected.storedValue} {rejected.reason}
            </li>
          ))}
        </ul>
      )}

      {!hasAnythingUrgent && <p className={styles.emptyMessage} role="status">{EMPTY_MESSAGE}</p>}

      {populatedGroups.map(({ group, forecasts }) => (
        <div className={group.isAlert ? styles.groupAlert : styles.group} key={group.state}>
          <h4 className={styles.groupHeading}>
            <span aria-hidden="true">{group.icon}</span>
            {/* Text always carries the verdict, so colour is never the only thing saying it. */}
            {group.label}
            <span className={styles.groupCount}>{forecasts.length}</span>
          </h4>
          <ul className={styles.rowList}>
            {forecasts.map((issueForecast) => (
              <ForecastRow
                key={issueForecast.issueKey}
                forecast={issueForecast}
                teamName={issueForecast.teamProfileId === null
                  ? null
                  : teamNamesByProfileId[issueForecast.teamProfileId] ?? null}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
