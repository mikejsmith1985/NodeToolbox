// docLinkSettings.ts — Where this integration is pointed, kept between visits.
//
// Seven values, all of them instance facts a person reads off Confluence and Jira rather than
// anything derivable. They live in localStorage beside every other Admin Hub setting: this is one
// operator's configuration of a tool, not team data, and putting it in the shared workspace would
// make one person's setup everybody's.

const DOC_LINK_SETTINGS_STORAGE_KEY = 'tbxConfluenceDocLinks';

/** Everything a scan needs to find the tree and route what it finds. */
export interface DocLinkSettings {
  spaceKey: string;
  rootPageTitle: string;
  /** Comma separated, because a train can have more than one Feature project. */
  featureProjectKeys: string;
  /** The field NAME as JQL reads it, not an id — no field id belongs in a settings blob. */
  featureLinkFieldName: string;
  storyProjectKey: string;
  storyIssueTypeId: string;
  containmentLinkTypeName: string;
}

/**
 * Defaults that describe the shape rather than guessing an instance.
 *
 * Blank rather than pre-filled with this team's values: a setting that arrives already populated
 * looks configured, and a scan that then finds nothing reads as a broken tool instead of an
 * unconfigured one. `Container` is the exception — it is Jira's own default name for the link type,
 * so it is a real starting point rather than a guess.
 */
const DEFAULT_DOC_LINK_SETTINGS: DocLinkSettings = {
  spaceKey: '',
  rootPageTitle: '',
  featureProjectKeys: '',
  featureLinkFieldName: 'Feature Link',
  storyProjectKey: '',
  storyIssueTypeId: '',
  containmentLinkTypeName: 'Container',
};

/** Reads a stored string field, falling back to the default when it is missing or the wrong type. */
function readStoredField(stored: Record<string, unknown>, fieldName: keyof DocLinkSettings): string {
  const storedValue = stored[fieldName];
  return typeof storedValue === 'string' ? storedValue : DEFAULT_DOC_LINK_SETTINGS[fieldName];
}

/**
 * Loads the saved settings, or the defaults.
 *
 * Every field is read individually so a blob written by an older build — or hand-edited into
 * nonsense — yields a usable object rather than throwing on the screen that would let somebody fix
 * it.
 */
export function readDocLinkSettings(storage: Storage = window.localStorage): DocLinkSettings {
  try {
    const rawSettings = storage.getItem(DOC_LINK_SETTINGS_STORAGE_KEY);
    if (rawSettings === null) {
      return { ...DEFAULT_DOC_LINK_SETTINGS };
    }
    const stored = JSON.parse(rawSettings) as Record<string, unknown>;
    return {
      spaceKey: readStoredField(stored, 'spaceKey'),
      rootPageTitle: readStoredField(stored, 'rootPageTitle'),
      featureProjectKeys: readStoredField(stored, 'featureProjectKeys'),
      featureLinkFieldName: readStoredField(stored, 'featureLinkFieldName'),
      storyProjectKey: readStoredField(stored, 'storyProjectKey'),
      storyIssueTypeId: readStoredField(stored, 'storyIssueTypeId'),
      containmentLinkTypeName: readStoredField(stored, 'containmentLinkTypeName'),
    };
  } catch {
    return { ...DEFAULT_DOC_LINK_SETTINGS };
  }
}

/** Saves the settings, ignoring a storage that refuses to write rather than losing the panel. */
export function saveDocLinkSettings(settings: DocLinkSettings, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(DOC_LINK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A private window or a full quota must not take the panel down with it.
  }
}
