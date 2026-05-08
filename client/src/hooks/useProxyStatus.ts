// useProxyStatus.ts — Hook that polls proxy status and keeps the global connection store synchronized.

import { useEffect } from 'react';

import { fetchProxyStatus, probeJiraConnection, probeSnowConnection } from '../services/proxyApi.ts';
import { useConnectionStore } from '../store/connectionStore.ts';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls proxy-status on mount and every 30 seconds.
 * After each poll, runs live probes for any configured services to verify
 * that credentials actually work — not just that they are present in the config.
 * Results are written to connectionStore so all components stay in sync.
 */
export function useProxyStatus(): void {
  const setProxyStatus = useConnectionStore((state) => state.setProxyStatus);
  const setJiraVerified = useConnectionStore((state) => state.setJiraVerified);
  const setSnowVerified = useConnectionStore((state) => state.setSnowVerified);

  useEffect(() => {
    let isCancelled = false;

    async function refreshStatus(): Promise<void> {
      try {
        const status = await fetchProxyStatus();
        if (isCancelled) return;

        setProxyStatus(status);

        // Run live probes in parallel for configured services.
        // We probe independently so a failing Jira probe doesn't block the SNow probe.
        const probePromises: Promise<void>[] = [];

        if (status.jira.configured) {
          probePromises.push(
            probeJiraConnection().then((result) => {
              if (!isCancelled) setJiraVerified(result.isOk);
            }),
          );
        }

        if (status.snow.configured) {
          probePromises.push(
            probeSnowConnection().then((result) => {
              if (!isCancelled) setSnowVerified(result.isOk);
            }),
          );
        }

        await Promise.allSettled(probePromises);
      } catch {
        // Temporary backend outages should not break the rest of the application shell.
      }
    }

    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [setProxyStatus, setJiraVerified, setSnowVerified]);
}
