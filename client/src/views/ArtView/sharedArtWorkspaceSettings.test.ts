// sharedArtWorkspaceSettings.test.ts — One reader, so two surfaces cannot disagree about it.
//
// The Roll-Up Board read `tbxARTSettings` raw and fell back to an empty string; the Train settings
// screen read the same key and merged the built-in defaults. After "Clear All Connection Data"
// removed the key, the settings screen showed a workspace and the board believed there was none —
// so "Get the team's columns" silently returned nothing while the columns sat safe in Confluence.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ART_SETTINGS_STORAGE_KEY,
  DEFAULT_SHARED_ART_SETTINGS,
  readSharedArtDatabaseId,
  readSharedArtWorkspaceSettings,
} from './sharedArtWorkspaceSettings.ts';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('readSharedArtDatabaseId', () => {
  it('falls back to the built-in workspace when the setting was cleared', () => {
    // The exact case that lost a team its columns: the key is gone, so a raw read says "no
    // workspace" and every share button quietly does nothing.
    expect(readSharedArtDatabaseId()).toBe(DEFAULT_SHARED_ART_SETTINGS.sharedArtDatabaseId);
  });

  it('prefers a configured workspace over the default', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ sharedArtDatabaseId: '999' }));

    expect(readSharedArtDatabaseId()).toBe('999');
  });

  it('treats a blank stored value as unset, not as "no workspace"', () => {
    // A half-finished settings edit leaves an empty string, which read literally means the board
    // stops sharing while the settings screen still shows a workspace.
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ sharedArtDatabaseId: '   ' }));

    expect(readSharedArtDatabaseId()).toBe(DEFAULT_SHARED_ART_SETTINGS.sharedArtDatabaseId);
  });

  it('survives storage that is not JSON at all', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, 'not json');

    expect(readSharedArtDatabaseId()).toBe(DEFAULT_SHARED_ART_SETTINGS.sharedArtDatabaseId);
  });
});

describe('readSharedArtWorkspaceSettings', () => {
  it('fills every absent field from the defaults, keeping what is stored', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ sharedArtName: 'Renamed' }));

    const settings = readSharedArtWorkspaceSettings();

    expect(settings.sharedArtName).toBe('Renamed');
    expect(settings.sharedArtSpaceId).toBe(DEFAULT_SHARED_ART_SETTINGS.sharedArtSpaceId);
  });
});
