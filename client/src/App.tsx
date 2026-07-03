// App.tsx — Top-level layout shell for the React SPA.
//
// This component owns the global layout, mounts the shared polling hooks, and
// routes placeholder views until later migration phases replace them.

import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { ConnectionBar } from './components/ConnectionBar/index.ts';
import { ToastProvider } from './components/Toast/ToastProvider.tsx';
import { useProxyStatus } from './hooks/useProxyStatus.ts';
import { useRelayBridge } from './hooks/useRelayBridge.ts';
import { parseRelayReturnRoute, RELAY_RETURN_ROUTE_KEY } from './services/browserRelay.ts';
import { useSettingsStore } from './store/settingsStore.ts';
import type { ToolTextSize } from './store/settingsStore.ts';
import type { RelaySystem } from './types/relay.ts';
import { disableDemoModeForCurrentTab, isDemoModeEnabled } from './utils/demoModeStorage.ts';
import ArtView from './views/ArtView/ArtView.tsx';
import AdminHubView from './views/AdminHub/AdminHubView.tsx';
import BusinessHelperView from './views/BusinessHelper/BusinessHelperView.tsx';
import CodeWalkthroughView from './views/CodeWalkthrough/CodeWalkthroughView.tsx';
import DsuBoardView from './views/DsuBoard/DsuBoardView.tsx';
import HomeView from './views/Home/HomeView.tsx';
import JiraIntake from './views/JiraIntake/JiraIntake.tsx';
import JiraTemplateMaker from './views/JiraTemplateMaker/JiraTemplateMaker.tsx';
import MyIssuesView from './views/MyIssues/MyIssuesView.tsx';
import PersonalToolboxView from './views/PersonalToolbox/PersonalToolboxView.tsx';
import ReportsHubView from './views/ReportsHub/ReportsHubView.tsx';
import { ReportsHubRuntimeBoundary } from './views/ReportsHub/ReportsHubRuntimeBoundary.tsx';
import SettingsView from './views/Settings/SettingsView.tsx';
import SnowHubView from './views/SnowHub/SnowHubView.tsx';
import SprintDashboardView from './views/SprintDashboard/SprintDashboardView.tsx';
import TextToolsView from './views/TextTools/TextToolsView.tsx';
import styles from './App.module.css';

// Lazy-loaded so the React Flow canvas dependency stays off the shared bundle for users who
// never open the Feature Canvas (mirrors the repo's on-demand heavy-import philosophy).
const FeatureCanvasView = lazy(() => import('./views/FeatureCanvas/FeatureCanvasView.tsx'));

const APP_TITLE = 'NodeToolbox';
const HOME_ROUTE = '/';
const SETTINGS_ROUTE = '/settings';
const SNOW_HUB_ROUTE = '/snow-hub';
const JIRA_TEMPLATE_MAKER_ROUTE = '/jira-template-maker';
const JIRA_INTAKE_ROUTE = '/jira-intake';
const MY_ISSUES_ROUTE = '/my-issues';
const PERSONAL_TOOLBOX_ROUTE = '/personal-toolbox';
const SPRINT_DASHBOARD_ROUTE = '/sprint-dashboard';
const ART_ROUTE = '/art';
const DSU_BOARD_ROUTE = '/dsu-board';
const CODE_WALKTHROUGH_ROUTE = '/code-walkthrough';
const TEXT_TOOLS_ROUTE = '/text-tools';
const REPORTS_HUB_ROUTE = '/reports-hub';
const ADMIN_HUB_ROUTE = '/admin-hub';
const BUSINESS_HELPER_ROUTE = '/business-helper';
const FEATURE_CANVAS_ROUTE = '/feature-canvas';
const DEFAULT_ROUTE = HOME_ROUTE;
const RELAY_SYSTEM: RelaySystem = 'snow';
const SHAREPOINT_RELAY_SYSTEM: RelaySystem = 'sharepoint';
const DEFAULT_TOOL_TEXT_SIZE: ToolTextSize = 'default';
const LARGE_TOOL_TEXT_SIZE: ToolTextSize = 'large';
const EXTRA_LARGE_TOOL_TEXT_SIZE: ToolTextSize = 'extra-large';

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

  return (
    <ToastProvider>
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
          <Route path={SNOW_HUB_ROUTE} element={<SnowHubView />} />
          <Route path={JIRA_TEMPLATE_MAKER_ROUTE} element={<JiraTemplateMaker />} />
          <Route path={JIRA_INTAKE_ROUTE} element={<JiraIntake />} />
          <Route path={MY_ISSUES_ROUTE} element={<MyIssuesView />} />
          <Route path={PERSONAL_TOOLBOX_ROUTE} element={<PersonalToolboxView />} />
          <Route path={SPRINT_DASHBOARD_ROUTE} element={<SprintDashboardView />} />
          <Route path={ART_ROUTE} element={<ArtView />} />
          <Route path={DSU_BOARD_ROUTE} element={<DsuBoardView />} />
          <Route path={CODE_WALKTHROUGH_ROUTE} element={<CodeWalkthroughView />} />
          <Route path={TEXT_TOOLS_ROUTE} element={<TextToolsView />} />
          <Route path={REPORTS_HUB_ROUTE} element={(
            <ReportsHubRuntimeBoundary>
              <ReportsHubView />
            </ReportsHubRuntimeBoundary>
          )}
          />
          <Route path={ADMIN_HUB_ROUTE} element={<AdminHubView />} />
          <Route path={BUSINESS_HELPER_ROUTE} element={<BusinessHelperView />} />
          <Route
            path={FEATURE_CANVAS_ROUTE}
            element={(
              <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', opacity: 0.7 }}>Loading Feature Canvas…</div>}>
                <FeatureCanvasView />
              </Suspense>
            )}
          />
          <Route path="/sprint-planning" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/pointing" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/standup" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/dsu-daily" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/metrics" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/pipeline" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/defects" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/release-monitor" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
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
