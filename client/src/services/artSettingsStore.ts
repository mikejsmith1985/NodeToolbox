// artSettingsStore.ts — One reader for the ART settings, because nineteen was too many.
//
// `tbxARTSettings` was parsed by hand in nineteen separate files, each with its own idea of what an
// absent or blank value meant. That is not a stylistic problem. The Roll-Up Board and the Train
// settings screen read the same key with different fallbacks, so after a settings wipe the screen
// said a workspace was configured and the board said none was — and "Get the team's columns"
// returned nothing while the columns sat safe in Confluence. A recoverable loss looked total.
//
// So: one parse, one defaulting policy, one place to change when the shape moves. Field IDS are not
// defaulted here — those belong to `jiraFieldMapping.ts`, which knows the discovery chain. This
// module owns the settings that are NOT field ids: thresholds, dates, scopes, workspace pointers.

/** Where the ART advanced settings live. Note the `tbx` prefix: "Clear All Connection Data" takes it. */
export const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/** Everything the ART settings screen persists that is not a Jira field id. */
export interface ArtSettings {
  /** Days without movement before an issue counts as stale. */
  staleDays: number;
  /** Length of a sprint in calendar days, used by every sprint-window calculation. */
  sprintWindowDays: number;
  /** Last day of the current PI, or empty when unset. */
  piEndDate: string;
  /** Projects that hold Features, when Features do not live in the team's own project. */
  featureProjectKeys: string[];
  /** Jira link types the dependency graph includes by default. */
  depLinkTypes: string[];
  /**
   * PI Review's own date fields and its "work started" status.
   *
   * These default to EMPTY, not to an id. Their callers already read blank as "not configured" and
   * skip the write — inventing a default here would make PI Review write dates to a field nobody
   * chose, which is the exact failure the story-points work just undid.
   */
  piReviewTargetStartFieldId: string;
  piReviewTargetEndFieldId: string;
  piReviewDevStartStatusName: string;
  /** The Confluence workspace this ART shares through. */
  sharedArtName: string;
  sharedArtKey: string;
  sharedArtDatabaseId: string;
  sharedArtSpaceId: string;
  sharedArtParentId: string;
}

/**
 * What every reader falls back to. Real values, not blanks: the team that uses this tool shares one
 * workspace, and a blank default would mean a fresh install could share nothing at all.
 */
export const DEFAULT_ART_SETTINGS: ArtSettings = {
  staleDays: 5,
  sprintWindowDays: 14,
  piEndDate: '',
  featureProjectKeys: [],
  depLinkTypes: ['blocks', 'is blocked by', 'depends on', 'is depended on by', 'relates to'],
  piReviewTargetStartFieldId: '',
  piReviewTargetEndFieldId: '',
  piReviewDevStartStatusName: '',
  sharedArtName: 'Sales to Enrollment',
  sharedArtKey: 'S2E',
  sharedArtDatabaseId: '684163133',
  sharedArtSpaceId: '256344064',
  sharedArtParentId: '685473797',
};

/** Reads a stored string, treating blank as absent — a half-finished edit is not a choice. */
function readStoredText(storedValue: unknown, defaultValue: string): string {
  return typeof storedValue === 'string' && storedValue.trim() !== '' ? storedValue.trim() : defaultValue;
}

/** Reads a stored positive number, ignoring anything that is not one. */
function readStoredCount(storedValue: unknown, defaultValue: number): number {
  const parsedValue = Number(storedValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

/** Reads a stored list, treating an empty one as absent so a default survives a cleared field. */
function readStoredList(storedValue: unknown, defaultValue: string[]): string[] {
  if (!Array.isArray(storedValue)) {
    return [...defaultValue];
  }
  const cleanedEntries = storedValue
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return cleanedEntries.length === 0 ? [...defaultValue] : cleanedEntries;
}

/**
 * Parses the stored blob. Unreadable OR ABSENT storage is "nothing stored".
 *
 * The absent case is not hypothetical: several modules that read these settings are bundled into the
 * SERVER engines, where there is no `window` at all. Touching `window.localStorage` eagerly there
 * throws before any default can apply — which is what took eight PI-review DOM tests down the moment
 * this reader replaced a local one.
 */
function readStoredSettingsObject(storage?: Storage): Record<string, unknown> {
  try {
    const resolvedStorage = storage
      ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolvedStorage) {
      return {};
    }
    return JSON.parse(resolvedStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Reads the ART settings with every default applied.
 *
 * Unreadable storage yields the defaults rather than blanks. An absent setting is not evidence that
 * nothing is configured — it is evidence that this machine has not been told, and the build already
 * knows what to assume. Reading it as "nothing" is exactly how two screens came to disagree.
 */
export function readArtSettings(storage?: Storage): ArtSettings {
  const storedSettings = readStoredSettingsObject(storage);

  return {
    staleDays: readStoredCount(storedSettings.staleDays, DEFAULT_ART_SETTINGS.staleDays),
    sprintWindowDays: readStoredCount(storedSettings.sprintWindowDays, DEFAULT_ART_SETTINGS.sprintWindowDays),
    piEndDate: readStoredText(storedSettings.piEndDate, DEFAULT_ART_SETTINGS.piEndDate),
    // Feature projects default to EMPTY rather than a guess: scoping a Feature search to the wrong
    // project returns another team's work, which is worse than returning none.
    featureProjectKeys: Array.isArray(storedSettings.featureProjectKeys)
      ? readStoredList(storedSettings.featureProjectKeys, [])
      : [],
    depLinkTypes: readStoredList(storedSettings.depLinkTypes, DEFAULT_ART_SETTINGS.depLinkTypes),
    piReviewTargetStartFieldId: readStoredText(storedSettings.piReviewTargetStartFieldId, ''),
    piReviewTargetEndFieldId: readStoredText(storedSettings.piReviewTargetEndFieldId, ''),
    piReviewDevStartStatusName: readStoredText(storedSettings.piReviewDevStartStatusName, ''),
    sharedArtName: readStoredText(storedSettings.sharedArtName, DEFAULT_ART_SETTINGS.sharedArtName),
    sharedArtKey: readStoredText(storedSettings.sharedArtKey, DEFAULT_ART_SETTINGS.sharedArtKey),
    sharedArtDatabaseId: readStoredText(storedSettings.sharedArtDatabaseId, DEFAULT_ART_SETTINGS.sharedArtDatabaseId),
    sharedArtSpaceId: readStoredText(storedSettings.sharedArtSpaceId, DEFAULT_ART_SETTINGS.sharedArtSpaceId),
    sharedArtParentId: readStoredText(storedSettings.sharedArtParentId, DEFAULT_ART_SETTINGS.sharedArtParentId),
  };
}
