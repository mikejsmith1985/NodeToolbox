// piReviewIgnoredFeatures.test.ts — Unit tests for the persisted PI Review Feature ignore list.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addIgnoredPiReviewFeatureKey,
  readIgnoredPiReviewFeatureKeys,
  removeIgnoredPiReviewFeatureKey,
} from './piReviewIgnoredFeatures.ts';

const IGNORED_FEATURE_KEYS_STORAGE_KEY = 'tbxPiReviewIgnoredFeatureKeys';

describe('piReviewIgnoredFeatures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing has been ignored yet', () => {
    expect(readIgnoredPiReviewFeatureKeys().size).toBe(0);
  });

  it('adds a key, persists it, and normalizes to upper case', () => {
    const ignoredKeys = addIgnoredPiReviewFeatureKey('denp-1414');

    expect(ignoredKeys.has('DENP-1414')).toBe(true);
    expect(readIgnoredPiReviewFeatureKeys().has('DENP-1414')).toBe(true);
    expect(JSON.parse(localStorage.getItem(IGNORED_FEATURE_KEYS_STORAGE_KEY) ?? '[]')).toEqual(['DENP-1414']);
  });

  it('adding the same key twice keeps a single entry', () => {
    addIgnoredPiReviewFeatureKey('DENP-1414');
    const ignoredKeys = addIgnoredPiReviewFeatureKey(' denp-1414 ');

    expect(ignoredKeys.size).toBe(1);
  });

  it('ignores a blank key rather than storing an empty entry', () => {
    const ignoredKeys = addIgnoredPiReviewFeatureKey('   ');

    expect(ignoredKeys.size).toBe(0);
    expect(readIgnoredPiReviewFeatureKeys().size).toBe(0);
  });

  it('removes a key and persists the removal', () => {
    addIgnoredPiReviewFeatureKey('DENP-1414');
    addIgnoredPiReviewFeatureKey('DENP-2000');

    const ignoredKeys = removeIgnoredPiReviewFeatureKey('denp-1414');

    expect(ignoredKeys.has('DENP-1414')).toBe(false);
    expect(ignoredKeys.has('DENP-2000')).toBe(true);
    expect(readIgnoredPiReviewFeatureKeys().has('DENP-1414')).toBe(false);
  });

  it('treats unreadable stored JSON as an empty list instead of throwing', () => {
    localStorage.setItem(IGNORED_FEATURE_KEYS_STORAGE_KEY, 'not-json{');

    expect(readIgnoredPiReviewFeatureKeys().size).toBe(0);
  });

  it('drops non-string entries that somehow reached storage', () => {
    localStorage.setItem(IGNORED_FEATURE_KEYS_STORAGE_KEY, JSON.stringify(['DENP-1414', 42, null, '']));

    const ignoredKeys = readIgnoredPiReviewFeatureKeys();

    expect(Array.from(ignoredKeys)).toEqual(['DENP-1414']);
  });
});
