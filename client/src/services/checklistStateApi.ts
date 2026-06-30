// checklistStateApi.ts — Client wrapper for the NodeToolbox daily-checklist API.
//
// These endpoints are served by the local NodeToolbox backend (not the Jira
// proxy), so they use plain fetch against /api/sm-checklist-state. The store
// keeps which "Today" dashboard categories the user has marked complete for a
// given business day, namespaced per user and per day.

/** A single checklist-completion record returned by the backend. */
export interface ChecklistCompletionRecord {
  completedAt: string;
}

/** Map of categoryId → completion record. */
export type ChecklistCompletionMap = Record<string, ChecklistCompletionRecord>;

/** Fetches the categories the user has marked complete for the given business day. */
export async function fetchDailyChecklist(userKey: string, day: string): Promise<ChecklistCompletionMap> {
  const response = await fetch(
    `/api/sm-checklist-state?user=${encodeURIComponent(userKey)}&day=${encodeURIComponent(day)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load daily checklist (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { completed?: ChecklistCompletionMap };
  return payload.completed ?? {};
}

/**
 * Marks one category complete for the day (isComplete=true) or undoes it (false).
 * Returns the user's updated completion map so callers can refresh in place.
 */
export async function setCategoryComplete(params: {
  userKey: string;
  day: string;
  categoryId: string;
  isComplete: boolean;
}): Promise<ChecklistCompletionMap> {
  const response = await fetch('/api/sm-checklist-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Failed to update checklist category (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { completed?: ChecklistCompletionMap };
  return payload.completed ?? {};
}
