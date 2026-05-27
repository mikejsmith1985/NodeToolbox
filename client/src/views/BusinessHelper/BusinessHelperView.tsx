// BusinessHelperView.tsx — Top-level Business Helper page with business-facing Jira utility tabs.

import { useState } from 'react';

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import ViewFrame from '../../components/ViewFrame/ViewFrame.tsx';
import SimpleSearchTab from './tabs/SimpleSearchTab.tsx';
import BusinessHelperSettingsTab from './tabs/BusinessHelperSettingsTab.tsx';
import StablizationFundingTab from './tabs/StablizationFundingTab.tsx';
import styles from './BusinessHelperView.module.css';

const VIEW_TITLE = 'Business Helper';
const VIEW_SUBTITLE =
  'Use guided Jira tools built for business users, including Simple Search, the stablization funding table, and table settings.';
const TAB_OPTIONS = [
  { key: 'simple-search', label: 'Simple Search' },
  { key: 'stablization', label: 'Stablization' },
  { key: 'settings', label: 'Settings' },
] as const;

type BusinessHelperTabKey = (typeof TAB_OPTIONS)[number]['key'];
const DEFAULT_TAB_KEY: BusinessHelperTabKey = 'simple-search';

function renderActiveTabPanel(activeTab: BusinessHelperTabKey) {
  if (activeTab === 'simple-search') {
    return <SimpleSearchTab />;
  }

  if (activeTab === 'stablization') {
    return <StablizationFundingTab />;
  }

  if (activeTab === 'settings') {
    return <BusinessHelperSettingsTab />;
  }

  return null;
}

/** Renders the Business Helper workspace so business users can switch between guided utility tabs. */
export default function BusinessHelperView() {
  const [activeTab, setActiveTab] = useState<BusinessHelperTabKey>(DEFAULT_TAB_KEY);

  return (
    <ViewFrame title={VIEW_TITLE} subtitle={VIEW_SUBTITLE} width="full">
      <PrimaryTabs
        ariaLabel="Business Helper tabs"
        idPrefix="business-helper"
        tabs={TAB_OPTIONS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />
      <section
        aria-labelledby={`business-helper-${activeTab}-tab`}
        className={styles.panelSurface}
        id={`business-helper-${activeTab}-panel`}
        role="tabpanel"
      >
        {renderActiveTabPanel(activeTab)}
      </section>
    </ViewFrame>
  );
}
