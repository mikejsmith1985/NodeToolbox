// piReviewIgnoredFeatures.ts — Persisted ignore list of Feature keys the PI Review pull must skip.
//
// Some Features match the pull query (right PI, right assignee) but are not actually the team's to
// deliver. Deleting their row only helps until the next pull re-discovers them, so this list
// remembers the decision: an ignored key is filtered out of every future "Pull Features from Jira"
// until the user restores it. Keys are stored as a plain upper-cased array — a Jira key is globally
// unique, so the list is deliberately NOT scoped by team or PI (a Feature the user does not own is
// not theirs in any PI).

const IGNORED_FEATURE_KEYS_STORAGE_KEY = 'tbxPiReviewIgnoredFeatureKeys';

/** Normalizes a Feature key for storage/comparison; empty string when the key is blank. */
function normalizeFeatureKey(featureKey: string): string {
  return featureKey.trim().toUpperCase();
}

function persistIgnoredFeatureKeys(ignoredFeatureKeys: Set<string>): void {
  try {
    localStorage.setItem(IGNORED_FEATURE_KEYS_STORAGE_KEY, JSON.stringify(Array.from(ignoredFeatureKeys).sort()));
  } catch {
    // Storage may be unavailable (private mode, quota); the in-memory set still serves this session.
  }
}

/** Reads the persisted ignore list; unreadable or malformed storage yields an empty set, never an error. */
export function readIgnoredPiReviewFeatureKeys(): Set<string> {
  try {
    const storedValue = JSON.parse(localStorage.getItem(IGNORED_FEATURE_KEYS_STORAGE_KEY) || '[]');
    if (!Array.isArray(storedValue)) {
      return new Set();
    }
    return new Set(
      storedValue
        .filter((storedKey): storedKey is string => typeof storedKey === 'string')
        .map(normalizeFeatureKey)
        .filter((storedKey) => storedKey !== ''),
    );
  } catch {
    return new Set();
  }
}

/** Adds a Feature key to the persisted ignore list and returns the updated set. Blank keys are ignored. */
export function addIgnoredPiReviewFeatureKey(featureKey: string): Set<string> {
  const ignoredFeatureKeys = readIgnoredPiReviewFeatureKeys();
  const normalizedFeatureKey = normalizeFeatureKey(featureKey);
  if (normalizedFeatureKey === '') {
    return ignoredFeatureKeys;
  }

  ignoredFeatureKeys.add(normalizedFeatureKey);
  persistIgnoredFeatureKeys(ignoredFeatureKeys);
  return ignoredFeatureKeys;
}

/** Removes a Feature key from the persisted ignore list (restoring it to future pulls) and returns the updated set. */
export function removeIgnoredPiReviewFeatureKey(featureKey: string): Set<string> {
  const ignoredFeatureKeys = readIgnoredPiReviewFeatureKeys();
  ignoredFeatureKeys.delete(normalizeFeatureKey(featureKey));
  persistIgnoredFeatureKeys(ignoredFeatureKeys);
  return ignoredFeatureKeys;
}
