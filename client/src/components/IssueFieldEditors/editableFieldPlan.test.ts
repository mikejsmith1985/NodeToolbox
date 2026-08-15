// editableFieldPlan.test.ts — Proves the panel offers what Jira says it may set, empty fields first.

import { describe, expect, it } from 'vitest';

import {
  buildEditableFieldPlan,
  filterFieldPlans,
  readFieldOptions,
  resolveEditorKind,
} from './editableFieldPlan.ts';

describe('resolveEditorKind', () => {
  it('uses a select whenever Jira listed the values it will accept', () => {
    // Whatever the declared type, allowed values settle it: a select is the only control that cannot
    // produce a value Jira then rejects.
    expect(resolveEditorKind({ schema: { type: 'string' }, allowedValues: [{ id: '1', value: 'A' }] }))
      .toBe('select');
  });

  it('maps the plain schema types onto their controls', () => {
    expect(resolveEditorKind({ schema: { type: 'user' } })).toBe('user');
    expect(resolveEditorKind({ schema: { type: 'number' } })).toBe('number');
    expect(resolveEditorKind({ schema: { type: 'date' } })).toBe('date');
    expect(resolveEditorKind({ schema: { type: 'datetime' } })).toBe('date');
    expect(resolveEditorKind({ schema: { type: 'string' } })).toBe('text');
  });

  it('treats an array of free text as text, which is how labels are edited', () => {
    expect(resolveEditorKind({ schema: { type: 'array', items: 'string' } })).toBe('text');
  });

  it('answers null for a type it has no control for, rather than guessing', () => {
    // A guessed control writes a shape Jira refuses, which is worse than not offering the field.
    expect(resolveEditorKind({ schema: { type: 'sd-approvals' } })).toBeNull();
  });
});

describe('buildEditableFieldPlan', () => {
  const EDIT_META = {
    summary: { name: 'Summary', schema: { type: 'string' } },
    customfield_100: { name: 'Target End', schema: { type: 'date' } },
    fixVersions: { name: 'Fix Version/s', schema: { type: 'array', items: 'version' }, allowedValues: [{ id: '9', name: 'R1' }] },
    assignee: { name: 'Assignee', schema: { type: 'user' } },
  };

  it('lists EMPTY fields first — the ones that cost a trip to Jira', () => {
    // Jira's own shelf renders only the fields that already have a value, so an empty fix version
    // means a new tab, the Edit button, and a scroll. That case leads here instead.
    const { fields } = buildEditableFieldPlan(EDIT_META, { summary: 'A real summary' });

    expect(fields[fields.length - 1].fieldId).toBe('summary');
    expect(fields.filter((field) => field.isEmpty).map((field) => field.fieldId).sort())
      .toEqual(['assignee', 'customfield_100', 'fixVersions']);
  });

  it('offers every field Jira says the user may set, not a hard-coded handful', () => {
    // The board could edit exactly four fields before this; the list is now Jira's answer.
    expect(buildEditableFieldPlan(EDIT_META, {}).fields).toHaveLength(4);
  });

  it('names a field by its Jira name, so a custom field is not a number', () => {
    const { fields } = buildEditableFieldPlan(EDIT_META, {});

    expect(fields.find((field) => field.fieldId === 'customfield_100')?.label).toBe('Target End');
  });

  it('reads a value out of whatever shape Jira wrapped it in', () => {
    const { fields } = buildEditableFieldPlan(EDIT_META, {
      assignee: { displayName: 'Smith, Michael (CTR)', name: 'C8Q6T3' },
      fixVersions: [{ name: 'R1' }, { name: 'R2' }],
    });

    expect(fields.find((field) => field.fieldId === 'assignee')?.displayValue)
      .toBe('Smith, Michael (CTR)');
    expect(fields.find((field) => field.fieldId === 'fixVersions')?.displayValue).toBe('R1, R2');
  });

  it('flags a field holding several values, because saving replaces all of them', () => {
    const { fields } = buildEditableFieldPlan(EDIT_META, { fixVersions: [{ name: 'R1' }, { name: 'R2' }] });

    expect(fields.find((field) => field.fieldId === 'fixVersions')?.isReplacingList).toBe(true);
  });

  it('trims a Jira datetime to the day a date input can hold', () => {
    const { fields } = buildEditableFieldPlan(EDIT_META, { customfield_100: '2026-08-15T09:00:00.000+0000' });

    expect(fields.find((field) => field.fieldId === 'customfield_100')?.currentValue).toBe('2026-08-15');
  });

  it('keeps description read-only, because a text box would flatten its wiki markup', () => {
    const { fields } = buildEditableFieldPlan(
      { description: { name: 'Description', schema: { type: 'string' } } },
      {},
    );

    expect(fields).toHaveLength(0);
  });

  it('NAMES the fields it cannot edit rather than dropping them silently', () => {
    // A panel that quietly omits fields is indistinguishable from one that never saw them, and the
    // whole promise here is that the list is complete.
    const { fields, unsupported } = buildEditableFieldPlan(
      { customfield_9: { name: 'Approvals', schema: { type: 'sd-approvals' } } },
      {},
    );

    expect(fields).toHaveLength(0);
    expect(unsupported[0].label).toBe('Approvals');
  });
});

describe('filterFieldPlans', () => {
  const { fields } = buildEditableFieldPlan(
    {
      summary: { name: 'Summary', schema: { type: 'string' } },
      customfield_100: { name: 'Target End', schema: { type: 'date' } },
    },
    {},
  );

  it('narrows a long list to what somebody typed', () => {
    expect(filterFieldPlans(fields, 'target').map((field) => field.label)).toEqual(['Target End']);
  });

  it('ignores case, because nobody types a field name exactly', () => {
    expect(filterFieldPlans(fields, 'TARGET')).toHaveLength(1);
  });

  it('shows everything when nothing is typed', () => {
    expect(filterFieldPlans(fields, '   ')).toHaveLength(2);
  });
});

describe('readFieldOptions', () => {
  it('keys a VERSION field by name, because that is what the fix-version writer sends', () => {
    // The general reader prefers an option's id, which is right for priority and silently wrong
    // here: an id-keyed option posts a numeric id as though it were a version name.
    const [fieldPlan] = buildEditableFieldPlan({
      fixVersions: {
        name: 'Fix Version/s',
        schema: { type: 'array', items: 'version' },
        allowedValues: [{ id: '10500', name: '09/10/2026' }],
      },
    }, {}).fields;

    expect(readFieldOptions(fieldPlan)).toEqual([{ label: '09/10/2026', value: '09/10/2026' }]);
  });

  it('leaves out a released version, which Jira refuses to add to an issue', () => {
    const [fieldPlan] = buildEditableFieldPlan({
      fixVersions: {
        name: 'Fix Version/s',
        schema: { type: 'array', items: 'version' },
        allowedValues: [{ id: '1', name: 'Shipped', released: true }, { id: '2', name: 'Next' }],
      },
    }, {}).fields;

    expect(readFieldOptions(fieldPlan).map((option) => option.value)).toEqual(['Next']);
  });

  it('keys an ordinary option field by id, which is what its writer resolves against', () => {
    const [fieldPlan] = buildEditableFieldPlan({
      priority: { name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: '3', name: 'High' }] },
    }, {}).fields;

    expect(readFieldOptions(fieldPlan)).toEqual([{ label: 'High', value: '3' }]);
  });
});
