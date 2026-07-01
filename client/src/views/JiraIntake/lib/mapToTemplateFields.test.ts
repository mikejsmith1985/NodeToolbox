// mapToTemplateFields.test.ts — Covers raw/wikiMarkup/choiceByName transforms, fixed-value
// overrides, and omission of empty values.

import { describe, expect, it } from 'vitest';

import { mapSubmissionToFields } from './mapToTemplateFields.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

function submissionWith(fields: Partial<IntakeSubmission['fields']>): IntakeSubmission {
  return {
    id: 'a', submittedAt: '', status: 'New',
    submitter: { displayName: '', email: '' },
    fields: { summary: '', description: '', acceptanceCriteria: '', issueType: '', priority: '', ...fields },
    extras: {}, rowIndex: 0, parseErrors: [],
  };
}

function configWith(mappings: IntakeConfig['fieldMappings']): IntakeConfig {
  return {
    projectKey: 'ENFCT', projectId: '1', issueTypeId: '10001', issueTypeName: 'Story',
    fieldMappings: mappings, autoCreateOnImport: true, updatedAt: '', updatedBy: '',
  };
}

describe('mapSubmissionToFields', () => {
  it('maps a raw text field straight through', () => {
    const fields = mapSubmissionToFields(
      submissionWith({ summary: 'Do the thing' }),
      configWith([{ coreField: 'summary', jiraFieldId: 'summary', jiraFieldType: 'text', transform: 'raw' }]),
    );
    expect(fields).toEqual({ summary: 'Do the thing' });
  });

  it('serializes wikiMarkup fields to Jira wiki markup', () => {
    const fields = mapSubmissionToFields(
      submissionWith({ description: 'Line one\nLine two' }),
      configWith([{ coreField: 'description', jiraFieldId: 'description', jiraFieldType: 'text', transform: 'wikiMarkup' }]),
    );
    expect(fields.description).toBe('Line one\n\nLine two');
  });

  it('maps choiceByName fields to a { name } reference', () => {
    const fields = mapSubmissionToFields(
      submissionWith({ priority: 'Highest' }),
      configWith([{ coreField: 'priority', jiraFieldId: 'priority', jiraFieldType: 'choice', transform: 'choiceByName' }]),
    );
    expect(fields.priority).toEqual({ name: 'Highest' });
  });

  it('applies a fixed value override instead of the submission value', () => {
    const fields = mapSubmissionToFields(
      submissionWith({ priority: 'Low' }),
      configWith([{ coreField: 'priority', jiraFieldId: 'priority', jiraFieldType: 'choice', transform: 'choiceByName', fixedValue: 'Medium' }]),
    );
    expect(fields.priority).toEqual({ name: 'Medium' });
  });

  it('omits fields whose resolved value is empty', () => {
    const fields = mapSubmissionToFields(
      submissionWith({ acceptanceCriteria: '   ' }),
      configWith([{ coreField: 'acceptanceCriteria', jiraFieldId: 'customfield_10200', jiraFieldType: 'text', transform: 'wikiMarkup' }]),
    );
    expect(fields).toEqual({});
  });
});
