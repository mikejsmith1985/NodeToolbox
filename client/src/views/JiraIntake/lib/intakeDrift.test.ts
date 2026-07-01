// intakeDrift.test.ts — Covers choice-drift detection: valid options pass, unknown options are
// flagged, and validation is skipped when descriptors are unavailable or unconstrained.

import { describe, expect, it } from 'vitest';

import { findChoiceDrift } from './intakeDrift.ts';
import type { FieldDescriptor } from '../../JiraTemplateMaker/lib/templateTypes.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

function submissionWith(priority: string): IntakeSubmission {
  return {
    id: 'a', submittedAt: '', status: 'New',
    submitter: { displayName: '', email: '' },
    fields: { summary: 's', description: '', acceptanceCriteria: '', issueType: '', priority },
    extras: {}, rowIndex: 0, parseErrors: [],
  };
}

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT', projectId: '1', issueTypeId: '10001', issueTypeName: 'Story',
  fieldMappings: [{ coreField: 'priority', jiraFieldId: 'priority', jiraFieldType: 'choice', transform: 'choiceByName' }],
  autoCreateOnImport: true, updatedAt: '', updatedBy: '',
};

const PRIORITY_DESCRIPTOR: FieldDescriptor[] = [
  {
    fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice', isSupported: true,
    allowedValues: [{ id: '1', label: 'High' }, { id: '2', label: 'Medium' }, { id: '3', label: 'Low' }],
    hasDefault: false,
  },
];

describe('findChoiceDrift', () => {
  it('returns no reasons when the mapped value is an available option (case-insensitive)', () => {
    expect(findChoiceDrift(submissionWith('high'), CONFIG, PRIORITY_DESCRIPTOR)).toEqual([]);
  });

  it('flags a value that is not among the allowed options', () => {
    const reasons = findChoiceDrift(submissionWith('Highest'), CONFIG, PRIORITY_DESCRIPTOR);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe('Priority: "Highest" is not an available option');
  });

  it('skips validation when descriptors are unavailable', () => {
    expect(findChoiceDrift(submissionWith('Whatever'), CONFIG, [])).toEqual([]);
  });

  it('skips fields without a constrained option list', () => {
    const unconstrained: FieldDescriptor[] = [
      { fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice', isSupported: true, hasDefault: false },
    ];
    expect(findChoiceDrift(submissionWith('Highest'), CONFIG, unconstrained)).toEqual([]);
  });
});
