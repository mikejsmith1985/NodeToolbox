// DashboardApiProbePanel.tsx — Admin Hub panel running the read-only dashboard / Rich Filters API probe (GH #511).
//
// Toolbox can only import the whole Enrollment dashboard (gadgets and rich filter included) if Jira and the
// Rich Filters app expose endpoints for them, and neither is documented on Data Center. This panel finds out:
// it sends GET requests only to a short list of likely endpoints, then shows a compact report with a Copy
// button so the owner can paste it into GH #511. Nothing is ever written. The report opens with who Jira thinks the
// probe is and which route carried it, and ends with a scan of each dashboard page, so it is never read on a guess.

import React, { useState } from 'react';

import { probeJiraPath } from '../../services/jiraApi.ts';
import styles from './AdminHubView.module.css';
import {
  MAX_REDIRECT_HOPS, buildDashboardPagePath, buildProbePaths, describeJiraIdentity, describeRedirectTarget, findRichFilterApps,
  formatDashboardPageScan, formatProbeReport, isRedirectStatus, summarizeProbeReply,
  type ProbeResult,
} from './dashboardApiProbe.ts';

/** The plugin-list path whose reply names the Rich Filters app, when the user may read it. */
const PLUGIN_LIST_PATH = '/rest/plugins/1.0/';
/** The dashboard-list path whose reply supplies the ids to probe in detail. */
const MY_DASHBOARDS_PATH = '/rest/api/2/dashboard?filter=my';
/** Who Jira thinks the caller is; answered first so the report says how it reached Jira. */
const MYSELF_PATH = '/rest/api/2/myself';

/** GETs one path and records its outcome; a failure is a result, never a thrown error. */
async function probeOnePath(path: string): Promise<{ result: ProbeResult; body: unknown; upstreamLocation: string | null }> {
  const reply = await probeJiraPath(path);
  return { result: summarizeProbeReply(path, reply), body: reply.body, upstreamLocation: reply.upstreamLocation };
}

/**
 * Follows a redirect chain for a path that answered 3xx: explains where Jira pointed and GETs the target when it
 * is another REST address — up to MAX_REDIRECT_HOPS times. Each hop becomes one report line.
 */
async function followRedirects(startStatus: number | null, startLocation: string | null): Promise<string[]> {
  const hopLines: string[] = [];
  let currentStatus = startStatus;
  let location = startLocation;
  for (let hopIndex = 0; hopIndex < MAX_REDIRECT_HOPS; hopIndex += 1) {
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
    currentStatus = followed.result.status;
    location = followed.upstreamLocation;
  }
  hopLines.push(`stopped after ${MAX_REDIRECT_HOPS} redirects`);
  return hopLines;
}

/** Probes one path and, when it answered with a redirect, records where the redirect led. */
async function probeAndFollow(path: string): Promise<{ result: ProbeResult; body: unknown }> {
  const outcome = await probeOnePath(path);
  if (!isRedirectStatus(outcome.result.status)) return outcome;
  return { ...outcome, result: { ...outcome.result, redirects: await followRedirects(outcome.result.status, outcome.upstreamLocation) } };
}

/** Reads the dashboard ids out of GET /rest/api/2/dashboard. */
function readDashboardIds(body: unknown): string[] {
  const dashboards = (body as { dashboards?: Array<{ id?: string }> } | null)?.dashboards;
  return Array.isArray(dashboards) ? dashboards.map((dashboard) => String(dashboard.id ?? '')).filter(Boolean) : [];
}

/** Reads each dashboard's own page and scans it for its gadgets and the Rich Filters app's addresses. */
async function scanDashboardPages(dashboardIds: readonly string[]): Promise<string[]> {
  const scanLines: string[] = [];
  for (const dashboardId of dashboardIds) {
    scanLines.push(...formatDashboardPageScan(dashboardId, await probeJiraPath(buildDashboardPagePath(dashboardId))));
  }
  return scanLines;
}

/** Runs the whole probe: who we are, the dashboard list (for ids), every planned path, then each dashboard page. */
async function runProbe(customPath: string): Promise<string> {
  const identityLine = describeJiraIdentity(await probeJiraPath(MYSELF_PATH));
  const dashboardList = await probeOnePath(MY_DASHBOARDS_PATH);
  const dashboardIds = readDashboardIds(dashboardList.body);
  const results: ProbeResult[] = [];
  let pluginBody: unknown = null;
  for (const path of buildProbePaths(dashboardIds, customPath)) {
    const outcome = path === MY_DASHBOARDS_PATH ? dashboardList : await probeAndFollow(path);
    if (path === PLUGIN_LIST_PATH) pluginBody = outcome.body;
    results.push(outcome.result);
  }
  const pageScanLines = await scanDashboardPages(dashboardIds);
  return formatProbeReport(results, findRichFilterApps(pluginBody), { identityLine, pageScanLines });
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
