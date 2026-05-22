// useBusinessHelperSettings.test.ts — Unit tests for Business Helper settings persistence and Simple Search mapping.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_STABLIZATION_COLUMN_WIDTHS,
  buildMappedStablizationValues,
  readBusinessHelperSettings,
  useBusinessHelperSettings,
} from './useBusinessHelperSettings.ts';

describe('useBusinessHelperSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists column input-kind changes and mapping selections', () => {
    const { result } = renderHook(() => useBusinessHelperSettings());

    act(() => {
      result.current.updateColumnInputKind('name', 'dropdown');
      result.current.addDropdownOption('name', 'Funding Candidate');
      result.current.updateSimpleSearchMapping('name', 'summary');
    });

    const storedSettings = readBusinessHelperSettings();
    expect(storedSettings.stablizationColumns.name.inputKind).toBe('dropdown');
    expect(storedSettings.stablizationColumns.name.dropdownOptions).toContain('Funding Candidate');
    expect(storedSettings.simpleSearchMapping.name).toBe('summary');
  });

  it('persists stablization column width changes within the supported range', () => {
    const { result } = renderHook(() => useBusinessHelperSettings());

    act(() => {
      result.current.updateStablizationColumnWidth('name', 412);
      result.current.updateStablizationColumnWidth('actions', 40);
    });

    const storedSettings = readBusinessHelperSettings();
    expect(storedSettings.stablizationColumnWidths.name).toBe(412);
    expect(storedSettings.stablizationColumnWidths.actions).toBeGreaterThanOrEqual(96);
    expect(storedSettings.stablizationColumnWidths.grouping).toBe(DEFAULT_STABLIZATION_COLUMN_WIDTHS.grouping);
  });
});

describe('buildMappedStablizationValues', () => {
  it('returns mapped values and skips dropdown columns whose options do not contain the mapped text', () => {
    const mappedValuesResult = buildMappedStablizationValues(
      {
        key: 'TBX-101',
        summary: 'Funding summary',
        issueType: 'Story',
        status: 'In Progress',
        assigneeName: 'Alex Analyst',
        created: '2026-05-01T00:00:00.000Z',
        updated: '2026-05-20T00:00:00.000Z',
        hierarchyLevel: 'team',
        matchLocation: 'summary',
        projectKey: 'TBX',
      },
      {
        stablizationColumns: {
          grouping: { inputKind: 'text', dropdownOptions: [] },
          name: { inputKind: 'dropdown', dropdownOptions: ['Allowed Value'] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
        stablizationColumnWidths: DEFAULT_STABLIZATION_COLUMN_WIDTHS,
        simpleSearchMapping: {
          grouping: 'jira-key',
          name: 'jira-key-summary',
          justification: 'status',
        },
      },
    );

    expect(mappedValuesResult.mappedValues).toEqual({
      grouping: 'TBX-101',
      justification: 'In Progress',
    });
    expect(mappedValuesResult.skippedColumns).toEqual(['name']);
  });
});
