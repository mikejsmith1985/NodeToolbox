// App.tsx — Top-level layout shell for the React SPA.
//
// This component owns the global layout, mounts the shared polling hooks, and
// routes placeholder views until later migration phases replace them.

import { Navigate, Route, Routes } from 'react-router-dom';

import { ConnectionBar } from './components/ConnectionBar/index.ts';
import { useProxyStatus } from './hooks/useProxyStatus.ts';
import { useRelayBridge } from './hooks/useRelayBridge.ts';
import type { RelaySystem } from './types/relay.ts';
import styles from './App.module.css';

const APP_TITLE = 'NodeToolbox';
const DEFAULT_ROUTE = '/';
const RELAY_SYSTEM: RelaySystem = 'snow';
const PLACEHOLDER_MESSAGE =
  'This view is being migrated. Use the legacy dashboard in the meantime.';
const PLACEHOLDER_ROUTES = [
  { path: '/', name: 'Home' },
  { path: '/settings', name: 'Settings' },
  { path: '/my-issues', name: 'My Issues' },
  { path: '/snow-hub', name: 'SNow Hub' },
  { path: '/dev-workspace', name: 'Dev Workspace' },
  { path: '/sprint-dashboard', name: 'Sprint Dashboard' },
  { path: '/text-tools', name: 'Text Tools' },
  { path: '/dsu-board', name: 'DSU Board' },
  { path: '/reports-hub', name: 'Reports Hub' },
  { path: '/admin-hub', name: 'Admin Hub' },
] as const;

interface PlaceholderViewProps {
  name: string;
}

/** Root layout shell for the Phase 1 React migration. */
export default function App() {
  useProxyStatus();
  useRelayBridge(RELAY_SYSTEM);

  return (
    <div className={styles.appShell}>
      <header className={styles.topBar}>
        <span className={styles.appTitle}>{APP_TITLE}</span>
        <ConnectionBar />
      </header>

      <main className={styles.mainContent}>
        <Routes>
          {PLACEHOLDER_ROUTES.map((placeholderRoute) => (
            <Route
              key={placeholderRoute.path}
              path={placeholderRoute.path}
              element={<PlaceholderView name={placeholderRoute.name} />}
            />
          ))}
          <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** Temporary placeholder rendered for routes that are migrated in later phases. */
function PlaceholderView({ name }: PlaceholderViewProps) {
  return (
    <div className={styles.placeholderView}>
      <h2>{name}</h2>
      <p className={styles.placeholderMessage}>{PLACEHOLDER_MESSAGE}</p>
    </div>
  );
}
