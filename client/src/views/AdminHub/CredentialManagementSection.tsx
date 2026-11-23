// CredentialManagementSection.tsx — Edits the Jira and ServiceNow base URLs from the Admin Hub.
//
// These URLs used to be shown here as read-only text with a link to Settings, so after a Jira re-instance
// migration there was nothing in the Admin Hub to paste the new address into. They are now real inputs.
// Save writes the value to the server — the copy the Jira and ServiceNow proxies actually use — and then to
// the browser's settings store, so every screen that reads either copy agrees.
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

import { useEffect, useState } from 'react';

import { fetchServiceBaseUrls, saveServiceBaseUrl, type ServiceWithBaseUrl } from '../../services/proxyApi.ts';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './AdminHubView.module.css';

// ── Types ──

interface ServiceUrlRowProps {
  inputId: string;
  label: string;
  /** The short service name used on the Save button and in status messages. */
  serviceName: string;
  placeholder: string;
  urlValue: string;
  isSaving: boolean;
  onChangeUrl: (url: string) => void;
  onSave: () => void;
}

// ── Sub-views ──

/** One editable service URL: a plain text input (so paste always works) and its Save button. */
function ServiceUrlRow(props: ServiceUrlRowProps) {
  const { inputId, label, serviceName, placeholder, urlValue, isSaving, onChangeUrl, onSave } = props;
  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor={inputId}>{label}</label>
      <div className={styles.inputRow}>
        <input
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className={styles.textInput}
          value={urlValue}
          placeholder={placeholder}
          onChange={(changeEvent) => onChangeUrl(changeEvent.target.value)}
        />
        <button className={styles.actionButton} type="button" onClick={onSave} disabled={isSaving}>
          Save {serviceName}
        </button>
      </div>
    </div>
  );
}

/** Read-only view of one URL, shown while Admin Hub is locked (ServiceNow settings are admin-only). */
function LockedUrlRow({ label, urlValue }: { label: string; urlValue: string }) {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {urlValue !== ''
        ? <span className={styles.credentialUrl}>{urlValue}</span>
        : <span className={styles.credentialUrlEmpty}>Not configured</span>}
    </div>
  );
}

// ── The section ──

interface CredentialManagementSectionProps {
  /** Editing is offered only once Admin Hub is unlocked; locked, the URLs are shown read-only. */
  isAdminUnlocked: boolean;
}

/** Admin Hub section where the Jira and ServiceNow base URLs are pasted in and saved. */
export default function CredentialManagementSection({ isAdminUnlocked }: CredentialManagementSectionProps) {
  const storedJiraUrl = useSettingsStore((storeState) => storeState.changeRequestGeneratorJiraUrl);
  const storedSnowUrl = useSettingsStore((storeState) => storeState.changeRequestGeneratorSnowUrl);
  const setStoredJiraUrl = useSettingsStore((storeState) => storeState.setChangeRequestGeneratorJiraUrl);
  const setStoredSnowUrl = useSettingsStore((storeState) => storeState.setChangeRequestGeneratorSnowUrl);
  const [jiraUrl, setJiraUrl] = useState(storedJiraUrl ?? '');
  const [snowUrl, setSnowUrl] = useState(storedSnowUrl ?? '');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // The server's copy is the one the proxies use, so it wins over the browser's on load — but a value the
  // user has already started typing is never overwritten.
  useEffect(() => {
    let isActive = true;
    fetchServiceBaseUrls()
      .then((serverUrls) => {
        if (!isActive) return;
        if (serverUrls.jira) setJiraUrl((current) => (current === (storedJiraUrl ?? '') ? serverUrls.jira : current));
        if (serverUrls.snow) setSnowUrl((current) => (current === (storedSnowUrl ?? '') ? serverUrls.snow : current));
      })
      .catch(() => { /* keep the browser's copy; Save still reports any server problem */ });
    return () => { isActive = false; };
    // Load once on mount; later store changes come from this section's own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveUrl = async (service: ServiceWithBaseUrl, serviceName: string, url: string, persist: (value: string) => void) => {
    setIsSaving(true);
    try {
      await saveServiceBaseUrl(service, url);
      persist(url.trim());
      setStatusMessage(`✅ ${serviceName} URL saved.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`⚠️ Could not save the ${serviceName} URL — ${reason}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔑 Credential Management</h2>
      <p className={styles.adminDescription}>
        Paste the Jira and ServiceNow base URLs here and press Save — the server&apos;s proxies use them straight
        away. GitHub credentials are NOT set here: the server&apos;s token (used by the email intake, the deployments
        probe and the monitors) lives in <strong>Connectivity → GitHub</strong> below, and the Git Sync panel keeps
        its own browser-side token in <strong>My Issues → Git Sync</strong>.
      </p>

      {!isAdminUnlocked && (
        <>
          <LockedUrlRow label="Jira Base URL" urlValue={jiraUrl} />
          <LockedUrlRow label="ServiceNow Instance URL" urlValue={snowUrl} />
          <p className={styles.panelStatusLine}>🔒 Unlock Admin Hub (top of this page) to edit these URLs.</p>
        </>
      )}

      {isAdminUnlocked && (<>
      <ServiceUrlRow
        inputId="credential-jira-base-url"
        label="Jira Base URL"
        serviceName="Jira"
        placeholder="https://jira.your-company.com"
        urlValue={jiraUrl}
        isSaving={isSaving}
        onChangeUrl={setJiraUrl}
        onSave={() => void saveUrl('jira', 'Jira', jiraUrl, setStoredJiraUrl)}
      />

      <ServiceUrlRow
        inputId="credential-snow-base-url"
        label="ServiceNow Instance URL"
        serviceName="ServiceNow"
        placeholder="https://your-instance.service-now.com"
        urlValue={snowUrl}
        isSaving={isSaving}
        onChangeUrl={setSnowUrl}
        onSave={() => void saveUrl('snow', 'ServiceNow', snowUrl, setStoredSnowUrl)}
      />
      </>)}

      {statusMessage && <p className={styles.panelStatusLine}>{statusMessage}</p>}
    </section>
  );
}
