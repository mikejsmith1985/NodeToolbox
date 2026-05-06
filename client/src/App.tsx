// App.tsx — Top-level layout shell for the React SPA.
//
// This component owns the global layout, mounts the shared polling hooks, and
// routes placeholder views until later migration phases replace them.

import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ConnectionBar } from './components/ConnectionBar/index.ts';
import { useProxyStatus } from './hooks/useProxyStatus.ts';
import { useRelayBridge } from './hooks/useRelayBridge.ts';
import { useSettingsStore } from './store/settingsStore.ts';
import type { RelaySystem } from './types/relay.ts';
import HomeView from './views/Home/HomeView.tsx';
import MyIssuesView from './views/MyIssues/MyIssuesView.tsx';
import SettingsView from './views/Settings/SettingsView.tsx';
import SnowHubView from './views/SnowHub/SnowHubView.tsx';
import SprintDashboardView from './views/SprintDashboard/SprintDashboardView.tsx';
import ArtView from './views/ArtView/ArtView.tsx';
import DevWorkspaceView from './views/DevWorkspace/DevWorkspaceView.tsx';
import CodeWalkthroughView from './views/CodeWalkthrough/CodeWalkthroughView.tsx';
import DsuBoardView from './views/DsuBoard/DsuBoardView.tsx';
import TextToolsView from './views/TextTools/TextToolsView.tsx';
import ReportsHubView from './views/ReportsHub/ReportsHubView.tsx';
import AdminHubView from './views/AdminHub/AdminHubView.tsx';
import styles from './App.module.css';

const APP_TITLE = 'NodeToolbox';
const HOME_ROUTE = '/';
const SETTINGS_ROUTE = '/settings';
const SNOW_HUB_ROUTE = '/snow-hub';
const DEFAULT_ROUTE = HOME_ROUTE;
const RELAY_SYSTEM: RelaySystem = 'snow';

/** Root layout shell for the React migration, including live status hooks and route selection. */
export default function App() {
  useProxyStatus();
  useRelayBridge(RELAY_SYSTEM);

  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className={styles.appShell}>
      <header className={styles.topBar}>
        <span className={styles.appTitle}>{APP_TITLE}</span>
        <ConnectionBar />
      </header>

      <main className={styles.mainContent}>
        <Routes>
          <Route path={HOME_ROUTE} element={<HomeView />} />
          <Route path={SETTINGS_ROUTE} element={<SettingsView />} />
          <Route path={SNOW_HUB_ROUTE} element={<SnowHubView />} />
          <Route path="/my-issues" element={<MyIssuesView />} />
          <Route path="/sprint-dashboard" element={<SprintDashboardView />} />
          <Route path="/art" element={<ArtView />} />
          <Route path="/dev-workspace" element={<DevWorkspaceView />} />
          <Route path="/dsu-board" element={<DsuBoardView />} />
          <Route path="/code-walkthrough" element={<CodeWalkthroughView />} />
          <Route path="/text-tools" element={<TextToolsView />} />
          <Route path="/reports-hub" element={<ReportsHubView />} />
          <Route path="/admin-hub" element={<AdminHubView />} />
          <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
        </Routes>
      </main>
    </div>
  );
}
