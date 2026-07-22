// mentionDirectoryStore.ts — Session directory mapping a mentioned person's identifier to their name.
//
// Comments store people as machine identifiers, so rendering a readable name needs a lookup. Most of
// that work is free: the app is already handling user records (comment authors, assignees, reporters)
// that pair an identifier with a display name, so those are simply recorded. Only the remainder is
// fetched, a few at a time.
//
// DELIBERATELY NOT PERSISTED. There is no zustand `persist` middleware here and no localStorage
// mirror, unlike settingsStore/recentIssuesStore. Because the directory dies with the page it can
// never be stale, which is why this feature needs no expiry policy, no cache-invalidation rule, and
// writes no directory data to disk (spec FR-007a, NFR-004). Please do not "fix" this by adding
// persistence — the absence is the design.

import { create } from 'zustand';

import { jiraGet } from '../services/jiraApi.ts';
import type { DirectoryEntry } from '../utils/jiraMentionFormat.ts';

/**
 * How many people may be looked up at once. Bounds the request burst when one thread mentions many
 * unknown people, without bounding HOW MANY are ultimately resolved — capping the total would leave
 * resolvable people showing the "cannot be identified" placeholder (spec FR-007b).
 */
export const MAX_CONCURRENT_LOOKUPS = 4;

/** One person the app already knows about, used to seed the directory at no request cost. */
export interface SeedableUser {
  /** Prefixed identifier: 'accountId:…', 'name:…' or 'key:…'. */
  userIdentifier: string;
  displayName: string;
}

interface MentionDirectoryState {
  /** Keyed by the PREFIXED identifier, so a username and a user key can never collide. */
  entriesByIdentifier: Record<string, DirectoryEntry>;
  /** Records names already on hand. Only ever produces 'resolved' entries. */
  seedFromUsers: (users: SeedableUser[]) => void;
  /** Ensures every identifier reaches a terminal state, a few lookups at a time. */
  resolveMissing: (identifiers: string[]) => Promise<void>;
}

/** Splits 'accountId:557058:ab-12' into its flavour and value (the value may itself contain colons). */
function splitDirectoryKey(directoryKey: string): { flavour: string; value: string } | null {
  const separatorIndex = directoryKey.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }
  const value = directoryKey.slice(separatorIndex + 1).trim();
  return value === '' ? null : { flavour: directoryKey.slice(0, separatorIndex), value };
}

/** Builds the user-lookup paths to try, in order, for one directory key. */
function buildLookupPaths(directoryKey: string): string[] {
  const splitKey = splitDirectoryKey(directoryKey);
  if (!splitKey) {
    return [];
  }

  const encodedValue = encodeURIComponent(splitKey.value);
  if (splitKey.flavour === 'accountId') {
    return [`/rest/api/2/user?accountId=${encodedValue}`];
  }
  if (splitKey.flavour === 'key') {
    return [`/rest/api/2/user?key=${encodedValue}`];
  }
  // A bare "[~X]" cannot reveal whether X is a username or a user key, so try both — mirroring the
  // legacy retry the app's existing Jira user search already performs for older Data Center servers.
  return [`/rest/api/2/user?username=${encodedValue}`, `/rest/api/2/user?key=${encodedValue}`];
}

/** Fetches one person's display name, returning null when they cannot be identified at all. */
async function fetchDisplayName(directoryKey: string): Promise<string | null> {
  for (const lookupPath of buildLookupPaths(directoryKey)) {
    try {
      const user = await jiraGet<{ displayName?: string } | null>(lookupPath);
      const displayName = user?.displayName?.trim();
      if (displayName) {
        return displayName;
      }
    } catch {
      // A deactivated user, one outside the viewer's directory visibility, or a transport failure.
      // Any remaining path is still worth trying; exhausting them all means unresolvable.
    }
  }
  return null;
}

/** Runs `worker` over every item with at most `limit` running at once. */
async function runWithConcurrencyLimit<ItemType>(
  items: ItemType[],
  limit: number,
  worker: (item: ItemType) => Promise<void>,
): Promise<void> {
  let nextItemIndex = 0;

  async function drainQueue(): Promise<void> {
    while (nextItemIndex < items.length) {
      const currentIndex = nextItemIndex;
      nextItemIndex += 1;
      await worker(items[currentIndex]);
    }
  }

  const runnerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: runnerCount }, () => drainQueue()));
}

export const useMentionDirectoryStore = create<MentionDirectoryState>((setState, getState) => ({
  entriesByIdentifier: {},

  seedFromUsers: (users) => {
    const existingEntries = getState().entriesByIdentifier;
    const seededEntries: Record<string, DirectoryEntry> = {};

    users.forEach((user) => {
      const directoryKey = user.userIdentifier?.trim();
      const displayName = user.displayName?.trim();
      if (!directoryKey || !displayName) {
        return;
      }
      // Never downgrade a name we already have; seeding only ever adds knowledge.
      if (existingEntries[directoryKey]?.status === 'resolved') {
        return;
      }
      seededEntries[directoryKey] = { status: 'resolved', displayName };
    });

    if (Object.keys(seededEntries).length > 0) {
      setState({ entriesByIdentifier: { ...existingEntries, ...seededEntries } });
    }
  },

  resolveMissing: async (identifiers) => {
    const existingEntries = getState().entriesByIdentifier;
    // Skipping 'pending' is what de-duplicates in-flight lookups: two comments naming the same
    // unknown person must produce one request, not two.
    const pendingKeys = [...new Set(identifiers)]
      .filter((directoryKey) => directoryKey.trim() !== '' && existingEntries[directoryKey] === undefined);

    if (pendingKeys.length === 0) {
      return;
    }

    // Mark every one pending BEFORE any request starts, so a concurrent call sees them.
    setState({
      entriesByIdentifier: {
        ...getState().entriesByIdentifier,
        ...Object.fromEntries(pendingKeys.map((directoryKey) => [directoryKey, { status: 'pending' } as const])),
      },
    });

    await runWithConcurrencyLimit(pendingKeys, MAX_CONCURRENT_LOOKUPS, async (directoryKey) => {
      const displayName = await fetchDisplayName(directoryKey);
      const settledEntry: DirectoryEntry = displayName
        ? { status: 'resolved', displayName }
        : { status: 'unresolvable' };
      setState({
        entriesByIdentifier: { ...getState().entriesByIdentifier, [directoryKey]: settledEntry },
      });
    });
  },
}));
