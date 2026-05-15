// useCrgFieldPins.test.ts — Unit tests for the CRG field pin persistence hook.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCrgFieldPins } from './useCrgFieldPins.ts';

const CRG_FIELD_PINS_STORAGE_KEY = 'ntbx-crg-field-pins';

describe('useCrgFieldPins', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads previously saved pinned fields from localStorage', () => {
    window.localStorage.setItem(CRG_FIELD_PINS_STORAGE_KEY, JSON.stringify([
      { id: 'chgBasicInfo.category:string:software', key: 'chgBasicInfo.category', label: 'Category', section: 'Change Details', value: 'software' },
    ]));

    const { result } = renderHook(() => useCrgFieldPins());

    expect(result.current.pinnedFields).toEqual([
      { id: 'chgBasicInfo.category:string:software', key: 'chgBasicInfo.category', label: 'Category', section: 'Change Details', value: 'software' },
    ]);
    expect(result.current.getPinnedFields('chgBasicInfo.category')).toHaveLength(1);
  });

  it('adds pins in sorted order and persists them', () => {
    const { result } = renderHook(() => useCrgFieldPins());

    act(() => {
      result.current.upsertPin({
        key: 'chgPlanningAssessment.impact',
        label: 'Impact',
        section: 'Planning',
        value: '1',
      });
      result.current.upsertPin({
        key: 'chgBasicInfo.category',
        label: 'Category',
        section: 'Change Details',
        value: 'software',
      });
    });

    expect(result.current.pinnedFields.map((pinnedField) => pinnedField.key)).toEqual([
      'chgBasicInfo.category',
      'chgPlanningAssessment.impact',
    ]);
    expect(window.localStorage.getItem(CRG_FIELD_PINS_STORAGE_KEY)).toContain('chgBasicInfo.category');
  });

  it('keeps multiple saved values for the same field and can find a specific one', () => {
    const { result } = renderHook(() => useCrgFieldPins());

    act(() => {
      result.current.upsertPin({
        key: 'chgBasicInfo.assignmentGroup',
        label: 'Assignment Group',
        section: 'Change Details',
        value: { sysId: 'group-001', displayName: 'Release Managers' },
      });
      result.current.upsertPin({
        key: 'chgBasicInfo.assignmentGroup',
        label: 'Assignment Group',
        section: 'Change Details',
        value: { sysId: 'group-002', displayName: 'CAB Managers' },
      });
    });

    expect(result.current.getPinnedFields('chgBasicInfo.assignmentGroup')).toHaveLength(2);
    expect(result.current.findPinnedField('chgBasicInfo.assignmentGroup', { sysId: 'group-002', displayName: 'CAB Managers' })).toMatchObject({
      key: 'chgBasicInfo.assignmentGroup',
      label: 'Assignment Group',
    });
  });

  it('removes one pin or clears all pins', () => {
    const { result } = renderHook(() => useCrgFieldPins());

    act(() => {
      result.current.upsertPin({
        key: 'chgBasicInfo.category',
        label: 'Category',
        section: 'Change Details',
        value: 'software',
      });
      result.current.upsertPin({
        key: 'chgBasicInfo.isExpedited',
        label: 'Expedited Change',
        section: 'Change Details',
        value: true,
      });
    });

    act(() => {
      result.current.removePin('chgBasicInfo.category:string:software');
    });

    expect(result.current.getPinnedFields('chgBasicInfo.category')).toEqual([]);
    expect(result.current.findPinnedField('chgBasicInfo.isExpedited', true)).toBeDefined();

    act(() => {
      result.current.clearPins();
    });

    expect(result.current.pinnedFields).toEqual([]);
    expect(window.localStorage.getItem(CRG_FIELD_PINS_STORAGE_KEY)).toBe('[]');
  });

  it('ignores malformed storage state', () => {
    window.localStorage.setItem(CRG_FIELD_PINS_STORAGE_KEY, '{not-valid-json');

    const { result } = renderHook(() => useCrgFieldPins());

    expect(result.current.pinnedFields).toEqual([]);
    expect(result.current.getPinnedFields('chgBasicInfo.category')).toEqual([]);
  });
});
