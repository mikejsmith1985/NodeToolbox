// docLinkSettings.test.ts — Setup done once, and surviving whatever is in storage.

import { beforeEach, describe, expect, it } from 'vitest';

import { readDocLinkSettings, saveDocLinkSettings } from './docLinkSettings.ts';

const STORAGE_KEY = 'tbxConfluenceDocLinks';

/** A storage that behaves, and one that refuses — both of which happen in real browsers. */
function buildStorage(initialValue: string | null = null): Storage {
  let storedValue = initialValue;
  return {
    getItem: () => storedValue,
    setItem: (_key: string, nextValue: string) => { storedValue = nextValue; },
    removeItem: () => { storedValue = null; },
    clear: () => { storedValue = null; },
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('readDocLinkSettings', () => {
  it('starts BLANK rather than pre-filled with a guess', () => {
    // A setting that arrives already populated looks configured, and a scan that then finds nothing
    // reads as a broken tool instead of an unconfigured one.
    const settings = readDocLinkSettings(buildStorage());

    expect(settings.spaceKey).toBe('');
    expect(settings.rootPageTitle).toBe('');
    expect(settings.storyProjectKey).toBe('');
  });

  it('starts the two fields that have real defaults at those defaults', () => {
    // Jira's own default name for the link type is a starting point, not a guess about this team.
    const settings = readDocLinkSettings(buildStorage());

    expect(settings.containmentLinkTypeName).toBe('Container');
    expect(settings.featureLinkFieldName).toBe('Feature Link');
  });

  it('reads back what was saved', () => {
    const storage = buildStorage();
    saveDocLinkSettings({
      spaceKey: 'MAVertical',
      rootPageTitle: 'ENCUC: CleanUpCrew: SF Integration',
      featureProjectKeys: 'DENP',
      featureLinkFieldName: 'Feature Link',
      storyProjectKey: 'ENCUC',
      storyIssueTypeId: '10001',
      containmentLinkTypeName: 'Container',
    }, storage);

    expect(readDocLinkSettings(storage).rootPageTitle).toBe('ENCUC: CleanUpCrew: SF Integration');
  });

  it('fills a field an older build never wrote, rather than yielding undefined', () => {
    const storage = buildStorage(JSON.stringify({ spaceKey: 'MAVertical' }));

    const settings = readDocLinkSettings(storage);

    expect(settings.spaceKey).toBe('MAVertical');
    expect(settings.containmentLinkTypeName).toBe('Container');
  });

  it('ignores a field stored as the wrong type', () => {
    const storage = buildStorage(JSON.stringify({ spaceKey: 42 }));

    expect(readDocLinkSettings(storage).spaceKey).toBe('');
  });

  it('survives nonsense in storage instead of taking down the screen that would fix it', () => {
    expect(readDocLinkSettings(buildStorage('not json')).spaceKey).toBe('');
  });
});

describe('saveDocLinkSettings', () => {
  it('writes the whole object under one key', () => {
    const storage = buildStorage();
    saveDocLinkSettings(readDocLinkSettings(storage), storage);

    expect(storage.getItem(STORAGE_KEY)).toContain('containmentLinkTypeName');
  });

  it('does not throw when storage refuses the write', () => {
    // A private window or a full quota must not take the panel down with it.
    const refusingStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    } as unknown as Storage;

    expect(() => saveDocLinkSettings(readDocLinkSettings(), refusingStorage)).not.toThrow();
  });
});
