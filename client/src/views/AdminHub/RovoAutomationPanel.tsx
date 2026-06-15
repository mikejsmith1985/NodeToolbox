// RovoAutomationPanel.tsx — Passphrase-gated Admin Hub config for the automated
// Rovo exchange. Holds the single Atlassian Automation/Rovo webhook + secret and
// the Confluence parking space used by the "Run via Rovo (auto)" actions.
//
// The capability is hidden: nothing is shown until the Rovo passphrase is entered.
// The same hidden Ctrl+Alt+Z shortcut that unlocks the generators also unlocks
// this section in place, so the user never has to leave Admin Hub to configure it.

import { useCallback, useEffect, useState } from 'react';

import { useRovoAssist } from '../SnowHub/hooks/useRovoAssist.ts';
import styles from './AdminHubView.module.css';

interface RovoConfig {
  webhookUrl: string;
  webhookSecret: string;
  parkingSpaceKey: string;
  isEnabled: boolean;
}

const EMPTY_CONFIG: RovoConfig = { webhookUrl: '', webhookSecret: '', parkingSpaceKey: '', isEnabled: false };
const HIDDEN_ROVO_SHORTCUT_KEY = 'z';

async function fetchRovoConfig(): Promise<RovoConfig> {
  const response = await fetch('/api/rovo/config');
  return (await response.json()) as RovoConfig;
}

async function saveRovoConfig(config: RovoConfig): Promise<void> {
  const response = await fetch('/api/rovo/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) throw new Error('Failed to save Rovo config: ' + response.statusText);
}

async function testRovoDispatch(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch('/api/rovo/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correlationId: 'rovo-config-test', prompt: 'Connection test from NodeToolbox.' }),
  });
  const body = (await response.json()) as { ok?: boolean; message?: string };
  return { ok: Boolean(body.ok), message: body.message ?? (body.ok ? 'Dispatched.' : 'Dispatch failed.') };
}

/** Renders the Rovo Automation config section (only once the Rovo passphrase is unlocked). */
export function RovoAutomationPanel() {
  const { isUnlocked, verifyPassphrase } = useRovoAssist();
  const [config, setConfig] = useState<RovoConfig>(EMPTY_CONFIG);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [isPassphraseModalVisible, setIsPassphraseModalVisible] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  // Hidden Ctrl+Alt+Z reveals the passphrase gate in place (only while locked).
  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      const isShortcutPressed =
        keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.key.toLowerCase() === HIDDEN_ROVO_SHORTCUT_KEY;
      if (!isShortcutPressed || isUnlocked) return;
      setIsPassphraseModalVisible(true);
      setPassphraseInput('');
      setPassphraseError(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;
    void fetchRovoConfig().then(setConfig).catch(() => { /* leave defaults on failure */ });
  }, [isUnlocked]);

  const updateField = useCallback((field: keyof RovoConfig, value: string | boolean) => {
    setConfig((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handlePassphraseSubmit = useCallback(async () => {
    const isAccepted = await verifyPassphrase(passphraseInput);
    if (isAccepted) {
      // verifyPassphrase sets the shared rovoStore — the section reveals itself.
      setIsPassphraseModalVisible(false);
      setPassphraseInput('');
      setPassphraseError(null);
      return;
    }
    setPassphraseError('Incorrect passphrase');
  }, [passphraseInput, verifyPassphrase]);

  const handleSave = useCallback(async () => {
    setIsBusy(true);
    setStatusMessage(null);
    try {
      await saveRovoConfig(config);
      setStatusMessage('Saved.');
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Save failed.');
    } finally {
      setIsBusy(false);
    }
  }, [config]);

  const handleTest = useCallback(async () => {
    setIsBusy(true);
    setStatusMessage('Testing…');
    const result = await testRovoDispatch();
    setStatusMessage(result.message);
    setIsBusy(false);
  }, []);

  // Locked: render only the passphrase modal if the hidden shortcut opened it.
  if (!isUnlocked) {
    if (!isPassphraseModalVisible) return null;
    return (
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>🔒 Rovo Automation</h2>
        <label className={styles.adminDescription}>
          Passphrase
          <input
            autoFocus
            className={styles.inputField}
            type="password"
            placeholder="Enter passphrase"
            value={passphraseInput}
            onChange={(changeEvent) => { setPassphraseInput(changeEvent.target.value); setPassphraseError(null); }}
            onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter') void handlePassphraseSubmit(); }}
          />
        </label>
        {passphraseError !== null ? <p className={styles.errorMessage}>{passphraseError}</p> : null}
        <div>
          <button className={styles.primaryBtn} onClick={() => void handlePassphraseSubmit()} type="button">Unlock</button>
          <button className={styles.secondaryBtn} onClick={() => setIsPassphraseModalVisible(false)} type="button">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>⚡ Rovo Automation</h2>
      <p className={styles.adminDescription}>
        Configure the Atlassian Automation webhook that runs Rovo and the Confluence space where
        results are parked. Used by the &quot;Run via Rovo (auto)&quot; actions to remove the manual
        copy-paste step.
      </p>

      <label className={styles.adminDescription}>
        Rovo Webhook URL
        <input
          className={styles.inputField}
          value={config.webhookUrl}
          placeholder="https://...atlassian.net/... incoming webhook URL"
          onChange={(changeEvent) => updateField('webhookUrl', changeEvent.target.value)}
        />
      </label>

      <label className={styles.adminDescription}>
        Webhook Secret
        <input
          className={styles.inputField}
          type="password"
          value={config.webhookSecret}
          placeholder="X-Automation-Webhook-Token (optional)"
          onChange={(changeEvent) => updateField('webhookSecret', changeEvent.target.value)}
        />
      </label>

      <label className={styles.adminDescription}>
        Parking Space Key
        <input
          className={styles.inputField}
          value={config.parkingSpaceKey}
          placeholder="Confluence space key for result pages"
          onChange={(changeEvent) => updateField('parkingSpaceKey', changeEvent.target.value)}
        />
      </label>

      <label className={styles.adminDescription}>
        <input
          type="checkbox"
          checked={config.isEnabled}
          onChange={(changeEvent) => updateField('isEnabled', changeEvent.target.checked)}
        />
        {' '}Enabled
      </label>

      <div>
        <button className={styles.primaryBtn} disabled={isBusy} onClick={() => void handleSave()} type="button">
          Save
        </button>
        <button className={styles.secondaryBtn} disabled={isBusy || !config.webhookUrl} onClick={() => void handleTest()} type="button">
          Test
        </button>
      </div>

      {statusMessage !== null ? <p className={styles.adminDescription} role="status">{statusMessage}</p> : null}
    </section>
  );
}
