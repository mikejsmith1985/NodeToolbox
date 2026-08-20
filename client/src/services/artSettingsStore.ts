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
  /**
   * How many story points one person completes in one working day.
   *
   * The conversion the whole delivery forecast rests on: fourteen working days to code freeze means
   * a person holding more than fourteen points is over capacity. One number per ART rather than per
   * person, because per-person velocity is not recorded anywhere.
   */
  pointsPerWorkingDay: number;
  /** Organisational holidays as 'YYYY-MM-DD'. Empty by default; without it every December is wrong. */
  holidayIsoDates: string[];
  /** How far a Feature's children may exceed its own estimate before it is flagged, as a percentage. */
  featureSizingTolerancePercent: number;
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
  pointsPerWorkingDay: 1,
  holidayIsoDates: [],
  featureSizingTolerancePercent: 0,
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

/** Matches a bare calendar day. Anything else is not a date a calendar can act on. */
const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a points-per-working-day rate, refusing anything that cannot divide.
 *
 * Zero and negatives are rejected rather than clamped: a rate of zero is a divide-by-zero waiting
 * to become an infinite deadline, and a negative one would run every forecast backwards.
 */
function readStoredRate(storedValue: unknown, defaultValue: number): number {
  const parsedValue = Number(storedValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

/** Reads a percentage, allowing zero — which is this setting's deliberate default, not an absence. */
function readStoredPercentage(storedValue: unknown, defaultValue: number): number {
  const parsedValue = Number(storedValue);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : defaultValue;
}

/**
 * Reads a holiday list, keeping only entries shaped like a calendar day.
 *
 * An EMPTY list is a real answer here, unlike every other list in this store: an ART with no
 * holidays configured is the normal case, and defaulting a cleared field back to something would
 * make the field impossible to clear.
 */
function readStoredCalendarDays(storedValue: unknown): string[] {
  if (!Array.isArray(storedValue)) {
    return [];
  }
  return storedValue
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => CALENDAR_DAY_PATTERN.test(entry));
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
    // Rate and tolerance are read through their OWN guards rather than readStoredCount: a rate of
    // zero would be used as a divisor, and a tolerance of zero is the deliberate default rather
    // than an absent value, so "positive only" is the wrong rule for both.
    pointsPerWorkingDay: readStoredRate(storedSettings.pointsPerWorkingDay, DEFAULT_ART_SETTINGS.pointsPerWorkingDay),
    holidayIsoDates: readStoredCalendarDays(storedSettings.holidayIsoDates),
    featureSizingTolerancePercent: readStoredPercentage(
      storedSettings.featureSizingTolerancePercent,
      DEFAULT_ART_SETTINGS.featureSizingTolerancePercent,
    ),
    sharedArtName: readStoredText(storedSettings.sharedArtName, DEFAULT_ART_SETTINGS.sharedArtName),
    sharedArtKey: readStoredText(storedSettings.sharedArtKey, DEFAULT_ART_SETTINGS.sharedArtKey),
    sharedArtDatabaseId: readStoredText(storedSettings.sharedArtDatabaseId, DEFAULT_ART_SETTINGS.sharedArtDatabaseId),
    sharedArtSpaceId: readStoredText(storedSettings.sharedArtSpaceId, DEFAULT_ART_SETTINGS.sharedArtSpaceId),
    sharedArtParentId: readStoredText(storedSettings.sharedArtParentId, DEFAULT_ART_SETTINGS.sharedArtParentId),
  };
}

/**
 * The three delivery-forecast settings exactly as stored, before any defaulting.
 *
 * `readArtSettings` deliberately corrects an unusable value so that every reader gets something it
 * can work with. That is right for a reader and wrong for a REPORTER: the forecast has to be able
 * to say "your rate is zero and is being ignored", and it cannot say that about a value it only
 * ever sees as one. So the raw values are available too, and the forecast validates them itself.
 */
export function readRawForecastSettings(storage?: Storage): {
  pointsPerWorkingDay: unknown;
  holidayIsoDates: unknown;
  featureSizingTolerancePercent: unknown;
} {
  const storedSettings = readStoredSettingsObject(storage);
  return {
    pointsPerWorkingDay: storedSettings.pointsPerWorkingDay ?? DEFAULT_ART_SETTINGS.pointsPerWorkingDay,
    holidayIsoDates: storedSettings.holidayIsoDates ?? DEFAULT_ART_SETTINGS.holidayIsoDates,
    featureSizingTolerancePercent: storedSettings.featureSizingTolerancePercent
      ?? DEFAULT_ART_SETTINGS.featureSizingTolerancePercent,
  };
}
