// useFinishRunner.ts — Runs the last step: create the changes (or save the edited one), attach evidence, and retry what is missing.
//
// Every write is Toolbox's own: createChg (with the per-environment task plan — drift 1), updateExistingChg and
// appendTasksToExistingChg. Those report their outcome through the hook's `submitResult`, so this runner starts a
// write, then settles it when the hook's state shows the write has finished. Local state only changes in handlers
// and async continuations (react-hooks/set-state-in-effect); what has been settled is tracked in a ref.

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { EnvironmentValueByKey } from '../../views/SnowHub/hooks/useCrgState.ts';
import { DRAFT_ENVIRONMENTS, readEnabledPlanEnvironments, type CrgHook } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';
import { mergeCreatedChanges, readCreateOutcome, type CreatedChangeSummary } from './createOutcome.ts';
import type { CtaskEnvironmentPlan, PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import { attachAllEvidenceToChanges } from './evidenceUpload.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { detectRemoteConflicts, type RemoteConflict } from './modifyDiff.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';
import type { ChangeWizardStepId } from './changeWizardSteps.ts';

/** What the last step is doing now. */
export type FinishPhase =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'conflicts'; conflicts: RemoteConflict[] }
  | { kind: 'done' };

/** Everything the runner needs from the job. */
export interface FinishRunnerInput {
  crg: CrgHook;
  session: ChangeWizardSession;
  updateSession: (update: Partial<ChangeWizardSession>) => void;
  ctaskEnvironmentPlan: CtaskEnvironmentPlan;
  environmentValueByKey: EnvironmentValueByKey;
  evidenceFiles: readonly File[];
  /** The ticked Jira files, downloaded and zipped with the local files once the changes exist. */
  jiraEvidence: readonly JiraEvidenceAttachment[];
  editedStepIds: readonly ChangeWizardStepId[];
  /** Called once the job has fully succeeded. */
  onFinished: () => void;
}

/** The actions the last step offers. */
export interface FinishRunner {
  phase: FinishPhase;
  startCreate: () => void;
  retryMissing: () => void;
  startSave: () => void;
  confirmSave: () => void;
  cancelSave: () => void;
}

/** A write that has been started and not yet settled. */
interface PendingWrite {
  kind: 'create' | 'update' | 'append';
  attempted: PlanEnvironmentKey[];
  previousResult: string | null;
  hasSeenSubmitting: boolean;
  /** The update's own result, carried into the task append that follows it. */
  updateText?: string;
}

const ERROR_PREFIX = 'Error';

/** The hook's result line once the pending write has finished, or null while it is still running. */
function readSettledResult(pendingWrite: PendingWrite, crgState: CrgHook['state']): string | null {
  if (crgState.isSubmitting || crgState.submitResult === null) return null;
  if (!pendingWrite.hasSeenSubmitting && crgState.submitResult === pendingWrite.previousResult) return null;
  return crgState.submitResult;
}

/** The runner for one job's last step. */
export function useFinishRunner(input: FinishRunnerInput): FinishRunner {
  const { crg, session, updateSession } = input;
  const [phase, setPhase] = useState<FinishPhase>({ kind: 'idle' });
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const pendingRetryRef = useRef<PlanEnvironmentKey[] | null>(null);

  /**
   * Attaches the evidence to the given changes, showing each step, records each result (and any Jira file that could
   * not be fetched, after `outcomeNotes`), and reports the job finished when it is.
   */
  async function attachEvidenceAndFinish(changeNumbers: string[], isJobComplete: boolean, outcomeNotes: string[]) {
    const hasEvidence = input.evidenceFiles.length > 0 || input.jiraEvidence.length > 0;
    if (hasEvidence && changeNumbers.length > 0) {
      setPhase({ kind: 'working', message: 'Attaching your evidence…' });
      const onProgress = (message: string) => setPhase({ kind: 'working', message });
      const evidenceOutcome = await attachAllEvidenceToChanges({ localFiles: input.evidenceFiles, jiraAttachments: input.jiraEvidence }, changeNumbers, { onProgress });
      updateSession({ evidenceResults: { ...session.evidenceResults, ...evidenceOutcome.results }, outcomeNotes: [...outcomeNotes, ...evidenceOutcome.problems] });
    }
    setPhase({ kind: 'done' });
    if (isJobComplete) input.onFinished();
  }

  /** Starts one write and remembers how to tell when it has finished. */
  function beginWrite(pendingWrite: Omit<PendingWrite, 'previousResult' | 'hasSeenSubmitting'>, message: string, runWrite: () => Promise<void>) {
    pendingWriteRef.current = { ...pendingWrite, previousResult: crg.state.submitResult, hasSeenSubmitting: false };
    setPhase({ kind: 'working', message });
    void runWrite();
  }

  /** Creates one change per environment asked for, each with only its own tasks. */
  function createFor(attempted: PlanEnvironmentKey[]) {
    beginWrite({ kind: 'create', attempted }, 'Creating your changes in ServiceNow…',
      () => crg.actions.createChg(input.environmentValueByKey, { ctaskEnvironmentPlan: input.ctaskEnvironmentPlan }));
  }

  /** Records a create attempt's outcome, then attaches evidence to the changes it made. */
  function settleCreate(pendingWrite: PendingWrite, resultText: string) {
    const outcome = readCreateOutcome(resultText, pendingWrite.attempted);
    const outcomeNotes = [...session.outcomeNotes, ...outcome.notes];
    updateSession({
      createdChanges: mergeCreatedChanges(session.createdChanges, outcome.createdChanges),
      outcomeNotes,
      failureText: outcome.failureText,
    });
    void attachEvidenceAndFinish(outcome.createdChanges.map((createdChange) => createdChange.changeNumber), outcome.isComplete, outcomeNotes);
  }

  /** Records a modify's save, chaining the new tasks after the update when there are any. */
  function settleSave(pendingWrite: PendingWrite, resultText: string) {
    const changeNumber = session.modify?.changeNumber ?? '';
    const isFailure = resultText.startsWith(ERROR_PREFIX);
    if (pendingWrite.kind === 'update' && !isFailure && crg.state.changeTasks.length > 0) {
      beginWrite({ kind: 'append', attempted: [], updateText: resultText }, 'Adding the new tasks…', () => crg.actions.appendTasksToExistingChg(changeNumber));
      return;
    }
    const savedChange: CreatedChangeSummary = { environmentLabel: readEnabledPlanEnvironments(crg.state)[0] ?? null, changeNumber };
    const outcomeNotes = [pendingWrite.updateText, resultText].filter((noteText): noteText is string => Boolean(noteText) && !noteText?.startsWith(ERROR_PREFIX));
    updateSession({
      createdChanges: isFailure && pendingWrite.kind === 'update' ? [] : [savedChange],
      outcomeNotes,
      failureText: isFailure ? resultText.replace(/^Error:\s*/, '') : null,
    });
    void attachEvidenceAndFinish(isFailure && pendingWrite.kind === 'update' ? [] : [changeNumber], !isFailure, outcomeNotes);
  }

  const settlePendingWrite = useEffectEvent((pendingWrite: PendingWrite, resultText: string) => {
    if (pendingWrite.kind === 'create') settleCreate(pendingWrite, resultText);
    else settleSave(pendingWrite, resultText);
  });

  useEffect(() => {
    const pendingWrite = pendingWriteRef.current;
    if (!pendingWrite) return;
    if (crg.state.isSubmitting) {
      pendingWriteRef.current = { ...pendingWrite, hasSeenSubmitting: true };
      return;
    }
    const resultText = readSettledResult(pendingWrite, crg.state);
    if (resultText === null) return;
    pendingWriteRef.current = null;
    settlePendingWrite(pendingWrite, resultText);
  }, [crg.state]);

  const startRetryWhenReady = useEffectEvent((missingEnvironments: PlanEnvironmentKey[]) => createFor(missingEnvironments));

  // A retry first switches off the environments that already have a change, then creates once the draft shows it.
  useEffect(() => {
    const missingEnvironments = pendingRetryRef.current;
    if (!missingEnvironments) return;
    if (readEnabledPlanEnvironments(crg.state).join(',') !== missingEnvironments.join(',')) return;
    pendingRetryRef.current = null;
    startRetryWhenReady(missingEnvironments);
  }, [crg.state]);

  /** Switches off every environment that already has a change, so the next create makes only what is missing. */
  function retryMissing() {
    const createdLabels = new Set(session.createdChanges.map((createdChange) => createdChange.environmentLabel));
    const missingEnvironments = readEnabledPlanEnvironments(crg.state).filter((environmentLabel) => !createdLabels.has(environmentLabel));
    if (missingEnvironments.length === 0) return;
    pendingRetryRef.current = missingEnvironments;
    setPhase({ kind: 'working', message: 'Creating only what is missing…' });
    for (const { key, label } of DRAFT_ENVIRONMENTS) {
      if (createdLabels.has(label)) crg.actions.updateEnvironment(key, { isEnabled: false });
    }
  }

  /** Saves the edited change once the conflict check is clear. */
  function confirmSave() {
    const changeNumber = session.modify?.changeNumber ?? '';
    beginWrite({ kind: 'update', attempted: [] }, 'Saving your changes to ServiceNow…', () => crg.actions.updateExistingChg(changeNumber));
  }

  /** Re-reads the change and shows anything changed in ServiceNow since it was loaded, before writing anything. */
  async function checkConflictsThenSave() {
    const modifySession = session.modify;
    if (!modifySession) return;
    setPhase({ kind: 'working', message: 'Checking nobody changed it in ServiceNow meanwhile…' });
    try {
      const freshSnapshot = await fetchChangeSnapshot(modifySession.changeNumber);
      const conflicts = detectRemoteConflicts(modifySession.loadedSnapshot, freshSnapshot, input.editedStepIds);
      if (conflicts.length > 0) setPhase({ kind: 'conflicts', conflicts });
      else confirmSave();
    } catch (readError) {
      updateSession({ failureText: `Nothing was saved: the change could not be re-read to check for edits made in ServiceNow (${readError instanceof Error ? readError.message : String(readError)}).` });
      setPhase({ kind: 'idle' });
    }
  }

  return {
    phase,
    startCreate: () => createFor(readEnabledPlanEnvironments(crg.state)),
    retryMissing,
    startSave: () => { void checkConflictsThenSave(); },
    confirmSave,
    cancelSave: () => setPhase({ kind: 'idle' }),
  };
}
