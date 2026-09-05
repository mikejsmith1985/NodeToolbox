// testEvidenceScope.test.ts — Choosing the release whose evidence is gathered: project + fix version.

import { describe, expect, it } from 'vitest';

import {
  buildReleaseJql,
  listSelectableVersions,
  readDefaultProjectKey,
  rememberProjectKey,
  TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY,
} from './testEvidenceScope.ts';

function storage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

describe('readDefaultProjectKey', () => {
  it('prefers the key this section last used', () => {
    const browserStorage = storage({
      [TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY]: 'ENCUC',
      'ntbx-crg-state': JSON.stringify({ projectKey: 'OTHER' }),
    });

    expect(readDefaultProjectKey(browserStorage)).toBe('ENCUC');
  });

  it('falls back to the project the CHG Generator draft is working in', () => {
    // The operator who just raised the change from ENCUC's fix version should not retype ENCUC.
    const browserStorage = storage({ 'ntbx-crg-state': JSON.stringify({ projectKey: 'encuc' }) });

    expect(readDefaultProjectKey(browserStorage)).toBe('ENCUC');
  });

  it('returns empty when nothing is remembered or the draft is unreadable', () => {
    expect(readDefaultProjectKey(storage())).toBe('');
    expect(readDefaultProjectKey(storage({ 'ntbx-crg-state': 'not json' }))).toBe('');
  });

  it('survives a storage that throws, as a private window can', () => {
    const throwingStorage = { getItem: () => { throw new Error('denied'); } } as unknown as Storage;

    expect(readDefaultProjectKey(throwingStorage)).toBe('');
  });
});

describe('rememberProjectKey', () => {
  it('stores the upper-cased key for next time', () => {
    const browserStorage = storage();

    rememberProjectKey(browserStorage, ' encuc ');

    expect(browserStorage.getItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY)).toBe('ENCUC');
  });

  it('forgets rather than storing an empty key', () => {
    const browserStorage = storage({ [TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY]: 'ENCUC' });

    rememberProjectKey(browserStorage, '');

    expect(browserStorage.getItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY)).toBeNull();
  });
});

describe('buildReleaseJql', () => {
  it('scopes to the project and the exact fix version, like the CHG Generator does', () => {
    expect(buildReleaseJql('ENCUC', 'ENCUC 2026.09.1')).toBe('project = "ENCUC" AND fixVersion = "ENCUC 2026.09.1" ORDER BY key ASC');
  });

  it('strips quotes that would break the JQL', () => {
    expect(buildReleaseJql('EN"C', 'v"1')).toBe('project = "ENC" AND fixVersion = "v1" ORDER BY key ASC');
  });
});

describe('listSelectableVersions', () => {
  it('offers unreleased versions first, then released ones marked as such, and never archived ones', () => {
    // Evidence is usually gathered before a release ships, but attaching it afterwards is a real
    // thing too — so a released version stays selectable, just labelled. Archived is gone for good.
    const options = listSelectableVersions([
      { name: '2026.08.1', released: true },
      { name: '2026.07.1', archived: true },
      { name: '2026.09.1' },
      { name: '2026.10.1', released: false },
    ]);

    expect(options).toEqual([
      { name: '2026.09.1', label: '2026.09.1' },
      { name: '2026.10.1', label: '2026.10.1' },
      { name: '2026.08.1', label: '2026.08.1 (released)' },
    ]);
  });

  it('drops a version without a name', () => {
    expect(listSelectableVersions([{ name: '' }, { name: '  ' }])).toEqual([]);
  });
});
