// artFeatureScopeSettings.ts — Shared helpers for reading and normalizing ART feature-scope settings.

import { readArtSettings } from '../../services/artSettingsStore.ts';
import { resolveWriteFieldId } from '../../services/jiraFieldMapping.ts';

export interface ArtFeatureScopeSettings {
  piFieldId: string;
  featureProjectKeys: string[];
}

/** Parses a comma-separated project-key filter into unique uppercase Jira project keys. */
export function parseFeatureProjectKeysInput(featureProjectKeysValue: string): string[] {
  return Array.from(
    new Set(
      featureProjectKeysValue
        .split(',')
        .map((featureProjectKey) => featureProjectKey.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

/** Formats stored feature-project filters back into the Settings input. */
export function formatFeatureProjectKeysInput(featureProjectKeys: readonly string[] | undefined): string {
  return (featureProjectKeys ?? []).join(', ');
}

/** Reads the ART-wide feature scope settings used by Team Dashboard feature discovery. */
export function readArtFeatureScopeSettings(): ArtFeatureScopeSettings {
  // Both halves delegate: the field id to the mapping module, the project scope to the settings
  // reader. This file used to parse the store and default the id itself, which is one more copy of
  // each to keep in step and no benefit for either.
  return {
    piFieldId: resolveWriteFieldId('piFieldId', window.localStorage),
    featureProjectKeys: readArtSettings()
      .featureProjectKeys
      .map((featureProjectKey) => featureProjectKey.trim().toUpperCase())
      .filter(Boolean),
  };
}
