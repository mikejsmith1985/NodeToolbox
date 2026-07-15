// AiAssistAutomationPanel.tsx — Config form for the automated AI Assist exchange.
//
// Holds the single Atlassian Automation/AI Assist webhook + secret and the Confluence
// parking space used by the "Run via AI Assist (auto)" actions. Unlock/hide and the
// passphrase gate are handled by AdminHubView, which only renders this panel on
// the "⚡ AI Assist" tab (shown only while the AI Assist capability is unlocked).

import { useCallback, useEffect, useState } from 'react';

import styles from './AdminHubView.module.css';

/**
 * The config as the server reports it.
 *
 * The webhook secret is deliberately absent: the server never returns it, the same way it never returns
 * the Jira or Confluence credentials. This form only needs to know whether one is set.
 */
interface AiAssistConfig {
  webhookUrl: string;
  hasWebhookSecret: boolean;
  parkingSpaceKey: string;
  parkingPageId: string;
  isEnabled: boolean;
}

const EMPTY_CONFIG: AiAssistConfig = { webhookUrl: '', hasWebhookSecret: false, parkingSpaceKey: '', parkingPageId: '', isEnabled: false };

async function fetchAiAssistConfig(): Promise<AiAssistConfig> {
  const response = await fetch('/api/ai-assist/config');
  return (await response.json()) as AiAssistConfig;
}

/**
 * Saves the config.
 *
 * A blank secret means "leave the saved one alone" — the form was never given it, so it cannot send it
 * back, and sending blank must not wipe it. Clearing is an explicit act, hence the separate flag.
 */
async function saveAiAssistConfig(
  config: AiAssistConfig,
  webhookSecretInput: string,
  shouldClearWebhookSecret: boolean,
): Promise<void> {
  const response = await fetch('/api/ai-assist/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookUrl: config.webhookUrl,
      parkingSpaceKey: config.parkingSpaceKey,
      parkingPageId: config.parkingPageId,
      isEnabled: config.isEnabled,
      webhookSecret: webhookSecretInput,
      clearWebhookSecret: shouldClearWebhookSecret,
    }),
  });
  if (!response.ok) throw new Error('Failed to save AI Assist config: ' + response.statusText);
}

async function testAiAssistDispatch(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch('/api/ai-assist/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correlationId: 'ai-assist-config-test', prompt: 'Connection test from NodeToolbox.' }),
  });
  const body = (await response.json()) as { ok?: boolean; message?: string };
  return { ok: Boolean(body.ok), message: body.message ?? (body.ok ? 'Dispatched.' : 'Dispatch failed.') };
}

/** Renders the AI Assist Automation config form. Rendered only when the AI Assist tab is active (unlocked). */
export function AiAssistAutomationPanel() {
  const [config, setConfig] = useState<AiAssistConfig>(EMPTY_CONFIG);
  // Held separately from `config` because it is write-only: it is never loaded, only ever sent.
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [shouldClearWebhookSecret, setShouldClearWebhookSecret] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void fetchAiAssistConfig().then(setConfig).catch(() => { /* leave defaults on failure */ });
  }, []);

  const updateField = useCallback((field: keyof AiAssistConfig, value: string | boolean) => {
    setConfig((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setIsBusy(true);
    setStatusMessage(null);
    try {
      await saveAiAssistConfig(config, webhookSecretInput, shouldClearWebhookSecret);
      // Re-read so the form reflects what the server actually holds now.
      setConfig(await fetchAiAssistConfig());
      setWebhookSecretInput('');
      setShouldClearWebhookSecret(false);
      setStatusMessage('Saved.');
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Save failed.');
    } finally {
      setIsBusy(false);
    }
  }, [config, webhookSecretInput, shouldClearWebhookSecret]);

  const handleTest = useCallback(async () => {
    setIsBusy(true);
    setStatusMessage('Testing…');
    const result = await testAiAssistDispatch();
    setStatusMessage(result.message);
    setIsBusy(false);
  }, []);

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>⚡ AI Assist Automation</h2>
      <p className={styles.adminDescription}>
        Configure the Atlassian Automation webhook that runs AI Assist and the Confluence space where
        results are parked. Used by the &quot;Run via AI Assist (auto)&quot; actions to remove the manual
        copy-paste step. Press Ctrl+Alt+Z again to re-hide all AI Assist features.
      </p>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="ai-assist-webhook-url">AI Assist Webhook URL</label>
        <input
          id="ai-assist-webhook-url"
          className={styles.textInput}
          value={config.webhookUrl}
          placeholder="https://…atlassian.net/… incoming webhook URL"
          onChange={(changeEvent) => updateField('webhookUrl', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="ai-assist-webhook-secret">Webhook Secret</label>
        <input
          id="ai-assist-webhook-secret"
          className={styles.textInput}
          type="password"
          value={webhookSecretInput}
          disabled={shouldClearWebhookSecret}
          placeholder={
            config.hasWebhookSecret
              ? 'A secret is saved — type here only to replace it'
              : 'X-Automation-Webhook-Token (optional)'
          }
          onChange={(changeEvent) => setWebhookSecretInput(changeEvent.target.value)}
        />
        <p className={styles.adminDescription}>
          {config.hasWebhookSecret
            ? 'A secret is saved. For your safety it is never sent back to this screen, so it stays blank here — leave it blank and your saved secret is kept.'
            : 'No secret is saved yet.'}
        </p>
        {config.hasWebhookSecret ? (
          <label className={styles.fieldLabel} htmlFor="ai-assist-clear-secret">
            <input
              id="ai-assist-clear-secret"
              type="checkbox"
              checked={shouldClearWebhookSecret}
              onChange={(changeEvent) => setShouldClearWebhookSecret(changeEvent.target.checked)}
            />
            {' '}Remove the saved secret when I save
          </label>
        ) : null}
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="ai-assist-parking-page-id">Parking Page ID</label>
        <input
          id="ai-assist-parking-page-id"
          className={styles.textInput}
          value={config.parkingPageId}
          placeholder="Confluence page ID the rule edits (recommended — works in personal spaces)"
          onChange={(changeEvent) => updateField('parkingPageId', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="ai-assist-parking-space-key">Parking Space Key</label>
        <input
          id="ai-assist-parking-space-key"
          className={styles.textInput}
          value={config.parkingSpaceKey}
          placeholder="Fallback: Confluence space key (used only if no Page ID is set)"
          onChange={(changeEvent) => updateField('parkingSpaceKey', changeEvent.target.value)}
        />
      </div>

      <label className={styles.fieldLabel}>
        <input
          type="checkbox"
          checked={config.isEnabled}
          onChange={(changeEvent) => updateField('isEnabled', changeEvent.target.checked)}
          style={{ marginRight: '0.5rem' }}
        />
        Enabled
      </label>

      <div className={styles.inputRow}>
        <button className={styles.saveButton} disabled={isBusy} onClick={() => void handleSave()} type="button">
          Save
        </button>
        <button className={styles.actionButton} disabled={isBusy || !config.webhookUrl} onClick={() => void handleTest()} type="button">
          Test
        </button>
      </div>

      {statusMessage !== null ? <p className={styles.fieldLabel} role="status" style={{ marginTop: 0 }}>{statusMessage}</p> : null}
    </section>
  );
}
