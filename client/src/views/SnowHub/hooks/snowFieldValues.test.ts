// snowFieldValues.test.ts — Reading ServiceNow Table API fields.

import { describe, expect, it } from 'vitest';

import { extractChoiceValue, extractSnowReference, extractStringValue } from './snowFieldValues.ts';

describe('snowFieldValues', () => {
  it('reads a field\'s display text, its stored choice value, and a reference', () => {
    const field = { value: '2', display_value: 'Moderate' };

    expect(extractStringValue(field)).toBe('Moderate');
    expect(extractChoiceValue(field)).toBe('2');
    expect(extractSnowReference({ value: 'usr-1', display_value: 'Jane Smith' })).toEqual({ sysId: 'usr-1', displayName: 'Jane Smith' });
  });

  it('reads an empty or missing field as empty', () => {
    expect(extractStringValue(undefined)).toBe('');
    expect(extractSnowReference(null)).toEqual({ sysId: '', displayName: '' });
  });
});
