// drift.test.ts — Unit tests for template drift detection.

import { describe, expect, it } from 'vitest';

import { findTemplateDrift, isTemplateStale } from './drift.ts';
import type { FieldDescriptor, JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

function makeTemplate(fields: TemplateFieldEntry[]): JiraTemplate {
  return {
    id: 't', name: 'T', description: '', projectKey: 'ABC', projectId: '1', issueTypeId: '1',
    issueTypeName: 'Task', fields, authorName: 'x', createdAt: '', updatedAt: '',
  };
}

const PRIORITY_DESCRIPTOR: FieldDescriptor = {
  fieldId: 'priority', name: 'Priority', required: false, internalType: 'choice',
  isSupported: true, allowedValues: [{ id: '2', label: 'High' }], hasDefault: false,
};

describe('findTemplateDrift', () => {
  it('reports a field that no longer exists', () => {
    const template = makeTemplate([{ fieldId: 'gone', fieldName: 'Gone', fieldType: 'text', mode: 'fixed', value: 'x' }]);
    const drift = findTemplateDrift(template, []);
    expect(drift.missingFieldIds).toEqual(['gone']);
    expect(isTemplateStale(drift)).toBe(true);
  });

  it('reports a selected option that is no longer allowed', () => {
    const template = makeTemplate([{ fieldId: 'priority', fieldName: 'Priority', fieldType: 'choice', mode: 'fixed', value: { id: '99' } }]);
    const drift = findTemplateDrift(template, [PRIORITY_DESCRIPTOR]);
    expect(drift.invalidOptionFieldIds).toEqual(['priority']);
  });

  it('reports no drift when fields and options still exist', () => {
    const template = makeTemplate([{ fieldId: 'priority', fieldName: 'Priority', fieldType: 'choice', mode: 'fixed', value: { id: '2' } }]);
    const drift = findTemplateDrift(template, [PRIORITY_DESCRIPTOR]);
    expect(isTemplateStale(drift)).toBe(false);
  });
});
