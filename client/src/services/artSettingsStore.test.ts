// artSettingsStore.test.ts — One parse, one defaulting policy.
//
// Nineteen files parsed `tbxARTSettings` by hand, each with its own idea of what absent meant. Two of
// them disagreed about the shared workspace, so after a settings wipe one screen said a workspace was
// configured and another said none was — and pulling the team's columns returned nothing while the
// columns sat safe in Confluence (GH #375).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ART_SETTINGS_STORAGE_KEY, DEFAULT_ART_SETTINGS, readArtSettings } from './artSettingsStore.ts';

function storeSettings(settings: Record<string, unknown>): void {
  localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('readArtSettings', () => {
  it('returns the shipped defaults when nothing is stored', () => {
    // The exact case a settings wipe produces. Blanks here are what made a recoverable loss look
    // total: the board concluded there was no workspace and stopped trying.
    expect(readArtSettings(localStorage).sharedArtDatabaseId).toBe(DEFAULT_ART_SETTINGS.sharedArtDatabaseId);
    expect(readArtSettings(localStorage).staleDays).toBe(5);
  });

  it('keeps a stored value over the default', () => {
    storeSettings({ staleDays: 12, sharedArtDatabaseId: '999' });

    expect(readArtSettings(localStorage).staleDays).toBe(12);
    expect(readArtSettings(localStorage).sharedArtDatabaseId).toBe('999');
  });

  it('treats a blank string as unset, not as an answer', () => {
    // A half-finished edit leaves an empty string. Read literally it means "no workspace", which is
    // the reading that broke the board.
    storeSettings({ sharedArtDatabaseId: '   ' });

    expect(readArtSettings(localStorage).sharedArtDatabaseId).toBe(DEFAULT_ART_SETTINGS.sharedArtDatabaseId);
  });

  it('ignores a stale threshold that is not a positive number', () => {
    storeSettings({ staleDays: 0 });
    expect(readArtSettings(localStorage).staleDays).toBe(5);

    storeSettings({ staleDays: 'soon' });
    expect(readArtSettings(localStorage).staleDays).toBe(5);
  });

  it('restores the default link types when the stored list is emptied', () => {
    storeSettings({ depLinkTypes: [] });

    expect(readArtSettings(localStorage).depLinkTypes).toEqual(DEFAULT_ART_SETTINGS.depLinkTypes);
  });

  it('leaves feature projects EMPTY when unset, rather than guessing one', () => {
    // Opposite policy on purpose: scoping a Feature search to a guessed project returns another
    // team's work, which is worse than returning none.
    expect(readArtSettings(localStorage).featureProjectKeys).toEqual([]);
  });

  it('drops blank entries from a stored list', () => {
    storeSettings({ featureProjectKeys: ['ENFCT', '  ', 'DENP'] });

    expect(readArtSettings(localStorage).featureProjectKeys).toEqual(['ENFCT', 'DENP']);
  });

  it('survives storage that is not JSON', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, '{{{ not json');

    expect(readArtSettings(localStorage).sharedArtKey).toBe(DEFAULT_ART_SETTINGS.sharedArtKey);
  });

  it('hands back its own arrays, so one caller cannot mutate another\'s defaults', () => {
    const firstRead = readArtSettings(localStorage);
    firstRead.depLinkTypes.push('invented by caller');

    expect(readArtSettings(localStorage).depLinkTypes).toEqual(DEFAULT_ART_SETTINGS.depLinkTypes);
  });
});

describe('readArtSettings in a server bundle', () => {
  // Several modules that read these settings are bundled into the SERVER engines, where there is no
  // `window` at all. Touching `window.localStorage` eagerly throws before any default can apply —
  // which is exactly what took eight PI-review DOM tests down the moment this reader replaced a
  // local one. The DOM suite caught it; this test keeps it caught.
  it('returns the defaults when no storage exists at all', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — deliberately simulating the server bundle, where window is absent.
    delete globalThis.window;

    try {
      expect(readArtSettings().sharedArtKey).toBe(DEFAULT_ART_SETTINGS.sharedArtKey);
      expect(readArtSettings().depLinkTypes).toEqual(DEFAULT_ART_SETTINGS.depLinkTypes);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
