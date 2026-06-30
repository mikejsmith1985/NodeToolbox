// useTemplateLaunch.test.ts — Unit tests for the create-from-template flow (T029/T033).

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIssue } from '../../../services/jiraApi.ts';
import type { FieldDescriptor, JiraTemplate, TemplateFieldEntry } from '../lib/templateTypes.ts';
import { useTemplateLaunch } from './useTemplateLaunch.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ createIssue: vi.fn() }));
const createIssueMock = vi.mocked(createIssue);

function makeTemplate(fields: TemplateFieldEntry[]): JiraTemplate {
  return {
    id: 't', name: 'T', description: '', projectKey: 'ABC', projectId: '10000',
    issueTypeId: '1', issueTypeName: 'Task', fields, authorName: 'x', createdAt: '', updatedAt: '',
  };
}
const SUMMARY_REQUIRED: FieldDescriptor = { fieldId: 'summary', name: 'Summary', required: true, internalType: 'text', isSupported: true, hasDefault: false };

describe('useTemplateLaunch', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('blocks create and names the missing required field, making no POST', async () => {
    const template = makeTemplate([]); // summary required but absent
    const { result } = renderHook(() => useTemplateLaunch());

    await act(async () => { await result.current.createFromTemplate(template, [SUMMARY_REQUIRED]); });

    expect(result.current.missingRequiredNames).toEqual(['Summary']);
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(result.current.createdIssue).toBeNull();
  });

  it('uses launch answers for prompt-at-launch fields and returns a browse link', async () => {
    createIssueMock.mockResolvedValue({ id: '100', key: 'ABC-1', self: 'https://jira.example.com/rest/api/2/issue/100' } as never);
    const template = makeTemplate([{ fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'promptAtLaunch' }]);
    const { result } = renderHook(() => useTemplateLaunch());

    act(() => { result.current.setLaunchAnswer('summary', 'Live value'); });
    await act(async () => { await result.current.createFromTemplate(template, [SUMMARY_REQUIRED]); });

    expect(createIssueMock).toHaveBeenCalledTimes(1);
    const sentBody = createIssueMock.mock.calls[0][0];
    expect(sentBody.fields.summary).toBe('Live value');
    expect(result.current.createdIssue).toEqual({ key: 'ABC-1', browseUrl: 'https://jira.example.com/browse/ABC-1' });
  });

  it('surfaces a create error without a created issue', async () => {
    createIssueMock.mockRejectedValue(new Error('400'));
    const template = makeTemplate([{ fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'fixed', value: 'Hi' }]);
    const { result } = renderHook(() => useTemplateLaunch());

    await act(async () => { await result.current.createFromTemplate(template, [SUMMARY_REQUIRED]); });

    expect(result.current.errorMessage).toMatch(/could not create/i);
    expect(result.current.createdIssue).toBeNull();
  });
});
