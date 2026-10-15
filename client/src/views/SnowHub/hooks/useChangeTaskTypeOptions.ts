// useChangeTaskTypeOptions — ServiceNow's own list of CTASK types, so a CTASK's type is picked, never typed.
//
// A typed type that does not match ServiceNow's stored value saves cleanly and silently does nothing, which is
// how CTASKs ended up with the wrong type. The list is read the same way the change_request pickers read theirs
// (the UI Form API, then UI Meta) because hardened instances refuse direct sys_choice reads.

import { useEffect, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { readUiFormChoicesForField, type SnowChoiceOption } from './useSnowChoiceOptions.ts';

const CHANGE_TASK_TYPE_FIELD_NAME = 'change_task_type';
const CHANGE_TASK_METADATA_PATHS = [
  '/api/now/ui/form/change_task/-1?sysparm_view=default&sysparm_display_value=all',
  '/api/now/ui/form/change_task/-1?sysparm_view=normal&sysparm_display_value=all',
  '/api/now/ui/meta/change_task?sysparm_display_value=all',
] as const;

// One read serves every CTASK form on the page; the list only changes when ServiceNow is reconfigured.
let cachedTypeOptions: SnowChoiceOption[] | null = null;

/** Reads the CTASK type choices from ServiceNow, trying each metadata source until one carries them. */
export async function fetchChangeTaskTypeOptions(): Promise<SnowChoiceOption[]> {
  const attemptFailures: string[] = [];
  for (const metadataPath of CHANGE_TASK_METADATA_PATHS) {
    try {
      const typeOptions = readUiFormChoicesForField(await snowFetch<unknown>(metadataPath), CHANGE_TASK_TYPE_FIELD_NAME);
      if (typeOptions.length > 0) {
        return typeOptions;
      }
      attemptFailures.push(`${metadataPath} carried no type list`);
    } catch (fetchError) {
      attemptFailures.push(fetchError instanceof Error ? fetchError.message : String(fetchError));
    }
  }
  throw new Error(`ServiceNow did not return the CTASK types (${attemptFailures.join(' | ')}).`);
}

/** What a CTASK form needs to offer the type picker. */
export interface ChangeTaskTypeOptionsResult {
  typeOptions: SnowChoiceOption[];
  isLoading: boolean;
  /** Why the list could not be loaded; null when it loaded or has not been tried yet. */
  loadErrorMessage: string | null;
}

/** The CTASK type choices, loaded once the ServiceNow relay is ready. */
export function useChangeTaskTypeOptions(): ChangeTaskTypeOptionsResult {
  const [typeOptions, setTypeOptions] = useState<SnowChoiceOption[]>(() => cachedTypeOptions ?? []);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const isRelayReady = useConnectionStore((storeState) =>
    (storeState.relayBridgeStatus?.isConnected ?? false) && (storeState.relayBridgeStatus?.hasSessionToken ?? false));

  useEffect(() => {
    if (!isRelayReady || cachedTypeOptions !== null) return;
    let isCancelled = false;
    fetchChangeTaskTypeOptions()
      .then((loadedTypeOptions) => {
        cachedTypeOptions = loadedTypeOptions;
        if (!isCancelled) {
          setTypeOptions(loadedTypeOptions);
          setLoadErrorMessage(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) setLoadErrorMessage(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => { isCancelled = true; };
  }, [isRelayReady]);

  // Loading is derived, not stored: the relay is ready, nothing has arrived yet, and nothing has failed.
  const isLoading = isRelayReady && typeOptions.length === 0 && loadErrorMessage === null;
  return { typeOptions, isLoading, loadErrorMessage };
}
