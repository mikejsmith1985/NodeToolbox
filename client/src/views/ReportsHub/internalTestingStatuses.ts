// internalTestingStatuses.ts — The single definition of which Jira statuses mean "internal testing".
//
// Jira cannot tell us this: every in-flight status shares one category, so "Testing" and "In Progress"
// look identical to it. The user picks the statuses once, in the Internal Testing Bottleneck panel.
//
// This module exists so that the bottleneck panel and the internal-testing coverage metric read that
// choice from ONE place. Two readers would eventually disagree about which statuses count, and the
// coverage figure — which is used to argue for headcount — would then contradict the bottleneck panel
// sitting directly above it on the same page.

/** The bottleneck panel's persisted inputs: the scope query and the chosen internal-testing statuses. */
export interface BottleneckSettings {
  scopeJql: string;
  statusNames: string[];
}

/** localStorage key the Internal Testing Bottleneck panel persists its scope JQL + status names under. */
export const BOTTLENECK_SETTINGS_STORAGE_KEY = 'tbxPersonalFlowBottleneck';

/** Splits a comma-separated status-names string into trimmed, non-empty names (migrates older data). */
export function parseStatusNames(statusNamesText: string): string[] {
  return statusNamesText.split(',').map((name) => name.trim()).filter((name) => name !== '');
}

/**
 * Reads the persisted status names, tolerating three shapes: the current `statusNames` array, an older
 * `statusNamesText` comma string (migrated so a pre-multi-select user keeps their picks), or neither.
 * Any non-string array entry is dropped so a corrupted store can never seed a bogus status.
 */
export function readPersistedStatusNames(
  stored: { statusNames?: unknown; statusNamesText?: unknown },
): string[] {
  if (Array.isArray(stored.statusNames)) {
    return stored.statusNames.filter((name): name is string => typeof name === 'string');
  }
  if (typeof stored.statusNamesText === 'string') {
    return parseStatusNames(stored.statusNamesText); // migrate the older comma-separated text form
  }
  return [];
}

/**
 * Reads the bottleneck panel's persisted inputs, falling back to blanks when nothing is stored or the
 * stored JSON cannot be parsed.
 *
 * Blanks are deliberate: with no configured statuses the coverage metric reports itself as
 * unconfigured rather than guessing. Guessing which statuses mean "internal testing" would put a
 * fabricated staffing claim in front of a funding decision.
 */
export function readBottleneckSettings(): BottleneckSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(BOTTLENECK_SETTINGS_STORAGE_KEY) || '{}') as {
      scopeJql?: string;
      statusNames?: unknown;
      statusNamesText?: unknown;
    };
    return { scopeJql: stored.scopeJql ?? '', statusNames: readPersistedStatusNames(stored) };
  } catch {
    return { scopeJql: '', statusNames: [] };
  }
}

/** Persists the panel's inputs; failures are swallowed because storage here is a convenience. */
export function writeBottleneckSettings(settings: BottleneckSettings): void {
  try {
    localStorage.setItem(BOTTLENECK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors (private mode, quota) — the panel still works without persistence.
  }
}
