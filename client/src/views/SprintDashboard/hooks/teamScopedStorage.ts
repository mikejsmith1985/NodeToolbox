// teamScopedStorage.ts — Shared Team Dashboard localStorage helpers that migrate legacy single-team values safely.

const LEGACY_DASHBOARD_TEAM_PROFILE_ID = 'legacy-default';

/** Resolves the storage-safe Team Dashboard profile id, preserving the legacy default for single-team users. */
export function resolveTeamScopedStorageProfileId(dashboardTeamProfileId: string): string {
  return dashboardTeamProfileId.trim() || LEGACY_DASHBOARD_TEAM_PROFILE_ID;
}

/** Builds the team-scoped localStorage key used by Team Dashboard feature data. */
export function buildTeamScopedStorageKey(
  baseStorageKey: string,
  dashboardTeamProfileId: string,
): string {
  return `${baseStorageKey}:${resolveTeamScopedStorageProfileId(dashboardTeamProfileId)}`;
}

function hasAnyTeamScopedStorageValue(baseStorageKey: string): boolean {
  for (let storageIndex = 0; storageIndex < window.localStorage.length; storageIndex += 1) {
    const storedKeyName = window.localStorage.key(storageIndex);
    if (storedKeyName?.startsWith(`${baseStorageKey}:`)) {
      return true;
    }
  }

  return false;
}

/** Reads a scoped value and performs a one-time legacy migration only before any team-scoped data exists. */
export function readTeamScopedStorageValue(
  baseStorageKey: string,
  dashboardTeamProfileId: string,
): string | null {
  const scopedStorageKey = buildTeamScopedStorageKey(baseStorageKey, dashboardTeamProfileId);
  const scopedStorageValue = window.localStorage.getItem(scopedStorageKey);
  if (scopedStorageValue !== null) {
    return scopedStorageValue;
  }

  if (hasAnyTeamScopedStorageValue(baseStorageKey)) {
    return null;
  }

  const legacyStorageValue = window.localStorage.getItem(baseStorageKey);
  if (legacyStorageValue !== null) {
    window.localStorage.setItem(scopedStorageKey, legacyStorageValue);
  }

  return legacyStorageValue;
}
