// useProxyStatus.ts — Hook that polls proxy status and keeps the global connection store synchronized.

import { useEffect } from 'react';

import { fetchProxyStatus } from '../services/proxyApi.ts';
import { useConnectionStore } from '../store/connectionStore.ts';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls proxy-status on mount and every 30 seconds.
 * Results are written to connectionStore so all components stay in sync.
 */
export function useProxyStatus(): void {
  const setProxyStatus = useConnectionStore((state) => state.setProxyStatus);

  useEffect(() => {
    let isCancelled = false;

    async function refreshStatus(): Promise<void> {
      try {
        const status = await fetchProxyStatus();
        if (!isCancelled) {
          setProxyStatus(status);
        }
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
  }, [setProxyStatus]);
}
