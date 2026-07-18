// App.tsx — Top-level layout shell for the React SPA.
//
// This component owns the global layout, mounts the shared polling hooks, and
// routes placeholder views until later migration phases replace them.

import type { ReactNode } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { AiAssistUnlockGate } from './components/AiAssistUnlockGate/index.tsx';
import { TodoQuickAddGate } from './components/TodoQuickAdd/index.tsx';
import { ConnectionBar } from './components/ConnectionBar/index.ts';
import { ToastProvider } from './components/Toast/ToastProvider.tsx';
import { useProxyStatus } from './hooks/useProxyStatus.ts';
import { useRelayBridge } from './hooks/useRelayBridge.ts';
import { parseRelayReturnRoute, RELAY_RETURN_ROUTE_KEY } from './services/browserRelay.ts';
import { useAdminStore } from './store/adminStore.ts';
import { useSettingsStore } from './store/settingsStore.ts';
import type { ToolTextSize } from './store/settingsStore.ts';
import { resolveToolIsVisible, useToolVisibilityStore } from './store/toolVisibilityStore.ts';
import type { RelaySystem } from './types/relay.ts';
import { disableDemoModeForCurrentTab, isDemoModeEnabled } from './utils/demoModeStorage.ts';
import AgileHubView from './views/AgileHub/AgileHubView.tsx';
import AdminHubView from './views/AdminHub/AdminHubView.tsx';
import CodeWalkthroughView from './views/CodeWalkthrough/CodeWalkthroughView.tsx';
import DsuBoardView from './views/DsuBoard/DsuBoardView.tsx';
import HomeView from './views/Home/HomeView.tsx';
import JiraCreateView from './views/JiraCreate/JiraCreateView.tsx';
import MyIssuesView from './views/MyIssues/MyIssuesView.tsx';
import PersonalToolboxView from './views/PersonalToolbox/PersonalToolboxView.tsx';
import ReportsHubView from './views/ReportsHub/ReportsHubView.tsx';
import { ReportsHubRuntimeBoundary } from './views/ReportsHub/ReportsHubRuntimeBoundary.tsx';
import SettingsView from './views/Settings/SettingsView.tsx';
import SnowHubView from './views/SnowHub/SnowHubView.tsx';
import { migrateArtTeamPiReviewPagesToProfiles } from './views/SprintDashboard/sprintDashboardArtContext.ts';
import TextToolsView from './views/TextTools/TextToolsView.tsx';
import styles from './App.module.css';

// Lazy-loaded so the React Flow canvas dependency stays off the shared bundle for users who
// never open the Feature Canvas (mirrors the repo's on-demand heavy-import philosophy).
const FeatureCanvasView = lazy(() => import('./views/FeatureCanvas/FeatureCanvasView.tsx'));

const APP_TITLE = 'NodeToolbox';
const HOME_ROUTE = '/';
const SETTINGS_ROUTE = '/settings';
const SNOW_HUB_ROUTE = '/snow-hub';
const JIRA_CREATE_ROUTE = '/jira-create';
const MY_ISSUES_ROUTE = '/my-issues';
const PERSONAL_TOOLBOX_ROUTE = '/personal-toolbox';
const AGILE_HUB_ROUTE = '/agile-hub';
const SPRINT_DASHBOARD_ROUTE = '/sprint-dashboard';
const PO_TOOL_ROUTE = '/po-tool';
const ART_ROUTE = '/art';
const DSU_BOARD_ROUTE = '/dsu-board';
const CODE_WALKTHROUGH_ROUTE = '/code-walkthrough';
const TEXT_TOOLS_ROUTE = '/text-tools';
const REPORTS_HUB_ROUTE = '/reports-hub';
const ADMIN_HUB_ROUTE = '/admin-hub';
const FEATURE_CANVAS_ROUTE = '/feature-canvas';
const DEFAULT_ROUTE = HOME_ROUTE;
const RELAY_SYSTEM: RelaySystem = 'snow';
const SHAREPOINT_RELAY_SYSTEM: RelaySystem = 'sharepoint';
const DEFAULT_TOOL_TEXT_SIZE: ToolTextSize = 'default';
const LARGE_TOOL_TEXT_SIZE: ToolTextSize = 'large';
const EXTRA_LARGE_TOOL_TEXT_SIZE: ToolTextSize = 'extra-large';

interface GatedToolRouteProps {
  /** The home-card id whose visibility/gate state guards this route (spec 020 FR-002/FR-005). */
  cardId: string;
  /** True for tools whose capability is admin-controlled (SNow Hub). */
  requiresAdminUnlock?: boolean;
  children: ReactNode;
}

/**
 * Entry-only gate for a tool route: evaluated ONCE when the route mounts, so a mid-task state
 * change (unlock lapse, visibility toggle) never unmounts an open workspace — the next
 * navigation re-applies the gate (spec 020 edge case). A refused entry lands on the home page.
 */
function GatedToolRoute({ cardId, requiresAdminUnlock = false, children }: GatedToolRouteProps) {
  const [wasAdmittedAtEntry] = useState(() => {
    if (requiresAdminUnlock && !useAdminStore.getState().isAdminUnlocked) return false;
    return resolveToolIsVisible(useToolVisibilityStore.getState().visibilityByCardId, cardId);
  });
  if (!wasAdmittedAtEntry) {
    return <Navigate replace to={HOME_ROUTE} />;
  }
  return <>{children}</>;
}

/**
 * Param-preserving redirect into an Agile Hub space: the retired routes' query strings (e.g. the
 * Today cards' ?hygieneFilter=…) ride along verbatim; only `space` is set (spec 020 FR-010).
 */
function RedirectToAgileHub({ space }: { space: string }) {
  const location = useLocation();
  const forwardedParams = new URLSearchParams(location.search);
  forwardedParams.set('space', space);
  return <Navigate replace to={{ pathname: AGILE_HUB_ROUTE, search: `?${forwardedParams.toString()}` }} />;
}

/**
 * Param-preserving redirect into a Jira Create tab: the retired standalone routes' query strings
 * (e.g. a shared template link) ride along verbatim; only `tab` is set.
 */
function RedirectToJiraCreate({ tab }: { tab: string }) {
  const location = useLocation();
  const forwardedParams = new URLSearchParams(location.search);
  forwardedParams.set('tab', tab);
  return <Navigate replace to={{ pathname: JIRA_CREATE_ROUTE, search: `?${forwardedParams.toString()}` }} />;
}

interface ToolTextSizeButtonConfig {
  ariaLabel: string;
  label: string;
  toolTextSize: ToolTextSize;
}

const TOOL_TEXT_SIZE_BUTTONS: readonly ToolTextSizeButtonConfig[] = [
  { ariaLabel: 'Default text size', label: 'A', toolTextSize: DEFAULT_TOOL_TEXT_SIZE },
  { ariaLabel: 'Large text size', label: 'A+', toolTextSize: LARGE_TOOL_TEXT_SIZE },
  { ariaLabel: 'Extra large text size', label: 'A++', toolTextSize: EXTRA_LARGE_TOOL_TEXT_SIZE },
];

/** Root layout shell for the React migration, including live status hooks and route selection. */
export default function App() {
  const navigate = useNavigate();
  const [isDemoModeActive, setIsDemoModeActive] = useState(() => isDemoModeEnabled());

  useProxyStatus();
  useRelayBridge(RELAY_SYSTEM);
  // Poll the SharePoint relay too (feature 008) — the per-system store keeps it independent of SNow.
  useRelayBridge(SHAREPOINT_RELAY_SYSTEM);

  // After the SNow bookmarklet reloads this window to the root URL, navigate the user
  // back to wherever they were (e.g. /snow-hub) so their CRG wizard data is still there.
  // openSnowRelay() saves the pathname before opening the relay tab.
  useEffect(() => {
    const returnRoute = parseRelayReturnRoute(localStorage.getItem(RELAY_RETURN_ROUTE_KEY));
    if (returnRoute && returnRoute !== '/') {
      localStorage.removeItem(RELAY_RETURN_ROUTE_KEY);
      navigate(returnRoute, { replace: true });
    } else {
      localStorage.removeItem(RELAY_RETURN_ROUTE_KEY);
    }
  }, [navigate]);

  const theme = useSettingsStore((state) => state.theme);
  const toolTextSize = useSettingsStore((state) => state.toolTextSize);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setToolTextSize = useSettingsStore((state) => state.setToolTextSize);

  function handleExitDemoMode() {
    disableDemoModeForCurrentTab();
    setIsDemoModeActive(false);
    window.location.reload();
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-tool-text-size', toolTextSize);
  }, [toolTextSize]);

  // One-time migration: move PI Review pages that lived on legacy ART team records onto the Team
  // Dashboard team profiles (the new single source of truth) so existing pages keep displaying.
  useEffect(() => {
    const settingsState = useSettingsStore.getState();
    const { migratedProfiles, didMigrate } = migrateArtTeamPiReviewPagesToProfiles(
      settingsState.sprintDashboardTeamProfiles,
    );
    if (didMigrate) {
      settingsState.setSprintDashboardTeamProfiles(migratedProfiles);
    }
  }, []);

  return (
    <ToastProvider>
      {/* App-wide hidden AI Assist unlock (Ctrl+Alt+Z) — works from every screen. */}
      <AiAssistUnlockGate />
      {/* App-wide F1 to-do quick-add — captures an item from every screen (list: My Issues → Today). */}
      <TodoQuickAddGate />
      <div className={styles.appShell}>
        <header className={styles.topBar}>
          {/* Left side: app title links back to home — single, standard UX pattern */}
          <div className={styles.topBarLeft}>
            <Link className={styles.homeLink} to={HOME_ROUTE}>
              {APP_TITLE}
            </Link>
          </div>
          <div className={styles.topBarRight}>
            {isDemoModeActive && (
              <div className={styles.demoModeBadge}>
                <span>Demo mode</span>
                <button onClick={handleExitDemoMode} type="button">
                  Exit
                </button>
              </div>
            )}
            <div aria-label="Theme selection" className={styles.themeToggleGroup} role="group">
              <button
                aria-pressed={theme === 'dark'}
                className={`${styles.themeToggleButton} ${theme === 'dark' ? styles.themeToggleButtonActive : ''}`}
                onClick={() => setTheme('dark')}
                type="button"
              >
                Dark
              </button>
              <button
                aria-pressed={theme === 'light'}
                className={`${styles.themeToggleButton} ${theme === 'light' ? styles.themeToggleButtonActive : ''}`}
                onClick={() => setTheme('light')}
                type="button"
              >
                Light
              </button>
            </div>
            <div aria-label="Tool text size" className={styles.toolTextSizeGroup} role="group">
              {TOOL_TEXT_SIZE_BUTTONS.map(({ ariaLabel, label, toolTextSize: buttonToolTextSize }) => (
                <button
                  key={buttonToolTextSize}
                  aria-label={ariaLabel}
                  aria-pressed={toolTextSize === buttonToolTextSize}
                  className={`${styles.toolTextSizeButton} ${toolTextSize === buttonToolTextSize ? styles.toolTextSizeButtonActive : ''}`}
                  onClick={() => setToolTextSize(buttonToolTextSize)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <ConnectionBar />
          </div>
        </header>

        <main className={styles.mainContent}>
          <div className={styles.toolContent}>
            <Routes>
          <Route path={HOME_ROUTE} element={<HomeView />} />
          <Route path={SETTINGS_ROUTE} element={<SettingsView />} />
          {/* SNow connectivity is admin-controlled: entry requires the session unlock (spec 020 FR-002). */}
          <Route
            path={SNOW_HUB_ROUTE}
            element={(
              <GatedToolRoute cardId="snow-hub" requiresAdminUnlock>
                <SnowHubView />
              </GatedToolRoute>
            )}
          />
          {/* Jira Create merges the Template Maker and Intake cards; old routes redirect below. */}
          <Route path={JIRA_CREATE_ROUTE} element={<GatedToolRoute cardId="jira-create"><JiraCreateView /></GatedToolRoute>} />
          <Route path="/jira-template-maker" element={<RedirectToJiraCreate tab="templates" />} />
          <Route path="/jira-intake" element={<RedirectToJiraCreate tab="intake" />} />
          <Route path={MY_ISSUES_ROUTE} element={<GatedToolRoute cardId="my-issues"><MyIssuesView /></GatedToolRoute>} />
          <Route path={PERSONAL_TOOLBOX_ROUTE} element={<GatedToolRoute cardId="personal-toolbox"><PersonalToolboxView /></GatedToolRoute>} />
          {/* The Agile Hub replaces the Team Dashboard / PO Tool / ART View entry points (spec 020 US3). */}
          <Route path={AGILE_HUB_ROUTE} element={<GatedToolRoute cardId="agile-hub"><AgileHubView /></GatedToolRoute>} />
          <Route path={SPRINT_DASHBOARD_ROUTE} element={<RedirectToAgileHub space="team" />} />
          <Route path={PO_TOOL_ROUTE} element={<RedirectToAgileHub space="product" />} />
          <Route path={ART_ROUTE} element={<RedirectToAgileHub space="train" />} />
          <Route path={DSU_BOARD_ROUTE} element={<DsuBoardView />} />
          <Route path={CODE_WALKTHROUGH_ROUTE} element={<GatedToolRoute cardId="code-walkthrough"><CodeWalkthroughView /></GatedToolRoute>} />
          <Route path={TEXT_TOOLS_ROUTE} element={<GatedToolRoute cardId="text-tools"><TextToolsView /></GatedToolRoute>} />
          <Route path={REPORTS_HUB_ROUTE} element={(
            <GatedToolRoute cardId="reports-hub">
              <ReportsHubRuntimeBoundary>
                <ReportsHubView />
              </ReportsHubRuntimeBoundary>
            </GatedToolRoute>
          )}
          />
          <Route path={ADMIN_HUB_ROUTE} element={<AdminHubView />} />
          {/* The Business Helper is retired; its surviving Simple Search lives in the Agile Hub. */}
          <Route path="/business-helper" element={<RedirectToAgileHub space="search" />} />
          <Route
            path={FEATURE_CANVAS_ROUTE}
            element={(
              <GatedToolRoute cardId="feature-canvas">
                <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', opacity: 0.7 }}>Loading Feature Canvas…</div>}>
                  <FeatureCanvasView />
                </Suspense>
              </GatedToolRoute>
            )}
          />
          {/* Legacy team-workflow paths land in the hub's Team space in ONE hop (spec 020 FR-010). */}
          <Route path="/sprint-planning" element={<RedirectToAgileHub space="team" />} />
          <Route path="/pointing" element={<RedirectToAgileHub space="team" />} />
          <Route path="/standup" element={<RedirectToAgileHub space="team" />} />
          <Route path="/dsu-daily" element={<RedirectToAgileHub space="team" />} />
          <Route path="/metrics" element={<RedirectToAgileHub space="team" />} />
          <Route path="/pipeline" element={<RedirectToAgileHub space="team" />} />
          <Route path="/defects" element={<RedirectToAgileHub space="team" />} />
          <Route path="/release-monitor" element={<RedirectToAgileHub space="team" />} />
          <Route path="/work-log" element={<Navigate to={MY_ISSUES_ROUTE} replace />} />
          <Route path="/mermaid" element={<Navigate to={TEXT_TOOLS_ROUTE} replace />} />
          <Route path="/pitch-deck" element={<Navigate to={CODE_WALKTHROUGH_ROUTE} replace />} />
          <Route path="/hygiene" element={<Navigate to={MY_ISSUES_ROUTE} replace />} />
          <Route path="/impact-analysis" element={<Navigate to={REPORTS_HUB_ROUTE} replace />} />
          <Route path="/dev-panel" element={<Navigate to={ADMIN_HUB_ROUTE} replace />} />
            <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
