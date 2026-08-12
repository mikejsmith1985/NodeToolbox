// moveBlockDiagnosis.test.ts — Proves a Jira refusal becomes something a person can act on, and that
// a refusal nothing can fix on the board says so rather than offering a hopeful form.

import { describe, expect, it } from 'vitest';

import {
  diagnoseMoveBlock,
  matchEditMetaFieldsByName,
  parseRequiredFieldNames,
  type DiagnoseMoveBlockInput,
} from './moveBlockDiagnosis.ts';

function buildInput(overrides: Partial<DiagnoseMoveBlockInput> = {}): DiagnoseMoveBlockInput {
  return {
    issueKey: 'DENP-1288',
    issueSummary: 'Rework the intake',
    targetColumnName: 'Ready for QA',
    currentStatusName: 'In Progress',
    screenRequiredFields: [],
    errorText: '',
    reachableStatusNames: [],
    ...overrides,
  };
}

describe('parseRequiredFieldNames', () => {
  it('reads the prose list Jira returns from a transition', () => {
    expect(parseRequiredFieldNames('The following fields are required: Story Points, Fix Version'))
      .toEqual(expect.arrayContaining(['Story Points', 'Fix Version']));
  });

  it('reads a name out of the errors map, where the key is a custom field id', () => {
    const names = parseRequiredFieldNames('Error: 400 {"errors":{"customfield_10002":"Story Points is required."}}');

    expect(names).toContain('Story Points');
  });

  it('never offers a raw custom field id as a field name, because nobody would recognise it', () => {
    const names = parseRequiredFieldNames('customfield_10002 is required');

    expect(names).not.toContain('customfield_10002');
  });

  it('finds nothing in a refusal that names no field', () => {
    expect(parseRequiredFieldNames('Error: 500 internal server error')).toEqual([]);
  });
});

describe('matchEditMetaFieldsByName', () => {
  const EDIT_META = {
    customfield_10002: { name: 'Story Points', allowedValues: [{ id: '1', value: '3' }, { id: '2', value: '5' }] },
    summary: { name: 'Summary' },
  };

  it('turns a name Jira used in prose into the field id and its options', () => {
    const [matchedField] = matchEditMetaFieldsByName(EDIT_META, ['Story Points']);

    expect(matchedField.fieldId).toBe('customfield_10002');
    expect(matchedField.schemaType).toBe('option');
    expect(matchedField.allowedValues).toHaveLength(2);
  });

  it('matches regardless of the casing Jira used', () => {
    expect(matchEditMetaFieldsByName(EDIT_META, ['story points'])).toHaveLength(1);
  });

  it('returns nothing when the issue has no edit metadata, rather than guessing a field id', () => {
    expect(matchEditMetaFieldsByName(null, ['Story Points'])).toEqual([]);
  });
});

describe('diagnoseMoveBlock', () => {
  it('names the fields the transition screen asked for up front', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({
      screenRequiredFields: [
        { fieldId: 'customfield_10002', name: 'Story Points', schemaType: 'option', allowedValues: [] },
      ],
    }));

    expect(diagnosis.kind).toBe('screen-fields-required');
    expect(diagnosis.explanation).toContain('Story Points');
  });

  it('reads a field name out of a rejection that arrived after the attempt', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({
      errorText: 'Error: 400 {"errors":{"customfield_10002":"Story Points is required."}}',
    }));

    expect(diagnosis.kind).toBe('fields-required-after-attempt');
    expect(diagnosis.requiredFieldNames).toContain('Story Points');
  });

  it('says a dead end is a dead end and names where the issue CAN go', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({
      errorText: 'Jira does not allow moving from "In Progress" to "Done" — the workflow has no such transition.',
      reachableStatusNames: ['Ready for QA', 'Blocked'],
    }));

    expect(diagnosis.kind).toBe('no-such-transition');
    expect(diagnosis.whatToDo.join(' ')).toContain('Ready for QA');
    // No form is offered, because no field on this board would make the move legal.
    expect(diagnosis.requiredFieldNames).toEqual([]);
  });

  it('says so plainly when the issue cannot move anywhere at all', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({
      errorText: 'the workflow has no such transition',
      reachableStatusNames: [],
    }));

    expect(diagnosis.whatToDo.join(' ')).toMatch(/no available transitions/);
  });

  it('quotes Jira verbatim when it refuses without a reason the board understands', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({ errorText: 'Error: 503 service unavailable' }));

    expect(diagnosis.kind).toBe('unknown');
    expect(diagnosis.whatToDo.join(' ')).toContain('503');
  });

  it('always names the issue and where it was going, whatever went wrong', () => {
    const diagnosis = diagnoseMoveBlock(buildInput({ errorText: 'anything at all' }));

    expect(diagnosis.headline).toContain('DENP-1288');
    expect(diagnosis.headline).toContain('Ready for QA');
  });
});
