// teamScopedStorage.test.ts — Tests for one-time legacy Team Dashboard storage migration and team isolation.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildTeamScopedStorageKey,
  readTeamScopedStorageValue,
  resolveTeamScopedStorageProfileId,
} from './teamScopedStorage.ts';

describe('teamScopedStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the legacy default id when the active team profile id is blank', () => {
    expect(resolveTeamScopedStorageProfileId('')).toBe('legacy-default');
    expect(buildTeamScopedStorageKey('tbxExample', '')).toBe('tbxExample:legacy-default');
  });

  it('migrates a bare legacy value into the first scoped team key', () => {
    localStorage.setItem('tbxExample', '{"value":"legacy"}');

    expect(readTeamScopedStorageValue('tbxExample', 'team-alpha')).toBe('{"value":"legacy"}');
    expect(localStorage.getItem('tbxExample:team-alpha')).toBe('{"value":"legacy"}');
  });

  it('refuses the bare legacy fallback once any team-scoped key already exists', () => {
    localStorage.setItem('tbxExample', '{"value":"legacy"}');
    localStorage.setItem('tbxExample:team-alpha', '{"value":"alpha"}');

    expect(readTeamScopedStorageValue('tbxExample', 'team-beta')).toBeNull();
  });
});
