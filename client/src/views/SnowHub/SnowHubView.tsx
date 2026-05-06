// SnowHubView.tsx — Top-level SNow Hub page with tabs for CRG, PRB generation, and release management.

import { useState } from 'react';

import CrgTab from './tabs/CrgTab.tsx';
import PrbTab from './tabs/PrbTab.tsx';
import ReleaseManagementTab from './tabs/ReleaseManagementTab.tsx';
import styles from './SnowHubView.module.css';

const VIEW_TITLE = 'SNow Hub';
const VIEW_SUBTITLE = 'Manage change generation, PRB conversion, and release coordination from one ServiceNow-focused workspace.';
const TAB_OPTIONS = [
  { key: 'crg', label: 'CRG' },
  { key: 'prb', label: 'PRB Generator' },
  { key: 'release', label: 'Release Management' },
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
      <div aria-label="SNow Hub tabs" className={styles.tabList} role="tablist">
        {TAB_OPTIONS.map((tabOption) => {
          const isActiveTab = tabOption.key === activeTab;
          const buttonClassName = isActiveTab ? `${styles.tabButton} ${styles.activeTab}` : styles.tabButton;

          return (
            <button
              aria-controls={`${tabOption.key}-panel`}
              aria-selected={isActiveTab}
              className={buttonClassName}
              id={`${tabOption.key}-tab`}
              key={tabOption.key}
              onClick={() => setActiveTab(tabOption.key)}
              role="tab"
              type="button"
            >
              {tabOption.label}
            </button>
          );
        })}
      </div>
      <section
        aria-labelledby={`${activeTab}-tab`}
        className={styles.panelSurface}
        id={`${activeTab}-panel`}
        role="tabpanel"
      >
        {renderActiveTabPanel(activeTab)}
      </section>
    </div>
  );
}
