// changeOutageRecord.ts — A change's outage record: read it, check it is there, and create a planned one.
//
// A Production change was rejected at approval because it had no outage record — and nothing in Toolbox read,
// checked or created one. The record lives in ServiceNow's outage table, linked to the change through its task
// field; a planned outage carries the change's CI and window. This module holds the reads, the one rule, and the
// write, so the Modify panel and the risk check agree by construction.

import { snowFetch } from '../../../services/snowApi.ts';
import type { RiskCheckFinding } from '../chgFormula/riskCheckReview.ts';
import { extractStringValue } from '../hooks/useCrgState.ts';

/** One outage record linked to the change, as the panel shows it. */
export interface ChangeOutage {
  sysId: string;
  number: string;
  typeLabel: string;
  beginLabel: string;
  endLabel: string;
}

/** What a planned outage is built from: the change, its CI and its planned window (UTC, as the Modify form holds it). */
export interface PlannedOutageInput {
  changeSysId: string;
  configItemSysId: string;
  shortDescription: string;
  plannedStartUtc: string;
  plannedEndUtc: string;
}

const OUTAGE_TABLE_PATH = '/api/now/table/cmdb_ci_outage';
const OUTAGE_FIELDS = 'sys_id,number,type,begin,end,cmdb_ci,short_description';
// The outage type for work the change schedules in advance (the table's own "Planned" choice).
const PLANNED_OUTAGE_TYPE = 'planned';
// The card name the rule reports under, so the review lists it beside the other record fields.
const OUTAGE_FINDING_FIELD = 'Outage Record';
// The form keeps "YYYY-MM-DDTHH:mm"; the Table API stores "YYYY-MM-DD HH:mm:ss".
const FORM_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** The outage records linked to the change, oldest first. */
export async function fetchChangeOutages(changeSysId: string): Promise<ChangeOutage[]> {
  const outageQuery = encodeURIComponent(`task_number=${changeSysId}^ORDERBYbegin`);
  const replyData = await snowFetch<{ result?: unknown }>(
    `${OUTAGE_TABLE_PATH}?sysparm_query=${outageQuery}&sysparm_display_value=all&sysparm_fields=${OUTAGE_FIELDS}`,
    { method: 'GET' },
  );
  if (!Array.isArray(replyData?.result)) {
    return [];
  }
  return replyData.result.map((outageRecord: Record<string, unknown>) => ({
    sysId: extractStringValue(readRawValue(outageRecord.sys_id)),
    number: extractStringValue(outageRecord.number),
    typeLabel: extractStringValue(outageRecord.type),
    beginLabel: extractStringValue(outageRecord.begin),
    endLabel: extractStringValue(outageRecord.end),
  }));
}

/** A sys_id's stored value — its display value is the same text, but the stored one is the id. */
function readRawValue(fieldValue: unknown): unknown {
  return typeof fieldValue === 'object' && fieldValue !== null && 'value' in fieldValue ? (fieldValue as { value: unknown }).value : fieldValue;
}

/** A form date-time ("2026-10-10T05:00", UTC) as the Table API stores it ("2026-10-10 05:00:00"); '' when empty. */
export function toSnowUtcDateTime(formDateTime: string): string {
  const dateTimeMatch = FORM_DATE_TIME_PATTERN.exec(formDateTime.trim());
  return dateTimeMatch ? `${dateTimeMatch[1]} ${dateTimeMatch[2]}:00` : '';
}

/** The new record: a planned outage on the change's CI, for the change's window, linked to the change. */
export function buildPlannedOutagePayload(input: PlannedOutageInput): Record<string, string> {
  return {
    task_number: input.changeSysId,
    cmdb_ci: input.configItemSysId,
    type: PLANNED_OUTAGE_TYPE,
    begin: toSnowUtcDateTime(input.plannedStartUtc),
    end: toSnowUtcDateTime(input.plannedEndUtc),
    short_description: `Planned outage for ${input.shortDescription.trim()}`,
  };
}

/**
 * Creates the planned outage and returns its number. A change with no CI or no planned window is refused before
 * anything is sent: an outage without them would satisfy nobody at approval.
 */
export async function createPlannedOutage(input: PlannedOutageInput): Promise<string> {
  if (input.configItemSysId.trim() === '') {
    throw new Error('Set the change\'s configuration item first — the outage is recorded against it.');
  }
  const payload = buildPlannedOutagePayload(input);
  if (payload.begin === '' || payload.end === '') {
    throw new Error('Set the change\'s planned start and end first — the outage covers that window.');
  }
  const replyData = await snowFetch<{ result?: Record<string, unknown> }>(OUTAGE_TABLE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return extractStringValue(replyData?.result?.number);
}

/**
 * The outage rule for the risk check: a Production change needs an outage record. Settled by Toolbox from what
 * ServiceNow holds — never left to the assistant, which cannot see the outage table.
 */
export function checkOutageRule(isProduction: boolean, outages: readonly ChangeOutage[]): RiskCheckFinding[] {
  if (!isProduction) {
    return [];
  }
  if (outages.length > 0) {
    return [{ status: 'PASS', field: OUTAGE_FINDING_FIELD, detail: `${outages.map((outage) => outage.number).join(', ')} is linked to the change.`, fix: '' }];
  }
  return [{
    status: 'RECORD',
    field: OUTAGE_FINDING_FIELD,
    detail: 'A Production change needs an outage record — create the planned outage on Review & Save.',
    fix: '',
  }];
}
