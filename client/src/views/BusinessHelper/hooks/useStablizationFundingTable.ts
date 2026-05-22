// useStablizationFundingTable.ts — Persisted row state and formulas for the Business Helper stablization funding table.

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useLocalStorage } from '../../../hooks/useLocalStorage.ts';
import type { SimpleSearchResult } from './useSimpleSearchState.ts';
import {
  buildMappedStablizationValues,
  readBusinessHelperSettings,
  STABLIZATION_COLUMN_LABELS,
  type StablizationConfigurableColumn,
} from './useBusinessHelperSettings.ts';

const STABLIZATION_STORAGE_KEY = 'tbxBusinessHelperStablizationTable';
const DEFAULT_CURRENCY_INPUT = '';
const DEFAULT_TEXT_INPUT = '';
const DEFAULT_DATE_INPUT = '';
const DEFAULT_ROW_COUNT = 1;
const TESTING_RATE = 0.25;
const CURRENCY_ROUNDING_PRECISION = 100;
const ROW_ID_RANDOM_SUFFIX_LENGTH = 8;
const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export interface StablizationFundingRow {
  id: string;
  grouping: string;
  name: string;
  fulfillmentCost: string;
  enrollmentCost: string;
  billing: string;
  justification: string;
  timing: string;
  cost: string;
}

export interface StablizationFundingComputedRow extends StablizationFundingRow {
  testingAmount: number;
  totalAmount: number;
}

export interface StablizationFundingTotals {
  fulfillmentCost: number;
  enrollmentCost: number;
  billing: number;
  testing: number;
  total: number;
  cost: number;
}

export type StablizationTextField = 'grouping' | 'name' | 'justification' | 'timing';
export type StablizationCurrencyField = 'fulfillmentCost' | 'enrollmentCost' | 'billing' | 'cost';

export interface UseStablizationFundingTableResult {
  rows: StablizationFundingComputedRow[];
  totals: StablizationFundingTotals;
  addRow: () => void;
  removeRow: (rowId: string) => void;
  updateTextField: (rowId: string, fieldName: StablizationTextField, value: string) => void;
  updateCurrencyField: (rowId: string, fieldName: StablizationCurrencyField, value: string) => void;
}

export interface AppendSimpleSearchToStablizationResult {
  didCreateRow: boolean;
  appliedColumnLabels: string[];
  skippedColumnLabels: string[];
}

/**
 * Creates a blank stablization funding row so business users always have a ready-to-edit line item.
 */
export function createStablizationFundingRow(): StablizationFundingRow {
  return {
    id: createStablizationFundingRowId(),
    grouping: DEFAULT_TEXT_INPUT,
    name: DEFAULT_TEXT_INPUT,
    fulfillmentCost: DEFAULT_CURRENCY_INPUT,
    enrollmentCost: DEFAULT_CURRENCY_INPUT,
    billing: DEFAULT_CURRENCY_INPUT,
    justification: DEFAULT_TEXT_INPUT,
    timing: DEFAULT_DATE_INPUT,
    cost: DEFAULT_CURRENCY_INPUT,
  };
}

/**
 * Converts a business-entered currency input into a safe numeric amount for formulas and totals.
 */
export function parseUsdCurrencyInput(currencyInput: string): number {
  const normalizedCurrencyInput = currencyInput.trim().replace(/[$,]/g, '');
  if (!normalizedCurrencyInput) {
    return 0;
  }

  const parsedAmount = Number.parseFloat(normalizedCurrencyInput);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    return 0;
  }

  return roundCurrencyAmount(parsedAmount);
}

/**
 * Formats a numeric amount as USD so calculated values and footers match business expectations.
 */
export function formatUsdCurrencyAmount(currencyAmount: number): string {
  return USD_CURRENCY_FORMATTER.format(currencyAmount);
}

/**
 * Calculates the Testing amount from fulfillment, enrollment, and billing at the fixed 25% rate.
 */
export function calculateStablizationTestingAmount(stablizationRow: StablizationFundingRow): number {
  return roundCurrencyAmount(calculateStablizationBaseAmount(stablizationRow) * TESTING_RATE);
}

/**
 * Calculates the Total amount by adding fulfillment, enrollment, billing, and the derived Testing amount.
 */
export function calculateStablizationTotalAmount(stablizationRow: StablizationFundingRow): number {
  const stablizationBaseAmount = calculateStablizationBaseAmount(stablizationRow);
  const testingAmount = roundCurrencyAmount(stablizationBaseAmount * TESTING_RATE);

  return roundCurrencyAmount(stablizationBaseAmount + testingAmount);
}

/**
 * Calculates the footer totals for every currency column in the stablization table.
 */
export function calculateStablizationFooterTotals(
  stablizationRows: readonly StablizationFundingRow[],
): StablizationFundingTotals {
  return stablizationRows.reduce<StablizationFundingTotals>(
    (runningTotals, stablizationRow) => ({
      fulfillmentCost: roundCurrencyAmount(
        runningTotals.fulfillmentCost + parseUsdCurrencyInput(stablizationRow.fulfillmentCost),
      ),
      enrollmentCost: roundCurrencyAmount(
        runningTotals.enrollmentCost + parseUsdCurrencyInput(stablizationRow.enrollmentCost),
      ),
      billing: roundCurrencyAmount(runningTotals.billing + parseUsdCurrencyInput(stablizationRow.billing)),
      testing: roundCurrencyAmount(runningTotals.testing + calculateStablizationTestingAmount(stablizationRow)),
      total: roundCurrencyAmount(runningTotals.total + calculateStablizationTotalAmount(stablizationRow)),
      cost: roundCurrencyAmount(runningTotals.cost + parseUsdCurrencyInput(stablizationRow.cost)),
    }),
    {
      fulfillmentCost: 0,
      enrollmentCost: 0,
      billing: 0,
      testing: 0,
      total: 0,
      cost: 0,
    },
  );
}

/**
 * Appends one Simple Search result into the Stablization table using the configured destination mapping.
 */
export function appendSimpleSearchResultToStablization(
  simpleSearchResult: SimpleSearchResult,
): AppendSimpleSearchToStablizationResult {
  const businessHelperSettings = readBusinessHelperSettings();
  const { mappedValues, skippedColumns } = buildMappedStablizationValues(simpleSearchResult, businessHelperSettings);
  const appliedColumns = Object.keys(mappedValues) as StablizationConfigurableColumn[];

  if (appliedColumns.length === 0) {
    return {
      didCreateRow: false,
      appliedColumnLabels: [],
      skippedColumnLabels: skippedColumns.map((columnKey) => STABLIZATION_COLUMN_LABELS[columnKey]),
    };
  }

  const stablizationRows = readStoredStablizationRows();
  const mappedRow = {
    ...createStablizationFundingRow(),
    ...mappedValues,
  };
  const nextRows = shouldReplaceStarterRow(stablizationRows) ? [mappedRow] : [...stablizationRows, mappedRow];

  writeStoredStablizationRows(nextRows);

  return {
    didCreateRow: true,
    appliedColumnLabels: appliedColumns.map((columnKey) => STABLIZATION_COLUMN_LABELS[columnKey]),
    skippedColumnLabels: skippedColumns.map((columnKey) => STABLIZATION_COLUMN_LABELS[columnKey]),
  };
}

/**
 * Persists and manages the editable stablization funding table while exposing read-only calculated values.
 */
export function useStablizationFundingTable(): UseStablizationFundingTableResult {
  const [storedRows, setStoredRows] = useLocalStorage<StablizationFundingRow[]>(
    STABLIZATION_STORAGE_KEY,
    createDefaultStablizationRows(),
  );

  const stablizationRows = useMemo(() => sanitizeStoredRows(storedRows), [storedRows]);
  const stablizationRowsRef = useRef(stablizationRows);
  const computedRows = useMemo(
    () => stablizationRows.map((stablizationRow) => buildComputedRow(stablizationRow)),
    [stablizationRows],
  );
  const footerTotals = useMemo(
    () => calculateStablizationFooterTotals(stablizationRows),
    [stablizationRows],
  );

  useEffect(() => {
    stablizationRowsRef.current = stablizationRows;
  }, [stablizationRows]);

  const addRow = useCallback(() => {
    const nextRows = [...stablizationRowsRef.current, createStablizationFundingRow()];
    stablizationRowsRef.current = nextRows;
    setStoredRows(nextRows);
  }, [setStoredRows]);

  const removeRow = useCallback(
    (rowId: string) => {
      const remainingRows = stablizationRowsRef.current.filter((stablizationRow) => stablizationRow.id !== rowId);
      const nextRows = remainingRows.length > 0 ? remainingRows : createDefaultStablizationRows();
      stablizationRowsRef.current = nextRows;
      setStoredRows(nextRows);
    },
    [setStoredRows],
  );

  const updateTextField = useCallback(
    (rowId: string, fieldName: StablizationTextField, value: string) => {
      const nextRows = stablizationRowsRef.current.map((stablizationRow) =>
        stablizationRow.id === rowId ? { ...stablizationRow, [fieldName]: value } : stablizationRow,
      );
      stablizationRowsRef.current = nextRows;
      setStoredRows(nextRows);
    },
    [setStoredRows],
  );

  const updateCurrencyField = useCallback(
    (rowId: string, fieldName: StablizationCurrencyField, value: string) => {
      const nextRows = stablizationRowsRef.current.map((stablizationRow) =>
        stablizationRow.id === rowId ? { ...stablizationRow, [fieldName]: value } : stablizationRow,
      );
      stablizationRowsRef.current = nextRows;
      setStoredRows(nextRows);
    },
    [setStoredRows],
  );

  return {
    rows: computedRows,
    totals: footerTotals,
    addRow,
    removeRow,
    updateTextField,
    updateCurrencyField,
  };
}

function createDefaultStablizationRows(): StablizationFundingRow[] {
  return Array.from({ length: DEFAULT_ROW_COUNT }, () => createStablizationFundingRow());
}

function createStablizationFundingRowId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `stablization-${Date.now()}-${Math.random().toString(36).slice(2, 2 + ROW_ID_RANDOM_SUFFIX_LENGTH)}`;
}

function roundCurrencyAmount(currencyAmount: number): number {
  return Math.round((currencyAmount + Number.EPSILON) * CURRENCY_ROUNDING_PRECISION) / CURRENCY_ROUNDING_PRECISION;
}

function calculateStablizationBaseAmount(stablizationRow: StablizationFundingRow): number {
  return parseUsdCurrencyInput(stablizationRow.fulfillmentCost)
    + parseUsdCurrencyInput(stablizationRow.enrollmentCost)
    + parseUsdCurrencyInput(stablizationRow.billing);
}

function readStoredStablizationRows(): StablizationFundingRow[] {
  if (typeof window === 'undefined') {
    return createDefaultStablizationRows();
  }

  try {
    const rawStoredRows = window.localStorage.getItem(STABLIZATION_STORAGE_KEY);
    if (!rawStoredRows) {
      return createDefaultStablizationRows();
    }

    return sanitizeStoredRows(JSON.parse(rawStoredRows) as StablizationFundingRow[]);
  } catch {
    return createDefaultStablizationRows();
  }
}

function writeStoredStablizationRows(stablizationRows: StablizationFundingRow[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STABLIZATION_STORAGE_KEY, JSON.stringify(stablizationRows));
  } catch {
    // Storage access can fail in some browser modes, so the in-memory row state remains the primary source of truth.
  }
}

function sanitizeStoredRows(candidateRows: StablizationFundingRow[]): StablizationFundingRow[] {
  if (!Array.isArray(candidateRows) || candidateRows.length === 0) {
    return createDefaultStablizationRows();
  }

  return candidateRows.map((candidateRow) => sanitizeStoredRow(candidateRow));
}

function sanitizeStoredRow(candidateRow: StablizationFundingRow): StablizationFundingRow {
  return {
    id: typeof candidateRow?.id === 'string' && candidateRow.id ? candidateRow.id : createStablizationFundingRowId(),
    grouping: sanitizeStoredText(candidateRow?.grouping),
    name: sanitizeStoredText(candidateRow?.name),
    fulfillmentCost: sanitizeStoredText(candidateRow?.fulfillmentCost),
    enrollmentCost: sanitizeStoredText(candidateRow?.enrollmentCost),
    billing: sanitizeStoredText(candidateRow?.billing),
    justification: sanitizeStoredText(candidateRow?.justification),
    timing: sanitizeStoredText(candidateRow?.timing),
    cost: sanitizeStoredText(candidateRow?.cost),
  };
}

function sanitizeStoredText(candidateValue: string): string {
  return typeof candidateValue === 'string' ? candidateValue : DEFAULT_TEXT_INPUT;
}

function shouldReplaceStarterRow(stablizationRows: StablizationFundingRow[]): boolean {
  return stablizationRows.length === 1 && isBlankStablizationRow(stablizationRows[0]);
}

function isBlankStablizationRow(stablizationRow: StablizationFundingRow): boolean {
  return !stablizationRow.grouping
    && !stablizationRow.name
    && !stablizationRow.fulfillmentCost
    && !stablizationRow.enrollmentCost
    && !stablizationRow.billing
    && !stablizationRow.justification
    && !stablizationRow.timing
    && !stablizationRow.cost;
}

function buildComputedRow(stablizationRow: StablizationFundingRow): StablizationFundingComputedRow {
  return {
    ...stablizationRow,
    testingAmount: calculateStablizationTestingAmount(stablizationRow),
    totalAmount: calculateStablizationTotalAmount(stablizationRow),
  };
}
