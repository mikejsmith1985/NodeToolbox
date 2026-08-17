// jiraFieldMapping.ts — Which Jira field drives which piece of logic, said out loud.
//
// Five custom fields carry most of what this app reasons about: the Feature Link, story points,
// Acceptance Criteria, the classic Epic Link, and the ServiceNow reference. Each is resolved the same
// sensible way — a saved override first, then a field DISCOVERED by name, then a hard-coded default —
// and that chain was invisible. Nothing on any screen said which field had actually been chosen.
//
// That matters because of the last step. On a new Jira, discovery misses and the hard default reads
// **a different field that happens to share an id** — so the app carries on confidently, reporting
// nothing, having quietly attached itself to the wrong data. A missing field announces itself; a
// silently wrong one does not.
//
// So this module does two things and no more: it says what each logical field resolved to and WHY, and
// it lets somebody choose the right one. The resolution order is unchanged — this is the same chain,
// with the lights on.

import type { JiraField } from '../types/jira.ts';

/** Where the ART advanced settings live. Reused rather than replaced: two stores would disagree. */
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/** How much of this app stops making sense when one field is wrong. */
export type FieldMappingImportance = 'critical' | 'important';

/** One logical field, and everything needed to resolve, explain and change it. */
export interface FieldMappingEntry {
  /** The key inside the ART settings this override is saved under. */
  settingsKey: 'featureLinkField' | 'spFieldId' | 'acFieldId' | 'epicLinkFieldId' | 'snowRefFieldId';
  label: string;
  /** What breaks when this is wrong — in the reader's terms, not the code's. */
  whatItDrives: string;
  /** Matched case-insensitively against the instance's field NAMES. */
  namePattern: RegExp;
  /** The id used when nothing better is found. The dangerous step, which is why it is reported. */
  hardDefaultFieldId: string;
  importance: FieldMappingImportance;
}

/**
 * The fields worth surfacing, and only those.
 *
 * Deliberately not every custom field this app has ever read. These five are the ones whose being
 * wrong changes what the app SAYS rather than merely leaving a box empty.
 */
export const FIELD_MAPPING_ENTRIES: FieldMappingEntry[] = [
  {
    settingsKey: 'featureLinkField',
    label: 'Feature Link',
    whatItDrives: 'which Feature every Story, sub-task and defect rolls up to — so every swimlane, '
      + 'every progress figure and the whole Roll-Up Board',
    namePattern: /feature link/i,
    hardDefaultFieldId: 'customfield_10108',
    importance: 'critical',
  },
  {
    settingsKey: 'spFieldId',
    label: 'Story Points',
    whatItDrives: 'capacity planning, and whether progress is weighted by size or counted by issue',
    namePattern: /story point/i,
    hardDefaultFieldId: 'customfield_10028',
    importance: 'critical',
  },
  {
    settingsKey: 'acFieldId',
    label: 'Acceptance Criteria',
    whatItDrives: 'the hygiene check for missing AC, and the AC shown on a card',
    namePattern: /acceptance criteria/i,
    hardDefaultFieldId: 'customfield_10200',
    importance: 'important',
  },
  {
    settingsKey: 'epicLinkFieldId',
    label: 'Epic Link',
    whatItDrives: 'the fallback parent when an issue has no Feature Link',
    namePattern: /epic link/i,
    hardDefaultFieldId: 'customfield_10014',
    importance: 'important',
  },
  {
    settingsKey: 'snowRefFieldId',
    label: 'ServiceNow reference',
    whatItDrives: 'matching a Jira defect or story to its ServiceNow record',
    namePattern: /service.?now|\bsnow\b/i,
    hardDefaultFieldId: 'customfield_11203',
    importance: 'important',
  },
];

/** Where an effective field id came from. */
export type FieldMappingSource = 'chosen' | 'discovered' | 'hard-default' | 'missing';

/** What one logical field resolved to, and why. */
export interface FieldMappingResolution {
  entry: FieldMappingEntry;
  /** What somebody saved, if anything. */
  chosenFieldId: string | null;
  /** Every field on this instance whose NAME matches — usually one, occasionally several. */
  discoveredFieldIds: string[];
  /** What the app will actually read. */
  effectiveFieldId: string;
  source: FieldMappingSource;
  /** Null when nothing needs saying. Otherwise what is wrong and what it means. */
  riskNote: string | null;
}

/** Reads every saved override. Unreadable storage is treated as nothing saved. */
export function readFieldMappingOverrides(storage: Storage): Partial<Record<string, string>> {
  try {
    return JSON.parse(storage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as Partial<Record<string, string>>;
  } catch {
    return {};
  }
}

/**
 * Saves one override, leaving every other ART setting alone.
 *
 * Read-modify-write rather than replace: this store also holds the ART's own settings, and a panel
 * that owned the whole key would silently wipe them.
 */
export function writeFieldMappingOverride(
  storage: Storage,
  settingsKey: FieldMappingEntry['settingsKey'],
  nextFieldId: string,
): void {
  const settings = readFieldMappingOverrides(storage);
  const nextSettings = { ...settings };
  if (nextFieldId.trim() === '') delete nextSettings[settingsKey];
  else nextSettings[settingsKey] = nextFieldId.trim();
  storage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
}

/** Every field on this instance whose name matches an entry. */
export function discoverFieldIds(
  entry: FieldMappingEntry,
  availableFields: readonly JiraField[],
): string[] {
  return (availableFields ?? [])
    .filter((field) => typeof field.name === 'string' && entry.namePattern.test(field.name))
    .map((field) => String(field.id))
    .filter((fieldId) => fieldId !== '');
}

/**
 * Resolves one logical field and explains the answer.
 *
 * The order is the one the app already used. What is new is the fourth case: when discovery finds
 * nothing AND nobody has chosen, the hard default is still used — because removing it would break
 * every instance that works today — but it is reported as a guess rather than presented as a fact.
 */
export function resolveFieldMapping(
  entry: FieldMappingEntry,
  availableFields: readonly JiraField[],
  overrides: Partial<Record<string, string>>,
): FieldMappingResolution {
  const chosenFieldId = overrides[entry.settingsKey]?.trim() || null;
  const discoveredFieldIds = discoverFieldIds(entry, availableFields);
  const isChosenOnInstance = chosenFieldId !== null
    && availableFields.some((field) => String(field.id) === chosenFieldId);

  if (chosenFieldId !== null) {
    return {
      entry,
      chosenFieldId,
      discoveredFieldIds,
      effectiveFieldId: chosenFieldId,
      source: 'chosen',
      // Chosen beats discovery — somebody knew something the name did not say. But a choice pointing
      // at a field this Jira does not have is the signature of a settings file from another instance.
      riskNote: isChosenOnInstance || availableFields.length === 0
        ? null
        : `${chosenFieldId} does not exist on this Jira. It was probably chosen on a different `
          + 'instance — pick the right field here.',
    };
  }

  if (discoveredFieldIds.length > 0) {
    return {
      entry,
      chosenFieldId: null,
      discoveredFieldIds,
      effectiveFieldId: discoveredFieldIds[0],
      source: 'discovered',
      riskNote: discoveredFieldIds.length === 1
        ? null
        : `${discoveredFieldIds.length} fields on this Jira are named like "${entry.label}". The first `
          + 'is being used; choose one so it is not left to the order Jira happens to return them in.',
    };
  }

  // Nothing matched by name. The app still reads the default, and that is the case worth shouting
  // about: an id that exists on this instance and belongs to something else entirely reads perfectly.
  const isDefaultOnInstance = availableFields.some(
    (field) => String(field.id) === entry.hardDefaultFieldId,
  );
  // An empty catalogue means "not read yet", not "this Jira has no fields". Warning then would put a
  // screen of red rows in front of somebody every time the panel opened.
  const isCatalogueKnown = availableFields.length > 0;

  return {
    entry,
    chosenFieldId: null,
    discoveredFieldIds: [],
    effectiveFieldId: entry.hardDefaultFieldId,
    source: isCatalogueKnown && !isDefaultOnInstance ? 'missing' : 'hard-default',
    riskNote: !isCatalogueKnown
      ? null
      : (isDefaultOnInstance
        ? `No field on this Jira is named like "${entry.label}", so the built-in default `
          + `(${entry.hardDefaultFieldId}) is being read. On this instance that id may belong to `
          + 'something else entirely — confirm it, or choose the right field.'
        : `No field on this Jira is named like "${entry.label}", and the built-in default `
          + `(${entry.hardDefaultFieldId}) does not exist here either. This is not working — choose `
          + 'the right field.'),
  };
}

/** Resolves every entry at once. */
export function resolveAllFieldMappings(
  availableFields: readonly JiraField[],
  overrides: Partial<Record<string, string>>,
): FieldMappingResolution[] {
  return FIELD_MAPPING_ENTRIES.map((entry) => resolveFieldMapping(entry, availableFields, overrides));
}

/** A one-line headline, so the state of the mapping is legible without reading five rows. */
export function describeMappingHealth(resolutions: readonly FieldMappingResolution[]): string {
  const needsAttention = resolutions.filter((resolution) => resolution.riskNote !== null);
  if (needsAttention.length === 0) {
    return `All ${resolutions.length} fields resolve cleanly on this Jira.`;
  }
  return `${needsAttention.length} of ${resolutions.length} fields need attention: `
    + `${needsAttention.map((resolution) => resolution.entry.label).join(', ')}.`;
}
