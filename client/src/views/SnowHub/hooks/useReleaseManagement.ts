// useReleaseManagement — State, alert evaluation, and data-loading logic for Release Management.

import { useCallback, useMemo, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { ChangeRequest, SnowUser } from '../../../types/snow.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

type ActivityLogLevel = 'info' | 'success' | 'warning' | 'error';
type AlertSeverity = 'healthy' | 'warning' | 'error';

interface ActivityLogEntry {
  timestamp: string;
  message: string;
  level: ActivityLogLevel;
}

interface ReleaseMonitorSettings {
  shouldAlertOnPlannedStartMiss: boolean;
  shouldAlertOnPlannedEndMiss: boolean;
}

interface ActiveChangeSummary {
  sysId: string;
  number: string;
  shortDescription: string;
  state: string;
  plannedStartDate: string;
  plannedEndDate: string;
  alertSeverity: AlertSeverity;
  alertMessage: string | null;
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
  monitorSettings: ReleaseMonitorSettings;
}

interface ReleaseManagementActions {
  setChgNumber: (chgNumber: string) => void;
  loadChg: () => Promise<void>;
  loadMyActiveChanges: () => Promise<void>;
  appendLogEntry: (message: string, level: ActivityLogLevel) => void;
  clearLog: () => void;
  clearLoadedChg: () => void;
  setMonitorSetting: <SettingKey extends keyof ReleaseMonitorSettings>(
    settingKey: SettingKey,
    settingValue: ReleaseMonitorSettings[SettingKey],
  ) => void;
}

const EMPTY_VALUE = '';
const RELEASE_MONITOR_SETTINGS_STORAGE_KEY = 'tbx-release-monitor-settings';
const CHANGE_TABLE_PATH = '/api/now/table/change_request';
// SNow change_request table stores schedule dates as start_date and end_date (not planned_*)
const CHANGE_LOOKUP_FIELDS =
  'sys_id,number,short_description,state,assigned_to,start_date,end_date,risk,impact';
const ACTIVE_CHANGE_FIELDS = 'sys_id,number,short_description,state,start_date,end_date';
const CHANGE_LOOKUP_LIMIT = 1;
const ACTIVE_CHANGE_LIMIT = 20;
const ACTIVE_CHANGE_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';
const LOAD_CHANGE_FAILURE_MESSAGE = 'Failed to load change request';
const LOAD_MY_CHANGES_FAILURE_MESSAGE = 'Failed to load active changes';
const CHANGE_NUMBER_REQUIRED_MESSAGE = 'Change number is required.';
const START_MILESTONE_ALERT_MESSAGE = 'Planned start has passed and this change has not started.';
const END_MILESTONE_ALERT_MESSAGE = 'Planned end has passed and this change is not in a completed state.';
const START_ALERT_LOG_TEMPLATE = 'Start milestone missed for';
const END_ALERT_LOG_TEMPLATE = 'End milestone missed for';
const RECOVERY_LOG_TEMPLATE = 'Recovered to healthy status for';
const ALERT_STATE_COMPLETED_KEYWORDS = ['closed', 'complete', 'completed', 'review', 'cancelled', 'canceled'] as const;
const ALERT_STATE_IN_PROGRESS_KEYWORDS = ['implement', 'in progress', 'progress', 'work in progress'] as const;

const DEFAULT_RELEASE_MONITOR_SETTINGS: ReleaseMonitorSettings = {
  shouldAlertOnPlannedStartMiss: true,
  shouldAlertOnPlannedEndMiss: true,
};

type ServiceNowFieldValue = string | { value?: unknown; display_value?: unknown };
type ServiceNowChangeRecord = Record<string, ServiceNowFieldValue | undefined>;

interface ServiceNowChangeQueryResponse {
  result: ServiceNowChangeRecord[];
}

function parseDateTimeFromServiceNow(dateTimeText: string): number | null {
  const trimmedDateTime = dateTimeText.trim();
  if (trimmedDateTime === EMPTY_VALUE) {
    return null;
  }

  const isoCandidate = trimmedDateTime.includes('T')
    ? trimmedDateTime
    : trimmedDateTime.replace(' ', 'T');
  const parsedMilliseconds = Date.parse(isoCandidate);
  return Number.isNaN(parsedMilliseconds) ? null : parsedMilliseconds;
}

function hasKeywordMatch(sourceText: string, matchKeywords: readonly string[]): boolean {
  const normalizedSourceText = sourceText.toLowerCase();
  return matchKeywords.some((keyword) => normalizedSourceText.includes(keyword));
}

function resolveAlertSeverity(
  activeChangeSummary: Pick<ActiveChangeSummary, 'state' | 'plannedStartDate' | 'plannedEndDate'>,
  monitorSettings: ReleaseMonitorSettings,
): { severity: AlertSeverity; message: string | null; logPrefix: string | null } {
  const currentTimeMs = Date.now();
  const plannedEndTimeMs = parseDateTimeFromServiceNow(activeChangeSummary.plannedEndDate);
  const plannedStartTimeMs = parseDateTimeFromServiceNow(activeChangeSummary.plannedStartDate);
  const hasReachedCompletedState = hasKeywordMatch(activeChangeSummary.state, ALERT_STATE_COMPLETED_KEYWORDS);
  const hasReachedStartedState = hasKeywordMatch(activeChangeSummary.state, ALERT_STATE_IN_PROGRESS_KEYWORDS) || hasReachedCompletedState;

  const hasMissedPlannedEndMilestone =
    monitorSettings.shouldAlertOnPlannedEndMiss
    && plannedEndTimeMs !== null
    && currentTimeMs > plannedEndTimeMs
    && !hasReachedCompletedState;
  if (hasMissedPlannedEndMilestone) {
    return { severity: 'error', message: END_MILESTONE_ALERT_MESSAGE, logPrefix: END_ALERT_LOG_TEMPLATE };
  }

  const hasMissedPlannedStartMilestone =
    monitorSettings.shouldAlertOnPlannedStartMiss
    && plannedStartTimeMs !== null
    && currentTimeMs > plannedStartTimeMs
    && !hasReachedStartedState;
  if (hasMissedPlannedStartMilestone) {
    return { severity: 'warning', message: START_MILESTONE_ALERT_MESSAGE, logPrefix: START_ALERT_LOG_TEMPLATE };
  }

  return { severity: 'healthy', message: null, logPrefix: null };
}

function appendTransitionLogs(
  previousSummaries: ActiveChangeSummary[],
  nextSummaries: ActiveChangeSummary[],
): ActivityLogEntry[] {
  const previousSeverityByChangeId = new Map(
    previousSummaries.map((changeSummary) => [changeSummary.sysId, changeSummary.alertSeverity]),
  );

  const transitionLogs: ActivityLogEntry[] = [];
  for (const nextSummary of nextSummaries) {
    const previousSeverity = previousSeverityByChangeId.get(nextSummary.sysId) ?? 'healthy';
    const hasTransitionedToAlert =
      previousSeverity === 'healthy'
      && (nextSummary.alertSeverity === 'warning' || nextSummary.alertSeverity === 'error');
    if (hasTransitionedToAlert) {
      const prefix = nextSummary.alertSeverity === 'error' ? END_ALERT_LOG_TEMPLATE : START_ALERT_LOG_TEMPLATE;
      const alertLogLevel: ActivityLogLevel = nextSummary.alertSeverity === 'error' ? 'error' : 'warning';
      transitionLogs.push(createLogEntry(`${prefix} ${nextSummary.number}.`, alertLogLevel));
      continue;
    }

    const hasRecoveredToHealthy =
      (previousSeverity === 'warning' || previousSeverity === 'error')
      && nextSummary.alertSeverity === 'healthy';
    if (hasRecoveredToHealthy) {
      transitionLogs.push(createLogEntry(`${RECOVERY_LOG_TEMPLATE} ${nextSummary.number}.`, 'success'));
    }
  }

  return transitionLogs;
}

function readStoredReleaseMonitorSettings(): ReleaseMonitorSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_RELEASE_MONITOR_SETTINGS;
  }

  const serializedSettings = window.localStorage.getItem(RELEASE_MONITOR_SETTINGS_STORAGE_KEY);
  if (serializedSettings === null) {
    return DEFAULT_RELEASE_MONITOR_SETTINGS;
  }

  try {
    const parsedSettings = JSON.parse(serializedSettings) as Partial<ReleaseMonitorSettings>;
    return {
      shouldAlertOnPlannedStartMiss:
        parsedSettings.shouldAlertOnPlannedStartMiss ?? DEFAULT_RELEASE_MONITOR_SETTINGS.shouldAlertOnPlannedStartMiss,
      shouldAlertOnPlannedEndMiss:
        parsedSettings.shouldAlertOnPlannedEndMiss ?? DEFAULT_RELEASE_MONITOR_SETTINGS.shouldAlertOnPlannedEndMiss,
    };
  } catch {
    return DEFAULT_RELEASE_MONITOR_SETTINGS;
  }
}

function writeStoredReleaseMonitorSettings(monitorSettings: ReleaseMonitorSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(RELEASE_MONITOR_SETTINGS_STORAGE_KEY, JSON.stringify(monitorSettings));
}

function createInitialReleaseManagementState(): ReleaseManagementState {
  const initialMonitorSettings = readStoredReleaseMonitorSettings();
  return {
    chgNumber: EMPTY_VALUE,
    loadedChg: null,
    isLoadingChg: false,
    loadError: null,
    myActiveChanges: [],
    isLoadingMyChanges: false,
    myChangesError: null,
    activityLog: [],
    monitorSettings: initialMonitorSettings,
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

  const displayValue = normalizeRichTextToPlainText(fieldValue.display_value ?? EMPTY_VALUE).trim();
  if (displayValue !== EMPTY_VALUE) {
    return displayValue;
  }

  return normalizeRichTextToPlainText(fieldValue.value ?? EMPTY_VALUE);
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
    plannedStartDate: extractServiceNowFieldValue(changeRecord.start_date),
    plannedEndDate: extractServiceNowFieldValue(changeRecord.end_date),
    risk: extractServiceNowFieldValue(changeRecord.risk),
    impact: extractServiceNowFieldValue(changeRecord.impact),
  };
}

function mapActiveChangeSummary(changeRecord: ServiceNowChangeRecord): ActiveChangeSummary {
  return {
    sysId: extractServiceNowFieldValue(changeRecord.sys_id),
    number: extractServiceNowFieldValue(changeRecord.number),
    shortDescription: extractServiceNowFieldValue(changeRecord.short_description),
    state: extractServiceNowFieldValue(changeRecord.state),
    plannedStartDate: extractServiceNowFieldValue(changeRecord.start_date),
    plannedEndDate: extractServiceNowFieldValue(changeRecord.end_date),
    alertSeverity: 'healthy',
    alertMessage: null,
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
      setState((previousState) => {
        const activeChangeSummaries = myChangesResponse.result
          .map((changeRecord) => mapActiveChangeSummary(changeRecord))
          .filter((changeSummary) => (
            changeSummary.sysId !== ''
            && changeSummary.number !== ''
            && changeSummary.shortDescription !== ''
          ));

        const evaluatedSummaries = activeChangeSummaries.map((changeSummary) => {
          const alertResolution = resolveAlertSeverity(changeSummary, previousState.monitorSettings);
          return {
            ...changeSummary,
            alertSeverity: alertResolution.severity,
            alertMessage: alertResolution.message,
          };
        });

        const transitionLogs = appendTransitionLogs(previousState.myActiveChanges, evaluatedSummaries);
        return {
          ...previousState,
          myActiveChanges: evaluatedSummaries,
          isLoadingMyChanges: false,
          myChangesError: null,
          activityLog: [
            ...transitionLogs,
            createLogEntry('Loaded My Active Changes.', 'info'),
            ...previousState.activityLog,
          ],
        };
      });
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

  const setMonitorSetting = useCallback(<SettingKey extends keyof ReleaseMonitorSettings>(
    settingKey: SettingKey,
    settingValue: ReleaseMonitorSettings[SettingKey],
  ) => {
    setState((previousState) => {
      const nextMonitorSettings = {
        ...previousState.monitorSettings,
        [settingKey]: settingValue,
      };
      writeStoredReleaseMonitorSettings(nextMonitorSettings);
      return {
        ...previousState,
        myActiveChanges: previousState.myActiveChanges.map((changeSummary) => {
          const alertResolution = resolveAlertSeverity(changeSummary, nextMonitorSettings);
          return {
            ...changeSummary,
            alertSeverity: alertResolution.severity,
            alertMessage: alertResolution.message,
          };
        }),
        monitorSettings: nextMonitorSettings,
      };
    });
  }, []);

  const actions = useMemo<ReleaseManagementActions>(() => {
    return {
      setChgNumber,
      loadChg,
      loadMyActiveChanges,
      appendLogEntry,
      clearLog,
      clearLoadedChg,
      setMonitorSetting,
    };
  }, [appendLogEntry, clearLoadedChg, clearLog, loadChg, loadMyActiveChanges, setChgNumber, setMonitorSetting]);

  return { state, actions };
}
