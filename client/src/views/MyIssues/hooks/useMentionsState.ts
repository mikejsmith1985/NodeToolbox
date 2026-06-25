// useMentionsState.ts — State and Jira loading for the "Mentions" report.
//
// Finds the comments where the current user was @-mentioned within a selected
// business-day window, lets them reply inline, and lets them mark a mention
// "addressed" so it falls off the list. Detection runs client-side through the
// existing Jira proxy; the addressed state is persisted server-side so it
// follows the user across devices.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  fetchAddressedMentions,
  setMentionAddressed as persistMentionAddressed,
  type AddressedMentionMap,
} from '../../../services/mentionStateApi.ts';
import { fetchProxyConfig } from '../../../services/proxyApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { businessDaysAgo, toJqlDateString } from '../../../utils/businessDays.ts';
import { collectUserMentions, type JiraMention, type MentionIdentity } from '../../../utils/jiraMentions.ts';

const DEFAULT_WINDOW_BUSINESS_DAYS = 3;
const MENTIONS_MAX_RESULTS = 100;
const MYSELF_PATH = '/rest/api/2/myself';
const MENTION_SEARCH_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description,comment';

/** Window options offered by the report's selector. */
export const MENTION_WINDOW_OPTIONS = [1, 3, 5, 10] as const;

export interface MentionsState {
  windowBusinessDays: number;
  /** Mentions after applying the addressed filter (respecting showAddressed). */
  visibleMentions: JiraMention[];
  addressedMap: AddressedMentionMap;
  showAddressed: boolean;
  isLoading: boolean;
  loadError: string | null;
  /** How many issues the candidate JQL scanned — surfaced so users know the search breadth. */
  scannedIssueCount: number;
  /** Configured Jira base URL, used to build "open in Jira" links (empty if unavailable). */
  jiraBaseUrl: string;
}

export interface MentionsActions {
  setWindowBusinessDays: (businessDays: number) => void;
  toggleShowAddressed: () => void;
  markAddressed: (mention: JiraMention, isAddressed: boolean) => Promise<void>;
  reload: () => void;
}

/** Raw shape of the /rest/api/2/myself response we rely on. */
interface JiraMyself {
  accountId?: string | null;
  name?: string | null;
  key?: string | null;
  displayName?: string | null;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

/** Owns the Mentions report state so the tab component can stay declarative. */
export function useMentionsState(): MentionsState & MentionsActions {
  const [windowBusinessDays, setWindowBusinessDaysState] = useState<number>(DEFAULT_WINDOW_BUSINESS_DAYS);
  const [allMentions, setAllMentions] = useState<JiraMention[]>([]);
  const [addressedMap, setAddressedMap] = useState<AddressedMentionMap>({});
  const [identity, setIdentity] = useState<MentionIdentity | null>(null);
  const [showAddressed, setShowAddressed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scannedIssueCount, setScannedIssueCount] = useState<number>(0);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string>('');
  // Bumping this token forces the load effect to run again (manual refresh).
  const [reloadToken, setReloadToken] = useState<number>(0);

  // Load whenever the window changes or a manual reload is requested. The effect
  // body itself performs no synchronous setState — it delegates to an inline
  // async loader (mirroring the IssueDetailPanel transitions pattern) so it never
  // triggers cascading-render warnings.
  useEffect(() => {
    let isMounted = true;

    async function loadMentions() {
      try {
        const resolvedIdentity = await loadIdentity();
        const windowStart = businessDaysAgo(windowBusinessDays);
        const searchResponse = await jiraGet<JiraSearchResponse>(buildMentionSearchPath(resolvedIdentity, windowStart));
        const loadedIssues = searchResponse.issues ?? [];
        const detectedMentions = collectUserMentions(loadedIssues, resolvedIdentity, windowStart.getTime());
        const addressed = await fetchAddressedMentions(resolveUserKey(resolvedIdentity));
        const resolvedJiraBaseUrl = await loadJiraBaseUrl();

        if (!isMounted) {
          return;
        }
        setIdentity(resolvedIdentity);
        setScannedIssueCount(loadedIssues.length);
        setAllMentions(detectedMentions);
        setAddressedMap(addressed);
        setJiraBaseUrl(resolvedJiraBaseUrl);
        setLoadError(null);
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        setAllMentions([]);
        setLoadError(caughtError instanceof Error ? caughtError.message : 'Failed to load mentions');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadMentions();

    return () => {
      isMounted = false;
    };
  }, [windowBusinessDays, reloadToken]);

  const visibleMentions = useMemo(
    () => (showAddressed ? allMentions : allMentions.filter((mention) => !addressedMap[mention.mentionKey])),
    [allMentions, addressedMap, showAddressed],
  );

  // Changing the window or reloading shows the loading state immediately. Setting
  // it here (an event handler, not the effect) keeps the effect free of synchronous setState.
  const setWindowBusinessDays = useCallback((businessDays: number) => {
    setIsLoading(true);
    setWindowBusinessDaysState(businessDays);
  }, []);

  const reload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((currentToken) => currentToken + 1);
  }, []);

  const toggleShowAddressed = useCallback(() => {
    setShowAddressed((current) => !current);
  }, []);

  const markAddressed = useCallback(
    async (mention: JiraMention, isAddressed: boolean) => {
      if (!identity) {
        return;
      }
      const userKey = resolveUserKey(identity);
      // Optimistically update so the item falls off (or returns) immediately.
      setAddressedMap((previous) => applyAddressedChange(previous, mention, isAddressed));
      try {
        const updatedMap = await persistMentionAddressed({
          userKey,
          mentionKey: mention.mentionKey,
          issueKey: mention.issueKey,
          isAddressed,
        });
        setAddressedMap(updatedMap);
      } catch (caughtError) {
        // Roll back the optimistic change and surface the failure.
        setAddressedMap((previous) => applyAddressedChange(previous, mention, !isAddressed));
        setLoadError(caughtError instanceof Error ? caughtError.message : 'Failed to update mention');
      }
    },
    [identity],
  );

  return {
    windowBusinessDays,
    visibleMentions,
    addressedMap,
    showAddressed,
    isLoading,
    loadError,
    scannedIssueCount,
    jiraBaseUrl,
    setWindowBusinessDays,
    toggleShowAddressed,
    markAddressed,
    reload,
  };
}

// ── Helpers ──

/**
 * Reads the configured Jira base URL for building "open in Jira" links. Tolerant
 * by design: a config-fetch failure returns an empty string so the Mentions report
 * still loads (links then fall back to a relative path).
 */
async function loadJiraBaseUrl(): Promise<string> {
  try {
    const proxyConfig = await fetchProxyConfig();
    return proxyConfig.jiraBaseUrl ?? '';
  } catch {
    return '';
  }
}

/** Fetches and normalizes the current Jira user identity from /rest/api/2/myself. */
async function loadIdentity(): Promise<MentionIdentity> {
  const myself = await jiraGet<JiraMyself>(MYSELF_PATH);
  return {
    accountId: myself.accountId ?? null,
    name: myself.name ?? null,
    key: myself.key ?? null,
    displayName: myself.displayName ?? '',
  };
}

/**
 * Builds the candidate-issue search path. Jira Server has no first-class "issues
 * where I'm mentioned" query, so we narrow to issues whose text references the
 * user and that changed within the window; precise per-comment matching then
 * happens client-side via collectUserMentions.
 */
function buildMentionSearchPath(identity: MentionIdentity, windowStart: Date): string {
  const searchToken = identity.name || identity.accountId || identity.displayName;
  const escapedToken = searchToken.replace(/(["\\])/g, '\\$1');
  const jql =
    `text ~ "${escapedToken}" AND updated >= "${toJqlDateString(windowStart)}" ORDER BY updated DESC`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(MENTION_SEARCH_FIELDS)}&maxResults=${MENTIONS_MAX_RESULTS}`;
}

/** Picks the stable per-user key used to namespace the addressed-mentions store. */
function resolveUserKey(identity: MentionIdentity): string {
  return identity.accountId || identity.name || identity.key || identity.displayName;
}

/** Returns a new addressed map with one mention added or removed. */
function applyAddressedChange(
  previous: AddressedMentionMap,
  mention: JiraMention,
  isAddressed: boolean,
): AddressedMentionMap {
  const next = { ...previous };
  if (isAddressed) {
    next[mention.mentionKey] = { addressedAt: new Date().toISOString(), issueKey: mention.issueKey };
  } else {
    delete next[mention.mentionKey];
  }
  return next;
}
