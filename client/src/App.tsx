// App.tsx — Root application component.
//
// Phase 0: Renders a foundation-ready screen and confirms the Vite
// proxy is correctly forwarding requests to the Express backend at
// port 5555. This shell will be replaced with the full layout router
// in Phase 1 (nav rail + connection bar + <Outlet />).

import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape of the /api/proxy-status response we care about for Phase 0 */
interface ProxyStatusSummary {
  version: string;
  jiraConfigured: boolean;
  snowConfigured: boolean;
}

// ── Phase-0 Foundation Screen ─────────────────────────────────────────────────

/**
 * Fetches /api/proxy-status and displays the result to prove the Vite dev
 * proxy is correctly forwarding requests to the Express backend.
 *
 * This component is replaced by the full layout shell in Phase 1.
 */
function FoundationScreen() {
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusSummary | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Verify the Vite dev-server proxy is reaching the Express backend.
    // In production, this fetch hits Express directly (no proxy needed).
    fetch('/api/proxy-status')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} — ${response.statusText}`);
        }
        return response.json() as Promise<Record<string, unknown>>;
      })
      .then((responseData) => {
        setProxyStatus({
          version: String(responseData.version ?? 'unknown'),
          jiraConfigured: Boolean(responseData.jiraConfigured),
          snowConfigured: Boolean(responseData.snowConfigured),
        });
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setFetchError(errorMessage);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return (
    <main style={styles.container}>
      <h1 style={styles.heading}>⚡ NodeToolbox React SPA</h1>
      <p style={styles.subheading}>Phase 0 — Foundation ready</p>

      <section style={styles.statusCard}>
        <h2 style={styles.cardTitle}>Backend Connection</h2>

        {isLoading && <p style={styles.loadingText}>Connecting to Express backend…</p>}

        {fetchError && (
          <p style={styles.errorText}>
            ❌ Could not reach backend: {fetchError}
            <br />
            <small>Is the Express server running on port 5555?</small>
          </p>
        )}

        {proxyStatus && (
          <ul style={styles.statusList}>
            <li>✅ Express backend reachable</li>
            <li>📦 NodeToolbox v{proxyStatus.version}</li>
            <li>{proxyStatus.jiraConfigured ? '✅' : '⚠️'} Jira configured: {String(proxyStatus.jiraConfigured)}</li>
            <li>{proxyStatus.snowConfigured ? '✅' : '⚠️'} SNow configured: {String(proxyStatus.snowConfigured)}</li>
          </ul>
        )}
      </section>

      <p style={styles.note}>
        Phase 1 will replace this screen with the full layout shell, stores, and API services.
      </p>
    </main>
  );
}

// ── Inline styles (temporary — replaced by global.css in Phase 1) ─────────────

const styles = {
  container: {
    maxWidth: 520,
    margin: '80px auto',
    padding: '0 24px',
    fontFamily: 'system-ui, sans-serif',
    color: '#e2e8f0',
  },
  heading: {
    fontSize: '2rem',
    fontWeight: 700,
    margin: '0 0 8px',
  },
  subheading: {
    color: '#94a3b8',
    margin: '0 0 32px',
  },
  statusCard: {
    background: '#1e293b',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    margin: '0 0 16px',
    color: '#7dd3fc',
  },
  loadingText: { color: '#94a3b8' },
  errorText: { color: '#f87171', lineHeight: 1.6 },
  statusList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    lineHeight: 2,
  },
  note: {
    color: '#64748b',
    fontSize: '0.875rem',
  },
} as const;

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Phase 0: Single route renders the foundation screen.
 * Phase 1+: This component becomes the layout shell with nav + <Outlet />.
 */
export default function App() {
  return (
    <Routes>
      <Route path="*" element={<FoundationScreen />} />
    </Routes>
  );
}
