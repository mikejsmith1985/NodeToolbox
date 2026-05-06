// eslint.config.test.js — Smoke tests for the ESLint configuration.
//
// Verifies that the exported config is a non-empty array of rule objects.
// A broken eslint.config.js would silently disable all linting, so this
// guard catches accidental truncation or syntax errors in the file.

import { describe, it, expect } from 'vitest';
import eslintConfig from './eslint.config.js';

describe('eslint.config', () => {
  it('exports a non-empty array of rule configurations', () => {
    expect(Array.isArray(eslintConfig)).toBe(true);
    expect(eslintConfig.length).toBeGreaterThan(0);
  });

  it('each config entry is an object', () => {
    for (const configEntry of eslintConfig) {
      expect(typeof configEntry).toBe('object');
      expect(configEntry).not.toBeNull();
    }
  });
});
