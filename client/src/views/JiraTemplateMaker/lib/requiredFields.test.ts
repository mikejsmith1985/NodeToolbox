// requiredFields.test.ts — Unit tests for pre-create required-field validation.

import { describe, expect, it } from 'vitest';

import { findMissingRequiredFields } from './requiredFields.ts';
import type { FieldDescriptor } from './templateTypes.ts';

const SUMMARY: FieldDescriptor = { fieldId: 'summary', name: 'Summary', required: true, internalType: 'text', isSupported: true, hasDefault: false };
const PRIORITY: FieldDescriptor = { fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice', isSupported: true, hasDefault: false };

describe('findMissingRequiredFields', () => {
  it('names a required field missing from the payload', () => {
    expect(findMissingRequiredFields([SUMMARY, PRIORITY], { project: { id: '1' } })).toEqual(['Summary']);
  });

  it('returns nothing when all required fields are present', () => {
    expect(findMissingRequiredFields([SUMMARY], { summary: 'Hi' })).toEqual([]);
  });

  it('ignores optional fields', () => {
    expect(findMissingRequiredFields([PRIORITY], {})).toEqual([]);
  });
});
