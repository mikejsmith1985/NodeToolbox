// RovoAutomationPanel.tsx — Config form for the automated Rovo exchange.
//
// Holds the single Atlassian Automation/Rovo webhook + secret and the Confluence
// parking space used by the "Run via Rovo (auto)" actions. Unlock/hide and the
// passphrase gate are handled by AdminHubView, which only renders this panel on
// the "⚡ Rovo" tab (shown only while the Rovo capability is unlocked).

import { useCallback, useEffect, useState } from 'react';

import styles from './AdminHubView.module.css';

interface RovoConfig {
  webhookUrl: string;
  webhookSecret: string;
  parkingSpaceKey: string;
  parkingPageId: string;
  isEnabled: boolean;
}

const EMPTY_CONFIG: RovoConfig = { webhookUrl: '', webhookSecret: '', parkingSpaceKey: '', parkingPageId: '', isEnabled: false };

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

/** Renders the Rovo Automation config form. Rendered only when the Rovo tab is active (unlocked). */
export function RovoAutomationPanel() {
  const [config, setConfig] = useState<RovoConfig>(EMPTY_CONFIG);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void fetchRovoConfig().then(setConfig).catch(() => { /* leave defaults on failure */ });
  }, []);

  const updateField = useCallback((field: keyof RovoConfig, value: string | boolean) => {
    setConfig((previous) => ({ ...previous, [field]: value }));
  }, []);

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

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>⚡ Rovo Automation</h2>
      <p className={styles.adminDescription}>
        Configure the Atlassian Automation webhook that runs Rovo and the Confluence space where
        results are parked. Used by the &quot;Run via Rovo (auto)&quot; actions to remove the manual
        copy-paste step. Press Ctrl+Alt+Z again to re-hide all Rovo features.
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
        Parking Page ID
        <input
          className={styles.inputField}
          value={config.parkingPageId}
          placeholder="Confluence page ID the rule edits (recommended — works in personal spaces)"
          onChange={(changeEvent) => updateField('parkingPageId', changeEvent.target.value)}
        />
      </label>

      <label className={styles.adminDescription}>
        Parking Space Key
        <input
          className={styles.inputField}
          value={config.parkingSpaceKey}
          placeholder="Fallback: Confluence space key (used only if no Page ID is set)"
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
