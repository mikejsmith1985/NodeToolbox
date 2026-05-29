// RepoMonitorPanel.tsx — Repo monitor status and control panel, embedded in Admin Hub.

import { useCallback, useEffect, useState } from 'react';

import {
  fetchSchedulerConfig,
  fetchSchedulerResults,
  fetchSchedulerStatus,
  runSchedulerNow,
  updateSchedulerConfig,
} from '../../services/schedulerApi.ts';
import type {
  RepoMonitorSchedulerConfig,
  SchedulerResultEvent,
  SchedulerStatusResponse,
} from '../../services/schedulerApi.ts';

import styles from './RepoMonitorPanel.module.css';

/** Renders the Repo Monitor tab backed by the legacy server scheduler endpoints. */
export function RepoMonitorPanel() {
  const [monitorConfig, setMonitorConfig] = useState<RepoMonitorSchedulerConfig | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<SchedulerStatusResponse | null>(null);
  const [monitorEvents, setMonitorEvents] = useState<SchedulerResultEvent[]>([]);
  const [isMonitorBusy, setIsMonitorBusy] = useState(false);
  const [monitorErrorMessage, setMonitorErrorMessage] = useState<string | null>(null);

  const refreshMonitorData = useCallback(async () => {
    setMonitorErrorMessage(null);
    try {
      const [latestConfig, latestStatus, latestResults] = await Promise.all([
        fetchSchedulerConfig(),
        fetchSchedulerStatus(),
        fetchSchedulerResults(),
      ]);
      setMonitorConfig(latestConfig.repoMonitor);
      setMonitorStatus(latestStatus);
      setMonitorEvents(latestResults.repoMonitor.events);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
      setMonitorErrorMessage(errorMessage);
    }
  }, []);

  useEffect(() => {
    const initialRefreshTimeoutHandle = setTimeout(() => {
      void refreshMonitorData();
    }, 0);
    return () => clearTimeout(initialRefreshTimeoutHandle);
  }, [refreshMonitorData]);

  useEffect(() => {
    const statusIntervalHandle = setInterval(() => {
      void refreshMonitorData();
    }, 15000);
    return () => clearInterval(statusIntervalHandle);
  }, [refreshMonitorData]);

  const isMonitorEnabled = monitorStatus?.repoMonitor.enabled ?? false;

  return (
    <div className={styles.panel}>
      <div className={styles.syncStatus}>
        <span
          className={`${styles.statusDot} ${isMonitorEnabled ? styles.statusDotActive : styles.statusDotIdle}`}
          aria-label={isMonitorEnabled ? 'Monitoring' : 'Stopped'}
        />
        <span>{isMonitorEnabled ? 'Monitor Active' : 'Monitor Stopped'}</span>
        {monitorStatus?.repoMonitor.nextRunAt && (
          <span className={styles.countdownDisplay}>Next run: {new Date(monitorStatus.repoMonitor.nextRunAt).toLocaleTimeString()}</span>
        )}
      </div>
      <div className={styles.syncControls}>
        <button
          className={styles.primaryBtn}
          disabled={isMonitorBusy || monitorConfig === null}
          onClick={() => {
            if (monitorConfig === null) return;
            const nextEnabledValue = !isMonitorEnabled;
            setIsMonitorBusy(true);
            void updateSchedulerConfig({
              repoMonitor: { ...monitorConfig, enabled: nextEnabledValue },
            })
              .then(() => refreshMonitorData())
              .catch((caughtError) => {
                const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                setMonitorErrorMessage(errorMessage);
              })
              .finally(() => {
                setIsMonitorBusy(false);
              });
          }}
        >
          {isMonitorEnabled ? '⏹ Stop Monitor' : '▶ Start Monitor'}
        </button>
        <button
          className={styles.secondaryBtn}
          disabled={isMonitorBusy}
          onClick={() => {
            setIsMonitorBusy(true);
            void runSchedulerNow()
              .then(() => refreshMonitorData())
              .catch((caughtError) => {
                const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                setMonitorErrorMessage(errorMessage);
              })
              .finally(() => {
                setIsMonitorBusy(false);
              });
          }}
        >
          Check Now
        </button>
      </div>
      {monitorErrorMessage && (
        <p className={styles.errorText}>{monitorErrorMessage}</p>
      )}
      <div className={styles.syncLogContainer}>
        <div className={styles.syncLogHeader}><span>Legacy Monitor Status</span></div>
        <div className={styles.syncLog}>
          <div className={styles.syncLogEntry}>Configured repos: {monitorStatus?.repoMonitor.repos.length ?? 0}</div>
          <div className={styles.syncLogEntry}>Event count: {monitorStatus?.repoMonitor.eventCount ?? 0}</div>
          <div className={styles.syncLogEntry}>
            Last run: {monitorStatus?.repoMonitor.lastRunAt ? new Date(monitorStatus.repoMonitor.lastRunAt).toLocaleString() : 'Never'}
          </div>
          <div className={styles.syncLogEntry}>
            Branch pattern: {monitorConfig?.branchPattern ?? 'feature/[A-Z]+-\\d+'}
          </div>
        </div>
      </div>
      <div className={styles.syncLogContainer}>
        <div className={styles.syncLogHeader}><span>Monitor Events</span></div>
        <div className={styles.syncLog}>
          {monitorEvents.length === 0 && (
            <span className={styles.emptyState}>No monitor log entries.</span>
          )}
          {monitorEvents.map((eventItem, eventIndex) => (
            <div key={`${eventItem.timestamp}-${eventIndex}`} className={styles.syncLogEntry}>
              [{new Date(eventItem.timestamp).toLocaleTimeString()}] {eventItem.repo} — {eventItem.jiraKey || 'NO-KEY'} — {eventItem.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
