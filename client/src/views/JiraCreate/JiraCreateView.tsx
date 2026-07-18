// JiraCreateView.tsx — Thin shell merging the Jira Template Maker and Jira Intake into one tool.
//
// The shell owns NOTHING but the tab choice (the Agile Hub pattern): each tab mounts one of the
// pre-merge views completely unchanged, so both tools keep every capability and saved state they
// had as standalone cards. The old routes redirect here with their query params intact.

import { useSearchParams } from 'react-router-dom';

import JiraIntake from '../JiraIntake/JiraIntake.tsx';
import JiraTemplateMaker from '../JiraTemplateMaker/JiraTemplateMaker.tsx';
import styles from './JiraCreateView.module.css';

/** The two ways to create Jira issues — reusable templates, or imported request submissions. */
const JIRA_CREATE_TABS = [
  { key: 'templates', label: '🧩 Templates' },
  { key: 'intake', label: '📥 Intake' },
] as const;

type JiraCreateTab = (typeof JIRA_CREATE_TABS)[number]['key'];

const TAB_QUERY_PARAM = 'tab';
const DEFAULT_JIRA_CREATE_TAB: JiraCreateTab = 'templates';

/** Narrows an arbitrary string (URL param) to a valid tab. */
function isJiraCreateTab(candidateValue: string | null): candidateValue is JiraCreateTab {
  return JIRA_CREATE_TABS.some((tabDef) => tabDef.key === candidateValue);
}

/** Renders the tab switcher and mounts exactly one unchanged pre-merge view per tab. */
export default function JiraCreateView() {
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL param is authoritative (deep links, redirects); anything invalid lands on Templates.
  const requestedTab = searchParams.get(TAB_QUERY_PARAM);
  const activeTab: JiraCreateTab = isJiraCreateTab(requestedTab) ? requestedTab : DEFAULT_JIRA_CREATE_TAB;

  function handleSelectTab(nextTab: JiraCreateTab): void {
    setSearchParams(
      (previousParams) => {
        // Only the tab changes; foreign params (e.g. a shared template link) belong to the mounted view.
        const nextParams = new URLSearchParams(previousParams);
        nextParams.set(TAB_QUERY_PARAM, nextTab);
        return nextParams;
      },
      { replace: true },
    );
  }

  return (
    <div className={styles.jiraCreate}>
      <nav aria-label="Jira Create tabs" className={styles.tabSwitcher}>
        {JIRA_CREATE_TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            aria-pressed={activeTab === tabDef.key}
            className={activeTab === tabDef.key ? styles.tabButtonActive : styles.tabButton}
            type="button"
            onClick={() => handleSelectTab(tabDef.key)}
          >
            {tabDef.label}
          </button>
        ))}
      </nav>

      {activeTab === 'templates' && <JiraTemplateMaker />}
      {activeTab === 'intake' && <JiraIntake />}
    </div>
  );
}
