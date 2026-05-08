// CredentialManagementSection.tsx — Credential display and GitHub PAT management.
//
// Shows the Jira base URL and ServiceNow instance URL from the settings store (read-only,
// with links to the Settings view for editing). Provides a masked input for storing a
// GitHub Personal Access Token in localStorage.

import { useState } from 'react';

import { useSettingsStore } from '../../store/settingsStore';
import styles from './AdminHubView.module.css';

// ── Constants ──

const GITHUB_PAT_STORAGE_KEY = 'tbxGithubPat';
const SAVE_STATUS_CLEAR_MS = 2000;

// ── Helpers ──

/** Reads the GitHub PAT from localStorage, returning empty string on failure. */
function readStoredGithubPat(): string {
  try {
    return localStorage.getItem(GITHUB_PAT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Writes the GitHub PAT to localStorage. */
function writeGithubPat(token: string): void {
  try {
    localStorage.setItem(GITHUB_PAT_STORAGE_KEY, token);
  } catch {
    // Non-fatal: in-memory state remains authoritative.
  }
}

/** Removes the GitHub PAT from localStorage. */
function deleteGithubPat(): void {
  try {
    localStorage.removeItem(GITHUB_PAT_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

// ── Sub-components ──

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

interface GithubPatRowProps {
  storedPat: string;
  isPatVisible: boolean;
  patInput: string;
  isEditingPat: boolean;
  saveStatus: string | null;
  onToggleVisibility(): void;
  onEdit(): void;
  onClear(): void;
  onPatInputChange(value: string): void;
  onSavePat(): void;
  onCancelEdit(): void;
}

/** Renders the GitHub PAT masked display or input row. */
function GithubPatRow({
  storedPat,
  isPatVisible,
  patInput,
  isEditingPat,
  saveStatus,
  onToggleVisibility,
  onEdit,
  onClear,
  onPatInputChange,
  onSavePat,
  onCancelEdit,
}: GithubPatRowProps) {
  const isPatSaved = storedPat !== '';
  const shouldShowMasked = isPatSaved && !isEditingPat;

  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel}>GitHub Personal Access Token</label>

      {shouldShowMasked ? (
        <div className={styles.inputRow}>
          <span className={styles.maskedPat}>
            {isPatVisible ? storedPat : '●●●●●●●●●●●●●●●●●●●●'}
          </span>
          <button
            className={styles.actionButton}
            onClick={onToggleVisibility}
            aria-label={isPatVisible ? 'Hide PAT' : 'Show PAT'}
          >
            {isPatVisible ? '🙈 Hide' : '👁 Show PAT'}
          </button>
          <button
            className={styles.actionButton}
            onClick={onEdit}
            aria-label="Edit GitHub PAT"
          >
            ✏️ Edit
          </button>
          <button
            className={`${styles.actionButton} ${styles.dangerButton}`}
            onClick={onClear}
            aria-label="Clear GitHub PAT"
          >
            🗑 Clear
          </button>
        </div>
      ) : (
        <div className={styles.inputRow}>
          <input
            type="password"
            className={styles.textInput}
            value={patInput}
            onChange={(changeEvent) => onPatInputChange(changeEvent.target.value)}
            placeholder="ghp_… or github_pat_…"
            aria-label="GitHub PAT input"
            autoComplete="new-password"
          />
          <button
            className={`${styles.actionButton} ${styles.saveButton}`}
            onClick={onSavePat}
            aria-label="Save PAT"
          >
            💾 Save PAT
          </button>
          {isEditingPat && (
            <button className={styles.actionButton} onClick={onCancelEdit}>
              Cancel
            </button>
          )}
        </div>
      )}

      {saveStatus !== null && <span className={styles.saveStatus}>{saveStatus}</span>}
      <p className={styles.adminDescription}>
        GitHub PAT is stored in localStorage. Requires <code>repo</code> read scope.
      </p>
    </div>
  );
}

// ── Main component ──

/** Credential Management section — displays configured service URLs and manages GitHub PAT. */
export default function CredentialManagementSection() {
  const jiraBaseUrl = useSettingsStore((storeState) => storeState.changeRequestGeneratorJiraUrl);
  const snowInstanceUrl = useSettingsStore(
    (storeState) => storeState.changeRequestGeneratorSnowUrl,
  );

  const [storedPat, setStoredPat] = useState<string>(readStoredGithubPat);
  const [isPatVisible, setIsPatVisible] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [isEditingPat, setIsEditingPat] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  function showSaveStatus(message: string) {
    setSaveStatus(message);
    setTimeout(() => setSaveStatus(null), SAVE_STATUS_CLEAR_MS);
  }

  function handleSavePat() {
    const trimmedToken = patInput.trim();
    if (trimmedToken === '') return;
    writeGithubPat(trimmedToken);
    setStoredPat(trimmedToken);
    setPatInput('');
    setIsEditingPat(false);
    showSaveStatus('✓ PAT saved');
  }

  function handleClearPat() {
    deleteGithubPat();
    setStoredPat('');
    setIsPatVisible(false);
    showSaveStatus('✓ PAT cleared');
  }

  function handleCancelEdit() {
    setIsEditingPat(false);
    setPatInput('');
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔑 Credential Management</h2>
      <p className={styles.adminDescription}>
        Jira and ServiceNow URLs are configured in Settings. GitHub PAT is stored locally for
        direct API access.
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

      <GithubPatRow
        storedPat={storedPat}
        isPatVisible={isPatVisible}
        patInput={patInput}
        isEditingPat={isEditingPat}
        saveStatus={saveStatus}
        onToggleVisibility={() => setIsPatVisible((current) => !current)}
        onEdit={() => setIsEditingPat(true)}
        onClear={handleClearPat}
        onPatInputChange={setPatInput}
        onSavePat={handleSavePat}
        onCancelEdit={handleCancelEdit}
      />
    </section>
  );
}
