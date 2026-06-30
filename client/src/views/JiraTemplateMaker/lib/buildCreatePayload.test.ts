// buildCreatePayload.test.ts — Unit tests for template + launch answers → POST /issue body.

import { describe, expect, it } from 'vitest';

import { buildCreatePayload } from './buildCreatePayload.ts';
import type { JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

function makeTemplate(fields: TemplateFieldEntry[]): JiraTemplate {
  return {
    id: 't1', name: 'T', description: '', projectKey: 'ABC', projectId: '10000',
    issueTypeId: '10001', issueTypeName: 'Task', fields, authorName: 'Tester',
    createdAt: '', updatedAt: '',
  };
}

describe('buildCreatePayload', () => {
  it('always sets project and issuetype by id', () => {
    const payload = buildCreatePayload({ template: makeTemplate([]), launchAnswers: {} });
    expect(payload.fields.project).toEqual({ id: '10000' });
    expect(payload.fields.issuetype).toEqual({ id: '10001' });
  });

  it('maps fixed text, choice (object or string id), number, and date', () => {
    const template = makeTemplate([
      { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'fixed', value: 'Hello' },
      { fieldId: 'priority', fieldName: 'Priority', fieldType: 'choice', mode: 'fixed', value: { id: '2' } },
      { fieldId: 'customfield_1', fieldName: 'Team', fieldType: 'choice', mode: 'fixed', value: '10100' },
      { fieldId: 'customfield_n', fieldName: 'Points', fieldType: 'number', mode: 'fixed', value: 5 },
      { fieldId: 'duedate', fieldName: 'Due', fieldType: 'date', mode: 'fixed', value: '2026-07-02' },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: {} });
    expect(payload.fields.summary).toBe('Hello');
    expect(payload.fields.priority).toEqual({ id: '2' });
    expect(payload.fields.customfield_1).toEqual({ id: '10100' });
    expect(payload.fields.customfield_n).toBe(5);
    expect(payload.fields.duedate).toBe('2026-07-02');
  });

  it('maps multiChoice, components, and versions to arrays of {id}', () => {
    const template = makeTemplate([
      { fieldId: 'components', fieldName: 'Components', fieldType: 'components', mode: 'fixed', value: [{ id: '1' }, { id: '2' }] },
      { fieldId: 'fixVersions', fieldName: 'Fix versions', fieldType: 'versions', mode: 'fixed', value: ['3'] },
      { fieldId: 'cf_multi', fieldName: 'Cats', fieldType: 'multiChoice', mode: 'fixed', value: [{ id: '9' }] },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: {} });
    expect(payload.fields.components).toEqual([{ id: '1' }, { id: '2' }]);
    expect(payload.fields.fixVersions).toEqual([{ id: '3' }]);
    expect(payload.fields.cf_multi).toEqual([{ id: '9' }]);
  });

  it('dedupes labels case-sensitively', () => {
    const template = makeTemplate([
      { fieldId: 'labels', fieldName: 'Labels', fieldType: 'labels', mode: 'fixed', value: ['Ops', 'Ops', 'ops'] },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: {} });
    expect(payload.fields.labels).toEqual(['Ops', 'ops']);
  });

  it('maps a user field to { name } for Server/DC', () => {
    const template = makeTemplate([
      { fieldId: 'reporter', fieldName: 'Reporter', fieldType: 'user', mode: 'fixed', value: 'jdoe' },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: {} });
    expect(payload.fields.reporter).toEqual({ name: 'jdoe' });
  });

  it('uses launch answers for prompt-at-launch fields', () => {
    const template = makeTemplate([
      { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'promptAtLaunch' },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: { summary: 'Live value' } });
    expect(payload.fields.summary).toBe('Live value');
  });

  it('omits fields whose resolved value is empty', () => {
    const template = makeTemplate([
      { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'promptAtLaunch' },
    ]);
    const payload = buildCreatePayload({ template, launchAnswers: {} });
    expect('summary' in payload.fields).toBe(false);
  });
});
