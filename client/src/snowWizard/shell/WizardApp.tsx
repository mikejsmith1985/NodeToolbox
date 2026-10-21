// WizardApp.tsx — The SNow Wizard window: connection banner, Connect (until both systems answer), Home, Settings and
// the job chosen on Home.

import { useState, type ReactElement } from 'react';

import ChangeWizard from '../change/ChangeWizard.tsx';
import PrbWizard from '../prb/PrbWizard.tsx';
import ReviewWizard from '../review/ReviewWizard.tsx';
import ConnectStep from './ConnectStep.tsx';
import ConnectionBanner from './ConnectionBanner.tsx';
import SettingsStep from './SettingsStep.tsx';
import UpdateWizardSection from './UpdateWizardSection.tsx';
import WizardHome from './WizardHome.tsx';
import { isWizardReady, useWizardConnectionStore } from './wizardConnectionStore.ts';
import type { WizardJobId, WizardJobProps } from './wizardJobProps.ts';
import { loadJiraUrl, saveJiraUrl, type SaveJiraUrlResult } from './wizardSettings.ts';
import { useWizardConnections, type WizardAppDependencies, type WizardBoot } from './useWizardConnections.ts';
import styles from './WizardShell.module.css';

/** Each Home choice and the job screen it opens. */
const WIZARD_JOB_SCREENS: Record<WizardJobId, (props: WizardJobProps) => ReactElement> = {
  change: ChangeWizard,
  prb: PrbWizard,
  review: ReviewWizard,
};

interface WizardAppProps {
  boot: WizardBoot;
  dependencies: WizardAppDependencies;
  appVersion: string;
}

/** The whole Wizard window: Connect until both systems answer, then Home, Settings, or the chosen job. */
export default function WizardApp({ boot, dependencies, appVersion }: WizardAppProps) {
  const { openJira } = useWizardConnections(boot, dependencies);
  const snowState = useWizardConnectionStore((state) => state.snow);
  const jiraState = useWizardConnectionStore((state) => state.jira);
  const [jiraUrl, setJiraUrl] = useState(loadJiraUrl);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<WizardJobId | null>(null);
  const isReady = isWizardReady(snowState, jiraState);

  function handleSaveJiraUrl(addressText: string): SaveJiraUrlResult {
    const saveResult = saveJiraUrl(addressText);
    if (saveResult.isSaved) {
      setJiraUrl(saveResult.jiraUrl);
      openJira(saveResult.jiraUrl);
    }
    return saveResult;
  }

  function renderMainArea(): ReactElement {
    if (isSettingsOpen) {
      return (
        <>
          <SettingsStep jiraUrl={jiraUrl} onSaveJiraUrl={handleSaveJiraUrl} onClose={() => setIsSettingsOpen(false)} />
          <UpdateWizardSection boot={boot} appVersion={appVersion} />
        </>
      );
    }
    // A job stays open even if a connection drops mid-step: the banner offers the reconnect and the step is kept.
    if (activeJobId) {
      const ActiveJobScreen = WIZARD_JOB_SCREENS[activeJobId];
      return <ActiveJobScreen onExit={() => setActiveJobId(null)} />;
    }
    // Until both systems answer, Connect is the only thing on screen — one button, then Home.
    if (!isReady) return <button type="button" className={styles.secondaryButton} onClick={() => setIsSettingsOpen(true)}>Settings</button>;
    return <WizardHome isReady={isReady} onOpenSettings={() => setIsSettingsOpen(true)} onChooseJob={setActiveJobId} />;
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>SNow Wizard</h1>
      <ConnectionBanner snowState={snowState} jiraState={jiraState} onOpenJira={() => openJira(jiraUrl)} />
      {!isReady && <ConnectStep snowState={snowState} jiraState={jiraState} jiraUrl={jiraUrl} onOpenJira={() => openJira(jiraUrl)} />}
      {renderMainArea()}
      <p className={styles.hint}>SNow Wizard {appVersion}</p>
    </main>
  );
}
