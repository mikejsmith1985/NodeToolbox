// ChangeAuditPanel.tsx — Admin Hub panel that reviews status changes made under the operator's own
// Jira account and reports, per change, whether the evidence points at a hand-made edit, a bulk
// operation, or a write this application made on their behalf.
//
// It exists to answer a specific worry: an issue turned up cancelled and nobody remembered doing it.
// Because the application writes to Jira as the operator, Jira's own history credits them either way
// — so the panel gathers the corroborating evidence (this machine's local write record, the marker
// on adjacent comments, and the timing pattern across issues) and states which of those each verdict
// rests on. Where the evidence does not reach, it says so rather than guessing.

import { useState } from 'react';

import { auditStatusChanges, fetchWriteJournal, type AuditedChange, type ChangeAuditResult } from './changeAudit.ts';
import styles from './AdminHubView.module.css';

/** Default status to review — the case that prompted the panel. */
const DEFAULT_TARGET_STATUS = 'Cancelled';

/** How each verdict is presented: a badge, and a heading that avoids naming any tooling. */
const ORIGIN_PRESENTATION: Record<AuditedChange['origin'], { badge: string; label: string }> = {
  'assisted-confirmed': { badge: '🤖', label: 'Made for you (recorded on this machine)' },
  'assisted-signed':    { badge: '🖊️', label: 'Made for you (marked comment alongside)' },
  batch:                { badge: '📦', label: 'Part of a bulk operation' },
  'hand-made':          { badge: '✋', label: 'Hand-made' },
  indeterminate:        { badge: '❔', label: 'Cannot be determined' },
};

/** Returns the ISO date N days ago, used to seed the "since" field. */
function isoDateDaysAgo(dayCount: number): string {
  const startDate = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000);
  return startDate.toISOString().slice(0, 10);
}

/** Change review — an Admin Hub panel for confirming who or what moved an issue. */
export default function ChangeAuditPanel() {
  const [targetStatus, setTargetStatus] = useState(DEFAULT_TARGET_STATUS);
  const [sinceDate, setSinceDate] = useState(isoDateDaysAgo(30));
  const [projectKeysText, setProjectKeysText] = useState('');
  const [auditResult, setAuditResult] = useState<ChangeAuditResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function handleRunAudit() {
    setIsRunning(true);
    setErrorMessage(null);
    try {
      // Split on commas so a pasted project list keeps working even with spaces around the commas.
      const projectKeys = projectKeysText.split(',').map((projectKey) => projectKey.trim()).filter((key) => key !== '');
      const journalEntries = await fetchWriteJournal(`${sinceDate}T00:00:00.000Z`);
      setAuditResult(await auditStatusChanges(targetStatus.trim(), sinceDate, projectKeys, journalEntries));
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'The review could not be completed.');
      setAuditResult(null);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔎 Change Review</h2>
      <p className={styles.adminDescription}>
        Finds every issue you moved into a given status and weighs the evidence behind each change —
        this machine&apos;s local write record, a marker on an adjacent comment, and whether several
        issues moved together within seconds. Nothing here is sent anywhere; the local record never
        leaves this machine.
      </p>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="change-audit-status">Status moved into</label>
        <input
          className={styles.inputField}
          id="change-audit-status"
          onChange={(changeEvent) => setTargetStatus(changeEvent.target.value)}
          value={targetStatus}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="change-audit-since">Since</label>
        <input
          className={styles.dateInput}
          id="change-audit-since"
          onChange={(changeEvent) => setSinceDate(changeEvent.target.value)}
          type="date"
          value={sinceDate}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="change-audit-projects">
          Project keys <span className={styles.optionalLabel}>(optional, comma-separated)</span>
        </label>
        <input
          className={styles.inputField}
          id="change-audit-projects"
          onChange={(changeEvent) => setProjectKeysText(changeEvent.target.value)}
          placeholder="ENFCT, DENP"
          value={projectKeysText}
        />
      </div>

      <div className={styles.panelActions}>
        <button
          className={styles.actionButton}
          disabled={isRunning || targetStatus.trim() === ''}
          onClick={() => void handleRunAudit()}
        >
          {isRunning ? '⏳ Reviewing…' : '🔍 Review changes'}
        </button>
      </div>

      {errorMessage !== null && <p className={styles.sectionErrorText}>{errorMessage}</p>}

      {auditResult !== null && <AuditResultBody auditResult={auditResult} />}
    </section>
  );
}

/** Renders a completed review: the coverage caveat, the summary line, then one row per change. */
function AuditResultBody({ auditResult }: { auditResult: ChangeAuditResult }) {
  const { changes, scannedIssueCount, journalCoverageStartIso } = auditResult;

  return (
    <>
      {journalCoverageStartIso === null ? (
        <p className={styles.statusBannerMuted}>
          No local write record exists for this period yet — it begins collecting from now on. Until it
          covers the window you are reviewing, changes with no other evidence are reported as
          undetermined rather than hand-made.
        </p>
      ) : (
        <p className={styles.statusBannerMuted}>
          Local write record covers changes from <strong>{journalCoverageStartIso}</strong> onward.
          Anything earlier cannot be ruled either way.
        </p>
      )}

      <p className={styles.panelStatusLine}>
        {changes.length} matching change{changes.length === 1 ? '' : 's'} across {scannedIssueCount} issue
        {scannedIssueCount === 1 ? '' : 's'}.
      </p>

      {changes.length === 0 ? (
        <p className={styles.adminDescription}>No changes matched — nothing moved into that status in this window.</p>
      ) : (
        <div className={styles.diagnosticsGrid}>
          {changes.map((change) => (
            <div className={styles.diagnosticsRow} key={`${change.issueKey}-${change.atIso}`}>
              <span className={styles.diagnosticsLabel}>
                {ORIGIN_PRESENTATION[change.origin].badge} {change.issueKey}
              </span>
              <span className={styles.diagnosticsValue}>
                <strong>{ORIGIN_PRESENTATION[change.origin].label}</strong>
                <br />
                {change.fromStatus || '—'} → {change.toStatus} on {change.atIso}
                <br />
                {change.evidence}
                {change.companionFields.length > 0 && (
                  <>
                    <br />
                    Also changed in the same edit: {change.companionFields.join(', ')}.
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <details className={styles.collapsibleBlock}>
        <summary className={styles.collapsibleSummary}>Show the search this used</summary>
        <pre className={styles.codeBlock}>{auditResult.jql}</pre>
      </details>
    </>
  );
}
