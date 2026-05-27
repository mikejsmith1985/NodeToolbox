// useStablizationFundingTable.test.ts — Unit tests for persisted stablization funding rows and formulas.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendSimpleSearchResultToStablization,
  calculateStablizationFooterTotals,
  calculateStablizationTestingAmount,
  calculateStablizationTotalAmount,
  createStablizationFundingRow,
  useStablizationFundingTable,
} from './useStablizationFundingTable.ts';
import type { BusinessHelperSettingsState } from './useBusinessHelperSettings.ts';

describe('useStablizationFundingTable', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with one editable row and persists updates to localStorage', () => {
    const { result, unmount } = renderHook(() => useStablizationFundingTable());
    const firstRowId = result.current.rows[0].id;

    act(() => {
      result.current.updateTextField(firstRowId, 'name', 'Funding Workstream');
      result.current.updateCurrencyField(firstRowId, 'fulfillmentCost', '100');
      result.current.updateCurrencyField(firstRowId, 'enrollmentCost', '50');
      result.current.updateCurrencyField(firstRowId, 'billing', '50');
      result.current.updateCurrencyField(firstRowId, 'cost', '25');
    });

    expect(result.current.rows[0].testingAmount).toBe(50);
    expect(result.current.rows[0].totalAmount).toBe(250);
    expect(result.current.totals.total).toBe(250);

    unmount();

    const { result: restoredResult } = renderHook(() => useStablizationFundingTable());
    expect(restoredResult.current.rows[0].name).toBe('Funding Workstream');
    expect(restoredResult.current.totals.cost).toBe(25);
  });

  it('keeps one blank row available after removing the only row', () => {
    const { result } = renderHook(() => useStablizationFundingTable());
    const firstRowId = result.current.rows[0].id;

    act(() => {
      result.current.removeRow(firstRowId);
    });

    expect(result.current.rows).toHaveLength(1);
  });

  it('defaults blank configurable fields to the only dropdown option', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'dropdown', dropdownOptions: ['Portfolio'] },
          name: { inputKind: 'dropdown', dropdownOptions: ['Funding Candidate'] },
          justification: { inputKind: 'dropdown', dropdownOptions: ['Operational Need'] },
        },
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
        stablizationUserColumns: [],
      }),
    );

    const { result } = renderHook(() => useStablizationFundingTable());

    expect(result.current.rows[0].grouping).toBe('Portfolio');
    expect(result.current.rows[0].name).toBe('Funding Candidate');
    expect(result.current.rows[0].justification).toBe('Operational Need');

    act(() => {
      result.current.addRow();
    });

    expect(result.current.rows[1].grouping).toBe('Portfolio');
    expect(result.current.rows[1].name).toBe('Funding Candidate');
    expect(result.current.rows[1].justification).toBe('Operational Need');
  });

  it('stores values for user-defined columns', () => {
    const userColumnSettings: BusinessHelperSettingsState = {
      stablizationColumns: {
        grouping: { inputKind: 'text', dropdownOptions: [] },
        name: { inputKind: 'text', dropdownOptions: [] },
        justification: { inputKind: 'text', dropdownOptions: [] },
      },
      stablizationColumnWidths: {
        grouping: 160,
        name: 280,
        fulfillmentCost: 132,
        enrollmentCost: 132,
        billing: 132,
        testing: 148,
        total: 148,
        justification: 220,
        timing: 148,
        cost: 132,
        actions: 120,
      },
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
          simpleSearchMapping: 'none',
        },
      ],
    };
    const { result } = renderHook(() => useStablizationFundingTable(userColumnSettings));
    const firstRowId = result.current.rows[0].id;

    act(() => {
      result.current.updateUserColumnValue(firstRowId, 'owner-notes', 'Follow up with finance');
    });

    expect(result.current.rows[0].userColumnValues['owner-notes']).toBe('Follow up with finance');
  });

  it('replaces the starter row and stores a Jira browse link when Simple Search sends a result', () => {
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'dropdown', dropdownOptions: ['Portfolio'] },
          name: { inputKind: 'text', dropdownOptions: [] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
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
        ],
      }),
    );
    window.localStorage.setItem('tbxCRGenJiraUrl', 'https://jira.example.com/');

    const appendResult = appendSimpleSearchResultToStablization({
      key: 'TBX-101',
      summary: 'Business summary match',
      issueType: 'Story',
      status: 'In Progress',
      assigneeName: 'Alex Analyst',
      created: '2026-05-01T00:00:00.000Z',
      updated: '2026-05-20T00:00:00.000Z',
      hierarchyLevel: 'team',
      matchLocation: 'summary',
      projectKey: 'TBX',
    });

    const storedRows = JSON.parse(window.localStorage.getItem('tbxBusinessHelperStablizationTable') ?? '[]');

    expect(appendResult.didCreateRow).toBe(true);
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0].grouping).toBe('Portfolio');
    expect(storedRows[0].name).toBe('TBX-101 - Business summary match');
    expect(storedRows[0].userColumnValues['owner-notes']).toBe('Business summary match');
    expect(storedRows[0].sourceJiraBrowseUrl).toBe('https://jira.example.com/browse/TBX-101');
    expect(storedRows[0].sourceJiraIssueKey).toBe('TBX-101');
    expect(storedRows[0].sourceJiraLinkedColumns).toEqual(['name', 'owner-notes']);
  });
});

describe('stablization funding formulas', () => {
  it('calculates testing, total, and footer totals from the editable currency columns', () => {
    const primaryRow = {
      ...createStablizationFundingRow(),
      fulfillmentCost: '100',
      enrollmentCost: '20',
      billing: '80',
      cost: '15',
    };
    const secondaryRow = {
      ...createStablizationFundingRow(),
      fulfillmentCost: '40',
      enrollmentCost: '10',
      billing: '30',
      cost: '5',
    };

    expect(calculateStablizationTestingAmount(primaryRow)).toBe(50);
    expect(calculateStablizationTotalAmount(primaryRow)).toBe(250);

    expect(calculateStablizationFooterTotals([primaryRow, secondaryRow])).toEqual({
      fulfillmentCost: 140,
      enrollmentCost: 30,
      billing: 110,
      testing: 70,
      total: 350,
      cost: 20,
      userColumnCurrencyTotals: {},
    });
  });
});
