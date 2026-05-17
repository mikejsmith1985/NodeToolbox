// SnowHubView.tsx — Top-level SNow Hub page with tabs for CHG generation, PRB conversion, and release management.

import { useState } from 'react';

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import ConfigurationTab from './tabs/ConfigurationTab.tsx';
import CrgTab from './tabs/CrgTab.tsx';
import PrbTab from './tabs/PrbTab.tsx';
import ReleaseManagementTab from './tabs/ReleaseManagementTab.tsx';
import SyncMonitorTab from './tabs/SyncMonitorTab.tsx';
import styles from './SnowHubView.module.css';

const VIEW_TITLE = 'SNow Hub';
const VIEW_SUBTITLE = 'Manage change generation, PRB conversion, and release coordination from one ServiceNow-focused workspace.';
const TAB_OPTIONS = [
  { key: 'crg', label: 'CHG' },
  { key: 'config', label: 'Configuration' },
  { key: 'prb', label: 'PRB Generator' },
  { key: 'release', label: 'Release Management' },
  { key: 'sync', label: 'Sync Monitor' },
] as const;

type SnowHubTabKey = (typeof TAB_OPTIONS)[number]['key'];
const DEFAULT_TAB_KEY: SnowHubTabKey = 'crg';

function renderActiveTabPanel(activeTab: SnowHubTabKey) {
  if (activeTab === 'crg') {
    return <CrgTab />;
  }

  if (activeTab === 'prb') {
    return <PrbTab />;
  }

  if (activeTab === 'config') {
    return <ConfigurationTab />;
  }

  if (activeTab === 'sync') {
    return <SyncMonitorTab />;
  }

  return <ReleaseManagementTab />;
}

/**
 * Renders the SNow Hub view so users can switch between change generation, PRB conversion, and release management workflows.
 */
export default function SnowHubView() {
  const [activeTab, setActiveTab] = useState<SnowHubTabKey>(DEFAULT_TAB_KEY);

  return (
    <div className={styles.snowHubView}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>
      <PrimaryTabs
        ariaLabel="SNow Hub tabs"
        idPrefix="snow-hub"
        tabs={TAB_OPTIONS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      <section
        aria-labelledby={`snow-hub-${activeTab}-tab`}
        className={styles.panelSurface}
        id={`snow-hub-${activeTab}-panel`}
        role="tabpanel"
      >
        {renderActiveTabPanel(activeTab)}
      </section>
    </div>
  );
}
