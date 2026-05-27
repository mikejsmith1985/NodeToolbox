// artFeatureScopeSettings.ts — Shared helpers for reading and normalizing ART feature-scope settings.

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

interface StoredArtFeatureScopeSettings {
  piFieldId?: string;
  featureProjectKeys?: string[];
}

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
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as StoredArtFeatureScopeSettings;
    return {
      piFieldId: storedSettings.piFieldId?.trim() || DEFAULT_PI_FIELD_ID,
      featureProjectKeys: Array.isArray(storedSettings.featureProjectKeys)
        ? storedSettings.featureProjectKeys
          .map((featureProjectKey) => featureProjectKey.trim().toUpperCase())
          .filter(Boolean)
        : [],
    };
  } catch {
    return {
      piFieldId: DEFAULT_PI_FIELD_ID,
      featureProjectKeys: [],
    };
  }
}
