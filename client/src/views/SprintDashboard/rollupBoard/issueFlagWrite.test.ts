// issueFlagWrite.test.ts — Proves the flag is written from what Jira SAYS it will accept, never from
// a shape inferred by having read the field.
//
// The trap this guards is a real one the sub-status writer already fell into: reading a field only
// establishes truthiness, so writing it blind produces "Could not find valid 'id' or 'value' in the
// Parent Option object" — a message that explains nothing to the person who pressed the button.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraPut, mockSaveOptionField } = vi.hoisted(() => ({
  mockJiraPut: vi.fn(),
  mockSaveOptionField: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraPut: mockJiraPut, jiraGet: vi.fn() }));
vi.mock('../featureReviewFixes.ts', () => ({ saveFeatureReviewOptionField: mockSaveOptionField }));

import {
  describeFlagUnavailable,
  findFlagFieldId,
  readFlagOptionName,
  setIssueFlag,
} from './issueFlagWrite.ts';

/** Editmeta as this instance really returns it: the flag as a named select with one allowed value. */
const FLAG_EDIT_META = {
  customfield_10021: {
    name: 'Flagged',
    schema: { type: 'array', items: 'option' },
    allowedValues: [{ value: 'Impediment' }],
  },
  summary: { name: 'Summary', schema: { type: 'string' } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findFlagFieldId', () => {
  it('finds the flag by its NAME, so a different field id on another instance still works', () => {
    const renamedIdMeta = { customfield_99999: { name: 'Flagged', allowedValues: [{ value: 'Impediment' }] } };

    expect(findFlagFieldId(renamedIdMeta)).toBe('customfield_99999');
  });

  it('accepts the names Jira uses for the same idea', () => {
    expect(findFlagFieldId({ cf_1: { name: 'Impediment' } })).toBe('cf_1');
    expect(findFlagFieldId({ cf_2: { name: 'Flag' } })).toBe('cf_2');
  });

  it('falls back to the conventional id when nothing is named like a flag', () => {
    expect(findFlagFieldId({ customfield_10021: { schema: { type: 'array' } } })).toBe('customfield_10021');
  });

  it('finds nothing when the flag is not on this issue\'s edit screen', () => {
    // A real answer, not a failure: some issue types genuinely do not carry the flag, and the board
    // must not offer an action Jira is going to refuse.
    expect(findFlagFieldId({ summary: { name: 'Summary' } })).toBeNull();
    expect(findFlagFieldId({})).toBeNull();
  });
});

describe('readFlagOptionName', () => {
  it('takes the value Jira says is allowed rather than assuming "Impediment"', () => {
    expect(readFlagOptionName({ allowedValues: [{ value: 'Blocked' }] })).toBe('Blocked');
  });

  it('accepts an allowed value that carries a name instead of a value', () => {
    expect(readFlagOptionName({ allowedValues: [{ name: 'Impediment' }] })).toBe('Impediment');
  });

  it('reports nothing when Jira offered no value at all', () => {
    expect(readFlagOptionName({ allowedValues: [] })).toBeNull();
    expect(readFlagOptionName(undefined)).toBeNull();
  });
});

describe('describeFlagUnavailable', () => {
  it('says nothing when the flag can be written', () => {
    expect(describeFlagUnavailable(FLAG_EDIT_META)).toBeNull();
  });

  it('explains an issue type that has no flag field', () => {
    expect(describeFlagUnavailable({ summary: { name: 'Summary' } }))
      .toContain('no flag field on its edit screen');
  });

  it('explains a flag field Jira offered no value for', () => {
    expect(describeFlagUnavailable({ customfield_10021: { name: 'Flagged', allowedValues: [] } }))
      .toContain('did not offer a value');
  });
});

describe('setIssueFlag', () => {
  it('raises the flag through the shared option writer, which knows the payload shape', () => {
    void setIssueFlag('DEV-1', true, FLAG_EDIT_META);

    expect(mockSaveOptionField).toHaveBeenCalledWith(
      'DEV-1', 'customfield_10021', 'Impediment', FLAG_EDIT_META.customfield_10021,
    );
  });

  it('clears the flag with null rather than an empty array', async () => {
    // An empty array is accepted by some instances and refused by others; null is how Jira itself
    // clears a field, so it behaves the same everywhere.
    await setIssueFlag('DEV-1', false, FLAG_EDIT_META);

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DEV-1', {
      fields: { customfield_10021: null },
    });
  });

  it('refuses before sending anything when the flag is not writable here', async () => {
    await expect(setIssueFlag('DEV-1', true, { summary: { name: 'Summary' } })).rejects.toThrow(/no flag field/);

    expect(mockJiraPut).not.toHaveBeenCalled();
    expect(mockSaveOptionField).not.toHaveBeenCalled();
  });

  it('escapes an issue key that is not URL-safe', async () => {
    await setIssueFlag('DEV 1', false, FLAG_EDIT_META);

    expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DEV%201', expect.anything());
  });
});
