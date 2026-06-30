// artProjects.test.ts — Unit tests for the ART project-key merge logic.

import { describe, expect, it } from 'vitest';

import { mergeArtProjectKeys } from './artProjects.ts';

describe('mergeArtProjectKeys', () => {
  it('uses the feature-project filter when it is set, normalized', () => {
    expect(mergeArtProjectKeys([' enfct ', 'denp', 'ENFCT'], ['XYZ'])).toEqual(['ENFCT', 'DENP']);
  });

  it('falls back to team project keys when the feature filter is empty', () => {
    expect(mergeArtProjectKeys([], ['inttest', 'UEFT', 'inttest'])).toEqual(['INTTEST', 'UEFT']);
  });

  it('returns an empty list when neither source has keys', () => {
    expect(mergeArtProjectKeys([], [])).toEqual([]);
  });
});
