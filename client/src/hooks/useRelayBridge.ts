// useRelayBridge.ts — Hook that probes relay bridge availability and updates the shared connection store.

import { useEffect } from 'react';

import { fetchRelayStatus } from '../services/relayBridgeApi.ts';
import { useConnectionStore } from '../store/connectionStore.ts';
import type { RelaySystem } from '../types/relay.ts';

const PROBE_INTERVAL_MS = 30_000;

/**
 * Probes the relay bridge for the given system on mount and every 30 seconds.
 * Updates the shared connection store when the relay status changes.
 */
export function useRelayBridge(system: RelaySystem): void {
  const setRelayBridgeStatus = useConnectionStore((state) => state.setRelayBridgeStatus);

  useEffect(() => {
    let isCancelled = false;

    async function probeRelay(): Promise<void> {
      try {
        const relayStatus = await fetchRelayStatus(system);
        if (!isCancelled) {
          setRelayBridgeStatus(relayStatus);
        }
      } catch {
        // Relay availability can change during startup, so silent retries keep the shell resilient.
      }
    }

    void probeRelay();
    const intervalId = window.setInterval(() => void probeRelay(), PROBE_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [system, setRelayBridgeStatus]);
}
