// SettingsStep.tsx — Wizard Settings: the Jira address, which can change when Jira moves to a new instance (R-011).
// Saving reconnects Jira, which is the live check that the new address works.

import { useState } from 'react';

import type { SaveJiraUrlResult } from './wizardSettings.ts';
import styles from './WizardShell.module.css';

interface SettingsStepProps {
  jiraUrl: string;
  onSaveJiraUrl: (addressText: string) => SaveJiraUrlResult;
  onClose: () => void;
}

/** The Settings screen. */
export default function SettingsStep({ jiraUrl, onSaveJiraUrl, onClose }: SettingsStepProps) {
  const [addressText, setAddressText] = useState(jiraUrl);
  const [statusMessage, setStatusMessage] = useState('');

  function handleSave() {
    const saveResult = onSaveJiraUrl(addressText);
    setStatusMessage(saveResult.isSaved ? 'Saved — reconnecting to Jira.' : (saveResult.problem ?? 'Not saved.'));
  }

  return (
    <section className={styles.card} aria-labelledby="settings-heading">
      <h2 id="settings-heading" className={styles.cardTitle}>Settings</h2>
      <label className={styles.fieldLabel} htmlFor="wizard-jira-address">Jira address</label>
      <input
        id="wizard-jira-address"
        type="url"
        className={styles.inputField}
        value={addressText}
        onChange={(changeEvent) => setAddressText(changeEvent.target.value)}
      />
      <p className={styles.hint}>Change this only when Jira moves to a new address. ServiceNow needs no setting.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={handleSave}>Save and reconnect Jira</button>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>Back to home</button>
      </div>
      {statusMessage && <p role="status" className={styles.hint}>{statusMessage}</p>}
    </section>
  );
}
