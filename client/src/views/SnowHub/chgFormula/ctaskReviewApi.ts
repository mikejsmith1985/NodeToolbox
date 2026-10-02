// ctaskReviewApi.ts — Reads a change's tasks for the risk check and writes their fixes back to ServiceNow (GH #395).
//
// The tasks are read with EVERY field rather than a named list: ServiceNow has no standard backout field on a
// change task, so the only way to find an instance's own (u_backout_plan and the like) is to see what the
// record carries. Fixes go back one task at a time through the same Table API update the change builder uses.

import { snowFetch } from '../../../services/snowApi.ts';
import { readReviewedCtask, upsertBackoutSection, type ReviewedCtask } from './ctaskReviewRecord.ts';

/** What to change on one task: its CI, its backout plan, or both. */
export interface CtaskFix {
  configItemSysId?: string;
  backoutPlan?: string;
}

const CHANGE_TASK_TABLE_PATH = '/api/now/table/change_task';
// A change carries a handful of tasks; this bound only guards against a runaway query.
const CHANGE_TASK_FETCH_LIMIT = 200;

/** Every task attached to the change, oldest number first, read for the risk check. */
export async function fetchReviewedCtasks(changeSysId: string): Promise<ReviewedCtask[]> {
  const encodedQuery = encodeURIComponent(`change_request=${changeSysId}^ORDERBYnumber`);
  const replyData = await snowFetch<{ result?: unknown }>(
    `${CHANGE_TASK_TABLE_PATH}?sysparm_query=${encodedQuery}&sysparm_display_value=all&sysparm_limit=${CHANGE_TASK_FETCH_LIMIT}`,
    { method: 'GET' },
  );
  const taskRecords = replyData?.result;
  if (!Array.isArray(taskRecords)) {
    return [];
  }
  return taskRecords
    .filter((taskRecord): taskRecord is Record<string, unknown> => typeof taskRecord === 'object' && taskRecord !== null)
    .map((taskRecord) => readReviewedCtask(taskRecord));
}

/**
 * The update body for one fix. A backout plan goes into the instance's own backout field when it has one;
 * otherwise into the description's backout section, keeping the rest of the description as it was.
 */
export function buildCtaskFixPatch(ctask: ReviewedCtask, fix: CtaskFix): Record<string, string> {
  const patchBody: Record<string, string> = {};
  if (fix.configItemSysId) {
    patchBody.cmdb_ci = fix.configItemSysId;
  }
  if (fix.backoutPlan !== undefined && fix.backoutPlan.trim() !== '') {
    if (ctask.backoutFieldName) {
      patchBody[ctask.backoutFieldName] = fix.backoutPlan.trim();
    } else {
      patchBody.description = upsertBackoutSection(ctask.description, fix.backoutPlan);
    }
  }
  return patchBody;
}

/** Writes one task's fix to ServiceNow. A fix with nothing in it is refused rather than sent as an empty update. */
export async function saveCtaskFix(ctask: ReviewedCtask, fix: CtaskFix): Promise<void> {
  const patchBody = buildCtaskFixPatch(ctask, fix);
  if (Object.keys(patchBody).length === 0) {
    throw new Error(`There is nothing to write to ${ctask.number}.`);
  }
  await snowFetch(`${CHANGE_TASK_TABLE_PATH}/${ctask.sysId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
}
