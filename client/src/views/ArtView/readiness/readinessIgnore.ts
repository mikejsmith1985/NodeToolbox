// readinessIgnore.ts — Per-user "ignore" list for the Readiness tab.
//
// Not every Feature in an ART's PI belongs to the person reviewing it. This lets a user hide
// Features they are not responsible for — either a whole project or individual Features — so the
// lenses, counts, and alerts reflect only their own work. Ignored items are removed entirely (they
// do not count), and the choice persists locally per user. Project exclusion is applied in the JQL
// (so an ignored project never eats the result cap); feature exclusion is applied client-side.

import type { JiraIssue } from '../../../types/jira.ts';

const STORAGE_KEY = 'tbxReadinessIgnored';

/** The persisted ignore selections: whole projects and individual feature keys, both uppercase. */
export interface ReadinessIgnoreState {
  ignoredProjectKeys: string[];
  ignoredFeatureKeys: string[];
}

const EMPTY_STATE: ReadinessIgnoreState = { ignoredProjectKeys: [], ignoredFeatureKeys: [] };

/** Reads the stored ignore state; corrupt or missing storage means nothing is ignored. */
export function readReadinessIgnore(): ReadinessIgnoreState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<ReadinessIgnoreState>;
    return {
      ignoredProjectKeys: normalizeKeys(parsed.ignoredProjectKeys),
      ignoredFeatureKeys: normalizeKeys(parsed.ignoredFeatureKeys),
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Normalizes a stored list into unique, uppercase, non-empty keys. */
function normalizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  return Array.from(new Set(keys.map((key) => String(key).trim().toUpperCase()).filter(Boolean)));
}

/** Persists a new ignore state, returning it for immediate UI use. */
function writeReadinessIgnore(state: ReadinessIgnoreState): ReadinessIgnoreState {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can fail in private browsing; the returned state is still authoritative for this render.
  }
  return state;
}

/** Adds a project key to the ignore list (idempotent, uppercase). */
export function ignoreReadinessProject(projectKey: string): ReadinessIgnoreState {
  const current = readReadinessIgnore();
  const normalized = projectKey.trim().toUpperCase();
  if (normalized === '' || current.ignoredProjectKeys.includes(normalized)) return current;
  return writeReadinessIgnore({ ...current, ignoredProjectKeys: [...current.ignoredProjectKeys, normalized] });
}

/** Removes a project key from the ignore list. */
export function restoreReadinessProject(projectKey: string): ReadinessIgnoreState {
  const current = readReadinessIgnore();
  const normalized = projectKey.trim().toUpperCase();
  return writeReadinessIgnore({
    ...current,
    ignoredProjectKeys: current.ignoredProjectKeys.filter((key) => key !== normalized),
  });
}

/** Adds a feature key to the ignore list (idempotent, uppercase). */
export function ignoreReadinessFeature(featureKey: string): ReadinessIgnoreState {
  const current = readReadinessIgnore();
  const normalized = featureKey.trim().toUpperCase();
  if (normalized === '' || current.ignoredFeatureKeys.includes(normalized)) return current;
  return writeReadinessIgnore({ ...current, ignoredFeatureKeys: [...current.ignoredFeatureKeys, normalized] });
}

/** Removes a feature key from the ignore list. */
export function restoreReadinessFeature(featureKey: string): ReadinessIgnoreState {
  const current = readReadinessIgnore();
  const normalized = featureKey.trim().toUpperCase();
  return writeReadinessIgnore({
    ...current,
    ignoredFeatureKeys: current.ignoredFeatureKeys.filter((key) => key !== normalized),
  });
}

/** Clears every ignore selection. */
export function clearReadinessIgnore(): ReadinessIgnoreState {
  return writeReadinessIgnore({ ...EMPTY_STATE });
}

/** Derives the uppercase project prefix from a Jira issue key (`ENCUC-2163` → `ENCUC`). */
export function readProjectKeyFromFeatureKey(featureKey: string): string {
  return featureKey.split('-', 1)[0]?.trim().toUpperCase() ?? '';
}

/** Removes issues whose key is on the ignored-feature list (case-insensitive). */
export function applyReadinessFeatureIgnore(issues: readonly JiraIssue[], ignoredFeatureKeys: readonly string[]): JiraIssue[] {
  if (ignoredFeatureKeys.length === 0) return [...issues];
  const ignoredUpper = new Set(ignoredFeatureKeys.map((key) => key.toUpperCase()));
  return issues.filter((issue) => !ignoredUpper.has(issue.key.toUpperCase()));
}
