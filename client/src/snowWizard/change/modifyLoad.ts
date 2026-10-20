// modifyLoad.ts — Reads the change a modify starts from: whether it can still be edited, its window, its tasks, and a snapshot.
//
// The draft itself is filled by Toolbox's own load path (useCrgState.cloneFromChg). This adds only what that path
// does not keep: the change's state (closed changes go to Review), its planned window, the ids of the tasks it already
// has (so an edited task is rewritten, never re-created), and the snapshot the save-time conflict check compares against.

import { snowFetch } from '../../services/snowApi.ts';
import { fetchChangeTaskRecords } from '../../views/SnowHub/chgFormula/ctaskReviewApi.ts';
import { readReviewedCtask } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import { isChangeEditable } from '../../views/SnowHub/guided/changeReadiness.ts';
import { extractStringValue } from '../../views/SnowHub/hooks/snowFieldValues.ts';
import { readUtcInstant } from '../../views/SnowHub/rcp/rcpChangeFacts.ts';
import { formatUtcAsLocalDateTime } from '../../views/SnowHub/rcp/rcpNewChange.ts';
import { MODIFY_SNAPSHOT_FIELDS, readRecordSnapshot } from './modifyDiff.ts';

/** The change as a modify needs it at load. */
export interface LoadedChange {
  changeSysId: string;
  changeNumber: string;
  stateLabel: string;
  isEditable: boolean;
  snapshot: Record<string, string>;
  /** The planned window as the date fields show it (local time); '' when unset. */
  plannedStartInput: string;
  plannedEndInput: string;
}

const CHANGE_NUMBER_PATTERN = /^CHG\d+$/;
const LOOKUP_FIELDS = ['sys_id', 'number', 'state', ...MODIFY_SNAPSHOT_FIELDS].join(',');

/** A typed change number tidied up ("chg0001 " → "CHG0001"), or null when it is not one. */
export function normalizeChangeNumber(typedNumber: string): string | null {
  const changeNumber = typedNumber.trim().toUpperCase();
  return CHANGE_NUMBER_PATTERN.test(changeNumber) ? changeNumber : null;
}

/** One change record, by number; throws in plain words when ServiceNow has none. */
async function fetchChangeRecord(changeNumber: string): Promise<Record<string, unknown>> {
  const changeQuery = encodeURIComponent(`number=${changeNumber}`);
  const reply = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_request?sysparm_query=${changeQuery}&sysparm_display_value=all&sysparm_limit=1&sysparm_fields=${LOOKUP_FIELDS}`,
    { method: 'GET' },
  );
  const changeRecord = Array.isArray(reply?.result) ? reply.result[0] : undefined;
  if (typeof changeRecord !== 'object' || changeRecord === null) throw new Error(`ServiceNow has no change ${changeNumber}.`);
  return changeRecord as Record<string, unknown>;
}

/** A stored UTC date-time as the date field's local value. */
function readDateInput(field: unknown): string {
  const utcInstant = readUtcInstant(field);
  return utcInstant ? formatUtcAsLocalDateTime(utcInstant) : '';
}

/** Reads the change a modify starts from. */
export async function fetchChangeForModify(changeNumber: string): Promise<LoadedChange> {
  const changeRecord = await fetchChangeRecord(changeNumber);
  const sysIdField = changeRecord.sys_id as { value?: unknown } | string | undefined;
  const stateLabel = extractStringValue(changeRecord.state);
  return {
    changeSysId: typeof sysIdField === 'object' ? String(sysIdField?.value ?? '') : String(sysIdField ?? ''),
    changeNumber,
    stateLabel,
    isEditable: isChangeEditable(stateLabel),
    snapshot: readRecordSnapshot(changeRecord),
    plannedStartInput: readDateInput(changeRecord.start_date),
    plannedEndInput: readDateInput(changeRecord.end_date),
  };
}

/** The tracked values as ServiceNow holds them now, for the conflict check just before saving. */
export async function fetchChangeSnapshot(changeNumber: string): Promise<Record<string, string>> {
  return readRecordSnapshot(await fetchChangeRecord(changeNumber));
}

/** One task the change already has: its id, its number, and "number — short description" to show. */
export interface ExistingTaskSummary {
  sysId: string;
  number: string;
  label: string;
}

/** The tasks the change already has; none when they cannot be read. */
export async function fetchExistingTasks(changeSysId: string): Promise<ExistingTaskSummary[]> {
  try {
    return (await fetchChangeTaskRecords(changeSysId)).map((taskRecord) => {
      const reviewedTask = readReviewedCtask(taskRecord);
      const label = reviewedTask.shortDescription ? `${reviewedTask.number} — ${reviewedTask.shortDescription}` : reviewedTask.number;
      return { sysId: reviewedTask.sysId, number: reviewedTask.number, label };
    });
  } catch {
    return [];
  }
}
