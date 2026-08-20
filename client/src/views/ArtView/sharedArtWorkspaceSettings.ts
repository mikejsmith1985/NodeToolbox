// sharedArtWorkspaceSettings.ts — One reader for the shared ART workspace, used by every surface.
//
// This exists because two readers of the same setting disagreed, and the disagreement was invisible.
// The Train settings screen read `tbxARTSettings` and merged in the built-in defaults, so it always
// showed a workspace. The Roll-Up Board read the same key RAW and fell back to an empty string, so
// after "Clear All Connection Data" removed the key the board believed no workspace was configured —
// while the settings screen, two clicks away, said one was.
//
// The visible cost: "Get the team's columns" silently returned nothing. The columns were safe in
// Confluence the whole time; the board simply had no id to ask with, and nothing on screen said so.
//
// A setting shown in two places must be READ in one place. Anything else is two implementations
// agreeing until the day they do not.

/** The keys that locate a team's shared workspace in Confluence. */
export interface SharedArtWorkspaceSettings {
  sharedArtName: string;
  sharedArtKey: string;
  sharedArtDatabaseId: string;
  sharedArtSpaceId: string;
  sharedArtParentId: string;
}

/** Where the ART settings live. Note the `tbx` prefix — "Clear All Connection Data" removes it. */
export const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/**
 * The workspace this build ships pointing at.
 *
 * Real values, not placeholders: the team that uses this tool shares one workspace, and a blank
 * default would mean every fresh install started unable to share anything.
 */
export const DEFAULT_SHARED_ART_SETTINGS: SharedArtWorkspaceSettings = {
  sharedArtName: 'Sales to Enrollment',
  sharedArtKey: 'S2E',
  sharedArtDatabaseId: '684163133',
  sharedArtSpaceId: '256344064',
  sharedArtParentId: '685473797',
};

/**
 * Reads the shared workspace settings, with the built-in defaults filling anything absent.
 *
 * Unreadable or absent storage yields the defaults rather than blanks, because a missing setting is
 * not evidence that no workspace exists — it is evidence that this machine has not been told about
 * one, and the build already knows which one that is.
 */
export function readSharedArtWorkspaceSettings(): SharedArtWorkspaceSettings {
  try {
    const storedSettings = JSON.parse(
      window.localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}',
    ) as Partial<SharedArtWorkspaceSettings>;
    return { ...DEFAULT_SHARED_ART_SETTINGS, ...storedSettings };
  } catch {
    return { ...DEFAULT_SHARED_ART_SETTINGS };
  }
}

/**
 * The Confluence database id every shared-workspace read and write goes through.
 *
 * Returns the default when the stored value is missing OR blank. A stored empty string is the shape
 * a half-finished settings edit leaves behind, and treating it as "no workspace" is exactly how the
 * board came to disagree with the screen that configures it.
 */
export function readSharedArtDatabaseId(): string {
  const storedDatabaseId = readSharedArtWorkspaceSettings().sharedArtDatabaseId?.trim() ?? '';
  return storedDatabaseId === '' ? DEFAULT_SHARED_ART_SETTINGS.sharedArtDatabaseId : storedDatabaseId;
}
