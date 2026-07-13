// storyPointsField.test.ts — Verifies the shared, instance-correct story-points reading for the Reports Hub.

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_STORY_POINTS_FIELD_ID,
  readConfiguredStoryPointsFieldId,
  readNumericFieldValue,
  readStoryPoints,
} from './storyPointsField.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

describe('readNumericFieldValue', () => {
  it('takes a finite number as-is and rejects a non-finite one', () => {
    expect(readNumericFieldValue(5)).toBe(5);
    expect(readNumericFieldValue(0)).toBe(0);
    expect(readNumericFieldValue(Number.NaN)).toBeNull();
  });

  it('parses a non-empty numeric string and rejects blank/non-numeric strings', () => {
    expect(readNumericFieldValue('8')).toBe(8);
    expect(readNumericFieldValue('')).toBeNull();
    expect(readNumericFieldValue('abc')).toBeNull();
  });

  it('unwraps a dropdown/select object by recursing into its value', () => {
    // This is the case that broke the Aging triage: a dropdown story-points field arrives as an object.
    expect(readNumericFieldValue({ value: '3' })).toBe(3);
    expect(readNumericFieldValue({ value: 13 })).toBe(13);
  });

  it('reads null / undefined / unrelated objects as no value', () => {
    expect(readNumericFieldValue(null)).toBeNull();
    expect(readNumericFieldValue(undefined)).toBeNull();
    expect(readNumericFieldValue({ label: 'x' })).toBeNull();
  });
});

describe('readStoryPoints', () => {
  it('reads the configured field, whether it is a number or a dropdown object', () => {
    expect(readStoryPoints({ customfield_10236: { value: '5' } }, 'customfield_10236')).toBe(5);
    expect(readStoryPoints({ customfield_10016: 2 }, 'customfield_10016')).toBe(2);
    expect(readStoryPoints({ customfield_10236: null }, 'customfield_10236')).toBeNull();
  });
});

describe('readConfiguredStoryPointsFieldId', () => {
  afterEach(() => localStorage.removeItem(ART_SETTINGS_STORAGE_KEY));

  it('returns the configured spFieldId when the ART settings set one', () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ spFieldId: 'customfield_99999' }));
    expect(readConfiguredStoryPointsFieldId()).toBe('customfield_99999');
  });

  it('falls back to the default when nothing is set or the JSON is corrupt', () => {
    expect(readConfiguredStoryPointsFieldId()).toBe(DEFAULT_STORY_POINTS_FIELD_ID);
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, '{not json');
    expect(readConfiguredStoryPointsFieldId()).toBe(DEFAULT_STORY_POINTS_FIELD_ID);
  });
});
