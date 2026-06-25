// mentionStateApi.ts — Client wrapper for the NodeToolbox addressed-mentions API.
//
// These endpoints are served by the local NodeToolbox backend (not the Jira
// proxy), so they use plain fetch against /api/mention-state. The store keeps
// which @-mention comments the user has marked addressed, namespaced per user.

/** A single addressed-mention record returned by the backend. */
export interface AddressedMentionRecord {
  addressedAt: string;
  issueKey: string;
}

/** Map of mentionKey (`issueKey#commentId`) → addressed record. */
export type AddressedMentionMap = Record<string, AddressedMentionRecord>;

/** Fetches every mention the given user has already marked addressed. */
export async function fetchAddressedMentions(userKey: string): Promise<AddressedMentionMap> {
  const response = await fetch(`/api/mention-state?user=${encodeURIComponent(userKey)}`);
  if (!response.ok) {
    throw new Error(`Failed to load addressed mentions (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { addressed?: AddressedMentionMap };
  return payload.addressed ?? {};
}

/**
 * Marks a single mention addressed (isAddressed=true) or undoes it (false).
 * Returns the user's updated addressed map so callers can refresh in place.
 */
export async function setMentionAddressed(params: {
  userKey: string;
  mentionKey: string;
  issueKey: string;
  isAddressed: boolean;
}): Promise<AddressedMentionMap> {
  const response = await fetch('/api/mention-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Failed to update mention (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { addressed?: AddressedMentionMap };
  return payload.addressed ?? {};
}
