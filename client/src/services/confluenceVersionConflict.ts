// confluenceVersionConflict.ts — Recognises Confluence refusing a save because the page changed meanwhile.
//
// Framework-First drift (feature 038, research R-6): PI Review already makes this check, but privately inside
// PiReviewTab.tsx — a 3,300-line tab that must not be refactored to export it. This is the shared copy for
// new code; PI Review keeps its own until that tab is next opened for real work.

import { ConfluenceRequestError } from './confluenceApi.ts';

// Confluence's own wording when a save carries a version number that is no longer the next one.
const VERSION_CONFLICT_MESSAGE = 'Version must be incremented on update';
// HTTP 409 Conflict: the proxy's status for the same situation.
const HTTP_CONFLICT_STATUS = 409;

/**
 * True when a save failed only because someone else saved the page first. The caller re-reads the page,
 * merges again and retries, instead of reporting a failure the user did nothing to cause.
 */
export function isConfluenceVersionConflict(error: unknown): boolean {
  if (error instanceof ConfluenceRequestError && error.status === HTTP_CONFLICT_STATUS) {
    return true;
  }
  return error instanceof Error && error.message.includes(VERSION_CONFLICT_MESSAGE);
}
