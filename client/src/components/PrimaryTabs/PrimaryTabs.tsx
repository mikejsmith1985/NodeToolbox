// PrimaryTabs.tsx — Shared top-level tab navigation used across toolbox views.

import styles from './PrimaryTabs.module.css';

export interface PrimaryTabOption<TTabKey extends string> {
  key: TTabKey;
  label: string;
}

interface PrimaryTabsProps<TTabKey extends string> {
  tabs: readonly PrimaryTabOption<TTabKey>[];
  activeTab: TTabKey;
  onChange: (tabKey: TTabKey) => void;
  ariaLabel: string;
  idPrefix?: string;
}

/** Renders a shared sticky tablist so all tools follow one consistent navigation pattern. */
export function PrimaryTabs<TTabKey extends string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  idPrefix = 'tool',
}: PrimaryTabsProps<TTabKey>) {
  return (
    <div className={styles.tabList} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tabOption) => {
        const isActiveTab = tabOption.key === activeTab;
        const tabId = `${idPrefix}-${tabOption.key}-tab`;
        const panelId = `${idPrefix}-${tabOption.key}-panel`;
        return (
          <button
            key={tabOption.key}
            type="button"
            role="tab"
            id={tabId}
            aria-controls={panelId}
            aria-selected={isActiveTab}
            className={`${styles.tabButton} ${isActiveTab ? styles.activeTab : ''}`}
            onClick={() => onChange(tabOption.key)}
          >
            {tabOption.label}
          </button>
        );
      })}
    </div>
  );
}
