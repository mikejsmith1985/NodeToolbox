// persistentSettingsStorage.ts — Shared rules for which localStorage keys count as durable NodeToolbox settings.

const PERSISTENT_SETTINGS_PREFIX = 'tbx';
const LEGACY_PERSISTENT_SETTINGS_PREFIX = 'ntbx-';
const LEGACY_HYGIENE_SETTINGS_PREFIX = 'toolbox-hygiene-';

const ADDITIONAL_PERSISTENT_SETTINGS_KEYS = new Set([
  'nodetoolbox-art-teams',
  'toolbox-snow-root-causes',
]);

const TRANSIENT_SETTINGS_KEYS = new Set([
  'ntbx-crg-state',
  'ntbx-relay-return-route',
]);

/** Returns true when the key stores durable user configuration that should survive updates and backups. */
export function isPersistentSettingsStorageKey(storageKey: string): boolean {
  if (storageKey.startsWith(PERSISTENT_SETTINGS_PREFIX)) {
    return true;
  }

  if (TRANSIENT_SETTINGS_KEYS.has(storageKey)) {
    return false;
  }

  return (
    storageKey.startsWith(LEGACY_PERSISTENT_SETTINGS_PREFIX) ||
    storageKey.startsWith(LEGACY_HYGIENE_SETTINGS_PREFIX) ||
    ADDITIONAL_PERSISTENT_SETTINGS_KEYS.has(storageKey)
  );
}

/** Collects every durable NodeToolbox setting from localStorage into a plain object for export. */
export function collectPersistentSettingsLocalStorageData(): Record<string, string> {
  const collectedData: Record<string, string> = {};
  for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex += 1) {
    const storageKey = localStorage.key(storageIndex);
    if (storageKey !== null && isPersistentSettingsStorageKey(storageKey)) {
      collectedData[storageKey] = localStorage.getItem(storageKey) ?? '';
    }
  }
  return collectedData;
}

/** Restores durable settings from a parsed backup object and ignores transient or invalid entries. */
export function restorePersistentSettingsLocalStorageData(
  parsedBackupData: Record<string, unknown>,
): void {
  for (const [restoreKey, restoreValue] of Object.entries(parsedBackupData)) {
    if (isPersistentSettingsStorageKey(restoreKey) && typeof restoreValue === 'string') {
      localStorage.setItem(restoreKey, restoreValue);
    }
  }
}

/** Removes every durable NodeToolbox setting from localStorage while leaving transient browser state intact. */
export function removePersistentSettingsLocalStorageData(): void {
  const keysToRemove: string[] = [];
  for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex += 1) {
    const storageKey = localStorage.key(storageIndex);
    if (storageKey !== null && isPersistentSettingsStorageKey(storageKey)) {
      keysToRemove.push(storageKey);
    }
  }

  for (const keyToRemove of keysToRemove) {
    localStorage.removeItem(keyToRemove);
  }
}
