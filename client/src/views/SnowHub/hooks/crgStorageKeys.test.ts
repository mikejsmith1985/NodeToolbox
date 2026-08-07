// crgStorageKeys.test.ts — Unit tests for the CRG draft storage key helpers.

import { describe, expect, it } from 'vitest';

import { CRG_REBUILD_STORAGE_KEY_PREFIX, CRG_WIZARD_STORAGE_KEY, buildRebuildStorageKey } from './crgStorageKeys.ts';

describe('buildRebuildStorageKey', () => {
  it('normalises whitespace and case so one change resolves to one draft', () => {
    const spacedLowercaseKey = buildRebuildStorageKey('  chg0001234  ');
    const cleanUppercaseKey = buildRebuildStorageKey('CHG0001234');

    expect(spacedLowercaseKey).toBe(cleanUppercaseKey);
  });

  it('carries the rebuild prefix and the change number', () => {
    expect(buildRebuildStorageKey('CHG0001234')).toBe(`${CRG_REBUILD_STORAGE_KEY_PREFIX}CHG0001234`);
  });

  it('gives two different change numbers two different keys', () => {
    expect(buildRebuildStorageKey('CHG0001234')).not.toBe(buildRebuildStorageKey('CHG0009999'));
  });

  // A rebuild draft that landed on the wizard's key would both inherit and destroy the
  // operator's in-progress Create draft — the exact collision this module exists to prevent.
  it('never collides with the Create wizard key, even for empty input', () => {
    expect(buildRebuildStorageKey('CHG0001234')).not.toBe(CRG_WIZARD_STORAGE_KEY);
    expect(buildRebuildStorageKey('')).not.toBe(CRG_WIZARD_STORAGE_KEY);
    expect(buildRebuildStorageKey('   ')).not.toBe(CRG_WIZARD_STORAGE_KEY);
  });

  it('exposes the wizard key that every existing caller still uses by default', () => {
    expect(CRG_WIZARD_STORAGE_KEY).toBe('ntbx-crg-state');
  });
});
