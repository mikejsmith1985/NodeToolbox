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

describe('the delivery forecast settings', () => {
  it('defaults the rate to one point per working day', () => {
    // The conversion the whole forecast rests on. One means "fourteen working days to code freeze
    // makes fourteen points a full load", which is how the team already talks about it.
    expect(readArtSettings(localStorage).pointsPerWorkingDay).toBe(1);
  });

  it('keeps a stored rate that can actually divide', () => {
    storeSettings({ pointsPerWorkingDay: 0.5 });
    expect(readArtSettings(localStorage).pointsPerWorkingDay).toBe(0.5);
  });

  it('refuses a rate of zero, which would be a divide-by-zero in every deadline', () => {
    storeSettings({ pointsPerWorkingDay: 0 });
    expect(readArtSettings(localStorage).pointsPerWorkingDay).toBe(1);
  });

  it('refuses a negative rate, which would run every forecast backwards', () => {
    storeSettings({ pointsPerWorkingDay: -3 });
    expect(readArtSettings(localStorage).pointsPerWorkingDay).toBe(1);
  });

  it('refuses a rate that is not a number at all', () => {
    storeSettings({ pointsPerWorkingDay: 'fast' });
    expect(readArtSettings(localStorage).pointsPerWorkingDay).toBe(1);
  });

  it('starts with no holidays, because most ARTs have configured none', () => {
    expect(readArtSettings(localStorage).holidayIsoDates).toEqual([]);
  });

  it('keeps only entries shaped like a calendar day', () => {
    storeSettings({ holidayIsoDates: ['2026-12-25', 'Christmas', '', '2026-01-01'] });
    expect(readArtSettings(localStorage).holidayIsoDates).toEqual(['2026-12-25', '2026-01-01']);
  });

  it('lets a cleared holiday list stay cleared', () => {
    // Unlike every other list in this store, an empty holiday list is a real answer rather than an
    // absence — so defaulting it back to something would make the field impossible to clear.
    storeSettings({ holidayIsoDates: [] });
    expect(readArtSettings(localStorage).holidayIsoDates).toEqual([]);
  });

  it('defaults the sizing tolerance to zero, so any overage is flagged', () => {
    expect(readArtSettings(localStorage).featureSizingTolerancePercent).toBe(0);
  });

  it('keeps a stored tolerance of zero rather than treating it as absent', () => {
    // Zero is this setting's deliberate value, which is why it cannot use the positive-only guard
    // the other counts use.
    storeSettings({ featureSizingTolerancePercent: 0 });
    expect(readArtSettings(localStorage).featureSizingTolerancePercent).toBe(0);
  });

  it('keeps a stored positive tolerance', () => {
    storeSettings({ featureSizingTolerancePercent: 20 });
    expect(readArtSettings(localStorage).featureSizingTolerancePercent).toBe(20);
  });

  it('refuses a negative tolerance', () => {
    storeSettings({ featureSizingTolerancePercent: -1 });
    expect(readArtSettings(localStorage).featureSizingTolerancePercent).toBe(0);
  });
});
