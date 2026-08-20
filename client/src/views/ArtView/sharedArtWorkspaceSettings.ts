// sharedArtWorkspaceSettings.ts — The shared workspace, read through the one ART settings reader.
//
// This module was created to stop two surfaces disagreeing about the workspace: the Train settings
// screen merged the built-in defaults and always showed one, while the Roll-Up Board read the raw key
// and fell back to an empty string, so after a settings wipe the board believed no workspace existed
// and "Get the team's columns" silently returned nothing (GH #375).
//
// It now delegates to `services/artSettingsStore.ts`, which applies that same policy to EVERY ART
// setting rather than to these five. Two reader modules with one policy is still two reader modules;
// the point was never this file, it was that the policy live in exactly one place.

import { DEFAULT_ART_SETTINGS, readArtSettings } from '../../services/artSettingsStore.ts';

export { ART_SETTINGS_STORAGE_KEY } from '../../services/artSettingsStore.ts';

/** The keys that locate a team's shared workspace in Confluence. */
export interface SharedArtWorkspaceSettings {
  sharedArtName: string;
  sharedArtKey: string;
  sharedArtDatabaseId: string;
  sharedArtSpaceId: string;
  sharedArtParentId: string;
}

/** The workspace this build ships pointing at. */
export const DEFAULT_SHARED_ART_SETTINGS: SharedArtWorkspaceSettings = {
  sharedArtName: DEFAULT_ART_SETTINGS.sharedArtName,
  sharedArtKey: DEFAULT_ART_SETTINGS.sharedArtKey,
  sharedArtDatabaseId: DEFAULT_ART_SETTINGS.sharedArtDatabaseId,
  sharedArtSpaceId: DEFAULT_ART_SETTINGS.sharedArtSpaceId,
  sharedArtParentId: DEFAULT_ART_SETTINGS.sharedArtParentId,
};

/** Reads the shared workspace settings, with the built-in defaults filling anything absent. */
export function readSharedArtWorkspaceSettings(): SharedArtWorkspaceSettings {
  const artSettings = readArtSettings();
  return {
    sharedArtName: artSettings.sharedArtName,
    sharedArtKey: artSettings.sharedArtKey,
    sharedArtDatabaseId: artSettings.sharedArtDatabaseId,
    sharedArtSpaceId: artSettings.sharedArtSpaceId,
    sharedArtParentId: artSettings.sharedArtParentId,
  };
}

/** The Confluence database id every shared-workspace read and write goes through. */
export function readSharedArtDatabaseId(): string {
  return readSharedArtWorkspaceSettings().sharedArtDatabaseId;
}
