// useTemplateMakerState.test.ts — Unit tests for the wizard state machine + re-scope behavior.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createFieldEntry, useTemplateMakerState } from './useTemplateMakerState.ts';

describe('useTemplateMakerState', () => {
  it('adds and removes fields, deduping by id', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    expect(result.current.fieldEntries).toHaveLength(1);
    act(() => { result.current.removeField('summary'); });
    expect(result.current.fieldEntries).toHaveLength(0);
  });

  it('clears fields and warns when the project changes', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.setProject('ABC', '1'); });
    act(() => { result.current.addField(createFieldEntry('priority', 'Priority', 'choice')); });
    act(() => { result.current.setProject('XYZ', '2'); });
    expect(result.current.fieldEntries).toHaveLength(0);
    expect(result.current.rescopeWarning).toMatch(/Priority/);
  });

  it('does not warn when the same project id is re-set (e.g. id backfill)', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.setProject('ABC', ''); });
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    act(() => { result.current.setProject('ABC', '10000'); }); // same key, id backfilled
    expect(result.current.fieldEntries).toHaveLength(1);
    expect(result.current.rescopeWarning).toBeNull();
  });

  it('clears fields when the issue type changes', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.setIssueType('1', 'Task'); });
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    act(() => { result.current.setIssueType('2', 'Bug'); });
    expect(result.current.fieldEntries).toHaveLength(0);
  });

  it('updates a field value, default, and mode', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    act(() => { result.current.setFieldValue('summary', 'Hi'); });
    act(() => { result.current.setFieldDefault('summary', 'Default text'); });
    act(() => { result.current.setFieldMode('summary', 'promptAtLaunch'); });
    expect(result.current.fieldEntries[0].value).toBe('Hi');
    expect(result.current.fieldEntries[0].defaultValue).toBe('Default text');
    expect(result.current.fieldEntries[0].mode).toBe('promptAtLaunch');
  });

  it('loads a saved template for editing and tracks its id', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => {
      result.current.loadTemplate({
        id: 'tpl-1', name: 'Weekly', description: 'desc', projectKey: 'ABC', projectId: '10000',
        issueTypeId: '1', issueTypeName: 'Task', authorName: 'Jane', createdAt: '', updatedAt: '',
        fields: [{ fieldId: 'summary', fieldName: 'Summary', fieldType: 'text', mode: 'fixed', value: 'Hi' }],
      });
    });
    expect(result.current.editingTemplateId).toBe('tpl-1');
    expect(result.current.templateName).toBe('Weekly');
    expect(result.current.projectKey).toBe('ABC');
    expect(result.current.fieldEntries).toHaveLength(1);
    expect(result.current.currentStep).toBe('fields');
  });

  it('clears the editing id on reset', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => {
      result.current.loadTemplate({
        id: 'tpl-1', name: 'Weekly', description: '', projectKey: 'ABC', projectId: '1',
        issueTypeId: '1', issueTypeName: 'Task', authorName: 'x', createdAt: '', updatedAt: '', fields: [],
      });
    });
    act(() => { result.current.reset(); });
    expect(result.current.editingTemplateId).toBeNull();
  });
});
