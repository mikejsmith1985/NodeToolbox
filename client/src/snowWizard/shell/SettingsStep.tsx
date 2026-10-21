// SettingsStep.tsx — Wizard Settings: the ServiceNow and Jira addresses, and the relay bookmark to drag to the bookmarks
// bar. Saving reconnects whichever address changed, which is the live check that it works.

import { useMemo, useState } from 'react';

import { BookmarkletInstallLink } from '../../components/BookmarkletInstallLink/index.tsx';
import { buildBookmarkHref } from '../transport/bookmarkPayload.ts';
import { WIZARD_CHANNEL_NAME } from '../wizardDefaults.ts';
import type { SaveAddressResult } from './wizardSettings.ts';
import styles from './WizardShell.module.css';

interface SettingsStepProps {
  snowUrl: string;
  jiraUrl: string;
  appVersion: string;
  onSaveSnowUrl: (addressText: string) => SaveAddressResult;
  onSaveJiraUrl: (addressText: string) => SaveAddressResult;
  onClose: () => void;
}

function describeSave(systemLabel: string, saveResult: SaveAddressResult, wasChanged: boolean): string {
  if (!saveResult.isSaved) return `${systemLabel}: ${saveResult.problem ?? 'not saved.'}`;
  return wasChanged ? `${systemLabel}: saved — reconnecting.` : `${systemLabel}: saved.`;
}

/** The Settings screen. */
export default function SettingsStep({ snowUrl, jiraUrl, appVersion, onSaveSnowUrl, onSaveJiraUrl, onClose }: SettingsStepProps) {
  const [snowAddressText, setSnowAddressText] = useState(snowUrl);
  const [jiraAddressText, setJiraAddressText] = useState(jiraUrl);
  const [statusMessage, setStatusMessage] = useState('');
  const bookmarkHref = useMemo(() => buildBookmarkHref({ channelName: WIZARD_CHANNEL_NAME }), []);

  function handleSave() {
    const snowResult = onSaveSnowUrl(snowAddressText);
    const jiraResult = onSaveJiraUrl(jiraAddressText);
    setStatusMessage([
      describeSave('ServiceNow', snowResult, snowResult.address !== snowUrl),
      describeSave('Jira', jiraResult, jiraResult.address !== jiraUrl),
    ].join(' '));
  }

  return (
    <section className={styles.card} aria-labelledby="settings-heading">
      <h2 id="settings-heading" className={styles.cardTitle}>Settings</h2>

      <h3 className={styles.fieldLabel}>The SNow Wizard bookmark</h3>
      <p className={styles.hint}>
        Drag this button onto your bookmarks bar (Ctrl+Shift+B shows the bar). You only do this once — new versions of
        the Wizard use the same bookmark. Do not click it here.
      </p>
      {/* Dragged, never followed, on this page: a click here does nothing. */}
      <BookmarkletInstallLink bookmarkletCode={bookmarkHref} className={styles.bookmarkLink} title="Drag me to your bookmarks bar"
        onClick={(clickEvent) => clickEvent.preventDefault()}>SNow Wizard</BookmarkletInstallLink>

      <label className={styles.fieldLabel} htmlFor="wizard-snow-address">ServiceNow address</label>
      <input id="wizard-snow-address" type="url" className={styles.inputField} value={snowAddressText}
        onChange={(changeEvent) => setSnowAddressText(changeEvent.target.value)} />
      <label className={styles.fieldLabel} htmlFor="wizard-jira-address">Jira address</label>
      <input id="wizard-jira-address" type="url" className={styles.inputField} value={jiraAddressText}
        onChange={(changeEvent) => setJiraAddressText(changeEvent.target.value)} />
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={handleSave}>Save addresses</button>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>Back</button>
      </div>
      {statusMessage && <p role="status" className={styles.hint}>{statusMessage}</p>}
      <p className={styles.hint}>SNow Wizard {appVersion}</p>
    </section>
  );
}
