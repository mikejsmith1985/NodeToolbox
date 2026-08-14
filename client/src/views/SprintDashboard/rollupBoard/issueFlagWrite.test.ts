// issueFlagWrite.test.ts — Proves the flag write is attempted from what we know, and that Jira is
// left to be the authority on whether it is allowed.
//
// The first version refused before sending anything when the flag was missing from editmeta. On a
// real instance that rejected every attempt, because Jira's Flagged field is routinely left off the
// edit screen while staying perfectly writable. The guard was not preventing a refusal, it was the
// refusal — so these tests pin that a missing editmeta entry produces a REQUEST, not an excuse.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraPut } = vi.hoisted(() => ({ mockJiraPut: vi.fn() }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraPut: mockJiraPut, jiraGet: vi.fn() }));

import { findFlagFieldId, resolveFlagWrite, setIssueFlag } from './issueFlagWrite.ts';

/** Editmeta that knows the field: a named array-of-option with one allowed value. */
const KNOWN_FLAG_META = {
  customfield_10021: {
    name: 'Flagged',
    schema: { type: 'array', items: 'option' },
    allowedValues: [{ value: 'Impediment' }],
  },
};

/** The common real case: the flag is not on the edit screen at all. */
const FLAG_ABSENT_META = { summary: { name: 'Summary', schema: { type: 'string' } } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findFlagFieldId', () => {
  it('finds the flag by NAME, so a different id on another instance still works', () => {
    expect(findFlagFieldId({ customfield_99999: { name: 'Flagged' } })).toBe('customfield_99999');
  });

  it('accepts the names Jira uses for the same idea', () => {
    expect(findFlagFieldId({ cf_1: { name: 'Impediment' } })).toBe('cf_1');
    expect(findFlagFieldId({ cf_2: { name: 'Flag' } })).toBe('cf_2');
  });

  it('falls back to the conventional id rather than giving up', () => {
    // An absence from editmeta means the field is off the EDIT SCREEN. That says nothing at all about
    // whether it can be written, and treating it as a refusal is what broke this the first time.
    expect(findFlagFieldId(FLAG_ABSENT_META)).toBe('customfield_10021');
    expect(findFlagFieldId({})).toBe('customfield_10021');
  });
});

describe('resolveFlagWrite', () => {
  it('clears with null, which is how Jira itself empties a field', () => {
    // An empty array is accepted by some instances and refused by others; null is accepted everywhere.
    expect(resolveFlagWrite(KNOWN_FLAG_META, false)).toEqual({ fieldId: 'customfield_10021', value: null });
  });

  it('writes the option editmeta named, as an array, when editmeta knows the field', () => {
    expect(resolveFlagWrite(KNOWN_FLAG_META, true)).toEqual({
      fieldId: 'customfield_10021',
      value: [{ value: 'Impediment' }],
    });
  });

  it('prefers an option id over its value, the way Jira\'s own writers do', () => {
    const withIds = { customfield_10021: { name: 'Flagged', allowedValues: [{ id: '10100', value: 'Impediment' }] } };

    expect(resolveFlagWrite(withIds, true).value).toEqual([{ id: '10100' }]);
  });

  it('sends the conventional shape when editmeta knows nothing about the field', () => {
    expect(resolveFlagWrite(FLAG_ABSENT_META, true)).toEqual({
      fieldId: 'customfield_10021',
      value: [{ value: 'Impediment' }],
    });
  });

  it('sends a bare option, not an array, where editmeta says the field is not one', () => {
    const singleOption = {
      customfield_10021: { name: 'Flagged', schema: { type: 'option' }, allowedValues: [{ value: 'Impediment' }] },
    };

    expect(resolveFlagWrite(singleOption, true).value).toEqual({ value: 'Impediment' });
  });
});

describe('setIssueFlag', () => {
  it('sends the write even when the flag is absent from editmeta', async () => {
    // The regression this guards: this case used to throw without ever contacting Jira.
    await setIssueFlag('DEV-1', true, FLAG_ABSENT_META);

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DEV-1', {
      fields: { customfield_10021: [{ value: 'Impediment' }] },
    });
  });

  it('lets a Jira refusal surface rather than substituting a guess of our own', async () => {
    // Jira's own message says what is actually wrong; ours could only ever say what we assumed.
    mockJiraPut.mockRejectedValueOnce(new Error('Field \'customfield_10021\' cannot be set'));

    await expect(setIssueFlag('DEV-1', true, KNOWN_FLAG_META)).rejects.toThrow(/cannot be set/);
  });

  it('escapes an issue key that is not URL-safe', async () => {
    await setIssueFlag('DEV 1', false, KNOWN_FLAG_META);

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DEV%201', expect.anything());
  });
});
