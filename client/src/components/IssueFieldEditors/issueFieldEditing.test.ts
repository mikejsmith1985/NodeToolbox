// issueFieldEditing.test.ts — Unit tests for editmeta gating and the shared field-editor lifecycle.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NO_FIX_VERSION_LABEL,
  isFieldEditable,
  readFixVersionOptions,
  readIssueFixVersionNames,
  useFieldEditor,
} from './issueFieldEditing.ts';

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

describe('readFixVersionOptions — keyed by name, because that is what the writer sends', () => {
  it('uses the version NAME as the option value, never its numeric id', () => {
    const options = readFixVersionOptions({ allowedValues: [{ name: '08/13/2026' }] });

    // saveFeatureReviewFixVersion posts { name }, so an id-keyed value would be sent as a version
    // name and rejected by Jira.
    expect(options).toContainEqual({ label: '08/13/2026', value: '08/13/2026' });
  });

  it('adds no blank option of its own, since the select editor renders one', () => {
    const options = readFixVersionOptions({ allowedValues: [{ name: '08/13/2026' }] });

    // Two empty rows in one dropdown are indistinguishable to the person choosing.
    expect(options.filter((option) => option.value === '')).toHaveLength(0);
    expect(NO_FIX_VERSION_LABEL).toBe('— None —');
  });

  it('leaves out released versions, which Jira refuses to accept on an issue', () => {
    const options = readFixVersionOptions({
      allowedValues: [{ name: 'shipped', released: true }, { name: 'upcoming' }],
    });

    expect(options.map((option) => option.value)).toEqual(['upcoming']);
  });

  it('leaves out archived versions', () => {
    const options = readFixVersionOptions({
      allowedValues: [{ name: 'old', archived: true }, { name: 'upcoming' }],
    });

    expect(options.map((option) => option.value)).toEqual(['upcoming']);
  });

  it('returns nothing when the project has no versions at all', () => {
    expect(readFixVersionOptions(undefined)).toEqual([]);
  });

  it('drops a nameless allowed value rather than offering a blank choice twice', () => {
    expect(readFixVersionOptions({ allowedValues: [{ released: false }] })).toEqual([]);
  });
});

describe('readIssueFixVersionNames', () => {
  it('reads the names in Jira\'s order', () => {
    const issue = { fields: { fixVersions: [{ name: 'a' }, { name: 'b' }] } };
    expect(readIssueFixVersionNames(issue)).toEqual(['a', 'b']);
  });

  it('returns nothing for an issue with no fix version', () => {
    expect(readIssueFixVersionNames({ fields: {} })).toEqual([]);
    expect(readIssueFixVersionNames({})).toEqual([]);
  });
});
