// CredentialManagementSection.tsx — Read-only display of the configured service URLs.
//
// This used to offer a THIRD place to enter a GitHub Personal Access Token, stored in localStorage
// under `tbxGithubPat` "for direct browser-to-GitHub API calls". Nothing ever read it — the key had
// no consumer anywhere in the app. Its only real effect was to make somebody enter a token here,
// watch it save, and then find every GitHub feature still unauthenticated, because the server reads
// its own credential from the Connectivity section.
//
// GitHub credentials live in exactly two places now, and each says what it is:
//   • Admin Hub → Connectivity → GitHub — the SERVER's credential (intake, probes, monitors)
//   • My Issues → Git Sync — that panel's own browser-side token
//
// A credential field that stores a value nobody reads is worse than no field: it looks like the
// thing that would have worked.

import { useSettingsStore } from '../../store/settingsStore';
import styles from './AdminHubView.module.css';

// ── Constants ──

interface ServiceUrlRowProps {
  label: string;
  configuredUrl: string;
  settingsLinkLabel: string;
}

/** Displays a service URL with a link to Settings, or an unconfigured placeholder. */
function ServiceUrlRow({ label, configuredUrl, settingsLinkLabel }: ServiceUrlRowProps) {
  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel}>{label}</label>
      <div className={styles.inputRow}>
        {configuredUrl !== '' ? (
          <span className={styles.credentialUrl}>{configuredUrl}</span>
        ) : (
          <span className={styles.credentialUrlEmpty}>Not configured</span>
        )}
        <a href="/settings" className={styles.actionButton}>
          {settingsLinkLabel}
        </a>
      </div>
    </div>
  );
}

export default function CredentialManagementSection() {
  const jiraBaseUrl = useSettingsStore((storeState) => storeState.changeRequestGeneratorJiraUrl);
  const snowInstanceUrl = useSettingsStore(
    (storeState) => storeState.changeRequestGeneratorSnowUrl,
  );

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔑 Credential Management</h2>
      <p className={styles.adminDescription}>
        Jira and ServiceNow URLs are configured in Settings. GitHub credentials are NOT set here:
        the server&apos;s token (used by the email intake, the deployments probe and the monitors)
        lives in <strong>Connectivity → GitHub</strong> below, and the Git Sync panel keeps its own
        browser-side token in <strong>My Issues → Git Sync</strong>.
      </p>

      <ServiceUrlRow
        label="Jira Base URL"
        configuredUrl={jiraBaseUrl}
        settingsLinkLabel={jiraBaseUrl !== '' ? '✏️ Edit in Settings' : '⚙️ Open Settings'}
      />

      <ServiceUrlRow
        label="ServiceNow Instance URL"
        configuredUrl={snowInstanceUrl}
        settingsLinkLabel={snowInstanceUrl !== '' ? '✏️ Edit in Settings' : '⚙️ Open Settings'}
      />

    </section>
  );
}
