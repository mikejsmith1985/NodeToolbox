// ClientDiagnosticsPanel.tsx — Read-only browser and settings diagnostics panel.
//
// Displays browser user agent, a localStorage usage estimate, active settings values
// from the settingsStore, and a link to the Dev Panel for deeper inspection.

import { useSettingsStore } from '../../store/settingsStore';
import styles from './AdminHubView.module.css';

// ── Helpers ──

/**
 * Estimates the total character count of all localStorage keys and values by
 * serialising the storage object to JSON. This is an approximation — actual
 * byte usage depends on encoding (UTF-16 in most browsers uses 2 bytes/char).
 */
function estimateLocalStorageCharCount(): number {
  try {
    return JSON.stringify(localStorage).length;
  } catch {
    return 0;
  }
}

// ── Sub-components ──

interface DiagnosticsRowProps {
  label: string;
  children: React.ReactNode;
  /** Optional test-id applied to the value cell for targeted test assertions. */
  valueTestId?: string;
}

/** A single label/value row in the diagnostics grid. */
function DiagnosticsRow({ label, children, valueTestId }: DiagnosticsRowProps) {
  return (
    <div className={styles.diagnosticsRow}>
      <span className={styles.diagnosticsLabel}>{label}</span>
      <span className={styles.diagnosticsValue} data-testid={valueTestId}>
        {children}
      </span>
    </div>
  );
}

// ── Main component ──

/** Client-side Diagnostics panel — browser environment and current settings snapshot. */
export default function ClientDiagnosticsPanel() {
  const jiraBaseUrl = useSettingsStore((storeState) => storeState.changeRequestGeneratorJiraUrl);
  const snowInstanceUrl = useSettingsStore(
    (storeState) => storeState.changeRequestGeneratorSnowUrl,
  );
  const currentTheme = useSettingsStore((storeState) => storeState.theme);

  const localStorageCharCount = estimateLocalStorageCharCount();

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔍 Client Diagnostics</h2>
      <p className={styles.adminDescription}>
        Read-only snapshot of the browser environment and current settings. For API call tracing,
        use the Dev Panel.
      </p>

      <div className={styles.diagnosticsGrid}>
        <DiagnosticsRow label="Browser" valueTestId="diagnostics-user-agent">
          {navigator.userAgent}
        </DiagnosticsRow>

        <DiagnosticsRow label="localStorage Usage">
          ≈ {localStorageCharCount.toLocaleString()} chars
        </DiagnosticsRow>

        <DiagnosticsRow label="Jira Base URL">
          {jiraBaseUrl !== '' ? jiraBaseUrl : '—'}
        </DiagnosticsRow>

        <DiagnosticsRow label="ServiceNow URL">
          {snowInstanceUrl !== '' ? snowInstanceUrl : '—'}
        </DiagnosticsRow>

        <DiagnosticsRow label="Theme" valueTestId="diagnostics-theme">
          {currentTheme}
        </DiagnosticsRow>
      </div>

      <div className={styles.inputRow}>
        <a href="/dev-panel" className={styles.actionButton}>
          🔍 Open Dev Panel
        </a>
      </div>
    </section>
  );
}
