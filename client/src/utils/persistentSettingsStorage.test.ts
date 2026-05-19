// persistentSettingsStorage.test.ts — Unit tests for the durable localStorage settings registry.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  collectPersistentSettingsLocalStorageData,
  isPersistentSettingsStorageKey,
  removePersistentSettingsLocalStorageData,
  restorePersistentSettingsLocalStorageData,
} from './persistentSettingsStorage.ts';

describe('persistentSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('identifies durable settings keys and ignores transient browser state', () => {
    expect(isPersistentSettingsStorageKey('tbxSprintDashboardProjectKey')).toBe(true);
    expect(isPersistentSettingsStorageKey('ntbx-crg-templates')).toBe(true);
    expect(isPersistentSettingsStorageKey('toolbox-hygiene-stale-days')).toBe(true);
    expect(isPersistentSettingsStorageKey('nodetoolbox-art-teams')).toBe(true);
    expect(isPersistentSettingsStorageKey('ntbx-crg-state')).toBe(false);
    expect(isPersistentSettingsStorageKey('ntbx-relay-return-route')).toBe(false);
    expect(isPersistentSettingsStorageKey('random-key')).toBe(false);
  });

  it('collects durable settings and skips transient keys', () => {
    localStorage.setItem('tbxSprintDashboardProjectKey', 'TBX');
    localStorage.setItem('ntbx-crg-templates', '{"template":"chg"}');
    localStorage.setItem('toolbox-hygiene-stale-days', '5');
    localStorage.setItem('ntbx-crg-state', '{"draft":true}');
    localStorage.setItem('random-key', 'ignore');

    expect(collectPersistentSettingsLocalStorageData()).toEqual({
      tbxSprintDashboardProjectKey: 'TBX',
      'ntbx-crg-templates': '{"template":"chg"}',
      'toolbox-hygiene-stale-days': '5',
    });
  });

  it('restores only durable string values from a parsed backup object', () => {
    restorePersistentSettingsLocalStorageData({
      tbxSprintDashboardBoardId: '42',
      'ntbx-crg-field-pins': '{"assignmentGroup":"OPS"}',
      'ntbx-crg-state': '{"draft":true}',
      'random-key': 'ignore',
      invalidObject: { nested: true },
    });

    expect(localStorage.getItem('tbxSprintDashboardBoardId')).toBe('42');
    expect(localStorage.getItem('ntbx-crg-field-pins')).toBe('{"assignmentGroup":"OPS"}');
    expect(localStorage.getItem('ntbx-crg-state')).toBeNull();
    expect(localStorage.getItem('random-key')).toBeNull();
    expect(localStorage.getItem('invalidObject')).toBeNull();
  });

  it('removes durable settings while leaving transient browser state alone', () => {
    localStorage.setItem('tbxSprintDashboardProjectKey', 'TBX');
    localStorage.setItem('ntbx-crg-short-description-config', '{"application":"ENFCT"}');
    localStorage.setItem('toolbox-snow-root-causes', '["Dependency"]');
    localStorage.setItem('ntbx-relay-return-route', '/snow-hub');
    localStorage.setItem('random-key', 'preserve');

    removePersistentSettingsLocalStorageData();

    expect(localStorage.getItem('tbxSprintDashboardProjectKey')).toBeNull();
    expect(localStorage.getItem('ntbx-crg-short-description-config')).toBeNull();
    expect(localStorage.getItem('toolbox-snow-root-causes')).toBeNull();
    expect(localStorage.getItem('ntbx-relay-return-route')).toBe('/snow-hub');
    expect(localStorage.getItem('random-key')).toBe('preserve');
  });
});
