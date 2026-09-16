// prbRequiredFields.test.ts — What the PRB generator must know about a create screen before it posts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetProjectIssueTypes, mockGetIssueTypeFields } = vi.hoisted(() => ({
  mockGetProjectIssueTypes: vi.fn(),
  mockGetIssueTypeFields: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  getProjectIssueTypes: mockGetProjectIssueTypes,
  getIssueTypeFields: mockGetIssueTypeFields,
}));

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import {
  discoverRequiredFieldsByIssueType,
  PRB_SUPPLIED_FIELD_IDS,
  readUnansweredRequiredFields,
} from './prbRequiredFields.ts';

function buildField(overrides: Partial<CreateMetaFieldEntry> & { fieldId: string }): CreateMetaFieldEntry {
  return { required: true, name: overrides.fieldId, schema: { type: 'option' }, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readUnansweredRequiredFields', () => {
  it('keeps only the required fields the generator does not already supply', () => {
    // GH #384: the Defect create screen required a field the payload never carried, and the POST
    // failed with "This field is required" after the SL Story had already gone out.
    const unanswered = readUnansweredRequiredFields([
      buildField({ fieldId: 'summary' }),
      buildField({ fieldId: 'customfield_10001', name: 'Defect Root Cause' }),
      buildField({ fieldId: 'customfield_10002', name: 'Optional note', required: false }),
    ], PRB_SUPPLIED_FIELD_IDS);

    expect(unanswered.map((field) => field.fieldId)).toEqual(['customfield_10001']);
    expect(unanswered[0].name).toBe('Defect Root Cause');
  });

  it('skips a required field Jira fills in with a default', () => {
    const unanswered = readUnansweredRequiredFields([
      buildField({ fieldId: 'customfield_10001', hasDefaultValue: true }),
    ], PRB_SUPPLIED_FIELD_IDS);

    expect(unanswered).toEqual([]);
  });

  it('maps a cascading select to option-with-child and keeps its options', () => {
    const unanswered = readUnansweredRequiredFields([
      buildField({
        fieldId: 'customfield_10003',
        name: 'Application Component',
        schema: { type: 'option-with-child', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' },
        allowedValues: [{ id: '100', value: 'Web' }],
      }),
    ], PRB_SUPPLIED_FIELD_IDS);

    expect(unanswered[0].schemaType).toBe('option-with-child');
    expect(unanswered[0].allowedValues).toEqual([{ id: '100', value: 'Web' }]);
  });

  it('names a field by its id when Jira gives it no name', () => {
    const unanswered = readUnansweredRequiredFields([
      buildField({ fieldId: 'customfield_10004', name: '  ' }),
    ], PRB_SUPPLIED_FIELD_IDS);

    expect(unanswered[0].name).toBe('customfield_10004');
  });
});

describe('discoverRequiredFieldsByIssueType', () => {
  beforeEach(() => {
    mockGetProjectIssueTypes.mockResolvedValue({
      values: [
        { id: '1', name: 'Defect', subtask: false },
        { id: '2', name: 'Story', subtask: false },
        { id: '3', name: 'Sub-task', subtask: true },
      ],
    });
    mockGetIssueTypeFields.mockImplementation((_projectKey: string, issueTypeId: string) => Promise.resolve({
      values: issueTypeId === '1'
        ? [buildField({ fieldId: 'customfield_10001', name: 'Defect Root Cause', allowedValues: [{ id: '10', value: 'Code' }] })]
        : [],
    }));
  });

  it('finds each issue type by name, case-insensitively, and returns what it still needs', async () => {
    const requiredByType = await discoverRequiredFieldsByIssueType('ENFCT', ['defect', 'Sub-task']);

    expect(Object.keys(requiredByType)).toEqual(['defect', 'Sub-task']);
    expect(requiredByType.defect.map((field) => field.name)).toEqual(['Defect Root Cause']);
    expect(requiredByType['Sub-task']).toEqual([]);
    expect(mockGetIssueTypeFields).toHaveBeenCalledWith('ENFCT', '1');
  });

  it('refuses plainly when the project has no issue type by that name', async () => {
    // A wrong type name used to surface as a Jira 400 after the other issue had been created.
    await expect(discoverRequiredFieldsByIssueType('ENFCT', ['Defect', 'Bug']))
      .rejects.toThrow('Project ENFCT has no issue type named "Bug"');
  });

  it('asks Jira for the project once, however many types are checked', async () => {
    await discoverRequiredFieldsByIssueType('ENFCT', ['Defect', 'Story']);

    expect(mockGetProjectIssueTypes).toHaveBeenCalledTimes(1);
  });
});
