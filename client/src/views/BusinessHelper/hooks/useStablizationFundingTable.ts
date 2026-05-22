// useStablizationFundingTable.ts — Persisted row state and formulas for the Business Helper stablization funding table.

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useLocalStorage } from '../../../hooks/useLocalStorage.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';
import type { SimpleSearchResult } from './useSimpleSearchState.ts';
import {
  buildMappedStablizationValues,
  STABLIZATION_CONFIGURABLE_COLUMNS,
  readBusinessHelperSettings,
  STABLIZATION_COLUMN_LABELS,
  type BusinessHelperSettingsState,
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
const JIRA_BASE_URL_STORAGE_KEY = 'tbxCRGenJiraUrl';
const JIRA_BROWSE_PATH_PREFIX = '/browse/';
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
  sourceJiraBrowseUrl: string;
  sourceJiraIssueKey: string;
  sourceJiraLinkedColumns: StablizationConfigurableColumn[];
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

type StablizationSingleOptionDefaults = Partial<Record<StablizationConfigurableColumn, string>>;

/**
 * Creates a blank stablization funding row so business users always have a ready-to-edit line item.
 */
export function createStablizationFundingRow(
  businessHelperSettings?: BusinessHelperSettingsState,
): StablizationFundingRow {
  const stablizationSingleOptionDefaults = buildStablizationSingleOptionDefaults(businessHelperSettings);

  return {
    id: createStablizationFundingRowId(),
    grouping: stablizationSingleOptionDefaults.grouping ?? DEFAULT_TEXT_INPUT,
    name: stablizationSingleOptionDefaults.name ?? DEFAULT_TEXT_INPUT,
    fulfillmentCost: DEFAULT_CURRENCY_INPUT,
    enrollmentCost: DEFAULT_CURRENCY_INPUT,
    billing: DEFAULT_CURRENCY_INPUT,
    justification: stablizationSingleOptionDefaults.justification ?? DEFAULT_TEXT_INPUT,
    timing: DEFAULT_DATE_INPUT,
    cost: DEFAULT_CURRENCY_INPUT,
    sourceJiraBrowseUrl: DEFAULT_TEXT_INPUT,
    sourceJiraIssueKey: DEFAULT_TEXT_INPUT,
    sourceJiraLinkedColumns: [],
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

  const stablizationRows = readStoredStablizationRows(businessHelperSettings);
  const sourceJiraBrowseUrl = buildJiraBrowseUrl(simpleSearchResult.key);
  const mappedRow = {
    ...createStablizationFundingRow(businessHelperSettings),
    ...mappedValues,
    sourceJiraBrowseUrl,
    sourceJiraIssueKey: simpleSearchResult.key,
    sourceJiraLinkedColumns: appliedColumns,
  };
  const nextRows = shouldReplaceStarterRow(stablizationRows, businessHelperSettings)
    ? [mappedRow]
    : [...stablizationRows, mappedRow];

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
export function useStablizationFundingTable(
  businessHelperSettings: BusinessHelperSettingsState = readBusinessHelperSettings(),
): UseStablizationFundingTableResult {
  const [storedRows, setStoredRows] = useLocalStorage<StablizationFundingRow[]>(
    STABLIZATION_STORAGE_KEY,
    createDefaultStablizationRows(businessHelperSettings),
  );
  const stablizationRows = useMemo(
    () => applySingleOptionDefaultsToStarterRows(sanitizeStoredRows(storedRows), businessHelperSettings),
    [businessHelperSettings, storedRows],
  );
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

  useEffect(() => {
    if (areStablizationRowsEqual(storedRows, stablizationRows)) {
      return;
    }

    setStoredRows(stablizationRows);
  }, [setStoredRows, stablizationRows, storedRows]);

  const addRow = useCallback(() => {
    const nextRows = [...stablizationRowsRef.current, createStablizationFundingRow(businessHelperSettings)];
    stablizationRowsRef.current = nextRows;
    setStoredRows(nextRows);
  }, [businessHelperSettings, setStoredRows]);

  const removeRow = useCallback(
    (rowId: string) => {
      const remainingRows = stablizationRowsRef.current.filter((stablizationRow) => stablizationRow.id !== rowId);
      const nextRows = remainingRows.length > 0 ? remainingRows : createDefaultStablizationRows(businessHelperSettings);
      stablizationRowsRef.current = nextRows;
      setStoredRows(nextRows);
    },
    [businessHelperSettings, setStoredRows],
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

function createDefaultStablizationRows(
  businessHelperSettings?: BusinessHelperSettingsState,
): StablizationFundingRow[] {
  return Array.from({ length: DEFAULT_ROW_COUNT }, () => createStablizationFundingRow(businessHelperSettings));
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

function readStoredStablizationRows(
  businessHelperSettings?: BusinessHelperSettingsState,
): StablizationFundingRow[] {
  if (typeof window === 'undefined') {
    return createDefaultStablizationRows(businessHelperSettings);
  }

  try {
    const rawStoredRows = window.localStorage.getItem(STABLIZATION_STORAGE_KEY);
    if (!rawStoredRows) {
      return createDefaultStablizationRows(businessHelperSettings);
    }

    return applySingleOptionDefaultsToStarterRows(
      sanitizeStoredRows(JSON.parse(rawStoredRows) as StablizationFundingRow[]),
      businessHelperSettings,
    );
  } catch {
    return createDefaultStablizationRows(businessHelperSettings);
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

function sanitizeStoredRows(
  candidateRows: StablizationFundingRow[],
): StablizationFundingRow[] {
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
    sourceJiraBrowseUrl: sanitizeStoredText(candidateRow?.sourceJiraBrowseUrl),
    sourceJiraIssueKey: sanitizeStoredText(candidateRow?.sourceJiraIssueKey),
    sourceJiraLinkedColumns: sanitizeStoredLinkedColumns(candidateRow?.sourceJiraLinkedColumns),
  };
}

function sanitizeStoredText(candidateValue: string, fallbackValue = DEFAULT_TEXT_INPUT): string {
  if (typeof candidateValue !== 'string') {
    return fallbackValue;
  }

  return candidateValue;
}

function shouldReplaceStarterRow(
  stablizationRows: StablizationFundingRow[],
  businessHelperSettings?: BusinessHelperSettingsState,
): boolean {
  return stablizationRows.length === 1 && isBlankStablizationRow(stablizationRows[0], businessHelperSettings);
}

function isBlankStablizationRow(
  stablizationRow: StablizationFundingRow,
  businessHelperSettings?: BusinessHelperSettingsState,
): boolean {
  const stablizationSingleOptionDefaults = buildStablizationSingleOptionDefaults(businessHelperSettings);

  return isBlankOrDefaultTextValue(stablizationRow.grouping, stablizationSingleOptionDefaults.grouping)
    && isBlankOrDefaultTextValue(stablizationRow.name, stablizationSingleOptionDefaults.name)
    && !stablizationRow.fulfillmentCost
    && !stablizationRow.enrollmentCost
    && !stablizationRow.billing
    && isBlankOrDefaultTextValue(stablizationRow.justification, stablizationSingleOptionDefaults.justification)
    && !stablizationRow.timing
    && !stablizationRow.cost
    && !stablizationRow.sourceJiraBrowseUrl
    && !stablizationRow.sourceJiraIssueKey
    && stablizationRow.sourceJiraLinkedColumns.length === 0;
}

function buildComputedRow(stablizationRow: StablizationFundingRow): StablizationFundingComputedRow {
  return {
    ...stablizationRow,
    testingAmount: calculateStablizationTestingAmount(stablizationRow),
    totalAmount: calculateStablizationTotalAmount(stablizationRow),
  };
}

function buildStablizationSingleOptionDefaults(
  businessHelperSettings?: BusinessHelperSettingsState,
): StablizationSingleOptionDefaults {
  if (!businessHelperSettings) {
    return {};
  }

  return STABLIZATION_CONFIGURABLE_COLUMNS.reduce<StablizationSingleOptionDefaults>((runningDefaults, { key }) => {
    const columnSetting = businessHelperSettings.stablizationColumns[key];
    const defaultDropdownOption = columnSetting.inputKind === 'dropdown' && columnSetting.dropdownOptions.length === 1
      ? columnSetting.dropdownOptions[0]
      : undefined;

    return defaultDropdownOption ? { ...runningDefaults, [key]: defaultDropdownOption } : runningDefaults;
  }, {});
}

function applySingleOptionDefaultsToStarterRows(
  stablizationRows: readonly StablizationFundingRow[],
  businessHelperSettings?: BusinessHelperSettingsState,
): StablizationFundingRow[] {
  const stablizationSingleOptionDefaults = buildStablizationSingleOptionDefaults(businessHelperSettings);
  if (Object.keys(stablizationSingleOptionDefaults).length === 0) {
    return [...stablizationRows];
  }

  return stablizationRows.map((stablizationRow) =>
    shouldApplySingleOptionDefaultsToRow(stablizationRow, stablizationSingleOptionDefaults)
      ? applySingleOptionDefaultsToRow(stablizationRow, stablizationSingleOptionDefaults)
      : stablizationRow,
  );
}

function isBlankOrDefaultTextValue(candidateValue: string, defaultValue?: string): boolean {
  return !candidateValue || candidateValue === defaultValue;
}

function areStablizationRowsEqual(
  previousRows: readonly StablizationFundingRow[],
  nextRows: readonly StablizationFundingRow[],
): boolean {
  if (previousRows.length !== nextRows.length) {
    return false;
  }

  return previousRows.every((previousRow, rowIndex) => {
    const nextRow = nextRows[rowIndex];
    return previousRow.id === nextRow.id
      && previousRow.grouping === nextRow.grouping
      && previousRow.name === nextRow.name
      && previousRow.fulfillmentCost === nextRow.fulfillmentCost
      && previousRow.enrollmentCost === nextRow.enrollmentCost
      && previousRow.billing === nextRow.billing
      && previousRow.justification === nextRow.justification
      && previousRow.timing === nextRow.timing
      && previousRow.cost === nextRow.cost
      && previousRow.sourceJiraBrowseUrl === nextRow.sourceJiraBrowseUrl
      && previousRow.sourceJiraIssueKey === nextRow.sourceJiraIssueKey
      && areLinkedColumnListsEqual(previousRow.sourceJiraLinkedColumns, nextRow.sourceJiraLinkedColumns);
  });
}

function sanitizeStoredLinkedColumns(
  candidateLinkedColumns: unknown,
): StablizationConfigurableColumn[] {
  if (!Array.isArray(candidateLinkedColumns)) {
    return [];
  }

  return candidateLinkedColumns.filter(isStablizationConfigurableColumn);
}

function isStablizationConfigurableColumn(
  candidateColumnKey: unknown,
): candidateColumnKey is StablizationConfigurableColumn {
  return candidateColumnKey === 'grouping'
    || candidateColumnKey === 'name'
    || candidateColumnKey === 'justification';
}

function areLinkedColumnListsEqual(
  previousLinkedColumns: readonly StablizationConfigurableColumn[],
  nextLinkedColumns: readonly StablizationConfigurableColumn[],
): boolean {
  if (previousLinkedColumns.length !== nextLinkedColumns.length) {
    return false;
  }

  return previousLinkedColumns.every((previousLinkedColumn, linkedColumnIndex) =>
    previousLinkedColumn === nextLinkedColumns[linkedColumnIndex]
  );
}

function shouldApplySingleOptionDefaultsToRow(
  stablizationRow: StablizationFundingRow,
  stablizationSingleOptionDefaults: StablizationSingleOptionDefaults,
): boolean {
  return isBlankOrDefaultTextValue(stablizationRow.grouping, stablizationSingleOptionDefaults.grouping)
    && isBlankOrDefaultTextValue(stablizationRow.name, stablizationSingleOptionDefaults.name)
    && isBlankOrDefaultTextValue(stablizationRow.justification, stablizationSingleOptionDefaults.justification)
    && !stablizationRow.fulfillmentCost
    && !stablizationRow.enrollmentCost
    && !stablizationRow.billing
    && !stablizationRow.timing
    && !stablizationRow.cost
    && !stablizationRow.sourceJiraBrowseUrl
    && !stablizationRow.sourceJiraIssueKey
    && stablizationRow.sourceJiraLinkedColumns.length === 0;
}

function applySingleOptionDefaultsToRow(
  stablizationRow: StablizationFundingRow,
  stablizationSingleOptionDefaults: StablizationSingleOptionDefaults,
): StablizationFundingRow {
  return {
    ...stablizationRow,
    grouping: stablizationRow.grouping || stablizationSingleOptionDefaults.grouping || DEFAULT_TEXT_INPUT,
    name: stablizationRow.name || stablizationSingleOptionDefaults.name || DEFAULT_TEXT_INPUT,
    justification: stablizationRow.justification || stablizationSingleOptionDefaults.justification || DEFAULT_TEXT_INPUT,
  };
}

function buildJiraBrowseUrl(issueKey: string): string {
  const jiraBaseUrl = readConfiguredJiraBaseUrl();
  const normalizedIssuePath = `${JIRA_BROWSE_PATH_PREFIX}${encodeURIComponent(issueKey)}`;

  if (!jiraBaseUrl) {
    return normalizedIssuePath;
  }

  return `${jiraBaseUrl.replace(/\/+$/, '')}${normalizedIssuePath}`;
}

function readConfiguredJiraBaseUrl(): string {
  const jiraBaseUrlFromStore = useSettingsStore.getState().changeRequestGeneratorJiraUrl.trim();
  if (jiraBaseUrlFromStore) {
    return jiraBaseUrlFromStore;
  }

  if (typeof window === 'undefined') {
    return DEFAULT_TEXT_INPUT;
  }

  try {
    return window.localStorage.getItem(JIRA_BASE_URL_STORAGE_KEY)?.trim() ?? DEFAULT_TEXT_INPUT;
  } catch {
    return DEFAULT_TEXT_INPUT;
  }
}
