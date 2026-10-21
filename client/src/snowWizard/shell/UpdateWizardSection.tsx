// UpdateWizardSection.tsx — Settings → "Update the SNow Wizard": choose the new snow-hub-wizard.html, it is kept in
// ServiceNow's own storage, and "Restart now" opens the new version in this same window. The bookmark never changes
// (owner feedback, GH #475: every release used to mean deleting and re-dragging it).

import { useState, type ChangeEvent } from 'react';

import {
  assembleWizardHtml,
  buildWizardWindowTemplate,
  encodeBootJson,
  INSTALL_STORE_CONFIG,
  openInstallStore,
  parseInstallFile,
  writeInstalledWizard,
  type InstalledWizard,
} from '../install/wizardInstall.ts';
import type { WizardBoot } from './useWizardConnections.ts';
import styles from './WizardShell.module.css';

/** What the update needs outside itself, injected so it can be tested without real storage or navigation. */
export interface WizardUpdateDependencies {
  saveInstalledWizard: (installedWizard: InstalledWizard) => Promise<void>;
  /** Replaces this window's page with the given one. */
  openPage: (pageHtml: string) => void;
}

const REAL_UPDATE_DEPENDENCIES: WizardUpdateDependencies = {
  saveInstalledWizard: (installedWizard) => writeInstalledWizard(INSTALL_STORE_CONFIG, openInstallStore, installedWizard),
  openPage: (pageHtml) => window.location.replace(URL.createObjectURL(new Blob([pageHtml], { type: 'text/html' }))),
};

type UpdateOutcome =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'notWizardFile' }
  | { status: 'notKept'; message: string }
  | { status: 'installed'; installedWizard: InstalledWizard };

interface UpdateWizardSectionProps {
  boot: WizardBoot;
  appVersion: string;
  dependencies?: WizardUpdateDependencies;
}

/** The update section on the Settings screen, with a ✓/✗ result for every attempt. */
export default function UpdateWizardSection({ boot, appVersion, dependencies = REAL_UPDATE_DEPENDENCIES }: UpdateWizardSectionProps) {
  const [outcome, setOutcome] = useState<UpdateOutcome>({ status: 'idle' });

  async function handleFileChosen(changeEvent: ChangeEvent<HTMLInputElement>) {
    const chosenFile = changeEvent.target.files?.[0];
    if (!chosenFile) return;
    setOutcome({ status: 'working' });
    const installedWizard = parseInstallFile(await chosenFile.text(), INSTALL_STORE_CONFIG);
    if (!installedWizard) {
      setOutcome({ status: 'notWizardFile' });
      return;
    }
    try {
      await dependencies.saveInstalledWizard(installedWizard);
      setOutcome({ status: 'installed', installedWizard });
    } catch (saveError) {
      setOutcome({ status: 'notKept', message: (saveError as Error)?.message || 'the browser refused' });
    }
  }

  function handleRestart(installedWizard: InstalledWizard) {
    dependencies.openPage(assembleWizardHtml(buildWizardWindowTemplate(), installedWizard, encodeBootJson(boot), INSTALL_STORE_CONFIG));
  }

  return (
    <section className={styles.card} aria-labelledby="wizard-update-heading">
      <h2 id="wizard-update-heading" className={styles.cardTitle}>Update the SNow Wizard</h2>
      <p className={styles.hint}>
        {`This is ${appVersion}. To update, download the new snow-hub-wizard.html and choose it here — your bookmark stays as it is.`}
      </p>
      <label className={styles.fieldLabel} htmlFor="wizard-update-file">The new snow-hub-wizard.html</label>
      <input id="wizard-update-file" type="file" accept=".html,text/html" onChange={(changeEvent) => void handleFileChosen(changeEvent)} />
      <UpdateOutcomeLine outcome={outcome} onRestart={handleRestart} />
    </section>
  );
}

function UpdateOutcomeLine({ outcome, onRestart }: { outcome: UpdateOutcome; onRestart: (installedWizard: InstalledWizard) => void }) {
  if (outcome.status === 'idle') return null;
  if (outcome.status === 'working') return <p role="status" className={styles.hint}>Installing…</p>;
  if (outcome.status === 'notWizardFile') return <p role="alert" className={styles.hint}>✗ That is not the SNow Wizard file (snow-hub-wizard.html). Nothing was changed.</p>;
  if (outcome.status === 'notKept') return <p role="alert" className={styles.hint}>{`✗ Not installed — ${outcome.message}. Nothing was changed.`}</p>;
  const { installedWizard } = outcome;
  return (
    <div role="status">
      <p className={styles.hint}>{`✓ SNow Wizard ${installedWizard.version} is installed. The bookmark opens it from now on.`}</p>
      <button type="button" className={styles.primaryButton} onClick={() => onRestart(installedWizard)}>
        {`Restart now with ${installedWizard.version}`}
      </button>
    </div>
  );
}
