// WizardApp.tsx — The SNow Wizard page: connection banner, Connect (until both systems answer), Home, Settings and the
// job chosen on Home.

import { useState, type ReactElement } from 'react';

import ChangeWizard from '../change/ChangeWizard.tsx';
import PrbWizard from '../prb/PrbWizard.tsx';
import ReviewWizard from '../review/ReviewWizard.tsx';
import ConnectStep from './ConnectStep.tsx';
import ConnectionBanner from './ConnectionBanner.tsx';
import SettingsStep from './SettingsStep.tsx';
import WizardHome from './WizardHome.tsx';
import { isWizardReady, useWizardConnectionStore } from './wizardConnectionStore.ts';
import type { WizardJobId, WizardJobProps } from './wizardJobProps.ts';
import { loadJiraUrl, loadSnowUrl, saveJiraUrl, saveSnowUrl, type SaveAddressResult } from './wizardSettings.ts';
import { useWizardConnections, type WizardAppDependencies } from './useWizardConnections.ts';
import styles from './WizardShell.module.css';

/** Each Home choice and the job screen it opens. */
const WIZARD_JOB_SCREENS: Record<WizardJobId, (props: WizardJobProps) => ReactElement> = {
  change: ChangeWizard,
  prb: PrbWizard,
  review: ReviewWizard,
};

interface WizardAppProps {
  dependencies: WizardAppDependencies;
  appVersion: string;
}

/** The whole Wizard page: Connect until both systems answer, then Home, Settings, or the chosen job. */
export default function WizardApp({ dependencies, appVersion }: WizardAppProps) {
  const { connectSnow, connectJira } = useWizardConnections(dependencies);
  const snowState = useWizardConnectionStore((state) => state.snow);
  const jiraState = useWizardConnectionStore((state) => state.jira);
  const [snowUrl, setSnowUrl] = useState(loadSnowUrl);
  const [jiraUrl, setJiraUrl] = useState(loadJiraUrl);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<WizardJobId | null>(null);
  const isReady = isWizardReady(snowState, jiraState);

  // A changed address is reconnected at once, which is the live check that it works; an unchanged one is left alone.
  function handleSaveSnowUrl(addressText: string): SaveAddressResult {
    const saveResult = saveSnowUrl(addressText);
    if (saveResult.isSaved && saveResult.address !== snowUrl) {
      setSnowUrl(saveResult.address);
      connectSnow(saveResult.address);
    }
    return saveResult;
  }

  function handleSaveJiraUrl(addressText: string): SaveAddressResult {
    const saveResult = saveJiraUrl(addressText);
    if (saveResult.isSaved && saveResult.address !== jiraUrl) {
      setJiraUrl(saveResult.address);
      connectJira(saveResult.address);
    }
    return saveResult;
  }

  function renderMainArea(): ReactElement | null {
    if (isSettingsOpen) {
      return (
        <SettingsStep snowUrl={snowUrl} jiraUrl={jiraUrl} appVersion={appVersion} onSaveSnowUrl={handleSaveSnowUrl}
          onSaveJiraUrl={handleSaveJiraUrl} onClose={() => setIsSettingsOpen(false)} />
      );
    }
    // A job stays open even if a connection drops mid-step: the banner offers the reconnect and the step is kept.
    if (activeJobId) {
      const ActiveJobScreen = WIZARD_JOB_SCREENS[activeJobId];
      return <ActiveJobScreen onExit={() => setActiveJobId(null)} />;
    }
    return <WizardHome isReady={isReady} onOpenSettings={() => setIsSettingsOpen(true)} onChooseJob={setActiveJobId} />;
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>SNow Wizard</h1>
      <ConnectionBanner snowState={snowState} jiraState={jiraState} onConnectSnow={() => connectSnow(snowUrl)} onConnectJira={() => connectJira(jiraUrl)} />
      {!isReady && !isSettingsOpen && (
        <ConnectStep snowState={snowState} jiraState={jiraState} snowUrl={snowUrl} jiraUrl={jiraUrl} onConnectSnow={() => connectSnow(snowUrl)}
          onConnectJira={() => connectJira(jiraUrl)} onOpenSettings={() => setIsSettingsOpen(true)} />
      )}
      {renderMainArea()}
      <p className={styles.hint}>SNow Wizard {appVersion}</p>
    </main>
  );
}
