// useReleaseManagement — State and data-loading logic for the Release Management tab.

import { useCallback, useMemo, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { ChangeRequest } from '../../../types/snow.ts';

type ActivityLogLevel = 'info' | 'success' | 'warning' | 'error';

interface ActivityLogEntry {
  timestamp: string;
  message: string;
  level: ActivityLogLevel;
}

interface ReleaseManagementState {
  chgNumber: string;
  loadedChg: ChangeRequest | null;
  isLoadingChg: boolean;
  loadError: string | null;
  myActiveChanges: ChangeRequest[];
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
const LOAD_CHANGE_FAILURE_MESSAGE = 'Failed to load change request';
const LOAD_MY_CHANGES_FAILURE_MESSAGE = 'Failed to load active changes';
const MY_ACTIVE_CHANGES_PATH = '/api/now/table/change_request?assigned_to=current_user&state=-2^ORstate=-1&sysparm_limit=20';
const CHANGE_NUMBER_REQUIRED_MESSAGE = 'Change number is required.';

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

function extractLoadedChange(changeResponse: ChangeRequest | { result: ChangeRequest[] }): ChangeRequest | null {
  if ('result' in changeResponse) {
    return changeResponse.result[0] ?? null;
  }

  return changeResponse;
}

/**
 * Manages Release Management state so the tab can load a single change, list active work, and keep an operator-friendly activity log.
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
    if (!state.chgNumber) {
      setState((previousState) => ({ ...previousState, loadError: CHANGE_NUMBER_REQUIRED_MESSAGE }));
      return;
    }

    setState((previousState) => ({ ...previousState, isLoadingChg: true, loadError: null }));

    try {
      const changeResponse = await snowFetch<ChangeRequest | { result: ChangeRequest[] }>(
        `/api/now/table/change_request?number=${state.chgNumber}`,
      );
      const loadedChg = extractLoadedChange(changeResponse);
      setState((previousState) => ({
        ...previousState,
        loadedChg,
        isLoadingChg: false,
        loadError: loadedChg ? null : `No change request found for ${state.chgNumber}.`,
        activityLog: loadedChg
          ? [createLogEntry(`Loaded change ${loadedChg.number}.`, 'success'), ...previousState.activityLog]
          : [createLogEntry(`No change request found for ${state.chgNumber}.`, 'warning'), ...previousState.activityLog],
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
      const myChangesResponse = await snowFetch<{ result: ChangeRequest[] }>(MY_ACTIVE_CHANGES_PATH);
      setState((previousState) => ({
        ...previousState,
        myActiveChanges: myChangesResponse.result,
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
