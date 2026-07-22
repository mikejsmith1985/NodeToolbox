// useCurrentUserMentionKeys.ts — The current user's mention identifiers, for highlighting @-mentions of them.
//
// When reading a thread, a mention of *you* should catch your eye. Deciding that needs the viewer's
// own Jira identifiers in the same prefixed form the mention directory uses.
//
// The identity is fetched once per page load and shared by every comment thread on screen: several
// threads can render at once (a hygiene list, a DSU board), and each one asking Jira "who am I?"
// independently would be pure waste for an answer that cannot change during a session.

import { useEffect, useState } from 'react';

import { getMyself } from '../services/jiraApi.ts';
import type { JiraMyself } from '../types/jira.ts';

// Shared across every hook instance for the life of the page. Not a cache with a policy — the
// answer simply cannot change while the app is open.
let currentUserRequest: Promise<JiraMyself | null> | null = null;

/**
 * Fetches the current user once, reusing the in-flight or completed request thereafter.
 *
 * Every failure resolves to null rather than propagating: knowing who you are is a nicety that
 * highlights mentions of you, and it must never stop a comment thread from rendering. The async
 * wrapper matters — it converts a synchronous throw (Jira transport unavailable) into the same
 * quiet null as a rejected request.
 */
function loadCurrentUserOnce(): Promise<JiraMyself | null> {
  currentUserRequest ??= (async () => {
    try {
      return await getMyself();
    } catch {
      return null;
    }
  })();
  return currentUserRequest;
}

/** Resets the shared identity request. Exported for tests, which must not leak state between cases. */
export function resetCurrentUserMentionKeysCache(): void {
  currentUserRequest = null;
}

/** Builds the prefixed directory keys that identify one Jira user, newest identifier form first. */
export function buildUserDirectoryKeys(user: JiraMyself | null): string[] {
  if (!user) {
    return [];
  }
  const directoryKeys: string[] = [];
  if (user.accountId?.trim()) {
    directoryKeys.push(`accountId:${user.accountId.trim()}`);
  }
  if (user.name?.trim()) {
    // A bare "[~X]" mention is read as a username, so the username form is what will match.
    directoryKeys.push(`name:${user.name.trim()}`);
  }
  return directoryKeys;
}

/**
 * Returns the prefixed directory keys identifying the person using the app, so a comment can mark
 * mentions of them. Returns an empty list until the identity resolves, and permanently if Jira
 * cannot be asked — in which case mentions simply render without self-emphasis.
 */
export function useCurrentUserMentionKeys(): string[] {
  const [directoryKeys, setDirectoryKeys] = useState<string[]>([]);

  useEffect(() => {
    let isMounted = true;
    void loadCurrentUserOnce().then((currentUser) => {
      if (isMounted) {
        setDirectoryKeys(buildUserDirectoryKeys(currentUser));
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return directoryKeys;
}
