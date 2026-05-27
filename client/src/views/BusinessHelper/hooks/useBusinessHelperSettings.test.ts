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

  it('persists user-defined columns and their data types', () => {
    const { result } = renderHook(() => useBusinessHelperSettings());

    act(() => {
      result.current.addUserColumn('Owner Notes', 'text');
    });

    const addedUserColumnId = result.current.settings.stablizationUserColumns[0]?.id;
    expect(addedUserColumnId).toBeTruthy();

    act(() => {
      result.current.updateUserColumnDataType(addedUserColumnId, 'dropdown');
      result.current.addUserColumnDropdownOption(addedUserColumnId, 'Needs follow-up');
      result.current.updateUserColumnSimpleSearchMapping(addedUserColumnId, 'summary');
    });

    const storedSettings = readBusinessHelperSettings();
    expect(storedSettings.stablizationUserColumns).toHaveLength(1);
    expect(storedSettings.stablizationUserColumns[0]).toMatchObject({
      label: 'Owner Notes',
      dataType: 'dropdown',
      simpleSearchMapping: 'summary',
      dropdownOptions: ['Needs follow-up'],
    });
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
        stablizationUserColumns: [],
      },
    );

    expect(mappedValuesResult.mappedValues).toEqual({
      grouping: 'TBX-101',
      justification: 'In Progress',
    });
    expect(mappedValuesResult.appliedColumnLabels).toEqual(['Grouping', 'Justification']);
    expect(mappedValuesResult.skippedColumnLabels).toEqual(['Name']);
  });

  it('maps supported user-defined columns and skips unsupported dropdown values', () => {
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
          name: { inputKind: 'text', dropdownOptions: [] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
        stablizationColumnWidths: DEFAULT_STABLIZATION_COLUMN_WIDTHS,
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
        stablizationUserColumns: [
          {
            id: 'owner-notes',
            label: 'Owner Notes',
            dataType: 'text',
            dropdownOptions: [],
            widthPx: 180,
            simpleSearchMapping: 'summary',
          },
          {
            id: 'phase',
            label: 'Phase',
            dataType: 'dropdown',
            dropdownOptions: ['Discovery'],
            widthPx: 180,
            simpleSearchMapping: 'status',
          },
        ],
      },
    );

    expect(mappedValuesResult.mappedUserColumnValues).toEqual({
      'owner-notes': 'Funding summary',
    });
    expect(mappedValuesResult.appliedColumnLabels).toContain('Owner Notes');
    expect(mappedValuesResult.skippedColumnLabels).toContain('Phase');
  });
});
