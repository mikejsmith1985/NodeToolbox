// useChangeModifier — Manages state for the Change Modifier workflow.
// Lets users fetch an existing CHG by key, modify fields, manage CTASKs, and save back to ServiceNow.

import { useCallback, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type {
  ChgBasicInfo,
  ChgPlanningAssessment,
  ChgPlanningContent,
  CtaskTemplateData,
} from './useCrgState.ts';

const EMPTY_VALUE = '';

/** Represents a CTASK record with edit state tracking. */
export interface CtaskEditForm extends CtaskTemplateData {
  sysId: string;
  number: string;
}

/** Represents a fetched Change Request record with all fields. */
export interface ChangeModifierRecord {
  sysId: string;
  number: string;
  shortDescription: string;
  description: string;
  justification: string;
  riskImpactAnalysis: string;
  chgBasicInfo: ChgBasicInfo;
  chgPlanningAssessment: ChgPlanningAssessment;
  chgPlanningContent: ChgPlanningContent;
}

export interface ChangeModifierState {
  changeKey: string;
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  isSavingSuccess: boolean;
  change: ChangeModifierRecord | null;
  ctasks: CtaskEditForm[];
  isDirty: boolean;
}

export interface UseChangeModifierResult {
  state: ChangeModifierState;
  actions: {
    fetchChangeByKey(changeKey: string): Promise<void>;
    updateChangeField(fieldName: string, value: unknown): void;
    addCtask(ctaskData: CtaskEditForm): void;
    updateCtask(ctaskId: string, ctaskData: CtaskEditForm): void;
    removeCtask(ctaskId: string): void;
    saveChange(): Promise<void>;
  };
}

interface SnowChangeRecord {
  sys_id?: unknown;
  number?: unknown;
  short_description?: unknown;
  description?: unknown;
  justification?: unknown;
  risk_impact_analysis?: unknown;
  category?: unknown;
  type?: unknown;
  u_environment?: unknown;
  requested_by?: unknown;
  cmdb_ci?: unknown;
  assignment_group?: unknown;
  assigned_to?: unknown;
  change_manager?: unknown;
  u_tester?: unknown;
  u_service_manager?: unknown;
  u_expedited?: unknown;
  impact?: unknown;
  u_availability_impact?: unknown;
  u_change_tested?: unknown;
  u_impacted_persons_aware?: unknown;
  u_performed_previously?: unknown;
  u_success_probability?: unknown;
  u_can_be_backed_out?: unknown;
  implementation_plan?: unknown;
  backout_plan?: unknown;
  test_plan?: unknown;
  [key: string]: unknown;
}

interface SnowCtaskRecord {
  sys_id?: unknown;
  number?: unknown;
  short_description?: unknown;
  description?: unknown;
  assignment_group?: unknown;
  assigned_to?: unknown;
  planned_start_date?: unknown;
  planned_end_date?: unknown;
  close_notes?: unknown;
  [key: string]: unknown;
}

/**
 * Extracts a human-readable string from a SNow field.
 * Handles both { value, display_value } and plain string formats.
 */
function extractStringValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    if ('display_value' in snowField) return String(snowField.display_value ?? EMPTY_VALUE);
    if ('value' in snowField) return String(snowField.value ?? EMPTY_VALUE);
  }
  return EMPTY_VALUE;
}

/**
 * Extracts the stored SNow value for choice fields.
 */
function extractChoiceValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    const internalValue = String(snowField.value ?? EMPTY_VALUE).trim();
    if (internalValue) return internalValue;

    const displayValue = String(snowField.display_value ?? EMPTY_VALUE).trim();
    if (displayValue) return displayValue;
  }
  return EMPTY_VALUE;
}

/**
 * Extracts a SnowReference (sys_id + display name) from a SNow reference field.
 */
function extractSnowReference(field: unknown): { sysId: string; displayName: string } {
  if (typeof field === 'string') {
    return { sysId: EMPTY_VALUE, displayName: field };
  }
  if (!field || typeof field !== 'object') return { sysId: EMPTY_VALUE, displayName: EMPTY_VALUE };
  const snowField = field as Record<string, unknown>;
  const sysId = String(snowField.value ?? EMPTY_VALUE);
  const displayName = String(snowField.display_value ?? EMPTY_VALUE);
  if (!sysId && !displayName) return { sysId: EMPTY_VALUE, displayName: EMPTY_VALUE };
  return { sysId, displayName };
}

function normalizeSnowDateTimeForInput(field: unknown): string {
  const snowDateTime = extractChoiceValue(field) || extractStringValue(field);
  if (!snowDateTime) return EMPTY_VALUE;

  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/.exec(snowDateTime);
  return dateTimeMatch ? `${dateTimeMatch[1]}T${dateTimeMatch[2]}` : snowDateTime;
}

function extractReferenceSysId(field: unknown): string {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const snowField = field as Record<string, unknown>;
    return String(snowField.value ?? EMPTY_VALUE);
  }
  return EMPTY_VALUE;
}

function buildChangeModifierRecordFromSnow(chgRecord: SnowChangeRecord): ChangeModifierRecord {
  return {
    sysId: extractReferenceSysId(chgRecord.sys_id),
    number: extractStringValue(chgRecord.number),
    shortDescription: extractStringValue(chgRecord.short_description),
    description: extractStringValue(chgRecord.description),
    justification: extractStringValue(chgRecord.justification),
    riskImpactAnalysis: extractStringValue(chgRecord.risk_impact_analysis),
    chgBasicInfo: {
      category: extractChoiceValue(chgRecord.category),
      changeType: extractChoiceValue(chgRecord.type),
      environment: extractChoiceValue(chgRecord.u_environment),
      requestedBy: extractSnowReference(chgRecord.requested_by),
      configItem: extractSnowReference(chgRecord.cmdb_ci),
      assignmentGroup: extractSnowReference(chgRecord.assignment_group),
      assignedTo: extractSnowReference(chgRecord.assigned_to),
      changeManager: extractSnowReference(chgRecord.change_manager),
      tester: extractSnowReference(chgRecord.u_tester),
      serviceManager: extractSnowReference(chgRecord.u_service_manager),
      isExpedited: extractChoiceValue(chgRecord.u_expedited) === 'true',
    },
    chgPlanningAssessment: {
      impact: extractChoiceValue(chgRecord.impact),
      systemAvailabilityImplication: extractChoiceValue(chgRecord.u_availability_impact),
      hasBeenTested: extractChoiceValue(chgRecord.u_change_tested),
      impactedPersonsAware: extractChoiceValue(chgRecord.u_impacted_persons_aware),
      hasBeenPerformedPreviously: extractChoiceValue(chgRecord.u_performed_previously),
      successProbability: extractChoiceValue(chgRecord.u_success_probability),
      canBeBackedOut: extractChoiceValue(chgRecord.u_can_be_backed_out),
    },
    chgPlanningContent: {
      implementationPlan: extractStringValue(chgRecord.implementation_plan),
      backoutPlan: extractStringValue(chgRecord.backout_plan),
      testPlan: extractStringValue(chgRecord.test_plan),
    },
  };
}

function buildCtaskEditFormFromRecord(ctaskRecord: SnowCtaskRecord): CtaskEditForm {
  return {
    sysId: extractReferenceSysId(ctaskRecord.sys_id),
    number: extractStringValue(ctaskRecord.number),
    shortDescription: extractStringValue(ctaskRecord.short_description),
    description: extractStringValue(ctaskRecord.description),
    assignmentGroup: extractSnowReference(ctaskRecord.assignment_group),
    assignedTo: extractSnowReference(ctaskRecord.assigned_to),
    plannedStartDate: normalizeSnowDateTimeForInput(ctaskRecord.planned_start_date),
    plannedEndDate: normalizeSnowDateTimeForInput(ctaskRecord.planned_end_date),
    closeNotes: extractStringValue(ctaskRecord.close_notes),
  };
}

async function fetchChangeByKeyFromSnow(changeKey: string): Promise<ChangeModifierRecord | null> {
  const normalizedChangeKey = changeKey.trim().toUpperCase();
  const encodedQuery = encodeURIComponent(`number=${normalizedChangeKey}`);
  const responseData = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_request?sysparm_query=${encodedQuery}&sysparm_limit=1&sysparm_display_value=all`,
  );

  if (!Array.isArray(responseData.result)) {
    return null;
  }
  const matchedChangeRecord = responseData.result[0];
  return matchedChangeRecord && typeof matchedChangeRecord === 'object'
    ? buildChangeModifierRecordFromSnow(matchedChangeRecord as SnowChangeRecord)
    : null;
}

async function fetchChangeTasksByChangeKey(changeKey: string): Promise<CtaskEditForm[]> {
  const normalizedChangeKey = changeKey.trim().toUpperCase();
  const encodedQuery = encodeURIComponent(`change_request.number=${normalizedChangeKey}`);
  const responseData = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_task?sysparm_query=${encodedQuery}&sysparm_limit=100&sysparm_display_value=all`,
  );

  if (!Array.isArray(responseData.result)) {
    return [];
  }

  return responseData.result
    .filter((record): record is SnowCtaskRecord => record !== null && typeof record === 'object')
    .map(buildCtaskEditFormFromRecord);
}

function buildChangeUpdatePayload(change: ChangeModifierRecord): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    short_description: change.shortDescription,
    description: change.description,
    justification: change.justification,
    risk_impact_analysis: change.riskImpactAnalysis,
  };

  if (change.chgBasicInfo.category) payload.category = change.chgBasicInfo.category;
  if (change.chgBasicInfo.changeType) payload.type = change.chgBasicInfo.changeType;
  if (change.chgBasicInfo.environment) payload.u_environment = change.chgBasicInfo.environment;
  if (change.chgBasicInfo.isExpedited) payload.u_expedited = true;

  if (change.chgBasicInfo.requestedBy.sysId) payload.requested_by = change.chgBasicInfo.requestedBy.sysId;
  if (change.chgBasicInfo.configItem.sysId) payload.cmdb_ci = change.chgBasicInfo.configItem.sysId;
  if (change.chgBasicInfo.assignmentGroup.sysId) payload.assignment_group = change.chgBasicInfo.assignmentGroup.sysId;
  if (change.chgBasicInfo.assignedTo.sysId) payload.assigned_to = change.chgBasicInfo.assignedTo.sysId;
  if (change.chgBasicInfo.changeManager.sysId) payload.change_manager = change.chgBasicInfo.changeManager.sysId;
  if (change.chgBasicInfo.tester.sysId) payload.u_tester = change.chgBasicInfo.tester.sysId;
  if (change.chgBasicInfo.serviceManager.sysId) payload.u_service_manager = change.chgBasicInfo.serviceManager.sysId;

  if (change.chgPlanningAssessment.impact) payload.impact = change.chgPlanningAssessment.impact;
  if (change.chgPlanningAssessment.systemAvailabilityImplication) payload.u_availability_impact = change.chgPlanningAssessment.systemAvailabilityImplication;
  if (change.chgPlanningAssessment.hasBeenTested) payload.u_change_tested = change.chgPlanningAssessment.hasBeenTested;
  if (change.chgPlanningAssessment.hasBeenPerformedPreviously) payload.u_performed_previously = change.chgPlanningAssessment.hasBeenPerformedPreviously;
  if (change.chgPlanningAssessment.successProbability) payload.u_success_probability = change.chgPlanningAssessment.successProbability;
  if (change.chgPlanningAssessment.canBeBackedOut) payload.u_can_be_backed_out = change.chgPlanningAssessment.canBeBackedOut;

  if (change.chgPlanningContent.implementationPlan) payload.implementation_plan = change.chgPlanningContent.implementationPlan;
  if (change.chgPlanningContent.backoutPlan) payload.backout_plan = change.chgPlanningContent.backoutPlan;
  if (change.chgPlanningContent.testPlan) payload.test_plan = change.chgPlanningContent.testPlan;

  return payload;
}

async function updateChangeInSnow(change: ChangeModifierRecord): Promise<void> {
  const payload = buildChangeUpdatePayload(change);
  await snowFetch(
    `/api/now/table/change_request/${change.sysId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

async function updateCtaskInSnow(ctask: CtaskEditForm): Promise<void> {
  const payload: Record<string, unknown> = {};

  if (ctask.shortDescription) payload.short_description = ctask.shortDescription;
  if (ctask.description) payload.description = ctask.description;
  if (ctask.assignmentGroup.sysId) payload.assignment_group = ctask.assignmentGroup.sysId;
  if (ctask.assignedTo.sysId) payload.assigned_to = ctask.assignedTo.sysId;
  if (ctask.plannedStartDate) payload.planned_start_date = ctask.plannedStartDate;
  if (ctask.plannedEndDate) payload.planned_end_date = ctask.plannedEndDate;
  if (ctask.closeNotes) payload.close_notes = ctask.closeNotes;

  await snowFetch(
    `/api/now/table/change_task/${ctask.sysId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Manages the Change Modifier workflow state for fetching, editing, and saving
 * an existing ServiceNow Change Request along with its CTASKs.
 */
export function useChangeModifier(): UseChangeModifierResult {
  const [state, setState] = useState<ChangeModifierState>({
    changeKey: EMPTY_VALUE,
    isLoading: false,
    error: null,
    isSaving: false,
    isSavingSuccess: false,
    change: null,
    ctasks: [],
    isDirty: false,
  });

  const fetchChangeByKey = useCallback(async (changeKey: string) => {
    setState((previousState) => ({
      ...previousState,
      changeKey,
      isLoading: true,
      error: null,
      isSavingSuccess: false,
    }));

    try {
      const normalizedChangeKey = changeKey.trim().toUpperCase();
      if (!normalizedChangeKey) {
        setState((previousState) => ({
          ...previousState,
          isLoading: false,
          error: 'Enter a change key (e.g., CHG0123456)',
        }));
        return;
      }

      const fetchedChange = await fetchChangeByKeyFromSnow(normalizedChangeKey);
      if (!fetchedChange) {
        setState((previousState) => ({
          ...previousState,
          isLoading: false,
          error: `Change not found: ${normalizedChangeKey}`,
        }));
        return;
      }

      const fetchedCtasks = await fetchChangeTasksByChangeKey(normalizedChangeKey);

      setState((previousState) => ({
        ...previousState,
        change: fetchedChange,
        ctasks: fetchedCtasks,
        isLoading: false,
        isDirty: false,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to fetch change';
      setState((previousState) => ({
        ...previousState,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, []);

  const updateChangeField = useCallback((fieldName: string, value: unknown) => {
    setState((previousState) => {
      if (!previousState.change) return previousState;

      const changeCopy = { ...previousState.change };
      const parts = fieldName.split('.');

      if (parts.length === 2) {
        const [categoryKey, fieldKey] = parts;
        if (categoryKey === 'chgBasicInfo') {
          changeCopy.chgBasicInfo = {
            ...changeCopy.chgBasicInfo,
            [fieldKey]: value,
          };
        } else if (categoryKey === 'chgPlanningAssessment') {
          changeCopy.chgPlanningAssessment = {
            ...changeCopy.chgPlanningAssessment,
            [fieldKey]: value,
          };
        } else if (categoryKey === 'chgPlanningContent') {
          changeCopy.chgPlanningContent = {
            ...changeCopy.chgPlanningContent,
            [fieldKey]: value,
          };
        }
      } else if (parts.length === 1) {
        (changeCopy as Record<string, unknown>)[fieldName] = value;
      }

      return {
        ...previousState,
        change: changeCopy,
        isDirty: true,
      };
    });
  }, []);

  const addCtask = useCallback((ctaskData: CtaskEditForm) => {
    setState((previousState) => ({
      ...previousState,
      ctasks: [...previousState.ctasks, ctaskData],
      isDirty: true,
    }));
  }, []);

  const updateCtask = useCallback((ctaskId: string, ctaskData: CtaskEditForm) => {
    setState((previousState) => ({
      ...previousState,
      ctasks: previousState.ctasks.map((ctask) =>
        ctask.sysId === ctaskId ? ctaskData : ctask,
      ),
      isDirty: true,
    }));
  }, []);

  const removeCtask = useCallback((ctaskId: string) => {
    setState((previousState) => ({
      ...previousState,
      ctasks: previousState.ctasks.filter((ctask) => ctask.sysId !== ctaskId),
      isDirty: true,
    }));
  }, []);

  const saveChange = useCallback(async () => {
    if (!state.change) {
      setState((previousState) => ({
        ...previousState,
        error: 'No change loaded to save',
      }));
      return;
    }

    setState((previousState) => ({
      ...previousState,
      isSaving: true,
      error: null,
      isSavingSuccess: false,
    }));

    try {
      await updateChangeInSnow(state.change);

      for (const ctask of state.ctasks) {
        try {
          await updateCtaskInSnow(ctask);
        } catch (ctaskError) {
          const ctaskErrorMsg = ctaskError instanceof Error ? ctaskError.message : 'CTASK update failed';
          throw new Error(`${state.change.number} updated, but CTASK ${ctask.number} update failed: ${ctaskErrorMsg}`, {
            cause: ctaskError,
          });
        }
      }

      setState((previousState) => ({
        ...previousState,
        isSaving: false,
        isSavingSuccess: true,
        isDirty: false,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Save failed';
      setState((previousState) => ({
        ...previousState,
        isSaving: false,
        error: errorMessage,
      }));
    }
  }, [state.change, state.ctasks]);

  const actions = {
    fetchChangeByKey,
    updateChangeField,
    addCtask,
    updateCtask,
    removeCtask,
    saveChange,
  };

  return { state, actions };
}
