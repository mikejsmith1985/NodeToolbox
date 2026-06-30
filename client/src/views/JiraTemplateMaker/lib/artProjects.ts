// artProjects.ts — Resolves the Jira project keys configured for the ART, used to seed the
// template maker's project picker. Prefers the explicit ART-wide feature-project filter and
// falls back to the per-team roster. The merge logic is pure and unit-tested; getArtProjectKeys
// is a thin wrapper over the existing local-config readers.

import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import { readStoredArtTeams } from '../../SprintDashboard/sprintDashboardArtContext.ts';

/** Uppercases, trims, de-dupes, and drops blanks while preserving first-seen order. */
function normalizeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawKey of keys) {
    const key = rawKey.trim().toUpperCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

/**
 * Chooses the ART project-key list: the explicit ART-wide feature-project filter when set,
 * otherwise the project keys from the configured team roster. Both inputs are normalized.
 */
export function mergeArtProjectKeys(featureProjectKeys: string[], teamProjectKeys: string[]): string[] {
  const normalizedFeatureKeys = normalizeKeys(featureProjectKeys);
  if (normalizedFeatureKeys.length > 0) {
    return normalizedFeatureKeys;
  }
  return normalizeKeys(teamProjectKeys);
}

/** Reads the ART-configured project keys from local config (feature filter → team roster). */
export function getArtProjectKeys(): string[] {
  const featureProjectKeys = readArtFeatureScopeSettings().featureProjectKeys;
  const teamProjectKeys = readStoredArtTeams()
    .map((team) => team.projectKey ?? '')
    .filter(Boolean);
  return mergeArtProjectKeys(featureProjectKeys, teamProjectKeys);
}
