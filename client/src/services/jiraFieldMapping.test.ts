// jiraFieldMapping.test.ts — Proves the app says which field it chose and why, and never presents a
// guess as a fact.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JiraField } from '../types/jira.ts';
import {
  FIELD_MAPPING_ENTRIES,
  describeMappingHealth,
  discoverFieldIds,
  readFieldMappingOverrides,
  resolveAllFieldMappings,
  resolveFieldMapping,
  writeFieldMappingOverride,
  resolveConfiguredFieldIds,
  resolveWriteFieldId,
} from './jiraFieldMapping.ts';

/** The Feature Link entry, the one whose being wrong breaks the most. */
const FEATURE_LINK_ENTRY = FIELD_MAPPING_ENTRIES.find((entry) => entry.settingsKey === 'featureLinkField')!;

/** A field catalogue as Jira returns it. */
function buildFields(...named: Array<[string, string]>): JiraField[] {
  return named.map(([id, name]) => ({ id, name } as JiraField));
}

/** A storage double. */
function buildStorage(seed: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(seed));
  return {
    get length() { return entries.size; },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => entries.clear(),
  } as Storage;
}

describe('discoverFieldIds', () => {
  it('finds a field by its name, whatever id this instance gave it', () => {
    // The property the whole approach rests on: names are stable across instances, ids are not.
    expect(discoverFieldIds(FEATURE_LINK_ENTRY, buildFields(
      ['customfield_99999', 'Feature Link'],
      ['customfield_10001', 'Sprint'],
    ))).toEqual(['customfield_99999']);
  });

  it('ignores case and surrounding words', () => {
    expect(discoverFieldIds(FEATURE_LINK_ENTRY, buildFields(['customfield_1', 'Parent feature link (dev)'])))
      .toEqual(['customfield_1']);
  });
});

describe('resolveFieldMapping', () => {
  it('prefers a field discovered by NAME over the built-in default', () => {
    const resolution = resolveFieldMapping(
      FEATURE_LINK_ENTRY,
      buildFields(['customfield_99999', 'Feature Link']),
      {},
    );

    expect(resolution.effectiveFieldId).toBe('customfield_99999');
    expect(resolution.source).toBe('discovered');
    expect(resolution.riskNote).toBeNull();
  });

  it('prefers a saved choice over discovery, because somebody knew more than the name said', () => {
    const resolution = resolveFieldMapping(
      FEATURE_LINK_ENTRY,
      buildFields(['customfield_99999', 'Feature Link'], ['customfield_88888', 'Delivers Feature']),
      { featureLinkField: 'customfield_88888' },
    );

    expect(resolution.effectiveFieldId).toBe('customfield_88888');
    expect(resolution.source).toBe('chosen');
    expect(resolution.riskNote).toBeNull();
  });

  it('WARNS when the built-in default is being read because nothing matched', () => {
    // The case this module exists for. On a new Jira that id may belong to something else entirely,
    // and it reads perfectly — so the app carries on confidently, attached to the wrong data.
    const resolution = resolveFieldMapping(
      FEATURE_LINK_ENTRY,
      buildFields(['customfield_10108', 'Some Other Team Field']),
      {},
    );

    expect(resolution.effectiveFieldId).toBe('customfield_10108');
    expect(resolution.source).toBe('hard-default');
    expect(resolution.riskNote).toContain('may belong to something else entirely');
  });

  it('says it is simply NOT WORKING when even the default does not exist here', () => {
    // Distinguished from the above on purpose: one is "confirm this", the other is "this is broken".
    const resolution = resolveFieldMapping(FEATURE_LINK_ENTRY, buildFields(['customfield_1', 'Sprint']), {});

    expect(resolution.source).toBe('missing');
    expect(resolution.riskNote).toContain('This is not working');
  });

  it('flags a saved choice that does not exist on THIS Jira', () => {
    // The signature of a settings file restored from another instance — exactly what the backup
    // feature now makes easy to do.
    const resolution = resolveFieldMapping(
      FEATURE_LINK_ENTRY,
      buildFields(['customfield_1', 'Feature Link']),
      { featureLinkField: 'customfield_from_old_jira' },
    );

    expect(resolution.riskNote).toContain('does not exist on this Jira');
  });

  it('flags an ambiguous name rather than silently taking whichever came first', () => {
    const resolution = resolveFieldMapping(
      FEATURE_LINK_ENTRY,
      buildFields(['customfield_1', 'Feature Link'], ['customfield_2', 'Feature Link (old)']),
      {},
    );

    expect(resolution.riskNote).toContain('2 fields on this Jira are named like');
  });

  it('says nothing at all before the catalogue has been read', () => {
    // An empty catalogue means "not loaded yet", not "this Jira has no fields". Warning then would
    // put five red rows on screen every time the panel opened.
    expect(resolveFieldMapping(FEATURE_LINK_ENTRY, [], {}).riskNote).toBeNull();
  });
});

describe('the override store', () => {
  it('saves a choice without disturbing the ART settings sharing that key', () => {
    // The panel does not own this key. A blind overwrite would silently wipe the ART's own settings.
    const storage = buildStorage({ tbxARTSettings: '{"someArtSetting":"keep me"}' });

    writeFieldMappingOverride(storage, 'acFieldId', 'customfield_500');

    expect(readFieldMappingOverrides(storage)).toEqual({
      someArtSetting: 'keep me',
      acFieldId: 'customfield_500',
    });
  });

  it('clearing a choice removes it, rather than saving an empty one', () => {
    const storage = buildStorage({ tbxARTSettings: '{"acFieldId":"customfield_500"}' });

    writeFieldMappingOverride(storage, 'acFieldId', '');

    expect(readFieldMappingOverrides(storage).acFieldId).toBeUndefined();
  });

  it('treats unreadable storage as nothing saved', () => {
    expect(readFieldMappingOverrides(buildStorage({ tbxARTSettings: 'not json' }))).toEqual({});
  });
});

describe('describeMappingHealth', () => {
  it('names the fields needing attention, so the headline is actionable', () => {
    const resolutions = resolveAllFieldMappings(buildFields(['customfield_1', 'Sprint']), {});

    expect(describeMappingHealth(resolutions)).toContain('need attention');
    expect(describeMappingHealth(resolutions)).toContain('Feature Link');
  });

  it('says so plainly when everything resolves', () => {
    const resolutions = resolveAllFieldMappings(buildFields(
      ['customfield_1', 'Feature Link'],
      ['customfield_2', 'Story Points'],
      ['customfield_6', 'PI (Program Increment)'],
      ['customfield_7', 'Target start'],
      ['customfield_8', 'Target end'],
      ['customfield_3', 'Acceptance Criteria'],
      ['customfield_4', 'Epic Link'],
      ['customfield_5', 'ServiceNow Reference'],
    ), {});

    expect(describeMappingHealth(resolutions)).toContain('resolve cleanly');
  });
});

describe('resolveConfiguredFieldIds — the synchronous path every check and fix uses', () => {
  // Discovery needs Jira's field list, which a pure check cannot fetch. Without a synchronous entry
  // point, twelve modules resolved story points themselves — under fourteen constant names holding
  // four different values, one of which (`story_points`) is not a field id at all (GH #375).
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('prefers the saved override', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'customfield_10236' }));

    expect(resolveConfiguredFieldIds('spFieldId', localStorage)[0]).toBe('customfield_10236');
  });

  it('falls back to the hard default when nothing is saved', () => {
    expect(resolveConfiguredFieldIds('spFieldId', localStorage)[0]).toBe('customfield_10236');
  });

  it('ignores a saved value that is not a Jira field id', () => {
    // The dashboard config shipped the placeholder `story_points`, which read as "configured".
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'story_points' }));

    expect(resolveConfiguredFieldIds('spFieldId', localStorage)).not.toContain('story_points');
  });

  it('lists the legacy story-points fields too, since points there are still points', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'customfield_10236' }));

    const fieldIds = resolveConfiguredFieldIds('spFieldId', localStorage);

    expect(fieldIds).toContain('customfield_10028');
    expect(fieldIds).toContain('customfield_10016');
  });

  it('lists each field once, however the overrides line up', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'customfield_10028' }));

    const fieldIds = resolveConfiguredFieldIds('spFieldId', localStorage);

    expect(new Set(fieldIds).size).toBe(fieldIds.length);
  });

  it('returns only the one field for a mapping with no alternates', () => {
    expect(resolveConfiguredFieldIds('featureLinkField', localStorage)).toEqual(['customfield_10108']);
  });

  it('survives unreadable storage', () => {
    localStorage.setItem('tbxARTSettings', 'not json');

    expect(resolveConfiguredFieldIds('spFieldId', localStorage)[0]).toBe('customfield_10236');
  });
});

describe('resolveWriteFieldId', () => {
  beforeEach(() => localStorage.clear());

  it('is the field a read would consult first, so a write clears what a check sees', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'customfield_10236' }));

    expect(resolveWriteFieldId('spFieldId', localStorage)).toBe('customfield_10236');
  });
});

describe('the Program Increment field is a mapped field like any other', () => {
  // 27 reads across 10 files, under two constant names, all currently agreeing on
  // customfield_10301 — an agreement they enjoy rather than one anything enforces. With a Jira
  // re-instance expected, ten copies is ten edits and one chance to miss.
  beforeEach(() => localStorage.clear());

  it('resolves to the instance default when nothing is saved', () => {
    expect(resolveWriteFieldId('piFieldId', localStorage)).toBe('customfield_10301');
  });

  it('honours a saved override', () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_20301' }));

    expect(resolveWriteFieldId('piFieldId', localStorage)).toBe('customfield_20301');
  });

  it('is listed as critical, because every PI-scoped screen reads it', () => {
    const piEntry = FIELD_MAPPING_ENTRIES.find((entry) => entry.settingsKey === 'piFieldId');

    expect(piEntry?.importance).toBe('critical');
  });
});
