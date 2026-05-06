// ReleaseManagementTab.tsx — ServiceNow release management tab for loading changes, active work, and operator activity.

import type { ChangeEvent } from 'react';
import { useEffect } from 'react';

import { useReleaseManagement } from '../hooks/useReleaseManagement.ts';
import styles from './ReleaseManagementTab.module.css';

const TAB_TITLE = 'Release Management';
const TAB_SUBTITLE = 'Review a change request, monitor active work, and keep a live activity log for release coordination.';
const LOAD_SECTION_TITLE = 'Load Change Request';
const ACTIVE_CHANGES_TITLE = 'My Active Changes';
const ACTIVITY_LOG_TITLE = 'Activity Log';
const EMPTY_ASSIGNEE_LABEL = 'Unassigned';
const EMPTY_MY_CHANGES_MESSAGE = 'No active changes are currently assigned to you.';
const EMPTY_LOG_MESSAGE = 'Activity will appear here as you load changes and refresh work.';
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

function formatLogTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], LOG_TIME_FORMAT_OPTIONS);
}

function renderAssignedUserName(
  assignedUser: NonNullable<ReleaseStateData['loadedChg']>['assignedTo'],
): string {
  return assignedUser?.name ?? EMPTY_ASSIGNEE_LABEL;
}

function LoadedChangeCard({ state, actions }: LoadedChangeCardProps) {
  if (!state.loadedChg) {
    return null;
  }

  return (
    <article className={styles.detailCard}>
      <div className={styles.detailGrid}>
        <div><span className={styles.detailLabel}>Number</span><p className={styles.detailValue}>{state.loadedChg.number}</p></div>
        <div><span className={styles.detailLabel}>State</span><p className={styles.detailValue}>{state.loadedChg.state}</p></div>
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

function ActiveChangesSection({ state }: { state: ReleaseStateData }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{ACTIVE_CHANGES_TITLE}</h3></div>
      <div className={styles.sectionBody}>
        {state.isLoadingMyChanges ? <p className={styles.loadingText}>Loading active changes...</p> : null}
        {state.myChangesError ? <p className={styles.errorText} role="alert">{state.myChangesError}</p> : null}
        {!state.isLoadingMyChanges && !state.myChangesError && state.myActiveChanges.length === 0 ? <p className={styles.mutedText}>{EMPTY_MY_CHANGES_MESSAGE}</p> : null}
        {state.myActiveChanges.length > 0 ? (
          <table className={styles.dataTable}>
            <thead><tr><th scope="col">Number</th><th scope="col">Short Description</th><th scope="col">State</th><th scope="col">Planned Start</th></tr></thead>
            <tbody>{state.myActiveChanges.map((changeRequest) => <tr key={changeRequest.sysId}><td>{changeRequest.number}</td><td>{changeRequest.shortDescription}</td><td>{changeRequest.state}</td><td>{changeRequest.plannedStartDate}</td></tr>)}</tbody>
          </table>
        ) : null}
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
      <ActiveChangesSection state={state} />
      <ActivityLogSection actions={actions} state={state} />
    </div>
  );
}
