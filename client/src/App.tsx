// App.tsx — Top-level layout shell for the React SPA.
//
// This component owns the global layout, mounts the shared polling hooks, and
// routes placeholder views until later migration phases replace them.

import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { ConnectionBar } from './components/ConnectionBar/index.ts';
import { ToastProvider } from './components/Toast/ToastProvider.tsx';
import { useProxyStatus } from './hooks/useProxyStatus.ts';
import { useRelayBridge } from './hooks/useRelayBridge.ts';
import { parseRelayReturnRoute, RELAY_RETURN_ROUTE_KEY } from './services/browserRelay.ts';
import { useSettingsStore } from './store/settingsStore.ts';
import type { RelaySystem } from './types/relay.ts';
import ArtView from './views/ArtView/ArtView.tsx';
import AdminHubView from './views/AdminHub/AdminHubView.tsx';
import CodeWalkthroughView from './views/CodeWalkthrough/CodeWalkthroughView.tsx';
import DevWorkspaceView from './views/DevWorkspace/DevWorkspaceView.tsx';
import DsuBoardView from './views/DsuBoard/DsuBoardView.tsx';
import HomeView from './views/Home/HomeView.tsx';
import MyIssuesView from './views/MyIssues/MyIssuesView.tsx';
import PersonalToolboxView from './views/PersonalToolbox/PersonalToolboxView.tsx';
import ReportsHubView from './views/ReportsHub/ReportsHubView.tsx';
import SettingsView from './views/Settings/SettingsView.tsx';
import SnowHubView from './views/SnowHub/SnowHubView.tsx';
import SprintDashboardView from './views/SprintDashboard/SprintDashboardView.tsx';
import TextToolsView from './views/TextTools/TextToolsView.tsx';
import styles from './App.module.css';

const APP_TITLE = 'NodeToolbox';
const HOME_ROUTE = '/';
const SETTINGS_ROUTE = '/settings';
const SNOW_HUB_ROUTE = '/snow-hub';
const MY_ISSUES_ROUTE = '/my-issues';
const PERSONAL_TOOLBOX_ROUTE = '/personal-toolbox';
const SPRINT_DASHBOARD_ROUTE = '/sprint-dashboard';
const ART_ROUTE = '/art';
const DEV_WORKSPACE_ROUTE = '/dev-workspace';
const DSU_BOARD_ROUTE = '/dsu-board';
const CODE_WALKTHROUGH_ROUTE = '/code-walkthrough';
const TEXT_TOOLS_ROUTE = '/text-tools';
const REPORTS_HUB_ROUTE = '/reports-hub';
const ADMIN_HUB_ROUTE = '/admin-hub';
const DEFAULT_ROUTE = HOME_ROUTE;
const RELAY_SYSTEM: RelaySystem = 'snow';

/** Root layout shell for the React migration, including live status hooks and route selection. */
export default function App() {
  const navigate = useNavigate();

  useProxyStatus();
  useRelayBridge(RELAY_SYSTEM);

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
          <ConnectionBar />
        </header>

        <main className={styles.mainContent}>
          <Routes>
          <Route path={HOME_ROUTE} element={<HomeView />} />
          <Route path={SETTINGS_ROUTE} element={<SettingsView />} />
          <Route path={SNOW_HUB_ROUTE} element={<SnowHubView />} />
          <Route path={MY_ISSUES_ROUTE} element={<MyIssuesView />} />
          <Route path={PERSONAL_TOOLBOX_ROUTE} element={<PersonalToolboxView />} />
          <Route path={SPRINT_DASHBOARD_ROUTE} element={<SprintDashboardView />} />
          <Route path={ART_ROUTE} element={<ArtView />} />
          <Route path={DEV_WORKSPACE_ROUTE} element={<DevWorkspaceView />} />
          <Route path={DSU_BOARD_ROUTE} element={<DsuBoardView />} />
          <Route path={CODE_WALKTHROUGH_ROUTE} element={<CodeWalkthroughView />} />
          <Route path={TEXT_TOOLS_ROUTE} element={<TextToolsView />} />
          <Route path={REPORTS_HUB_ROUTE} element={<ReportsHubView />} />
          <Route path={ADMIN_HUB_ROUTE} element={<AdminHubView />} />
          <Route path="/sprint-planning" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/pointing" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/standup" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/dsu-daily" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/metrics" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/pipeline" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/defects" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/release-monitor" element={<Navigate to={SPRINT_DASHBOARD_ROUTE} replace />} />
          <Route path="/work-log" element={<Navigate to={DEV_WORKSPACE_ROUTE} replace />} />
          <Route path="/mermaid" element={<Navigate to={TEXT_TOOLS_ROUTE} replace />} />
          <Route path="/pitch-deck" element={<Navigate to={CODE_WALKTHROUGH_ROUTE} replace />} />
          <Route path="/hygiene" element={<Navigate to={MY_ISSUES_ROUTE} replace />} />
          <Route path="/impact-analysis" element={<Navigate to={REPORTS_HUB_ROUTE} replace />} />
          <Route path="/dev-panel" element={<Navigate to={ADMIN_HUB_ROUTE} replace />} />
            <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  );
}
