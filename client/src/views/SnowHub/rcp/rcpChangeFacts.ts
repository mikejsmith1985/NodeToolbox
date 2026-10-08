// rcpChangeFacts.ts — Reads what the RCP rules judge off an existing change, fresh from ServiceNow (GH #415).
//
// The window rule is about Central Time, so the planned dates are read as ServiceNow stores them — UTC, in
// the record's raw value — rather than as any screen happened to display them. The CI's owner, the change's
// attachments and its CTASK estimates each come from their own read; one that fails (an ACL, a timeout) is
// reported as unknown so its rule asks a person to confirm, rather than failing the whole checklist.

import { snowFetch } from '../../../services/snowApi.ts';
import { fetchReviewedCtasks } from '../chgFormula/ctaskReviewApi.ts';
import { readEstimatesFromText, sumEstimateMinutes } from '../ctaskDurations.ts';
import { inferEnvironmentKeyFromValue } from '../hooks/environmentKeyInference.ts';
import { extractChoiceValue, extractSnowReference, extractStringValue, type SnowReference } from '../hooks/useCrgState.ts';
import {
  checkApprovalAttached,
  checkImplementationWindow,
  checkJustification,
  checkLeadTime,
  checkRequestedByIsDirector,
  describeCentralWindow,
  type RcpCheckResult,
} from './rcpRules.ts';
import type { RcpApprovalEmailContext } from './rcpApprovalEmail.ts';

/** Everything the five RCP rules judge about one change. */
export interface RcpChangeFacts {
  changeSysId: string;
  changeNumber: string;
  shortDescription: string;
  stateLabel: string;
  environmentLabel: string;
  isProduction: boolean;
  riskLabel: string;
  plannedStartUtc: string | null;
  plannedEndUtc: string | null;
  /** Implementation + validation + backout across the change's tasks; null when no task carries estimates. */
  totalEstimateMinutes: number | null;
  requestedBy: SnowReference;
  configItem: SnowReference;
  /** The CI's owner; null when it could not be read. */
  ciOwner: SnowReference | null;
  /** Names of the files attached to the change; null when they could not be read. */
  attachmentFileNames: string[] | null;
  justification: string;
  backoutPlan: string;
}

const CHANGE_FACT_FIELDS = [
  'sys_id', 'number', 'state', 'risk', 'start_date', 'end_date', 'requested_by', 'cmdb_ci',
  'justification', 'short_description', 'backout_plan', 'u_environment',
].join(',');
// A ServiceNow date-time value, which the Table API stores and returns in UTC.
const SNOW_UTC_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;
const PRODUCTION_ENVIRONMENT_KEYS = new Set(['prd', 'pfix']);

/** A record's raw UTC date-time as an ISO instant, or null when it holds none. */
function readUtcInstant(field: unknown): string | null {
  const rawValue = typeof field === 'object' && field !== null ? String((field as { value?: unknown }).value ?? '') : String(field ?? '');
  const dateTimeMatch = SNOW_UTC_DATE_TIME_PATTERN.exec(rawValue.trim());
  return dateTimeMatch ? `${dateTimeMatch[1]}T${dateTimeMatch[2]}Z` : null;
}

/** The CI's owner (owned_by, else managed_by), or null when the CI could not be read. */
async function fetchCiOwner(ciSysId: string): Promise<SnowReference | null> {
  if (!ciSysId) return null;
  try {
    const reply = await snowFetch<{ result?: Record<string, unknown> }>(
      `/api/now/table/cmdb_ci/${ciSysId}?sysparm_display_value=all&sysparm_fields=owned_by,managed_by`,
      { method: 'GET' },
    );
    const ownedBy = extractSnowReference(reply?.result?.owned_by);
    return ownedBy.sysId || ownedBy.displayName ? ownedBy : extractSnowReference(reply?.result?.managed_by);
  } catch {
    return null;
  }
}

/** The names of the files attached to a change, or null when they could not be read. */
async function fetchAttachmentFileNames(changeSysId: string): Promise<string[] | null> {
  try {
    const attachmentQuery = encodeURIComponent(`table_name=change_request^table_sys_id=${changeSysId}`);
    const reply = await snowFetch<{ result?: unknown }>(`/api/now/attachment?sysparm_query=${attachmentQuery}&sysparm_fields=file_name`, { method: 'GET' });
    return Array.isArray(reply?.result)
      ? reply.result.map((attachment) => extractStringValue((attachment as Record<string, unknown>).file_name)).filter(Boolean)
      : [];
  } catch {
    return null;
  }
}

/** Implementation + validation + backout across the change's tasks, or null when none carries estimates. */
async function fetchTotalEstimateMinutes(changeSysId: string): Promise<number | null> {
  try {
    const taskMinutes = (await fetchReviewedCtasks(changeSysId))
      .map((ctask) => sumEstimateMinutes(readEstimatesFromText(ctask.description)));
    const totalMinutes = taskMinutes.reduce((runningTotal, minutes) => runningTotal + minutes, 0);
    return totalMinutes > 0 ? totalMinutes : null;
  } catch {
    return null;
  }
}

/** Reads every fact the RCP rules judge about one existing change. */
export async function fetchRcpChangeFacts(changeSysId: string): Promise<RcpChangeFacts> {
  const reply = await snowFetch<{ result?: Record<string, unknown> }>(
    `/api/now/table/change_request/${changeSysId}?sysparm_display_value=all&sysparm_fields=${CHANGE_FACT_FIELDS}`,
    { method: 'GET' },
  );
  const changeRecord = reply?.result ?? {};
  const configItem = extractSnowReference(changeRecord.cmdb_ci);
  const [ciOwner, attachmentFileNames, totalEstimateMinutes] = await Promise.all([
    fetchCiOwner(configItem.sysId), fetchAttachmentFileNames(changeSysId), fetchTotalEstimateMinutes(changeSysId),
  ]);
  const environmentLabel = extractStringValue(changeRecord.u_environment);
  const environmentKey = inferEnvironmentKeyFromValue(extractChoiceValue(changeRecord.u_environment) || environmentLabel);
  return {
    changeSysId,
    changeNumber: extractStringValue(changeRecord.number),
    shortDescription: extractStringValue(changeRecord.short_description),
    stateLabel: extractStringValue(changeRecord.state),
    environmentLabel,
    isProduction: environmentKey !== null && PRODUCTION_ENVIRONMENT_KEYS.has(environmentKey),
    riskLabel: extractStringValue(changeRecord.risk),
    plannedStartUtc: readUtcInstant(changeRecord.start_date),
    plannedEndUtc: readUtcInstant(changeRecord.end_date),
    totalEstimateMinutes,
    requestedBy: extractSnowReference(changeRecord.requested_by),
    configItem,
    ciOwner,
    attachmentFileNames,
    justification: extractStringValue(changeRecord.justification),
    backoutPlan: extractStringValue(changeRecord.backout_plan),
  };
}

/** One of my changes the RCP sweep will check. */
export interface InFlightChange {
  changeSysId: string;
  changeNumber: string;
  stateLabel: string;
}

const MY_ACTIVE_CHANGES_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';
const MY_ACTIVE_CHANGES_LIMIT = 100;
// The states Change Management asked to be reviewed: already in flight, not yet implemented.
const IN_FLIGHT_STATE_PATTERN = /^(assess|authorize|scheduled)$/i;

/**
 * My active Production changes in Assess, Authorize or Scheduled — the in-flight changes Change Management
 * asked to be brought up to the RCP rules before they are implemented.
 */
export async function fetchMyInFlightProductionChanges(): Promise<InFlightChange[]> {
  const reply = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_request?sysparm_query=${encodeURIComponent(MY_ACTIVE_CHANGES_QUERY)}`
      + `&sysparm_fields=sys_id,number,state,u_environment&sysparm_display_value=all&sysparm_limit=${MY_ACTIVE_CHANGES_LIMIT}`,
    { method: 'GET' },
  );
  const changeRows = Array.isArray(reply?.result) ? reply.result as Record<string, unknown>[] : [];
  return changeRows
    .filter((changeRow) => IN_FLIGHT_STATE_PATTERN.test(extractStringValue(changeRow.state).trim()))
    .filter((changeRow) => {
      const environmentKey = inferEnvironmentKeyFromValue(extractChoiceValue(changeRow.u_environment) || extractStringValue(changeRow.u_environment));
      return environmentKey !== null && PRODUCTION_ENVIRONMENT_KEYS.has(environmentKey);
    })
    .map((changeRow) => ({
      changeSysId: extractChoiceValue(changeRow.sys_id),
      changeNumber: extractStringValue(changeRow.number),
      stateLabel: extractStringValue(changeRow.state),
    }));
}

/**
 * The facts the Director approval email is written from. The Director is the CI's owner when that could be
 * read — the person the approval must come from — otherwise whoever is listed in Requested By.
 */
export function buildRcpApprovalEmailContext(facts: RcpChangeFacts): RcpApprovalEmailContext {
  return {
    changeNumber: facts.changeNumber,
    shortDescription: facts.shortDescription,
    environmentLabel: facts.environmentLabel,
    windowText: describeCentralWindow(facts.plannedStartUtc, facts.plannedEndUtc),
    configItemName: facts.configItem.displayName,
    directorName: facts.ciOwner?.displayName || facts.requestedBy.displayName,
    riskLabel: facts.riskLabel,
    justification: facts.justification,
    backoutPlan: facts.backoutPlan,
  };
}

/** All five RCP rules judged for one change, in the order Change Management listed them. */
export function evaluateRcpChecklist(facts: RcpChangeFacts, todayIso: string): RcpCheckResult[] {
  return [
    checkImplementationWindow(facts),
    checkRequestedByIsDirector(facts.requestedBy, facts.ciOwner),
    checkApprovalAttached(facts.attachmentFileNames),
    checkJustification(facts.justification),
    checkLeadTime({ riskLabel: facts.riskLabel, todayIso, plannedStartUtc: facts.plannedStartUtc }),
  ];
}
