// useSnowChoiceOptions — Fetches planning dropdown choices from the SNow sys_choice table.
// Subscribes to the relay bridge status and auto-retries when the relay connects, so users
// never need to reload the page after activating the bookmarklet.

import { useCallback, useEffect, useState } from 'react';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { snowFetch } from '../../../services/snowApi.ts';

/** A single selectable option in a SNow choice field (label is what the user sees). */
export interface SnowChoiceOption {
  value: string;
  label: string;
}

/** Maps a SNow field name to its resolved list of selectable options. */
export type SnowChoiceOptionMap = Record<string, SnowChoiceOption[]>;

// All change_request choice fields we want to resolve in one API call.
const CHANGE_REQUEST_CHOICE_FIELDS = [
  'category',
  'type',
  'u_environment',
  'impact',
  'u_availability_impact',
  'u_change_tested',
  'u_impacted_persons_aware',
  'u_performed_previously',
  'u_success_probability',
  'u_can_be_backed_out',
] as const;

interface SysChoiceRecord {
  element: string;
  value:   string;
  label:   string;
}

interface SysChoiceResponse {
  result: SysChoiceRecord[];
}

/**
 * Builds a sys_choice query URL that fetches all choice options for the given
 * fields on the change_request table in a single API call.
 */
function buildSysChoicePath(fields: readonly string[]): string {
  const fieldList = fields.join(',');
  const query = encodeURIComponent(
    `name=change_request^elementIN${fieldList}^language=en^inactive=false`,
  );
  return `/api/now/table/sys_choice?sysparm_query=${query}&sysparm_fields=element,value,label&sysparm_limit=200&sysparm_display_value=false`;
}

/**
 * Groups a flat list of sys_choice records into a map from field name → options.
 * Prepends an empty option to every list so the user can leave a field blank.
 */
function groupChoicesByField(records: SysChoiceRecord[]): SnowChoiceOptionMap {
  const grouped: SnowChoiceOptionMap = {};

  for (const record of records) {
    if (!grouped[record.element]) {
      grouped[record.element] = [{ value: '', label: '' }];
    }
    grouped[record.element].push({ value: record.value, label: record.label });
  }

  return grouped;
}

interface UseSnowChoiceOptionsResult {
  /** Options per field name — populated only after a successful SNow fetch. Empty when unavailable. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the sys_choice fetch is in flight. */
  isLoadingChoices: boolean;
  /** True if the live fetch succeeded (options are from SNow). */
  areChoicesFromSnow: boolean;
  /** True if the fetch failed for a reason other than the relay being disconnected. */
  isFetchFailed: boolean;
  /** True when the relay bridge is connected — drives whether the fetch is attempted. */
  isRelayConnected: boolean;
  /** Manually re-triggers the sys_choice fetch (e.g. after a transient SNow error). */
  retryFetch: () => void;
}

/**
 * Fetches all change_request dropdown choices from the SNow sys_choice table in one API call.
 * Returns empty option maps when the relay is unavailable — callers should surface a warning
 * rather than letting users select potentially invalid hardcoded values.
 *
 * Auto-retries when the relay transitions from disconnected → connected, so the user
 * never needs to reload the page after activating the bookmarklet.
 */
export function useSnowChoiceOptions(): UseSnowChoiceOptionsResult {
  // Start with an empty map — no defaults — so the UI never shows guessed values.
  const [choiceOptions, setChoiceOptions] = useState<SnowChoiceOptionMap>({});
  const [isLoadingChoices, setIsLoadingChoices]     = useState<boolean>(false);
  const [areChoicesFromSnow, setAreChoicesFromSnow] = useState<boolean>(false);
  const [isFetchFailed, setIsFetchFailed]           = useState<boolean>(false);
  // Bumped by retryFetch() to force a re-fetch even when isRelayConnected hasn't changed.
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Subscribe to relay connection status so we can auto-retry when it transitions to connected.
  const isRelayConnected = useConnectionStore(
    (storeState) => storeState.relayBridgeStatus?.isConnected ?? false,
  );

  useEffect(() => {
    // Don't attempt while relay is disconnected — snowFetch will throw immediately and
    // we'd be left in a permanent error state until the user manually retried.
    if (!isRelayConnected) return;

    // Skip if we already have fresh data from SNow to avoid redundant API calls on relay
    // status changes (e.g. relay briefly dropping and reconnecting).
    if (areChoicesFromSnow) return;

    let isCancelled = false;

    async function fetchChoiceOptions() {
      setIsLoadingChoices(true);
      try {
        const path = buildSysChoicePath(CHANGE_REQUEST_CHOICE_FIELDS);
        const response = await snowFetch<SysChoiceResponse>(path);
        if (isCancelled) return;

        setChoiceOptions(groupChoicesByField(response.result ?? []));
        setAreChoicesFromSnow(true);
        setIsFetchFailed(false);
      } catch {
        // Relay connected but SNow returned an error (expired session, network issue, etc.).
        // Leave choiceOptions empty and surface the warning so the user can retry.
        if (!isCancelled) setIsFetchFailed(true);
      } finally {
        if (!isCancelled) setIsLoadingChoices(false);
      }
    }

    void fetchChoiceOptions();

    return () => { isCancelled = true; };
  }, [isRelayConnected, areChoicesFromSnow, fetchTrigger]);

  /**
   * Forces a re-fetch of sys_choice options. Resets the failure state first so the
   * loading indicator appears immediately while the new request is in flight.
   */
  const retryFetch = useCallback(() => {
    setIsFetchFailed(false);
    setAreChoicesFromSnow(false);
    setFetchTrigger((previousTrigger) => previousTrigger + 1);
  }, []);

  return { choiceOptions, isLoadingChoices, areChoicesFromSnow, isFetchFailed, isRelayConnected, retryFetch };
}
