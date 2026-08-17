// configBackup.ts — Carrying this app's settings out to a file, and back in again.
//
// Everything the app has been taught about a Jira instance lives in browser storage across roughly a
// hundred separate keys: board columns, checklist mappings, team profiles, scope choices, PI names,
// field pins. None of it is written down anywhere else, none of it survives a cleared browser, and
// none of it could be moved to another machine or another instance.
//
// That is the whole reason this exists. It is a backup today, and it is the only way a re-point at a
// different Jira starts from what the team already agreed rather than from a blank page.
//
// Two rules shape what goes in the file:
//
//   • NO secrets. The admin passphrase is excluded outright — a file somebody emails to a colleague
//     must never carry it — and so are the unlock flags, which say what this machine is currently
//     allowed to do rather than what the team has configured.
//   • Nothing is applied blind. An import reports what it would change BEFORE it changes anything,
//     because the settings it overwrites took months to arrive at.

/** The prefixes every setting this app owns is stored under. */
const CONFIG_KEY_PREFIXES = ['tbx', 'ntbx-'];

/**
 * Keys deliberately left out of a backup.
 *
 * The passphrase is a secret and belongs nowhere near an exported file. The unlock flags are the
 * state of THIS browser — carrying them would silently hand an unlocked Admin Hub to whoever opened
 * the file, which is the opposite of what a settings backup should do.
 */
const EXCLUDED_KEYS = new Set([
  'tbxAdminPassphrase',
  'tbxAdminUnlocked',
  'tbxAdvancedUnlocked',
  'tbxAiAssistUnlocked',
]);

/** Bumped only when the shape changes in a way an older app could not read. */
export const CONFIG_BACKUP_VERSION = 1;

/** What an exported file contains. */
export interface ConfigBackup {
  version: number;
  /** When it was taken, so two files can be told apart without opening them. */
  exportedAt: string;
  /** The app version that wrote it, for when a restore behaves oddly a year from now. */
  appVersion: string;
  /** Raw stored values, exactly as the app left them. */
  entries: Record<string, string>;
}

/** True when a key belongs to this app and is safe to carry. */
export function isBackupKey(storageKey: string): boolean {
  if (EXCLUDED_KEYS.has(storageKey)) return false;
  return CONFIG_KEY_PREFIXES.some((prefix) => storageKey.startsWith(prefix));
}

/**
 * Collects every setting worth carrying.
 *
 * Reads the storage it is given rather than reaching for `window`, so the whole thing can be tested
 * without a browser and, more usefully, so a caller can back up something other than localStorage.
 */
export function buildConfigBackup(storage: Storage, appVersion: string, nowIso: string): ConfigBackup {
  const entries: Record<string, string> = {};

  for (let keyIndex = 0; keyIndex < storage.length; keyIndex += 1) {
    const storageKey = storage.key(keyIndex);
    if (storageKey === null || !isBackupKey(storageKey)) continue;
    const storedValue = storage.getItem(storageKey);
    if (storedValue !== null) entries[storageKey] = storedValue;
  }

  return { version: CONFIG_BACKUP_VERSION, exportedAt: nowIso, appVersion, entries };
}

/** Why a file could not be read as a backup. Null when it can. */
export function describeBackupProblem(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== 'object') {
    return 'That file is not a NodeToolbox settings backup.';
  }

  const backup = candidate as Partial<ConfigBackup>;
  if (typeof backup.version !== 'number') {
    return 'That file has no backup version, so it is not one this app wrote.';
  }
  if (backup.version > CONFIG_BACKUP_VERSION) {
    return `That backup was written by a newer NodeToolbox (format ${backup.version}, this one reads `
      + `${CONFIG_BACKUP_VERSION}). Update before restoring it.`;
  }
  if (backup.entries === null || typeof backup.entries !== 'object') {
    return 'That backup has no settings in it.';
  }
  return null;
}

/** One setting an import would change, described before anything is written. */
export interface ConfigChange {
  storageKey: string;
  kind: 'added' | 'replaced' | 'unchanged';
}

/**
 * Works out what an import would do, without doing any of it.
 *
 * Separate from applying on purpose. These settings represent months of agreement about columns,
 * mappings and team shape; replacing them is not something anybody should discover afterwards.
 */
export function planConfigRestore(storage: Storage, backup: ConfigBackup): ConfigChange[] {
  return Object.entries(backup.entries ?? {})
    .filter(([storageKey]) => isBackupKey(storageKey))
    .map(([storageKey, backedUpValue]) => {
      const currentValue = storage.getItem(storageKey);
      if (currentValue === null) return { storageKey, kind: 'added' as const };
      return { storageKey, kind: currentValue === backedUpValue ? 'unchanged' as const : 'replaced' as const };
    })
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
}

/** A one-line summary of a plan, so the headline is not left to be counted off a list. */
export function describeRestorePlan(changes: readonly ConfigChange[]): string {
  const addedCount = changes.filter((change) => change.kind === 'added').length;
  const replacedCount = changes.filter((change) => change.kind === 'replaced').length;
  const unchangedCount = changes.filter((change) => change.kind === 'unchanged').length;

  if (addedCount === 0 && replacedCount === 0) {
    return `Nothing would change — all ${unchangedCount} settings already match this backup.`;
  }
  return `${replacedCount} setting${replacedCount === 1 ? '' : 's'} would be REPLACED, `
    + `${addedCount} added, ${unchangedCount} already match.`;
}

/**
 * Writes the backup's settings into storage.
 *
 * Only keys this app owns are written, even if the file carries others — a settings file is not a
 * licence to set arbitrary browser storage, and an edited or hand-made file must not become one.
 *
 * Keys absent from the backup are LEFT ALONE rather than cleared. A restore is "make these settings
 * true", not "make this machine identical"; wiping something the file simply predates would turn a
 * restore into a silent loss.
 */
export function applyConfigRestore(storage: Storage, backup: ConfigBackup): number {
  let appliedCount = 0;

  for (const [storageKey, backedUpValue] of Object.entries(backup.entries ?? {})) {
    if (!isBackupKey(storageKey) || typeof backedUpValue !== 'string') continue;
    storage.setItem(storageKey, backedUpValue);
    appliedCount += 1;
  }

  return appliedCount;
}

/** The file name an export downloads as — dated, so a folder of them is readable at a glance. */
export function buildBackupFileName(nowIso: string): string {
  return `nodetoolbox-settings-${nowIso.slice(0, 10)}.json`;
}
