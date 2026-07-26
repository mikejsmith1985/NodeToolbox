// compositionFieldPrefill.test.ts — Deterministic PI/PO/Application prefill: fill-when-empty via the real
// field-config ids, resolve options from allowedValues, and flag anything that can't be resolved.

import { describe, expect, it } from 'vitest';

import { buildCompositionPrefill } from './compositionFieldPrefill.ts';
import type { PrefillInputs } from './compositionFieldPrefill.ts';
import type { CreateMetaFieldEntry } from '../../../types/jira.ts';

const PI_FIELD = 'customfield_10301';
const PO_FIELD = 'customfield_10200';
const APP_FIELD = 'customfield_10400';

function descriptor(fieldId: string, allowed: { id: string; value?: string; name?: string }[]): CreateMetaFieldEntry {
  return { fieldId, required: false, name: fieldId, allowedValues: allowed } as CreateMetaFieldEntry;
}

function inputs(overrides: Partial<PrefillInputs> = {}): PrefillInputs {
  return {
    fieldConfig: { programIncrementFieldIds: [PI_FIELD], productOwnerFieldIds: [PO_FIELD], applicationFieldIds: [APP_FIELD] },
    descriptors: [
      descriptor(PI_FIELD, [{ id: '900', value: 'PI 26.3' }]),
      descriptor(PO_FIELD, []), // a user field — no options
      descriptor(APP_FIELD, [{ id: '5', value: 'Initial' }, { id: '6', value: 'Enhancement' }]),
    ],
    currentFields: {},
    piValue: 'PI 26.3',
    poAccountId: 'acc-po-1',
    ...overrides,
  };
}

describe('buildCompositionPrefill', () => {
  it('fills PI, PO, and Application from the team/roster/fixed value', () => {
    const result = buildCompositionPrefill(inputs());
    expect(result.fields[PI_FIELD]).toEqual({ id: '900' });       // PI option resolved by name
    expect(result.fields[PO_FIELD]).toEqual({ accountId: 'acc-po-1' }); // PO as a user field
    expect(result.fields[APP_FIELD]).toEqual({ id: '5' });        // "Initial" option
    expect(result.flags).toEqual([]);
  });

  it('never clobbers a field that already has a value (only-when-empty)', () => {
    const result = buildCompositionPrefill(inputs({ currentFields: { [PO_FIELD]: { accountId: 'someone-else' } } }));
    expect(result.fields[PO_FIELD]).toBeUndefined(); // left as-is
    expect(result.fields[PI_FIELD]).toEqual({ id: '900' });
  });

  it('flags PO when the roster has no Product Owner, and leaves it blank', () => {
    const result = buildCompositionPrefill(inputs({ poAccountId: null }));
    expect(result.fields[PO_FIELD]).toBeUndefined();
    expect(result.flags.some((flag) => /Product Owner/.test(flag))).toBe(true);
  });

  it('flags PI when the team has no PI selected', () => {
    const result = buildCompositionPrefill(inputs({ piValue: null }));
    expect(result.fields[PI_FIELD]).toBeUndefined();
    expect(result.flags.some((flag) => /Program Increment/.test(flag) && /no PI/.test(flag))).toBe(true);
  });

  it('flags PI when the selected PI is not an option on the issue type', () => {
    const result = buildCompositionPrefill(inputs({ piValue: 'PI 99.9' }));
    expect(result.fields[PI_FIELD]).toBeUndefined();
    expect(result.flags.some((flag) => /PI 99.9.*not an option/.test(flag))).toBe(true);
  });

  it('skips a field the issue type does not offer (not in descriptors) without flagging', () => {
    const result = buildCompositionPrefill(inputs({ descriptors: [descriptor(APP_FIELD, [{ id: '5', value: 'Initial' }])] }));
    expect(result.fields[PI_FIELD]).toBeUndefined();
    expect(result.fields[PO_FIELD]).toBeUndefined();
    expect(result.fields[APP_FIELD]).toEqual({ id: '5' }); // the only offered field is filled
    expect(result.flags).toEqual([]); // PI/PO not offered → not our concern here, no noise
  });

  it('flags Application when there is no "Initial" option', () => {
    const result = buildCompositionPrefill(inputs({ descriptors: [descriptor(APP_FIELD, [{ id: '6', value: 'Enhancement' }])] }));
    expect(result.fields[APP_FIELD]).toBeUndefined();
    expect(result.flags.some((flag) => /Application.*Initial/.test(flag))).toBe(true);
  });
});
