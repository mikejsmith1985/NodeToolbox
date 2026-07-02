// useSharePointPull.ts — Orchestrates a one-click pull of the SharePoint intake List through the
// relay: check the relay is connected, resolve the List's column names, read all items, and map
// them to rows for the existing queue. Fails safe — any problem yields no rows + a clear message.
// See spec 007 contracts §E and FR-002/004/005/006/008.

import { useCallback, useState } from 'react';

import { fetchRelayStatus } from '../../../services/relayBridgeApi.ts';
import { fetchListItems, resolveListFieldMap } from '../../../services/sharepointIntakeApi.ts';
import { mapSharePointItem } from '../lib/mapSharePointItem.ts';
import type { RawRow } from '../lib/parseSubmissions.ts';
import type { IntakeConfig } from '../lib/intakeTypes.ts';

const NOT_CONFIGURED_MESSAGE = 'Set the SharePoint site URL and list name in Intake settings first.';
const NOT_CONNECTED_MESSAGE = 'Connect the SharePoint relay first — open the SharePoint site and click the bookmarklet.';

export interface SharePointPullResult {
  rows: RawRow[];
  /** Expected intake columns missing from the List (surface to the user, FR-010). */
  missingColumns: string[];
  itemCount: number;
}

export interface UseSharePointPullResult {
  /** Pulls the List; returns null (with errorMessage set) when not configured/connected or on error. */
  pull: () => Promise<SharePointPullResult | null>;
  isPulling: boolean;
  errorMessage: string | null;
}

/**
 * Hook owning the SharePoint pull operation. Connection status now lives in the shared connection
 * store (driven by the app's relay poll and surfaced by the Connection Bar, feature 008); this hook
 * keeps a defensive pre-pull relay check so a stale click never proceeds against a dead relay.
 */
export function useSharePointPull(config: IntakeConfig | null): UseSharePointPullResult {
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pull = useCallback(async (): Promise<SharePointPullResult | null> => {
    const siteRelativeUrl = config?.sharePointSiteRelativeUrl?.trim();
    const listName = config?.sharePointListName?.trim();
    if (!siteRelativeUrl || !listName) {
      setErrorMessage(NOT_CONFIGURED_MESSAGE);
      return null;
    }

    setIsPulling(true);
    setErrorMessage(null);
    try {
      const status = await fetchRelayStatus('sharepoint');
      if (!status.isConnected) {
        setErrorMessage(NOT_CONNECTED_MESSAGE);
        return null;
      }

      const source = { siteRelativeUrl, listName };
      const fieldMap = await resolveListFieldMap(source);
      const items = await fetchListItems(source, fieldMap.byDisplayName);
      const rows = items.map((item) => mapSharePointItem(item, fieldMap.byDisplayName));
      return { rows, missingColumns: fieldMap.missingColumns, itemCount: rows.length };
    } catch (caught) {
      // Fail safe: no rows, a clear message; the caller ingests nothing (FR-008).
      setErrorMessage(caught instanceof Error ? caught.message : 'Could not pull from SharePoint.');
      return null;
    } finally {
      setIsPulling(false);
    }
  }, [config]);

  return { pull, isPulling, errorMessage };
}
