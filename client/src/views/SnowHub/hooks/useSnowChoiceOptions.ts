// useSnowChoiceOptions — Fetches planning dropdown choices from the live SNow change_request form metadata.
// Subscribes to the relay bridge status and auto-retries when the relay connects, so users
// never need to reload the page after activating the bookmarklet.

import { useCallback, useEffect, useState } from 'react';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { snowFetch } from '../../../services/snowApi.ts';

/** A single selectable option in a SNow choice field (label is what the user sees). */
export interface SnowChoiceOption {
  value: string;
  label: string;
}

/** Maps a SNow field name to its resolved list of selectable options. */
export type SnowChoiceOptionMap = Record<string, SnowChoiceOption[]>;

const CHANGE_REQUEST_TABLE_NAME = 'change_request';
const NEW_CHANGE_REQUEST_SYS_ID = '-1';
const SNOW_FORM_VIEW_NAMES = ['default', 'normal'] as const;

// All change_request choice fields we want to resolve from the same form metadata SNow uses.
const CHANGE_REQUEST_CHOICE_FIELDS = [
  'category',
  'type',
  'u_environment',
  'impact',
  'u_availability_impact',
  'u_change_tested',
  'u_impacted_persons_aware',
  'u_performed_previously',
  'u_success_probability',
  'u_can_be_backed_out',
] as const;

type UnknownRecord = Record<string, unknown>;

/**
 * Builds the UI Form API path for a new change_request record. This endpoint mirrors the
 * native SNow form and avoids direct sys_choice ACL checks in hardened instances.
 */
function buildUiFormPath(formViewName: (typeof SNOW_FORM_VIEW_NAMES)[number]): string {
  const encodedTableName = encodeURIComponent(CHANGE_REQUEST_TABLE_NAME);
  const encodedNewRecordSysId = encodeURIComponent(NEW_CHANGE_REQUEST_SYS_ID);
  const encodedFormView = encodeURIComponent(formViewName);
  return `/api/now/ui/form/${encodedTableName}/${encodedNewRecordSysId}?sysparm_view=${encodedFormView}&sysparm_display_value=all`;
}

function buildUiMetaPath(): string {
  const encodedTableName = encodeURIComponent(CHANGE_REQUEST_TABLE_NAME);
  return `/api/now/ui/meta/${encodedTableName}?sysparm_display_value=all`;
}

function isObjectRecord(candidate: unknown): candidate is UnknownRecord {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function readStringProperty(record: UnknownRecord, propertyNames: readonly string[]): string | null {
  for (const propertyName of propertyNames) {
    const propertyValue = record[propertyName];
    if (typeof propertyValue === 'string' && propertyValue.length > 0) {
      return propertyValue;
    }
    if (typeof propertyValue === 'number') {
      return String(propertyValue);
    }
  }
  return null;
}

function createChoiceOption(choiceCandidate: unknown, fallbackValue: string | null = null): SnowChoiceOption | null {
  if (typeof choiceCandidate === 'string') {
    return { value: fallbackValue ?? choiceCandidate, label: choiceCandidate };
  }
  if (!isObjectRecord(choiceCandidate)) {
    return null;
  }

  const label = readStringProperty(choiceCandidate, ['label', 'displayValue', 'display_value', 'display', 'text', 'name']);
  const value = readStringProperty(choiceCandidate, ['value', 'id', 'key']) ?? fallbackValue ?? label;
  if (!value || !label) {
    return null;
  }
  return { value, label };
}

function normalizeChoiceOptions(choiceCollection: unknown): SnowChoiceOption[] {
  if (Array.isArray(choiceCollection)) {
    return choiceCollection
      .map((choiceCandidate) => createChoiceOption(choiceCandidate))
      .filter((choiceOption): choiceOption is SnowChoiceOption => choiceOption !== null);
  }

  if (!isObjectRecord(choiceCollection)) {
    return [];
  }

  return Object.entries(choiceCollection)
    .map(([choiceValue, choiceCandidate]) => createChoiceOption(choiceCandidate, choiceValue))
    .filter((choiceOption): choiceOption is SnowChoiceOption => choiceOption !== null);
}

function extractFieldChoices(fieldCandidate: unknown): SnowChoiceOption[] {
  if (!isObjectRecord(fieldCandidate)) {
    return [];
  }

  for (const choicePropertyName of ['choices', 'choice_list', 'choiceList', 'options', 'values']) {
    const choiceOptions = normalizeChoiceOptions(fieldCandidate[choicePropertyName]);
    if (choiceOptions.length > 0) {
      return [{ value: '', label: '' }, ...choiceOptions];
    }
  }
  return [];
}

function assignChoicesFromNamedField(
  fieldName: string,
  fieldCandidate: unknown,
  choiceOptions: SnowChoiceOptionMap,
): void {
  if (!CHANGE_REQUEST_CHOICE_FIELDS.includes(fieldName as (typeof CHANGE_REQUEST_CHOICE_FIELDS)[number])) {
    return;
  }

  const fieldChoices = extractFieldChoices(fieldCandidate);
  if (fieldChoices.length > 0) {
    choiceOptions[fieldName] = fieldChoices;
  }
}

function collectChoicesFromFields(fieldsCandidate: unknown, choiceOptions: SnowChoiceOptionMap): void {
  if (Array.isArray(fieldsCandidate)) {
    for (const fieldCandidate of fieldsCandidate) {
      if (!isObjectRecord(fieldCandidate)) continue;
      const fieldName = readStringProperty(fieldCandidate, ['name', 'element', 'fieldName']);
      if (fieldName) assignChoicesFromNamedField(fieldName, fieldCandidate, choiceOptions);
    }
    return;
  }

  if (!isObjectRecord(fieldsCandidate)) {
    return;
  }

  for (const [fieldName, fieldCandidate] of Object.entries(fieldsCandidate)) {
    assignChoicesFromNamedField(fieldName, fieldCandidate, choiceOptions);
    if (isObjectRecord(fieldCandidate)) {
      const nestedFieldName = readStringProperty(fieldCandidate, ['name', 'element', 'fieldName']);
      if (nestedFieldName) assignChoicesFromNamedField(nestedFieldName, fieldCandidate, choiceOptions);
    }
  }
}

function collectChoicesFromSections(sectionsCandidate: unknown, choiceOptions: SnowChoiceOptionMap): void {
  if (!Array.isArray(sectionsCandidate)) {
    return;
  }

  for (const sectionCandidate of sectionsCandidate) {
    if (!isObjectRecord(sectionCandidate)) continue;
    collectChoicesFromFields(sectionCandidate.fields, choiceOptions);
    collectChoicesFromFields(sectionCandidate.columns, choiceOptions);
    collectChoicesFromSections(sectionCandidate.sections, choiceOptions);
  }
}

function hasChoiceOptions(choiceOptions: SnowChoiceOptionMap): boolean {
  return Object.values(choiceOptions).some((fieldOptions) => fieldOptions.length > 1);
}

function hasAllRequestedChoiceFields(choiceOptions: SnowChoiceOptionMap): boolean {
  return CHANGE_REQUEST_CHOICE_FIELDS.every((fieldName) => (choiceOptions[fieldName]?.length ?? 0) > 1);
}

function mergeChoiceOptions(
  baseChoiceOptions: SnowChoiceOptionMap,
  additionalChoiceOptions: SnowChoiceOptionMap,
): SnowChoiceOptionMap {
  const mergedChoiceOptions = { ...baseChoiceOptions };
  for (const [fieldName, fieldOptions] of Object.entries(additionalChoiceOptions)) {
    if ((mergedChoiceOptions[fieldName]?.length ?? 0) <= 1 && fieldOptions.length > 1) {
      mergedChoiceOptions[fieldName] = fieldOptions;
    }
  }
  return mergedChoiceOptions;
}

function getErrorMessage(unknownError: unknown): string {
  return unknownError instanceof Error ? unknownError.message : String(unknownError);
}

/**
 * Extracts choice lists from the UI Form API response. The parser accepts both record-shaped
 * and section-shaped payloads because SNow versions expose form metadata differently.
 */
function extractChoicesFromUiForm(responseData: unknown): SnowChoiceOptionMap {
  const responseRecord = isObjectRecord(responseData) ? responseData : {};
  const resultCandidate = responseRecord.result ?? responseData;
  const resultRecord = isObjectRecord(resultCandidate) ? resultCandidate : {};
  const choiceOptions: SnowChoiceOptionMap = {};

  collectChoicesFromFields(resultRecord.fields, choiceOptions);
  collectChoicesFromFields(resultRecord._fields, choiceOptions);
  collectChoicesFromFields(resultRecord.columns, choiceOptions);
  collectChoicesFromSections(resultRecord.sections, choiceOptions);
  collectChoicesFromSections(resultRecord._sections, choiceOptions);

  return choiceOptions;
}

/** Loads live change_request choice metadata from UI endpoints only. */
async function fetchChoiceOptionsFromServiceNow(): Promise<SnowChoiceOptionMap> {
  const fetchErrors: string[] = [];
  let mergedChoiceOptions: SnowChoiceOptionMap = {};
  let hasSuccessfulMetadataResponse = false;

  const metadataPaths = [
    ...SNOW_FORM_VIEW_NAMES.map((formViewName) => buildUiFormPath(formViewName)),
    buildUiMetaPath(),
  ];

  for (const metadataPath of metadataPaths) {
    try {
      const metadataResponse = await snowFetch<unknown>(metadataPath);
      hasSuccessfulMetadataResponse = true;
      const metadataChoiceOptions = extractChoicesFromUiForm(metadataResponse);
      mergedChoiceOptions = mergeChoiceOptions(mergedChoiceOptions, metadataChoiceOptions);
      if (hasAllRequestedChoiceFields(mergedChoiceOptions)) {
        return mergedChoiceOptions;
      }
      if (!hasChoiceOptions(metadataChoiceOptions)) {
        fetchErrors.push(`${metadataPath} returned no choice metadata`);
      }
    } catch (metadataError) {
      fetchErrors.push(getErrorMessage(metadataError));
    }
  }

  if (hasChoiceOptions(mergedChoiceOptions)) {
    return mergedChoiceOptions;
  }

  if (hasSuccessfulMetadataResponse) {
    throw new Error(
      'SNow UI metadata returned no live choice options. Clone a known-good CHG or use saved template values, then click Retry if you expect live options.',
    );
  }

  throw new Error(`Unable to load live SNow choice metadata. UI metadata attempts: ${fetchErrors.join(' | ')}`);
}

interface UseSnowChoiceOptionsResult {
  /** Options per field name — populated only after a successful SNow fetch. Empty when unavailable. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the SNow choice metadata fetch is in flight. */
  isLoadingChoices: boolean;
  /** True if the live fetch succeeded (options are from SNow). */
  areChoicesFromSnow: boolean;
  /** True if the fetch failed for a reason other than the relay being disconnected. */
  isFetchFailed: boolean;
  /**
   * The human-readable error message from the last failed fetch attempt.
   * null when no failure has occurred or when a new fetch is in progress.
   * Surfaced in the UI so users know whether the issue is auth (401), timeout, etc.
   */
  fetchErrorMessage: string | null;
  /** True when the relay bridge is connected — drives whether the fetch is attempted. */
  isRelayConnected: boolean;
  /** True when the relay bridge has detected ServiceNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  /** Manually re-triggers the SNow choice metadata fetch (e.g. after a transient SNow error). */
  retryFetch: () => void;
}

/**
 * Fetches all change_request dropdown choices from SNow's live form metadata.
 * Returns empty option maps when the relay is unavailable — callers should surface a warning
 * rather than letting users select potentially invalid hardcoded values.
 *
 * Auto-retries when the relay transitions from disconnected → connected, so the user
 * never needs to reload the page after activating the bookmarklet.
 */
export function useSnowChoiceOptions(): UseSnowChoiceOptionsResult {
  // Start with an empty map — no defaults — so the UI never shows guessed values.
  const [choiceOptions, setChoiceOptions]           = useState<SnowChoiceOptionMap>({});
  const [isLoadingChoices, setIsLoadingChoices]     = useState<boolean>(false);
  const [areChoicesFromSnow, setAreChoicesFromSnow] = useState<boolean>(false);
  const [isFetchFailed, setIsFetchFailed]           = useState<boolean>(false);
  // The human-readable reason the last fetch failed (e.g. "401", "30s timeout").
  // Cleared at the start of every new attempt so stale messages don't linger.
  const [fetchErrorMessage, setFetchErrorMessage]   = useState<string | null>(null);
  // Bumped by retryFetch() to force a re-fetch even when isRelayConnected hasn't changed.
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Subscribe to relay connection status so we can auto-retry when it transitions to connected.
  const isRelayConnected = useConnectionStore(
    (storeState) => storeState.relayBridgeStatus?.isConnected ?? false,
  );
  const hasRelaySessionToken = useConnectionStore(
    (storeState) => storeState.relayBridgeStatus?.hasSessionToken ?? false,
  );

  useEffect(() => {
    // Don't attempt while relay is disconnected — snowFetch will throw immediately and
    // we'd be left in a permanent error state until the user manually retried.
    if (!isRelayConnected) return;
    if (!hasRelaySessionToken) return;

    // Skip if we already have fresh data from SNow to avoid redundant API calls on relay
    // status changes (e.g. relay briefly dropping and reconnecting).
    if (areChoicesFromSnow) return;

    let isCancelled = false;

    async function fetchChoiceOptions() {
      // Clear any previous failure state immediately so the UI shows "Loading…" rather than
      // displaying the old error banner while the new request is still in flight.
      setIsFetchFailed(false);
      setFetchErrorMessage(null);
      setIsLoadingChoices(true);
      try {
        const serviceNowChoiceOptions = await fetchChoiceOptionsFromServiceNow();
        if (isCancelled) return;

        setChoiceOptions(serviceNowChoiceOptions);
        setAreChoicesFromSnow(true);
        setIsFetchFailed(false);
      } catch (fetchError) {
        // Relay connected but SNow returned an error (expired session, timeout, etc.).
        // Capture the message so the user sees "401" or "timed out" rather than a generic banner.
        if (!isCancelled) {
          const errorText = fetchError instanceof Error ? fetchError.message : String(fetchError);
          setIsFetchFailed(true);
          setFetchErrorMessage(errorText);
        }
      } finally {
        if (!isCancelled) setIsLoadingChoices(false);
      }
    }

    void fetchChoiceOptions();

    return () => { isCancelled = true; };
  }, [isRelayConnected, hasRelaySessionToken, areChoicesFromSnow, fetchTrigger]);

  /** Forces a re-fetch of SNow metadata and shows the loading indicator immediately. */
  const retryFetch = useCallback(() => {
    setIsFetchFailed(false);
    setFetchErrorMessage(null);
    setAreChoicesFromSnow(false);
    setFetchTrigger((previousTrigger) => previousTrigger + 1);
  }, []);

  return {
    choiceOptions,
    isLoadingChoices,
    areChoicesFromSnow,
    isFetchFailed,
    fetchErrorMessage,
    isRelayConnected,
    hasRelaySessionToken,
    retryFetch,
  };
}
