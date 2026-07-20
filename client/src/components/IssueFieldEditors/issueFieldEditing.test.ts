// issueFieldEditing.test.ts — Unit tests for editmeta gating and the shared field-editor lifecycle.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isFieldEditable, useFieldEditor } from './issueFieldEditing.ts';

describe('isFieldEditable', () => {
  it('is true when the field is present in edit metadata', () => {
    expect(isFieldEditable({ summary: { name: 'Summary' } }, 'summary')).toBe(true);
  });

  it('is false when the field is absent (not settable)', () => {
    expect(isFieldEditable({ summary: { name: 'Summary' } }, 'priority')).toBe(false);
  });

  it('is false when the field is explicitly undefined', () => {
    expect(isFieldEditable({ labels: undefined }, 'labels')).toBe(false);
  });
});

describe('useFieldEditor', () => {
  afterEach(() => vi.clearAllMocks());

  it('enters and exits edit mode', () => {
    const { result } = renderHook(() => useFieldEditor(vi.fn().mockResolvedValue(undefined)));
    expect(result.current.isEditing).toBe(false);
    act(() => result.current.beginEdit());
    expect(result.current.isEditing).toBe(true);
    act(() => result.current.cancelEdit());
    expect(result.current.isEditing).toBe(false);
  });

  it('saves through the writer, flashes saved, and calls onSaved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const { result } = renderHook(() => useFieldEditor(onSave, onSaved));

    act(() => result.current.beginEdit());
    await act(async () => {
      await result.current.save('High');
    });

    expect(onSave).toHaveBeenCalledWith('High');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.isEditing).toBe(false);
    expect(result.current.justSaved).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an inline error and stays editing on a failed write', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Field write rejected'));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useFieldEditor(onSave, onSaved));

    act(() => result.current.beginEdit());
    await act(async () => {
      await result.current.save('High');
    });

    await waitFor(() => expect(result.current.error).toBe('Field write rejected'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(true);
    expect(result.current.justSaved).toBe(false);
  });
});
