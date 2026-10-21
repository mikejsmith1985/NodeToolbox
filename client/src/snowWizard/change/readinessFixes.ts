// readinessFixes.ts — The one-click fixes a final check offers, run right on the change in ServiceNow.
//
// The readiness engine names some fixes as "fix now" (every task's configuration item, the planned outage), but nothing
// ran them: the Wizard sent the user to a step that could not fix them (GH #475, last comment). These run them with
// Toolbox's own writers (saveCtaskFix, createPlannedOutage), reading the change as ServiceNow holds it, so the fix
// matches what the check judged. Each returns a plain sentence of what it did.

import { snowFetch } from '../../services/snowApi.ts';
import { fetchReviewedCtasks, saveCtaskFix } from '../../views/SnowHub/chgFormula/ctaskReviewApi.ts';
import type { ReviewedCtask } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import type { ReadinessFixId } from '../../views/SnowHub/guided/changeReadiness.ts';
import { createPlannedOutage, type PlannedOutageInput } from '../../views/SnowHub/outage/changeOutageRecord.ts';

/** The change a fix runs on. */
export interface ReadinessFixTarget {
  changeNumber: string;
  changeSysId: string;
}

/** The change as ServiceNow holds it: its configuration item, window (UTC) and title. */
interface HeldChange {
  configItemSysId: string;
  plannedStartUtc: string;
  plannedEndUtc: string;
  shortDescription: string;
}

/** The reads and writes a fix goes through; replaceable in tests. */
export interface ReadinessFixWriters {
  readChange: (changeSysId: string) => Promise<HeldChange>;
  readTasks: (changeSysId: string) => Promise<ReviewedCtask[]>;
  setTaskConfigItem: (ctask: ReviewedCtask, configItemSysId: string) => Promise<void>;
  createOutage: (input: PlannedOutageInput) => Promise<string>;
}

const CHANGE_FIELDS = 'cmdb_ci,start_date,end_date,short_description';

/** A field's stored value, whatever shape ServiceNow sent it in. */
function readStoredValue(field: unknown): string {
  if (typeof field === 'object' && field !== null) return String((field as { value?: unknown }).value ?? '');
  return field === undefined || field === null ? '' : String(field);
}

/** The change's own configuration item, window and title, as stored (dates in UTC). */
async function readHeldChange(changeSysId: string): Promise<HeldChange> {
  const reply = await snowFetch<{ result?: Record<string, unknown> }>(
    `/api/now/table/change_request/${encodeURIComponent(changeSysId)}?sysparm_fields=${CHANGE_FIELDS}&sysparm_display_value=false`,
  );
  const changeRecord = reply?.result ?? {};
  return {
    configItemSysId: readStoredValue(changeRecord.cmdb_ci),
    plannedStartUtc: readStoredValue(changeRecord.start_date),
    plannedEndUtc: readStoredValue(changeRecord.end_date),
    shortDescription: readStoredValue(changeRecord.short_description),
  };
}

const DEFAULT_WRITERS: ReadinessFixWriters = {
  readChange: readHeldChange,
  readTasks: fetchReviewedCtasks,
  setTaskConfigItem: (ctask, configItemSysId) => saveCtaskFix(ctask, { configItemSysId }),
  createOutage: createPlannedOutage,
};

/** Puts the change's own configuration item on every task that differs. */
async function setTaskConfigItems(target: ReadinessFixTarget, writers: ReadinessFixWriters): Promise<string> {
  const heldChange = await writers.readChange(target.changeSysId);
  if (!heldChange.configItemSysId) throw new Error(`${target.changeNumber} has no configuration item to copy — set it on “Tell us about the change” first.`);
  const differingTasks = (await writers.readTasks(target.changeSysId)).filter((ctask) => ctask.configItem.sysId !== heldChange.configItemSysId);
  for (const ctask of differingTasks) await writers.setTaskConfigItem(ctask, heldChange.configItemSysId);
  return differingTasks.length === 0
    ? `${target.changeNumber}: every task already has the change's configuration item.`
    : `${target.changeNumber}: set the configuration item on ${differingTasks.map((ctask) => ctask.number).join(', ')}.`;
}

/** Creates the planned outage for the change's own item and window. */
async function createOutageFor(target: ReadinessFixTarget, writers: ReadinessFixWriters): Promise<string> {
  const heldChange = await writers.readChange(target.changeSysId);
  const outageNumber = await writers.createOutage({
    changeSysId: target.changeSysId, configItemSysId: heldChange.configItemSysId,
    plannedStartUtc: heldChange.plannedStartUtc, plannedEndUtc: heldChange.plannedEndUtc, shortDescription: heldChange.shortDescription,
  });
  return `${target.changeNumber}: created planned outage ${outageNumber || '(number not returned)'}.`;
}

/**
 * Runs one "fix now" on every target change and says what happened on each. A fix the Wizard does not run (problem
 * records — ServiceNow links those itself) reports so rather than doing anything.
 */
export async function runReadinessFix(fixId: ReadinessFixId, targets: readonly ReadinessFixTarget[], writers: ReadinessFixWriters = DEFAULT_WRITERS): Promise<string> {
  const results: string[] = [];
  for (const target of targets) {
    if (fixId === 'setCtaskConfigItems') results.push(await setTaskConfigItems(target, writers));
    else if (fixId === 'createPlannedOutage') results.push(await createOutageFor(target, writers));
    else results.push(`${target.changeNumber}: ServiceNow links problem records itself — nothing to do.`);
  }
  return results.join(' ');
}
