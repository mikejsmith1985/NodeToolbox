// TodayDashboard.tsx — "Today" landing tab of My Issues.
//
// A deterministic, at-a-glance daily checklist for a Scrum Master: one card per daily
// Jira-hygiene duty, each with a live count derived from data the product already pulls
// and a one-click deep link to where the work is done. No AI dependency.
//
// This component is purely the composition layer — it wires the per-card orchestration hook
// and the daily check-off hook to the card, snapshot, and navigation UI.

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import CategoryCard from './CategoryCard.tsx';
import SprintFlowSnapshot from './SprintFlowSnapshot.tsx';
import { CATEGORY_CATALOG, type CategoryId } from './todayCategories.ts';
import {
  useTodayDashboard,
  type CategoryResult,
  type TodayDestination,
} from './hooks/useTodayDashboard.ts';
import { useChecklistCompletion } from './hooks/useChecklistCompletion.ts';
import styles from './TodayDashboard.module.css';

const VIEW_HEADING = 'Today';
const VIEW_SUBHEADING = 'Your daily Jira-hygiene checklist — everything that needs you today.';
const CONNECTION_REQUIRED_MESSAGE =
  'Connect to Jira to load your daily checklist. Configure the connection in Settings.';
const DONE_FOR_TODAY_MESSAGE = "🎉 You're done for today — every duty is cleared.";

const DEFAULT_MY_ISSUES_TAB = 'report';
const DEFAULT_SPRINT_TAB = 'overview';
const MY_ISSUES_PATH = '/my-issues';
const SPRINT_DASHBOARD_PATH = '/sprint-dashboard';
const DSU_BOARD_PATH = '/dsu-board';

/** Reduces the per-card results to a count lookup the checklist hook can merge with manual state. */
function buildCountByCategory(
  categories: Record<CategoryId, CategoryResult>,
): Record<CategoryId, number> {
  const countByCategory = {} as Record<CategoryId, number>;
  for (const catalogEntry of CATEGORY_CATALOG) {
    countByCategory[catalogEntry.id] = categories[catalogEntry.id].count;
  }
  return countByCategory;
}

/** Renders the Today dashboard: connection gate, category cards, snapshot, and done state. */
export default function TodayDashboard() {
  const navigate = useNavigate();
  const dashboard = useTodayDashboard();
  const countByCategory = useMemo(
    () => buildCountByCategory(dashboard.categories),
    [dashboard.categories],
  );
  const completion = useChecklistCompletion(countByCategory);

  /** Resolves a card destination into a single navigation action (FR-009/FR-010). */
  function handleNavigate(destination: TodayDestination) {
    if (destination.kind === 'myIssuesTab') {
      // Carry the destination's scope params so the landing tab answers the SAME question the
      // card counted (e.g. cross-project stale scope), not whatever scope it last persisted.
      const queryParams = new URLSearchParams({
        tab: destination.tab ?? DEFAULT_MY_ISSUES_TAB,
        ...(destination.search ?? {}),
      });
      navigate(`${MY_ISSUES_PATH}?${queryParams.toString()}`);
      return;
    }

    if (destination.kind === 'sprintTab') {
      // The Sprint Dashboard reopens to its last active tab, so set it before navigating.
      useSettingsStore.getState().setSprintDashboardActiveTab(destination.tab ?? DEFAULT_SPRINT_TAB);
      navigate(SPRINT_DASHBOARD_PATH);
      return;
    }

    navigate(DSU_BOARD_PATH);
  }

  if (!dashboard.isConnectionReady) {
    return (
      <div className={styles.todayDashboard} data-testid="today-dashboard">
        <header className={styles.dashboardHeader}>
          <h2 className={styles.dashboardHeading}>{VIEW_HEADING}</h2>
          <p className={styles.dashboardSubheading}>{VIEW_SUBHEADING}</p>
        </header>
        <p className={styles.connectionRequired} role="status">{CONNECTION_REQUIRED_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className={styles.todayDashboard} data-testid="today-dashboard">
      <header className={styles.dashboardHeader}>
        <div>
          <h2 className={styles.dashboardHeading}>{VIEW_HEADING}</h2>
          <p className={styles.dashboardSubheading}>{VIEW_SUBHEADING}</p>
        </div>
        <button className={styles.refreshButton} onClick={dashboard.refresh} type="button">
          Refresh
        </button>
      </header>

      {completion.isDoneForToday && (
        <p className={styles.doneForToday} role="status">{DONE_FOR_TODAY_MESSAGE}</p>
      )}

      <div className={styles.cardGrid}>
        {CATEGORY_CATALOG.map((catalogEntry) => (
          <CategoryCard
            key={catalogEntry.id}
            entry={catalogEntry}
            result={dashboard.categories[catalogEntry.id]}
            isComplete={completion.completionByCategory[catalogEntry.id]}
            onToggleComplete={() => { void completion.toggle(catalogEntry.id); }}
            onNavigate={handleNavigate}
            onRetry={dashboard.refresh}
          />
        ))}
      </div>

      <SprintFlowSnapshot sprintIssues={dashboard.sprintIssues} sprintInfo={dashboard.sprintInfo} />
    </div>
  );
}
