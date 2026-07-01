// buildIntakeFields.test.ts — Covers convention mapping: project + row-driven issue type/priority,
// wiki-markup text, Acceptance Criteria → configured field, and omission of empty values.

import { describe, expect, it } from 'vitest';

import { buildIntakeFields, plainTextToWikiMarkup } from './buildIntakeFields.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

function submissionWith(fields: Partial<IntakeSubmission['fields']>): IntakeSubmission {
  return {
    id: 'a', submittedAt: '', status: 'New',
    submitter: { displayName: '', email: '' },
    fields: { summary: 'A summary', description: '', acceptanceCriteria: '', issueType: 'Story', priority: '', project: '', ...fields },
    extras: {}, rowIndex: 0, parseErrors: [],
  };
}

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT',
  acceptanceCriteriaFieldId: 'customfield_10200',
  autoCreateOnImport: true,
  updatedAt: '', updatedBy: '',
};

describe('buildIntakeFields', () => {
  it('uses the resolved project key and maps summary + issue type by name from the row', () => {
    const fields = buildIntakeFields(submissionWith({ summary: 'Do it', issueType: 'Bug' }), CONFIG, 'ENCUC');
    expect(fields.project).toEqual({ key: 'ENCUC' });
    expect(fields.summary).toBe('Do it');
    expect(fields.issuetype).toEqual({ name: 'Bug' });
  });

  it('maps priority by name from the row when present', () => {
    const fields = buildIntakeFields(submissionWith({ priority: 'Highest' }), CONFIG, 'ENFCT');
    expect(fields.priority).toEqual({ name: 'Highest' });
  });

  it('sends description as wiki markup and Acceptance Criteria to the configured field', () => {
    const fields = buildIntakeFields(
      submissionWith({ description: 'Line one\nLine two', acceptanceCriteria: 'AC text' }),
      CONFIG,
      'ENFCT',
    );
    expect(fields.description).toBe('Line one\n\nLine two');
    expect(fields.customfield_10200).toBe('AC text');
  });

  it('omits priority, description, and AC when the row leaves them blank', () => {
    const fields = buildIntakeFields(submissionWith({ description: '', priority: '   ', acceptanceCriteria: '' }), CONFIG, 'ENFCT');
    expect(fields.priority).toBeUndefined();
    expect(fields.description).toBeUndefined();
    expect(fields.customfield_10200).toBeUndefined();
  });

  it('omits issue type when the row does not carry one', () => {
    const fields = buildIntakeFields(submissionWith({ issueType: '' }), CONFIG, 'ENFCT');
    expect(fields.issuetype).toBeUndefined();
  });
});

describe('plainTextToWikiMarkup', () => {
  it('renders each non-empty line as its own paragraph', () => {
    expect(plainTextToWikiMarkup('a\n\nb')).toBe('a\n\nb');
    expect(plainTextToWikiMarkup('')).toBe('');
  });
});
