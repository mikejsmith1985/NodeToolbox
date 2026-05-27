// useReleaseManagement — State and data-loading logic for the Release Management tab.

import { useCallback, useMemo, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { ChangeRequest, SnowUser } from '../../../types/snow.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

type ActivityLogLevel = 'info' | 'success' | 'warning' | 'error';

interface ActivityLogEntry {
  timestamp: string;
  message: string;
  level: ActivityLogLevel;
}

interface ActiveChangeSummary {
  sysId: string;
  number: string;
  shortDescription: string;
}

interface ReleaseManagementState {
  chgNumber: string;
  loadedChg: ChangeRequest | null;
  isLoadingChg: boolean;
  loadError: string | null;
  myActiveChanges: ActiveChangeSummary[];
  isLoadingMyChanges: boolean;
  myChangesError: string | null;
  activityLog: ActivityLogEntry[];
}

interface ReleaseManagementActions {
  setChgNumber: (chgNumber: string) => void;
  loadChg: () => Promise<void>;
  loadMyActiveChanges: () => Promise<void>;
  appendLogEntry: (message: string, level: ActivityLogLevel) => void;
  clearLog: () => void;
  clearLoadedChg: () => void;
}

const EMPTY_VALUE = '';
const CHANGE_TABLE_PATH = '/api/now/table/change_request';
const CHANGE_LOOKUP_FIELDS =
  'sys_id,number,short_description,state,assigned_to,planned_start_date,planned_end_date,risk,impact';
const ACTIVE_CHANGE_FIELDS = 'sys_id,number,short_description';
const CHANGE_LOOKUP_LIMIT = 1;
const ACTIVE_CHANGE_LIMIT = 20;
const ACTIVE_CHANGE_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';
const LOAD_CHANGE_FAILURE_MESSAGE = 'Failed to load change request';
const LOAD_MY_CHANGES_FAILURE_MESSAGE = 'Failed to load active changes';
const CHANGE_NUMBER_REQUIRED_MESSAGE = 'Change number is required.';

type ServiceNowFieldValue = string | { value?: unknown; display_value?: unknown };
type ServiceNowChangeRecord = Record<string, ServiceNowFieldValue | undefined>;

interface ServiceNowChangeQueryResponse {
  result: ServiceNowChangeRecord[];
}

function createInitialReleaseManagementState(): ReleaseManagementState {
  return {
    chgNumber: EMPTY_VALUE,
    loadedChg: null,
    isLoadingChg: false,
    loadError: null,
    myActiveChanges: [],
    isLoadingMyChanges: false,
    myChangesError: null,
    activityLog: [],
  };
}

function createLogEntry(message: string, level: ActivityLogLevel): ActivityLogEntry {
  return {
    timestamp: new Date().toISOString(),
    message,
    level,
  };
}

function buildChangeLookupPath(changeNumber: string): string {
  const encodedQuery = encodeURIComponent(`number=${changeNumber}`);
  return (
    `${CHANGE_TABLE_PATH}?sysparm_query=${encodedQuery}` +
    `&sysparm_limit=${CHANGE_LOOKUP_LIMIT}` +
    `&sysparm_fields=${CHANGE_LOOKUP_FIELDS}` +
    '&sysparm_display_value=all'
  );
}

function buildMyActiveChangesPath(): string {
  const encodedQuery = encodeURIComponent(ACTIVE_CHANGE_QUERY);
  return (
    `${CHANGE_TABLE_PATH}?sysparm_query=${encodedQuery}` +
    `&sysparm_limit=${ACTIVE_CHANGE_LIMIT}` +
    `&sysparm_fields=${ACTIVE_CHANGE_FIELDS}` +
    '&sysparm_display_value=all'
  );
}

function extractServiceNowFieldValue(fieldValue: ServiceNowFieldValue | undefined): string {
  if (fieldValue === undefined) {
    return EMPTY_VALUE;
  }

  if (typeof fieldValue === 'string') {
    return normalizeRichTextToPlainText(fieldValue);
  }

  return normalizeRichTextToPlainText(fieldValue.display_value ?? fieldValue.value ?? EMPTY_VALUE);
}

function extractServiceNowReference(fieldValue: ServiceNowFieldValue | undefined): SnowUser | null {
  if (fieldValue === undefined) {
    return null;
  }

  if (typeof fieldValue === 'string') {
    const displayName = normalizeRichTextToPlainText(fieldValue);
    return displayName
      ? { sysId: EMPTY_VALUE, name: displayName, email: EMPTY_VALUE }
      : null;
  }

  const sysId = String(fieldValue.value ?? EMPTY_VALUE);
  const name = normalizeRichTextToPlainText(fieldValue.display_value ?? fieldValue.value ?? EMPTY_VALUE);
  if (!sysId && !name) {
    return null;
  }

  return { sysId, name, email: EMPTY_VALUE };
}

function mapChangeRecord(changeRecord: ServiceNowChangeRecord): ChangeRequest {
  return {
    sysId: extractServiceNowFieldValue(changeRecord.sys_id),
    number: extractServiceNowFieldValue(changeRecord.number),
    shortDescription: extractServiceNowFieldValue(changeRecord.short_description),
    state: extractServiceNowFieldValue(changeRecord.state),
    assignedTo: extractServiceNowReference(changeRecord.assigned_to),
    plannedStartDate: extractServiceNowFieldValue(changeRecord.planned_start_date),
    plannedEndDate: extractServiceNowFieldValue(changeRecord.planned_end_date),
    risk: extractServiceNowFieldValue(changeRecord.risk),
    impact: extractServiceNowFieldValue(changeRecord.impact),
  };
}

function mapActiveChangeSummary(changeRecord: ServiceNowChangeRecord): ActiveChangeSummary {
  return {
    sysId: extractServiceNowFieldValue(changeRecord.sys_id),
    number: extractServiceNowFieldValue(changeRecord.number),
    shortDescription: extractServiceNowFieldValue(changeRecord.short_description),
  };
}

/**
 * Manages Release Management state so the tab can load a single change, list active work,
 * and keep an operator-friendly activity log. Release Management uses the same relay-backed
 * SNow fetch path as the other CHG tools so browser-authenticated sessions can load data.
 */
export function useReleaseManagement(): {
  state: ReleaseManagementState;
  actions: ReleaseManagementActions;
} {
  const [state, setState] = useState<ReleaseManagementState>(() => createInitialReleaseManagementState());

  const appendLogEntry = useCallback((message: string, level: ActivityLogLevel) => {
    const nextLogEntry = createLogEntry(message, level);
    setState((previousState) => ({
      ...previousState,
      activityLog: [nextLogEntry, ...previousState.activityLog],
    }));
  }, []);

  const setChgNumber = useCallback((chgNumber: string) => {
    setState((previousState) => ({ ...previousState, chgNumber: chgNumber.toUpperCase() }));
  }, []);

  const loadChg = useCallback(async () => {
    const normalizedChangeNumber = state.chgNumber.trim().toUpperCase();
    if (!normalizedChangeNumber) {
      setState((previousState) => ({ ...previousState, loadError: CHANGE_NUMBER_REQUIRED_MESSAGE }));
      return;
    }

    setState((previousState) => ({ ...previousState, isLoadingChg: true, loadError: null }));

    try {
      const changeResponse = await snowFetch<ServiceNowChangeQueryResponse>(buildChangeLookupPath(normalizedChangeNumber));
      const loadedChg = changeResponse.result[0] ? mapChangeRecord(changeResponse.result[0]) : null;
      setState((previousState) => ({
        ...previousState,
        loadedChg,
        isLoadingChg: false,
        loadError: loadedChg ? null : `No change request found for ${normalizedChangeNumber}.`,
        activityLog: loadedChg
          ? [createLogEntry(`Loaded change ${loadedChg.number}.`, 'success'), ...previousState.activityLog]
          : [createLogEntry(`No change request found for ${normalizedChangeNumber}.`, 'warning'), ...previousState.activityLog],
      }));
    } catch (unknownError) {
      const loadError = unknownError instanceof Error ? unknownError.message : LOAD_CHANGE_FAILURE_MESSAGE;
      setState((previousState) => ({
        ...previousState,
        isLoadingChg: false,
        loadError,
        activityLog: [createLogEntry(loadError, 'error'), ...previousState.activityLog],
      }));
    }
  }, [state.chgNumber]);

  const loadMyActiveChanges = useCallback(async () => {
    setState((previousState) => ({ ...previousState, isLoadingMyChanges: true, myChangesError: null }));

    try {
      const myChangesResponse = await snowFetch<ServiceNowChangeQueryResponse>(buildMyActiveChangesPath());
      setState((previousState) => ({
        ...previousState,
        myActiveChanges: myChangesResponse.result
          .map((changeRecord) => mapActiveChangeSummary(changeRecord))
          .filter((changeSummary) => (
            changeSummary.sysId !== ''
            && changeSummary.number !== ''
            && changeSummary.shortDescription !== ''
          )),
        isLoadingMyChanges: false,
        myChangesError: null,
        activityLog: [createLogEntry('Loaded My Active Changes.', 'info'), ...previousState.activityLog],
      }));
    } catch (unknownError) {
      const myChangesError = unknownError instanceof Error ? unknownError.message : LOAD_MY_CHANGES_FAILURE_MESSAGE;
      setState((previousState) => ({
        ...previousState,
        isLoadingMyChanges: false,
        myChangesError,
        activityLog: [createLogEntry(myChangesError, 'error'), ...previousState.activityLog],
      }));
    }
  }, []);

  const clearLog = useCallback(() => {
    setState((previousState) => ({ ...previousState, activityLog: [] }));
  }, []);

  const clearLoadedChg = useCallback(() => {
    setState((previousState) => ({ ...previousState, loadedChg: null, loadError: null }));
  }, []);

  const actions = useMemo<ReleaseManagementActions>(() => {
    return {
      setChgNumber,
      loadChg,
      loadMyActiveChanges,
      appendLogEntry,
      clearLog,
      clearLoadedChg,
    };
  }, [appendLogEntry, clearLoadedChg, clearLog, loadChg, loadMyActiveChanges, setChgNumber]);

  return { state, actions };
}
