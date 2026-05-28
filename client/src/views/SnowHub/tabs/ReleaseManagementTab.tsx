// ReleaseManagementTab.tsx — ServiceNow release management tab for loading changes, active work, and operator activity.

import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { ALL_CHG_STATES, CHG_STATE_TRANSITIONS } from '../hooks/useReleaseManagement.ts';
import { useReleaseManagement } from '../hooks/useReleaseManagement.ts';
import styles from './ReleaseManagementTab.module.css';

const TAB_TITLE = 'Release Management';
const TAB_SUBTITLE = 'Review active changes, detect missed milestone states, and track alert/recovery timeline events.';
const LOAD_SECTION_TITLE = 'Load Change Request';
const ACTIVE_CHANGES_TITLE = 'My Active Changes';
const ALERT_MONITOR_SETTINGS_TITLE = 'Alert Monitor Settings';
const ACTIVITY_LOG_TITLE = 'Alert Timeline';
const EMPTY_ASSIGNEE_LABEL = 'Unassigned';
const EMPTY_MY_CHANGES_MESSAGE = 'No active changes are currently assigned to you.';
const EMPTY_LOG_MESSAGE = 'Alerts and recovery events will appear here as active changes are evaluated.';
const ALERT_COLUMN_LABEL = 'Alert';
const REFRESH_BUTTON_LABEL = 'Refresh';
const LOG_TIME_FORMAT_OPTIONS = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
} as const;

type ReleaseHookResult = ReturnType<typeof useReleaseManagement>;
type ReleaseStateData = ReleaseHookResult['state'];
type ReleaseActionSet = ReleaseHookResult['actions'];

interface LoadedChangeCardProps {
  state: ReleaseStateData;
  actions: ReleaseActionSet;
}

interface AlertSummary {
  total: number;
  healthy: number;
  warning: number;
  error: number;
}

function formatLogTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], LOG_TIME_FORMAT_OPTIONS);
}

function renderAssignedUserName(
  assignedUser: NonNullable<ReleaseStateData['loadedChg']>['assignedTo'],
): string {
  return assignedUser?.name ?? EMPTY_ASSIGNEE_LABEL;
}

function resolveAlertBadgeLabel(alertSeverity: ReleaseStateData['myActiveChanges'][number]['alertSeverity']): string {
  if (alertSeverity === 'error') {
    return 'Error';
  }

  if (alertSeverity === 'warning') {
    return 'Warning';
  }

  return 'Healthy';
}

/**
 * Resolves the list of valid next states from the current raw state value.
 * Falls back to showing all states when the current state is not in the transition map
 * (handles custom or non-standard SNow instances gracefully).
 */
function resolveAvailableTransitions(currentStateValue: string) {
  return CHG_STATE_TRANSITIONS[currentStateValue] ?? ALL_CHG_STATES;
}

/**
 * Inline dropdown that shows valid next SNow workflow states for a change.
 * Renders as a plain text label when no transitions are available (terminal state).
 */
function StateTransitionCell({
  changeKey,
  stateLabel,
  stateValue,
  onTransition,
}: {
  changeKey: string;
  stateLabel: string;
  stateValue: string;
  onTransition: (changeKey: string, newStateValue: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const availableTransitions = resolveAvailableTransitions(stateValue);
  const hasAvailableTransitions = availableTransitions.length > 0;

  // Close the dropdown when the user clicks outside of it
  useEffect(() => {
    if (!isOpen) return undefined;

    function handleOutsideClick(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  if (!hasAvailableTransitions) {
    return <span>{stateLabel}</span>;
  }

  return (
    <div className={styles.stateCell} ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={styles.stateButton}
        onClick={() => setIsOpen((previous) => !previous)}
        title="Click to transition state"
        type="button"
      >
        {stateLabel} ▾
      </button>
      {isOpen ? (
        <ul className={styles.stateDropdown} role="listbox">
          {availableTransitions.map((transition) => (
            <li key={transition.value} role="option" aria-selected={false}>
              <button
                className={styles.stateOption}
                onClick={() => {
                  setIsOpen(false);
                  onTransition(changeKey, transition.value);
                }}
                type="button"
              >
                {transition.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function calculateAlertSummary(state: ReleaseStateData): AlertSummary {
  return state.myActiveChanges.reduce<AlertSummary>((summary, activeChange) => {
    if (activeChange.alertSeverity === 'error') {
      return { ...summary, error: summary.error + 1 };
    }

    if (activeChange.alertSeverity === 'warning') {
      return { ...summary, warning: summary.warning + 1 };
    }

    return { ...summary, healthy: summary.healthy + 1 };
  }, {
    total: state.myActiveChanges.length,
    healthy: 0,
    warning: 0,
    error: 0,
  });
}

function LoadedChangeCard({ state, actions }: LoadedChangeCardProps) {
  if (!state.loadedChg) {
    return null;
  }

  return (
    <article className={styles.detailCard}>
      <div className={styles.detailGrid}>
        <div><span className={styles.detailLabel}>Number</span><p className={styles.detailValue}>{state.loadedChg.number}</p></div>
        <div>
          <span className={styles.detailLabel}>State</span>
          <p className={styles.detailValue}>
            <StateTransitionCell
              changeKey={state.loadedChg.number}
              onTransition={actions.updateChangeState}
              stateLabel={state.loadedChg.state}
              stateValue={state.loadedChg.stateValue}
            />
          </p>
        </div>
        <div><span className={styles.detailLabel}>Risk</span><p className={styles.detailValue}>{state.loadedChg.risk}</p></div>
        <div><span className={styles.detailLabel}>Impact</span><p className={styles.detailValue}>{state.loadedChg.impact}</p></div>
        <div><span className={styles.detailLabel}>Planned Start</span><p className={styles.detailValue}>{state.loadedChg.plannedStartDate}</p></div>
        <div><span className={styles.detailLabel}>Planned End</span><p className={styles.detailValue}>{state.loadedChg.plannedEndDate}</p></div>
        <div><span className={styles.detailLabel}>Assigned To</span><p className={styles.detailValue}>{renderAssignedUserName(state.loadedChg.assignedTo)}</p></div>
      </div>
      <div className={styles.detailStack}>
        <div><span className={styles.detailLabel}>Short Description</span><p className={styles.detailValue}>{state.loadedChg.shortDescription}</p></div>
      </div>
      <div className={styles.buttonRow}><button className={styles.secondaryButton} onClick={() => actions.clearLoadedChg()} type="button">Clear</button></div>
    </article>
  );
}

function ActiveChangesSection({ state, actions }: { state: ReleaseStateData; actions: ReleaseActionSet }) {
  const alertSummary = calculateAlertSummary(state);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{ACTIVE_CHANGES_TITLE}</h3>
        <button className={styles.secondaryButton} onClick={() => void actions.loadMyActiveChanges()} type="button">
          {REFRESH_BUTTON_LABEL}
        </button>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.summaryRow}>
          <span>Total: {alertSummary.total}</span>
          <span>Healthy: {alertSummary.healthy}</span>
          <span>Warning: {alertSummary.warning}</span>
          <span>Error: {alertSummary.error}</span>
        </div>
        {state.isLoadingMyChanges ? <p className={styles.loadingText}>Loading active changes...</p> : null}
        {state.myChangesError ? <p className={styles.errorText} role="alert">{state.myChangesError}</p> : null}
        {!state.isLoadingMyChanges && !state.myChangesError && state.myActiveChanges.length === 0 ? <p className={styles.mutedText}>{EMPTY_MY_CHANGES_MESSAGE}</p> : null}
        {state.myActiveChanges.length > 0 ? (
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Short Description</th>
                <th scope="col">State</th>
                <th scope="col">Planned Start</th>
                <th scope="col">Planned End</th>
                <th scope="col">{ALERT_COLUMN_LABEL}</th>
              </tr>
            </thead>
            <tbody>
              {state.myActiveChanges.map((changeRequest) => (
                <tr key={changeRequest.sysId}>
                  <td>{changeRequest.number}</td>
                  <td>{changeRequest.shortDescription}</td>
                  <td>
                    <StateTransitionCell
                      changeKey={changeRequest.number}
                      onTransition={actions.updateChangeState}
                      stateLabel={changeRequest.state || '—'}
                      stateValue={changeRequest.stateValue}
                    />
                  </td>
                  <td>{changeRequest.plannedStartDate || '—'}</td>
                  <td>{changeRequest.plannedEndDate || '—'}</td>
                  <td>
                    <span className={`${styles.logBadge} ${styles[changeRequest.alertSeverity]}`}>
                      {resolveAlertBadgeLabel(changeRequest.alertSeverity)}
                    </span>
                    {changeRequest.alertMessage ? (
                      <p className={styles.alertMessageText}>{changeRequest.alertMessage}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

function AlertMonitorSettingsSection({ state, actions }: { state: ReleaseStateData; actions: ReleaseActionSet }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{ALERT_MONITOR_SETTINGS_TITLE}</h3>
      </div>
      <div className={styles.sectionBody}>
        <label className={styles.checkboxLabel}>
          <input
            checked={state.monitorSettings.shouldAlertOnPlannedStartMiss}
            onChange={(event) => actions.setMonitorSetting('shouldAlertOnPlannedStartMiss', event.target.checked)}
            type="checkbox"
          />
          Alert when planned start is missed and work has not started
        </label>
        <label className={styles.checkboxLabel}>
          <input
            checked={state.monitorSettings.shouldAlertOnPlannedEndMiss}
            onChange={(event) => actions.setMonitorSetting('shouldAlertOnPlannedEndMiss', event.target.checked)}
            type="checkbox"
          />
          Alert when planned end is missed and change is not completed
        </label>
      </div>
    </section>
  );
}

function ActivityLogSection({ state, actions }: { state: ReleaseStateData; actions: ReleaseActionSet }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{ACTIVITY_LOG_TITLE}</h3><button className={styles.secondaryButton} onClick={() => actions.clearLog()} type="button">Clear Log</button></div>
      <div className={styles.sectionBody}>
        {state.activityLog.length === 0 ? <p className={styles.mutedText}>{EMPTY_LOG_MESSAGE}</p> : null}
        {state.activityLog.length > 0 ? (
          <ul className={styles.logList}>
            {state.activityLog.map((logEntry) => <li className={styles.logItem} key={`${logEntry.timestamp}-${logEntry.message}`}><span className={`${styles.logBadge} ${styles[logEntry.level]}`}>{logEntry.level}</span><span className={styles.logTime}>{formatLogTimestamp(logEntry.timestamp)}</span><span className={styles.logMessage}>{logEntry.message}</span></li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Renders the Release Management tab so coordinators can inspect one change, monitor assigned work, and review recent activity in one place.
 */
export default function ReleaseManagementTab() {
  const { state, actions } = useReleaseManagement();

  useEffect(() => {
    void actions.loadMyActiveChanges();
  }, [actions]);

  function handleChgNumberChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setChgNumber(event.target.value);
  }

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <h2 className={styles.tabTitle}>{TAB_TITLE}</h2>
        <p className={styles.tabSubtitle}>{TAB_SUBTITLE}</p>
      </header>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{LOAD_SECTION_TITLE}</h3></div>
        <div className={styles.sectionBody}>
          <label className={styles.fieldGroup}><span className={styles.fieldLabel}>CHG Number</span><input className={styles.input} onChange={handleChgNumberChange} value={state.chgNumber} /></label>
          <div className={styles.buttonRow}><button className={styles.primaryButton} onClick={() => void actions.loadChg()} type="button">Load Change</button></div>
          {state.isLoadingChg ? <p className={styles.loadingText}>Loading change request...</p> : null}
          {state.loadError ? <p className={styles.errorText} role="alert">{state.loadError}</p> : null}
          <LoadedChangeCard actions={actions} state={state} />
        </div>
      </section>
      <AlertMonitorSettingsSection actions={actions} state={state} />
      <ActiveChangesSection actions={actions} state={state} />
      <ActivityLogSection actions={actions} state={state} />
    </div>
  );
}
