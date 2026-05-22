// useBusinessHelperSettings.ts — Persisted Business Helper table configuration and Simple Search mapping rules.

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { SimpleSearchResult } from './useSimpleSearchState.ts';
import { useLocalStorage } from '../../../hooks/useLocalStorage.ts';

const BUSINESS_HELPER_SETTINGS_STORAGE_KEY = 'tbxBusinessHelperSettings';
const DEFAULT_SIMPLE_SEARCH_MAPPING_SOURCE = 'none';
const DEFAULT_STABLIZATION_NAME_MAPPING_SOURCE = 'jira-key-summary';
const DEFAULT_DROPDOWN_OPTION_INPUT = '';
const MAX_DROPDOWN_OPTIONS_PER_COLUMN = 50;
const MIN_STABLIZATION_COLUMN_WIDTH_PX = 96;
const MAX_STABLIZATION_COLUMN_WIDTH_PX = 520;

export type StablizationConfigurableColumn = 'grouping' | 'name' | 'justification';
export type StablizationColumnInputKind = 'text' | 'dropdown';
export type StablizationTableColumn =
  | 'grouping'
  | 'name'
  | 'fulfillmentCost'
  | 'enrollmentCost'
  | 'billing'
  | 'testing'
  | 'total'
  | 'justification'
  | 'timing'
  | 'cost'
  | 'actions';
export type SimpleSearchMappingSource =
  | 'none'
  | 'jira-key'
  | 'summary'
  | 'jira-key-summary'
  | 'issue-type'
  | 'status'
  | 'assignee'
  | 'updated-date';

export interface StablizationColumnSetting {
  inputKind: StablizationColumnInputKind;
  dropdownOptions: string[];
}

export interface BusinessHelperSettingsState {
  stablizationColumns: Record<StablizationConfigurableColumn, StablizationColumnSetting>;
  stablizationColumnWidths: Record<StablizationTableColumn, number>;
  simpleSearchMapping: Record<StablizationConfigurableColumn, SimpleSearchMappingSource>;
}

export interface UseBusinessHelperSettingsResult {
  settings: BusinessHelperSettingsState;
  updateColumnInputKind: (columnKey: StablizationConfigurableColumn, inputKind: StablizationColumnInputKind) => void;
  addDropdownOption: (columnKey: StablizationConfigurableColumn, dropdownOption: string) => void;
  removeDropdownOption: (columnKey: StablizationConfigurableColumn, dropdownOption: string) => void;
  updateSimpleSearchMapping: (
    columnKey: StablizationConfigurableColumn,
    mappingSource: SimpleSearchMappingSource,
  ) => void;
  updateStablizationColumnWidth: (columnKey: StablizationTableColumn, columnWidthPx: number) => void;
}

interface MappedStablizationValuesResult {
  mappedValues: Partial<Record<StablizationConfigurableColumn, string>>;
  skippedColumns: StablizationConfigurableColumn[];
}

export const STABLIZATION_CONFIGURABLE_COLUMNS: Array<{
  key: StablizationConfigurableColumn;
  label: string;
}> = [
  { key: 'grouping', label: 'Grouping' },
  { key: 'name', label: 'Name' },
  { key: 'justification', label: 'Justification' },
];

export const SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS: Array<{
  value: SimpleSearchMappingSource;
  label: string;
}> = [
  { value: 'none', label: 'Do not populate this column' },
  { value: 'jira-key', label: 'Jira Key' },
  { value: 'summary', label: 'Summary' },
  { value: 'jira-key-summary', label: 'Jira Key + Summary' },
  { value: 'issue-type', label: 'Issue Type' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'updated-date', label: 'Updated Date' },
];

export const STABLIZATION_COLUMN_LABELS: Record<StablizationConfigurableColumn, string> = {
  grouping: 'Grouping',
  name: 'Name',
  justification: 'Justification',
};

export const DEFAULT_STABLIZATION_COLUMN_WIDTHS: Record<StablizationTableColumn, number> = {
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
};

/**
 * Returns the current Business Helper settings, falling back to safe defaults when storage is missing or invalid.
 */
export function readBusinessHelperSettings(): BusinessHelperSettingsState {
  if (typeof window === 'undefined') {
    return createDefaultBusinessHelperSettings();
  }

  try {
    const rawStoredSettings = window.localStorage.getItem(BUSINESS_HELPER_SETTINGS_STORAGE_KEY);
    if (!rawStoredSettings) {
      return createDefaultBusinessHelperSettings();
    }

    return sanitizeBusinessHelperSettings(JSON.parse(rawStoredSettings) as Partial<BusinessHelperSettingsState>);
  } catch {
    return createDefaultBusinessHelperSettings();
  }
}

/**
 * Formats one Simple Search source choice into the text that should be written into a mapped table column.
 */
export function formatSimpleSearchMappingValue(
  simpleSearchResult: SimpleSearchResult,
  mappingSource: SimpleSearchMappingSource,
): string {
  if (mappingSource === 'jira-key') {
    return simpleSearchResult.key;
  }

  if (mappingSource === 'summary') {
    return simpleSearchResult.summary;
  }

  if (mappingSource === 'jira-key-summary') {
    return `${simpleSearchResult.key} - ${simpleSearchResult.summary}`;
  }

  if (mappingSource === 'issue-type') {
    return simpleSearchResult.issueType;
  }

  if (mappingSource === 'status') {
    return simpleSearchResult.status;
  }

  if (mappingSource === 'assignee') {
    return simpleSearchResult.assigneeName;
  }

  if (mappingSource === 'updated-date') {
    return simpleSearchResult.updated ? simpleSearchResult.updated.slice(0, 10) : '';
  }

  return DEFAULT_DROPDOWN_OPTION_INPUT;
}

/**
 * Builds the mapped text-column values for a Simple Search result while respecting dropdown-only restrictions.
 */
export function buildMappedStablizationValues(
  simpleSearchResult: SimpleSearchResult,
  businessHelperSettings: BusinessHelperSettingsState,
): MappedStablizationValuesResult {
  const mappedValues: Partial<Record<StablizationConfigurableColumn, string>> = {};
  const skippedColumns: StablizationConfigurableColumn[] = [];

  for (const { key: columnKey } of STABLIZATION_CONFIGURABLE_COLUMNS) {
    const mappingSource = businessHelperSettings.simpleSearchMapping[columnKey];
    if (mappingSource === 'none') {
      continue;
    }

    const mappedValue = formatSimpleSearchMappingValue(simpleSearchResult, mappingSource).trim();
    if (!mappedValue) {
      continue;
    }

    const columnSetting = businessHelperSettings.stablizationColumns[columnKey];
    const canWriteDropdownValue = columnSetting.inputKind === 'text'
      || columnSetting.dropdownOptions.includes(mappedValue);

    if (!canWriteDropdownValue) {
      skippedColumns.push(columnKey);
      continue;
    }

    mappedValues[columnKey] = mappedValue;
  }

  return { mappedValues, skippedColumns };
}

/**
 * Persists Business Helper settings for column behavior and Simple Search row transfer mappings.
 */
export function useBusinessHelperSettings(): UseBusinessHelperSettingsResult {
  const [storedSettings, setStoredSettings] = useLocalStorage<BusinessHelperSettingsState>(
    BUSINESS_HELPER_SETTINGS_STORAGE_KEY,
    createDefaultBusinessHelperSettings(),
  );
  const businessHelperSettings = useMemo(
    () => sanitizeBusinessHelperSettings(storedSettings),
    [storedSettings],
  );
  const businessHelperSettingsRef = useRef(businessHelperSettings);

  useEffect(() => {
    businessHelperSettingsRef.current = businessHelperSettings;
  }, [businessHelperSettings]);

  const updateColumnInputKind = useCallback(
    (columnKey: StablizationConfigurableColumn, inputKind: StablizationColumnInputKind) => {
      const nextSettings = {
        ...businessHelperSettingsRef.current,
        stablizationColumns: {
          ...businessHelperSettingsRef.current.stablizationColumns,
          [columnKey]: {
            ...businessHelperSettingsRef.current.stablizationColumns[columnKey],
            inputKind,
          },
        },
      };
      businessHelperSettingsRef.current = nextSettings;
      setStoredSettings(nextSettings);
    },
    [setStoredSettings],
  );

  const addDropdownOption = useCallback(
    (columnKey: StablizationConfigurableColumn, dropdownOption: string) => {
      const normalizedDropdownOption = dropdownOption.trim();
      if (!normalizedDropdownOption) {
        return;
      }

      const existingOptions = businessHelperSettingsRef.current.stablizationColumns[columnKey].dropdownOptions;
      if (
        existingOptions.includes(normalizedDropdownOption)
        || existingOptions.length >= MAX_DROPDOWN_OPTIONS_PER_COLUMN
      ) {
        return;
      }

      const nextSettings = {
        ...businessHelperSettingsRef.current,
        stablizationColumns: {
          ...businessHelperSettingsRef.current.stablizationColumns,
          [columnKey]: {
            ...businessHelperSettingsRef.current.stablizationColumns[columnKey],
            dropdownOptions: [...existingOptions, normalizedDropdownOption],
          },
        },
      };
      businessHelperSettingsRef.current = nextSettings;
      setStoredSettings(nextSettings);
    },
    [setStoredSettings],
  );

  const removeDropdownOption = useCallback(
    (columnKey: StablizationConfigurableColumn, dropdownOption: string) => {
      const nextSettings = {
        ...businessHelperSettingsRef.current,
        stablizationColumns: {
          ...businessHelperSettingsRef.current.stablizationColumns,
          [columnKey]: {
            ...businessHelperSettingsRef.current.stablizationColumns[columnKey],
            dropdownOptions: businessHelperSettingsRef.current.stablizationColumns[columnKey].dropdownOptions.filter(
              (storedDropdownOption) => storedDropdownOption !== dropdownOption,
            ),
          },
        },
      };
      businessHelperSettingsRef.current = nextSettings;
      setStoredSettings(nextSettings);
    },
    [setStoredSettings],
  );

  const updateSimpleSearchMapping = useCallback(
    (columnKey: StablizationConfigurableColumn, mappingSource: SimpleSearchMappingSource) => {
      const nextSettings = {
        ...businessHelperSettingsRef.current,
        simpleSearchMapping: {
          ...businessHelperSettingsRef.current.simpleSearchMapping,
          [columnKey]: mappingSource,
        },
      };
      businessHelperSettingsRef.current = nextSettings;
      setStoredSettings(nextSettings);
    },
    [setStoredSettings],
  );

  const updateStablizationColumnWidth = useCallback(
    (columnKey: StablizationTableColumn, columnWidthPx: number) => {
      const nextSettings = {
        ...businessHelperSettingsRef.current,
        stablizationColumnWidths: {
          ...businessHelperSettingsRef.current.stablizationColumnWidths,
          [columnKey]: sanitizeColumnWidth(columnWidthPx),
        },
      };
      businessHelperSettingsRef.current = nextSettings;
      setStoredSettings(nextSettings);
    },
    [setStoredSettings],
  );

  return {
    settings: businessHelperSettings,
    updateColumnInputKind,
    addDropdownOption,
    removeDropdownOption,
    updateSimpleSearchMapping,
    updateStablizationColumnWidth,
  };
}

function createDefaultBusinessHelperSettings(): BusinessHelperSettingsState {
  return {
    stablizationColumns: {
      grouping: { inputKind: 'text', dropdownOptions: [] },
      name: { inputKind: 'text', dropdownOptions: [] },
      justification: { inputKind: 'text', dropdownOptions: [] },
    },
    stablizationColumnWidths: DEFAULT_STABLIZATION_COLUMN_WIDTHS,
    simpleSearchMapping: {
      grouping: DEFAULT_SIMPLE_SEARCH_MAPPING_SOURCE,
      name: DEFAULT_STABLIZATION_NAME_MAPPING_SOURCE,
      justification: DEFAULT_SIMPLE_SEARCH_MAPPING_SOURCE,
    },
  };
}

function sanitizeBusinessHelperSettings(
  candidateSettings: Partial<BusinessHelperSettingsState>,
): BusinessHelperSettingsState {
  return {
    stablizationColumns: {
      grouping: sanitizeColumnSetting(candidateSettings.stablizationColumns?.grouping),
      name: sanitizeColumnSetting(candidateSettings.stablizationColumns?.name),
      justification: sanitizeColumnSetting(candidateSettings.stablizationColumns?.justification),
    },
    stablizationColumnWidths: sanitizeStablizationColumnWidths(candidateSettings.stablizationColumnWidths),
    simpleSearchMapping: {
      grouping: sanitizeMappingSource(candidateSettings.simpleSearchMapping?.grouping),
      name: sanitizeMappingSource(candidateSettings.simpleSearchMapping?.name, DEFAULT_STABLIZATION_NAME_MAPPING_SOURCE),
      justification: sanitizeMappingSource(candidateSettings.simpleSearchMapping?.justification),
    },
  };
}

function sanitizeColumnSetting(
  candidateColumnSetting: Partial<StablizationColumnSetting> | undefined,
): StablizationColumnSetting {
  return {
    inputKind: isValidColumnInputKind(candidateColumnSetting?.inputKind) ? candidateColumnSetting.inputKind : 'text',
    dropdownOptions: Array.isArray(candidateColumnSetting?.dropdownOptions)
      ? candidateColumnSetting.dropdownOptions
          .filter((dropdownOption): dropdownOption is string => typeof dropdownOption === 'string')
          .map((dropdownOption) => dropdownOption.trim())
          .filter(Boolean)
          .slice(0, MAX_DROPDOWN_OPTIONS_PER_COLUMN)
      : [],
  };
}

function sanitizeMappingSource(
  candidateMappingSource: SimpleSearchMappingSource | undefined,
  fallbackValue: SimpleSearchMappingSource = DEFAULT_SIMPLE_SEARCH_MAPPING_SOURCE,
): SimpleSearchMappingSource {
  return isValidMappingSource(candidateMappingSource) ? candidateMappingSource : fallbackValue;
}

function isValidColumnInputKind(candidateInputKind: unknown): candidateInputKind is StablizationColumnInputKind {
  return candidateInputKind === 'text' || candidateInputKind === 'dropdown';
}

function isValidMappingSource(candidateMappingSource: unknown): candidateMappingSource is SimpleSearchMappingSource {
  return SIMPLE_SEARCH_MAPPING_SOURCE_OPTIONS.some((mappingOption) => mappingOption.value === candidateMappingSource);
}

function sanitizeStablizationColumnWidths(
  candidateColumnWidths: Partial<Record<StablizationTableColumn, number>> | undefined,
): Record<StablizationTableColumn, number> {
  return {
    grouping: sanitizeColumnWidth(candidateColumnWidths?.grouping, DEFAULT_STABLIZATION_COLUMN_WIDTHS.grouping),
    name: sanitizeColumnWidth(candidateColumnWidths?.name, DEFAULT_STABLIZATION_COLUMN_WIDTHS.name),
    fulfillmentCost: sanitizeColumnWidth(
      candidateColumnWidths?.fulfillmentCost,
      DEFAULT_STABLIZATION_COLUMN_WIDTHS.fulfillmentCost,
    ),
    enrollmentCost: sanitizeColumnWidth(
      candidateColumnWidths?.enrollmentCost,
      DEFAULT_STABLIZATION_COLUMN_WIDTHS.enrollmentCost,
    ),
    billing: sanitizeColumnWidth(candidateColumnWidths?.billing, DEFAULT_STABLIZATION_COLUMN_WIDTHS.billing),
    testing: sanitizeColumnWidth(candidateColumnWidths?.testing, DEFAULT_STABLIZATION_COLUMN_WIDTHS.testing),
    total: sanitizeColumnWidth(candidateColumnWidths?.total, DEFAULT_STABLIZATION_COLUMN_WIDTHS.total),
    justification: sanitizeColumnWidth(
      candidateColumnWidths?.justification,
      DEFAULT_STABLIZATION_COLUMN_WIDTHS.justification,
    ),
    timing: sanitizeColumnWidth(candidateColumnWidths?.timing, DEFAULT_STABLIZATION_COLUMN_WIDTHS.timing),
    cost: sanitizeColumnWidth(candidateColumnWidths?.cost, DEFAULT_STABLIZATION_COLUMN_WIDTHS.cost),
    actions: sanitizeColumnWidth(candidateColumnWidths?.actions, DEFAULT_STABLIZATION_COLUMN_WIDTHS.actions),
  };
}

function sanitizeColumnWidth(candidateColumnWidth: unknown, fallbackWidth = MIN_STABLIZATION_COLUMN_WIDTH_PX): number {
  if (typeof candidateColumnWidth !== 'number' || !Number.isFinite(candidateColumnWidth)) {
    return fallbackWidth;
  }

  return Math.min(
    MAX_STABLIZATION_COLUMN_WIDTH_PX,
    Math.max(MIN_STABLIZATION_COLUMN_WIDTH_PX, Math.round(candidateColumnWidth)),
  );
}
