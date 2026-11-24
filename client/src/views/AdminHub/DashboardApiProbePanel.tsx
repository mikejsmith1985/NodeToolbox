// DashboardApiProbePanel.tsx — Admin Hub panel running the read-only dashboard / Rich Filters API probe (GH #511).
//
// Toolbox can only import the whole Enrollment dashboard (gadgets and rich filter included) if Jira and the
// Rich Filters app expose endpoints for them, and neither is documented on Data Center. This panel finds out:
// it sends GET requests only to a short list of likely endpoints, then shows a compact report with a Copy
// button so the owner can paste it into GH #511. Nothing is ever written.

import React, { useState } from 'react';

import { jiraGet, readJiraRedirectTarget } from '../../services/jiraApi.ts';
import styles from './AdminHubView.module.css';
import {
  MAX_REDIRECT_HOPS, buildProbePaths, describeRedirectTarget, findRichFilterApps, isRedirectStatus, formatProbeReport, readStatusFromFailure, summarizeProbeBody,
  type ProbeResult,
} from './dashboardApiProbe.ts';

/** The plugin-list path whose reply names the Rich Filters app, when the user may read it. */
const PLUGIN_LIST_PATH = '/rest/plugins/1.0/';
/** The dashboard-list path whose reply supplies the ids to probe in detail. */
const MY_DASHBOARDS_PATH = '/rest/api/2/dashboard?filter=my';
/** HTTP 200, the only status that carries a usable body here. */
const OK_STATUS = 200;

/** GETs one path and records its status and shape; a failure is a result, never a thrown error. */
async function probeOnePath(path: string): Promise<{ result: ProbeResult; body: unknown }> {
  try {
    const body = await jiraGet<unknown>(path);
    return { result: { path, status: OK_STATUS, ...summarizeProbeBody(body) }, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: { path, status: readStatusFromFailure(message), shape: '', snippet: message.slice(0, 200) }, body: null };
  }
}

/**
 * Follows a redirect chain for a path that answered 3xx: asks where Jira pointed, explains it, and GETs the
 * target when it is another REST address — up to MAX_REDIRECT_HOPS times. Each hop becomes one report line.
 */
async function followRedirects(startPath: string, startStatus: number | null): Promise<string[]> {
  const hopLines: string[] = [];
  let currentPath = startPath;
  let currentStatus = startStatus;
  for (let hopIndex = 0; hopIndex < MAX_REDIRECT_HOPS; hopIndex += 1) {
    const location = await readJiraRedirectTarget(currentPath).catch(() => null);
    if (!location) {
      hopLines.push('Jira did not say where it redirected to');
      return hopLines;
    }
    const target = describeRedirectTarget(location);
    hopLines.push(`${currentStatus ?? 'ERR'} → ${location} (${target.note})`);
    if (!target.followPath) return hopLines;
    const followed = await probeOnePath(target.followPath);
    hopLines.push(`${followed.result.status ?? 'ERR'}  ${target.followPath}${followed.result.shape ? ` — ${followed.result.shape}` : ''}`);
    if (!isRedirectStatus(followed.result.status)) return hopLines;
    currentPath = target.followPath;
    currentStatus = followed.result.status;
  }
  hopLines.push(`stopped after ${MAX_REDIRECT_HOPS} redirects`);
  return hopLines;
}

/** Probes one path and, when it redirected, records where the redirect led. */
async function probeAndFollow(path: string): Promise<{ result: ProbeResult; body: unknown }> {
  const outcome = await probeOnePath(path);
  if (!isRedirectStatus(outcome.result.status)) return outcome;
  return { ...outcome, result: { ...outcome.result, redirects: await followRedirects(path, outcome.result.status) } };
}

/** Reads the dashboard ids out of GET /rest/api/2/dashboard. */
function readDashboardIds(body: unknown): string[] {
  const dashboards = (body as { dashboards?: Array<{ id?: string }> } | null)?.dashboards;
  return Array.isArray(dashboards) ? dashboards.map((dashboard) => String(dashboard.id ?? '')).filter(Boolean) : [];
}

/** Runs the whole probe: first the dashboard list (for ids), then every planned path in turn. */
async function runProbe(customPath: string): Promise<string> {
  const dashboardList = await probeOnePath(MY_DASHBOARDS_PATH);
  const paths = buildProbePaths(readDashboardIds(dashboardList.body), customPath);
  const results: ProbeResult[] = [];
  let pluginBody: unknown = null;
  for (const path of paths) {
    const outcome = path === MY_DASHBOARDS_PATH ? dashboardList : await probeAndFollow(path);
    if (path === PLUGIN_LIST_PATH) pluginBody = outcome.body;
    results.push(outcome.result);
  }
  return formatProbeReport(results, findRichFilterApps(pluginBody));
}

/** Admin Hub panel: one button, a read-only probe, and a copyable report. */
export function DashboardApiProbePanel(): React.ReactElement {
  const [customPath, setCustomPath] = useState('');
  const [report, setReport] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState('');

  const startProbe = async () => {
    setIsBusy(true); setStatus('Probing (GET only — nothing is changed)…'); setReport('');
    try {
      setReport(await runProbe(customPath));
      setStatus('Probe complete — copy the report into GH #511.');
    } finally { setIsBusy(false); }
  };

  const copyReport = () => {
    void navigator.clipboard?.writeText(report).then(() => setStatus('Report copied.'));
  };

  return (
    <section className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>🛰️ Dashboard API Probe — #511 (read-only)</h3>
      <p className={styles.adminDescription}>
        Checks whether Jira and the Rich Filters app expose the endpoints Toolbox would need to import the whole
        Enrollment dashboard. Sends GET requests only.
      </p>
      <div className={styles.panelSection}>
        <label className={styles.fieldLabel} htmlFor="dashboard-probe-custom-path">Extra REST path to try (optional)</label>
        <input
          id="dashboard-probe-custom-path"
          className={styles.inputField}
          placeholder="/rest/… — leave blank for the standard set"
          value={customPath}
          onChange={(event) => setCustomPath(event.target.value)}
          disabled={isBusy}
        />
      </div>
      <div className={styles.panelSection}>
        <button className={styles.actionButton} onClick={startProbe} disabled={isBusy} type="button">🛰️ Run probe</button>
        <button className={styles.actionButton} onClick={copyReport} disabled={isBusy || !report} type="button">📋 Copy report</button>
      </div>
      {status && <p className={styles.panelStatusLine}>{status}</p>}
      {report && <pre className={styles.diagnosticsResultPre}>{report}</pre>}
    </section>
  );
}
