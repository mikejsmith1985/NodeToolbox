// createdDraftRecovery.ts — Puts back a job's picks from the changes it already created, when its draft was wiped.
//
// v0.312.0 created the changes part-way through a job, and Toolbox's createChg then cleared the draft for "the next
// change" (fixed by its shouldKeepDraft option). Those jobs kept their CHG numbers but lost every pick. The changes
// were made from the full draft, so they hold the values: this copies them back with Toolbox's own clone path
// (cloneFromChg) and each change's own window and configuration item, so no second set of changes is ever made.

import { useCallback, useEffect, useState } from 'react';

import { snowFetch } from '../../services/snowApi.ts';
import { extractChoiceValue, extractSnowReference } from '../../views/SnowHub/hooks/snowFieldValues.ts';
import type { SnowReference } from '../../views/SnowHub/hooks/useCrgState.ts';
import { readUtcInstant } from '../../views/SnowHub/rcp/rcpChangeFacts.ts';
import { formatUtcAsLocalDateTime } from '../../views/SnowHub/rcp/rcpNewChange.ts';
import { DRAFT_ENVIRONMENTS, readDetailsGaps, readEnabledPlanEnvironments, type CrgDraftState, type CrgHook } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';

/** One created change's own environment values, as the environment card holds them. */
export interface CreatedEnvironmentValues {
  configItem: SnowReference;
  plannedStartDate: string;
  plannedEndDate: string;
  snowEnvironmentValue: string;
}

/** Where a recovery stands. */
export type RecoveryPhase = 'idle' | 'waitingForNumber' | 'restoring' | 'done' | 'failed';

const ENVIRONMENT_FIELDS = 'cmdb_ci,start_date,end_date,u_environment';

/**
 * True for a new-change job whose changes exist but whose draft has lost what they were made from — a required detail
 * is missing, or a created change's environment is no longer switched on (the mark of the v0.312.0 wipe; a title
 * generated afterwards must not hide it). A job that has saved never needs it.
 */
export function needsDraftRecovery(session: ChangeWizardSession, draft: CrgDraftState): boolean {
  if (session.mode !== 'create' || session.createdChanges.length === 0 || session.hasSavedChanges) return false;
  const enabledEnvironments = readEnabledPlanEnvironments(draft);
  const isCreatedEnvironmentOff = session.createdChanges.some((createdChange) => createdChange.environmentLabel !== null && !enabledEnvironments.includes(createdChange.environmentLabel));
  return readDetailsGaps(draft).length > 0 || isCreatedEnvironmentOff;
}

/** A stored date-time as the date field's local value; '' when unset. */
function readDateInput(field: unknown): string {
  const utcInstant = readUtcInstant(field);
  return utcInstant ? formatUtcAsLocalDateTime(utcInstant) : '';
}

/** One created change's configuration item, window and environment value. */
export async function readCreatedEnvironmentValues(changeNumber: string): Promise<CreatedEnvironmentValues> {
  const changeQuery = encodeURIComponent(`number=${changeNumber}`);
  const reply = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_request?sysparm_query=${changeQuery}&sysparm_limit=1&sysparm_display_value=all&sysparm_fields=${ENVIRONMENT_FIELDS}`,
  );
  const changeRecord = Array.isArray(reply?.result) ? reply.result[0] as Record<string, unknown> | undefined : undefined;
  if (!changeRecord) throw new Error(`ServiceNow has no change ${changeNumber}.`);
  return {
    configItem: extractSnowReference(changeRecord.cmdb_ci),
    plannedStartDate: readDateInput(changeRecord.start_date),
    plannedEndDate: readDateInput(changeRecord.end_date),
    snowEnvironmentValue: extractChoiceValue(changeRecord.u_environment),
  };
}

/** The recovery for one job: whether it is needed, where it stands, and the button's action. */
export interface DraftRecovery {
  isNeeded: boolean;
  phase: RecoveryPhase;
  failureText: string;
  restore: () => void;
}

/** Restores a wiped job's picks from its created changes, once the user asks. */
export function useCreatedDraftRecovery(crg: CrgHook, session: ChangeWizardSession, onRestored: () => void): DraftRecovery {
  const [phase, setPhase] = useState<RecoveryPhase>('idle');
  const [failureText, setFailureText] = useState('');
  const { setCloneChgNumber, cloneFromChg, updateEnvironment } = crg.actions;
  const firstChangeNumber = session.createdChanges[0]?.changeNumber ?? '';
  const cloneNumberInDraft = crg.state.cloneChgNumber;

  /** Copies the first change's values, then gives each environment its own change's window and item. */
  const runRestore = useCallback(async () => {
    try {
      await cloneFromChg();
      for (const createdChange of session.createdChanges) {
        const environment = DRAFT_ENVIRONMENTS.find(({ label }) => label === createdChange.environmentLabel);
        if (!environment) continue;
        updateEnvironment(environment.key, { isEnabled: true, ...await readCreatedEnvironmentValues(createdChange.changeNumber) });
      }
      setPhase('done');
      onRestored();
    } catch (restoreError) {
      setFailureText(restoreError instanceof Error ? restoreError.message : String(restoreError));
      setPhase('failed');
    }
  }, [cloneFromChg, updateEnvironment, session.createdChanges, onRestored]);

  // cloneFromChg reads the number from the draft, so the number goes in first and the copy runs once it is there.
  useEffect(() => {
    if (phase !== 'waitingForNumber' || cloneNumberInDraft !== firstChangeNumber) return;
    queueMicrotask(() => { setPhase('restoring'); void runRestore(); });
  }, [phase, cloneNumberInDraft, firstChangeNumber, runRestore]);

  const restore = useCallback(() => {
    setFailureText('');
    setPhase('waitingForNumber');
    setCloneChgNumber(firstChangeNumber);
  }, [setCloneChgNumber, firstChangeNumber]);

  const isWorking = phase === 'restoring' || phase === 'waitingForNumber';
  return { isNeeded: isWorking || (phase !== 'done' && needsDraftRecovery(session, crg.state)), phase, failureText, restore };
}
