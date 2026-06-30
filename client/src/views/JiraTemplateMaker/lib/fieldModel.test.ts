// fieldModel.test.ts — Unit tests for createmeta → internal field model mapping.

import { describe, expect, it } from 'vitest';

import type { CreateMetaField } from '../../../types/jira.ts';
import { mapCreateMetaField, mapCreateMetaFieldList } from './fieldModel.ts';

function makeField(overrides: Partial<CreateMetaField>): CreateMetaField {
  return { required: false, name: 'Field', ...overrides };
}

describe('mapCreateMetaField', () => {
  it('maps a string field to text', () => {
    const descriptor = mapCreateMetaField('summary', makeField({ name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } }));
    expect(descriptor.internalType).toBe('text');
    expect(descriptor.isSupported).toBe(true);
    expect(descriptor.required).toBe(true);
    expect(descriptor.name).toBe('Summary');
  });

  it('maps a single option field to choice and normalizes allowedValues', () => {
    const descriptor = mapCreateMetaField('priority', makeField({
      name: 'Priority',
      schema: { type: 'priority', system: 'priority' },
      allowedValues: [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }],
    }));
    expect(descriptor.internalType).toBe('choice');
    expect(descriptor.allowedValues).toEqual([
      { id: '1', label: 'Highest' },
      { id: '2', label: 'High' },
    ]);
  });

  it('maps a custom select to choice using value as the label', () => {
    const descriptor = mapCreateMetaField('customfield_10010', makeField({
      name: 'Team',
      schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
      allowedValues: [{ id: '10100', value: 'Platform' }],
    }));
    expect(descriptor.internalType).toBe('choice');
    expect(descriptor.allowedValues).toEqual([{ id: '10100', label: 'Platform' }]);
  });

  it('maps an array of option to multiChoice', () => {
    const descriptor = mapCreateMetaField('customfield_2', makeField({
      name: 'Categories',
      schema: { type: 'array', items: 'option' },
      allowedValues: [{ id: '5', value: 'A' }],
    }));
    expect(descriptor.internalType).toBe('multiChoice');
  });

  it('maps the labels system field to labels', () => {
    const descriptor = mapCreateMetaField('labels', makeField({
      name: 'Labels',
      schema: { type: 'array', items: 'string', system: 'labels' },
    }));
    expect(descriptor.internalType).toBe('labels');
  });

  it('maps user, date, datetime, and number fields', () => {
    expect(mapCreateMetaField('assignee', makeField({ schema: { type: 'user', system: 'assignee' } })).internalType).toBe('user');
    expect(mapCreateMetaField('duedate', makeField({ schema: { type: 'date', system: 'duedate' } })).internalType).toBe('date');
    expect(mapCreateMetaField('cf_dt', makeField({ schema: { type: 'datetime' } })).internalType).toBe('datetime');
    expect(mapCreateMetaField('cf_num', makeField({ schema: { type: 'number' } })).internalType).toBe('number');
  });

  it('maps arrays of component and version', () => {
    expect(mapCreateMetaField('components', makeField({ schema: { type: 'array', items: 'component', system: 'components' } })).internalType).toBe('components');
    expect(mapCreateMetaField('fixVersions', makeField({ schema: { type: 'array', items: 'version', system: 'fixVersions' } })).internalType).toBe('versions');
  });

  it('marks cascading (option-with-child) as unsupported', () => {
    const descriptor = mapCreateMetaField('customfield_cascade', makeField({
      name: 'Cascade',
      schema: { type: 'option-with-child' },
    }));
    expect(descriptor.isSupported).toBe(false);
    expect(descriptor.internalType).toBeNull();
  });

  it('marks an unknown/exotic type as unsupported rather than guessing', () => {
    const descriptor = mapCreateMetaField('customfield_x', makeField({ schema: { type: 'sd-approvals' } }));
    expect(descriptor.isSupported).toBe(false);
    expect(descriptor.internalType).toBeNull();
  });

  it('treats a field with no schema as unsupported', () => {
    const descriptor = mapCreateMetaField('weird', makeField({ schema: undefined }));
    expect(descriptor.isSupported).toBe(false);
  });
});

describe('mapCreateMetaFieldList', () => {
  it('maps the modern field list (each entry carries its own fieldId), required first', () => {
    const descriptors = mapCreateMetaFieldList([
      { fieldId: 'priority', required: false, name: 'Priority', schema: { type: 'priority' }, allowedValues: [{ id: '2', name: 'High' }] },
      { fieldId: 'summary', required: true, name: 'Summary', schema: { type: 'string', system: 'summary' } },
    ]);
    expect(descriptors.map((descriptor) => descriptor.fieldId)).toEqual(['summary', 'priority']);
    expect(descriptors[1].allowedValues).toEqual([{ id: '2', label: 'High' }]);
  });
});
