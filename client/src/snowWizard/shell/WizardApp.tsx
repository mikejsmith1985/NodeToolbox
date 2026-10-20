// WizardApp.tsx — The SNow Wizard window: connection banner, Connect (until both systems answer), Home and Settings.

import { useState } from 'react';

import ConnectStep from './ConnectStep.tsx';
import ConnectionBanner from './ConnectionBanner.tsx';
import SettingsStep from './SettingsStep.tsx';
import WizardHome from './WizardHome.tsx';
import { isWizardReady, useWizardConnectionStore } from './wizardConnectionStore.ts';
import { loadJiraUrl, saveJiraUrl, type SaveJiraUrlResult } from './wizardSettings.ts';
import { useWizardConnections, type WizardAppDependencies, type WizardBoot } from './useWizardConnections.ts';
import styles from './WizardShell.module.css';

interface WizardAppProps {
  boot: WizardBoot;
  dependencies: WizardAppDependencies;
  appVersion: string;
}

/** The whole Wizard window. Each job will open from Home as it is delivered (US1–US4). */
export default function WizardApp({ boot, dependencies, appVersion }: WizardAppProps) {
  const { openJira } = useWizardConnections(boot, dependencies);
  const snowState = useWizardConnectionStore((state) => state.snow);
  const jiraState = useWizardConnectionStore((state) => state.jira);
  const [jiraUrl, setJiraUrl] = useState(loadJiraUrl);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isReady = isWizardReady(snowState, jiraState);

  function handleSaveJiraUrl(addressText: string): SaveJiraUrlResult {
    const saveResult = saveJiraUrl(addressText);
    if (saveResult.isSaved) {
      setJiraUrl(saveResult.jiraUrl);
      openJira(saveResult.jiraUrl);
    }
    return saveResult;
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>SNow Wizard</h1>
      <ConnectionBanner snowState={snowState} jiraState={jiraState} onOpenJira={() => openJira(jiraUrl)} />
      {!isReady && <ConnectStep snowState={snowState} jiraState={jiraState} jiraUrl={jiraUrl} onOpenJira={() => openJira(jiraUrl)} />}
      {isSettingsOpen
        ? <SettingsStep jiraUrl={jiraUrl} onSaveJiraUrl={handleSaveJiraUrl} onClose={() => setIsSettingsOpen(false)} />
        : <WizardHome isReady={isReady} onOpenSettings={() => setIsSettingsOpen(true)} />}
      <p className={styles.hint}>SNow Wizard {appVersion}</p>
    </main>
  );
}
