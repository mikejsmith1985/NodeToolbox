// useStablizationFundingTable.test.ts — Unit tests for persisted stablization funding rows and formulas.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  calculateStablizationFooterTotals,
  calculateStablizationTestingAmount,
  calculateStablizationTotalAmount,
  createStablizationFundingRow,
  useStablizationFundingTable,
} from './useStablizationFundingTable.ts';

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
    });
  });
});
