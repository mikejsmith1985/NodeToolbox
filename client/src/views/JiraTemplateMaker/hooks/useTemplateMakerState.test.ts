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

  it('updates a field value and mode', () => {
    const { result } = renderHook(() => useTemplateMakerState());
    act(() => { result.current.addField(createFieldEntry('summary', 'Summary', 'text')); });
    act(() => { result.current.setFieldValue('summary', 'Hi'); });
    act(() => { result.current.setFieldMode('summary', 'promptAtLaunch'); });
    expect(result.current.fieldEntries[0].value).toBe('Hi');
    expect(result.current.fieldEntries[0].mode).toBe('promptAtLaunch');
  });
});
