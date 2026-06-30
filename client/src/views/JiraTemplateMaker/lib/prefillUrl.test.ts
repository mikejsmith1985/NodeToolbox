// prefillUrl.test.ts — Unit tests for the CreateIssueDetails prefill-URL builder.

import { describe, expect, it } from 'vitest';

import { buildPrefillUrl } from './prefillUrl.ts';
import type { JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

function makeTemplate(fields: TemplateFieldEntry[], overrides: Partial<JiraTemplate> = {}): JiraTemplate {
  return {
    id: 't', name: 'T', description: '', projectKey: 'ENCUC', projectId: '11900',
    issueTypeId: '10001', issueTypeName: 'Story', fields, authorName: 'x',
    createdAt: '', updatedAt: '', ...overrides,
  };
}

const BASE = 'https://jira.example.com';

function parse(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildPrefillUrl', () => {
  it('targets CreateIssueDetails with pid and issuetype', () => {
    const url = buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([]) });
    expect(url.startsWith('https://jira.example.com/secure/CreateIssueDetails!init.jspa?')).toBe(true);
    const params = parse(url);
    expect(params.get('pid')).toBe('11900');
    expect(params.get('issuetype')).toBe('10001');
  });

  it('encodes text, choice (by option id), number, and date fields', () => {
    const url = buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([
      { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'fixed', value: 'Weekly ops sweep' },
      { fieldId: 'priority', fieldName: 'Priority', fieldType: 'choice', mode: 'fixed', value: { id: '2' } },
      { fieldId: 'customfield_5', fieldName: 'Points', fieldType: 'number', mode: 'fixed', value: 5 },
      { fieldId: 'duedate', fieldName: 'Due', fieldType: 'date', mode: 'fixed', value: '2026-07-02' },
    ]) });
    const params = parse(url);
    expect(params.get('summary')).toBe('Weekly ops sweep');
    expect(params.get('priority')).toBe('2');
    expect(params.get('customfield_5')).toBe('5');
    expect(params.get('duedate')).toBe('2026-07-02');
  });

  it('repeats labels and multi-select option ids', () => {
    const url = buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([
      { fieldId: 'labels', fieldName: 'Labels', fieldType: 'labels', mode: 'fixed', value: ['Ops', 'ops'] },
      { fieldId: 'components', fieldName: 'Components', fieldType: 'components', mode: 'fixed', value: [{ id: '1' }, { id: '2' }] },
    ]) });
    const params = parse(url);
    expect(params.getAll('labels')).toEqual(['Ops', 'ops']);
    expect(params.getAll('components')).toEqual(['1', '2']);
  });

  it('uses a prompt-at-launch default but omits prompt fields with no default', () => {
    const withDefault = buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([
      { fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'promptAtLaunch', defaultValue: 'Draft' },
      { fieldId: 'duedate', fieldName: 'Due', fieldType: 'date', mode: 'promptAtLaunch' },
    ]) });
    const params = parse(withDefault);
    expect(params.get('summary')).toBe('Draft');
    expect(params.has('duedate')).toBe(false);
  });

  it('appends hand-mapped manual params (the API-gap fallback)', () => {
    const url = buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([], {
      manualUrlParams: [{ param: 'customfield_99', value: 'manual-value' }, { param: '', value: 'ignored' }],
    }) });
    const params = parse(url);
    expect(params.get('customfield_99')).toBe('manual-value');
  });

  it('returns empty string when base URL or project id is missing', () => {
    expect(buildPrefillUrl({ baseUrl: '', template: makeTemplate([]) })).toBe('');
    expect(buildPrefillUrl({ baseUrl: BASE, template: makeTemplate([], { projectId: '' }) })).toBe('');
  });
});
