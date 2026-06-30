// labels.test.ts — Unit tests for case-sensitive label dedupe and validation.

import { describe, expect, it } from 'vitest';

import { dedupeLabels, isValidLabel } from './labels.ts';

describe('dedupeLabels', () => {
  it('collapses exact duplicates but keeps case distinctions', () => {
    expect(dedupeLabels(['Ops', 'Ops', 'ops'])).toEqual(['Ops', 'ops']);
  });

  it('preserves first-seen order', () => {
    expect(dedupeLabels(['beta', 'alpha', 'beta'])).toEqual(['beta', 'alpha']);
  });

  it('drops empty/whitespace entries', () => {
    expect(dedupeLabels(['ok', '', '   '])).toEqual(['ok']);
  });
});

describe('isValidLabel', () => {
  it('rejects labels containing spaces', () => {
    expect(isValidLabel('has space')).toBe(false);
  });
  it('accepts a normal label', () => {
    expect(isValidLabel('release-2026')).toBe(true);
  });
  it('rejects an empty label', () => {
    expect(isValidLabel('')).toBe(false);
  });
});
