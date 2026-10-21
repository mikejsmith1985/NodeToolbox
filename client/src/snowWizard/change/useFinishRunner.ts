// useFinishRunner.ts — Runs the writes: create the changes early (new change), save the finished work to them at the end
// (or save the edited one, for a modify), attach evidence, and retry what is missing.
//
// Every write is Toolbox's own: createChg (with the per-environment task plan — drift 1 — and reconcile mode, so the
// user's tasks overwrite the ones ServiceNow makes in order and only the rest are created), updateExistingChg, and
// for a modify's tasks Toolbox's task writers (modifyTasks.ts). The change writes report through the hook's
// `submitResult`, so this runner starts a write, then settles it when the hook's state shows the write has finished. Local state only changes in handlers
// and async continuations (react-hooks/set-state-in-effect); what has been settled is tracked in a ref.

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { EnvironmentValueByKey } from '../../views/SnowHub/hooks/useCrgState.ts';
import { DRAFT_ENVIRONMENTS, readEnabledPlanEnvironments, type CrgHook } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';
import { listCreatedChangeTasks, saveCreatedChange, type CreatedTasksByChange } from './createdChanges.ts';
import { restoreFromCreatedChanges } from './createdDraftRecovery.ts';
import { mergeCreatedChanges, readCreateOutcome, type CreatedChangeSummary } from './createOutcome.ts';
import { listTaskLabelsByEnvironment, type CtaskEnvironmentPlan, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import { attachAllEvidenceToChanges } from './evidenceUpload.ts';
import { resolveJiraEvidenceAtFinish, type JiraEvidenceAttachment } from './jiraEvidence.ts';
import { detectRemoteConflicts, type RemoteConflict } from './modifyDiff.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';
import { saveModifyTasks } from './modifyTasks.ts';
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
  /** True once the evidence step recorded the user's ticks; otherwise every Jira file is gathered at create. */
  hasJiraEvidenceChoice: boolean;
  /** The change's Jira issues, whose files make up the test evidence. */
  selectedIssueKeys: readonly string[];
  editedStepIds: readonly ChangeWizardStepId[];
  /** Called once the job has fully succeeded. */
  onFinished: () => void;
}

/** The actions the last step offers. */
export interface FinishRunner {
  phase: FinishPhase;
  /** A new change: create one change per environment now, so the writing can quote the numbers. */
  startCreate: () => void;
  retryMissing: () => void;
  /** A new change: save the finished work to every created change, then attach the evidence. */
  startSaveCreated: () => void;
  /** A new change: use changes already in ServiceNow (one per environment) instead of creating them again. */
  adoptExistingChanges: (existingChanges: CreatedChangeSummary[]) => void;
  startSave: () => void;
  confirmSave: () => void;
  cancelSave: () => void;
}

/** A write that has been started and not yet settled. */
interface PendingWrite {
  kind: 'create' | 'update';
  attempted: PlanEnvironmentKey[];
  previousResult: string | null;
  hasSeenSubmitting: boolean;
}

const ERROR_PREFIX = 'Error';
const JIRA_EVIDENCE_LIST_FAILED = 'The test evidence could not be collected from Jira, so only files from this computer were attached.';

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

  /** The Jira files for the zip; a failed listing is noted and the local files still go. */
  async function gatherJiraEvidence(outcomeNotes: string[]): Promise<JiraEvidenceAttachment[]> {
    try {
      setPhase({ kind: 'working', message: 'Collecting the test evidence from Jira…' });
      const localBytes = input.evidenceFiles.reduce((runningTotal, file) => runningTotal + file.size, 0);
      return await resolveJiraEvidenceAtFinish({ tickedEvidence: input.jiraEvidence, hasChoice: input.hasJiraEvidenceChoice, issueKeys: input.selectedIssueKeys, localBytes });
    } catch {
      outcomeNotes.push(JIRA_EVIDENCE_LIST_FAILED);
      return [];
    }
  }

  /**
   * Attaches the evidence to the given changes, showing each step, records each result (and any Jira file that could
   * not be fetched, after `outcomeNotes`), and reports the job finished when it is.
   */
  async function attachEvidenceAndFinish(changeNumbers: string[], isJobComplete: boolean, outcomeNotes: string[]) {
    const jiraEvidence = changeNumbers.length > 0 ? await gatherJiraEvidence(outcomeNotes) : [];
    const hasEvidence = input.evidenceFiles.length > 0 || jiraEvidence.length > 0;
    if (hasEvidence && changeNumbers.length > 0) {
      setPhase({ kind: 'working', message: 'Zipping your test evidence…' });
      const onProgress = (message: string) => setPhase({ kind: 'working', message });
      const evidenceOutcome = await attachAllEvidenceToChanges({ localFiles: input.evidenceFiles, jiraAttachments: jiraEvidence }, changeNumbers, { onProgress });
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

  /** Creates one change per environment asked for, each with only its own tasks, which overwrite ServiceNow's in order. */
  function createFor(attempted: PlanEnvironmentKey[]) {
    const attemptedTaskNames = listTaskLabelsByEnvironment(crg.state.changeTasks, attempted);
    updateSession({ taskNamesByEnvironment: { ...session.taskNamesByEnvironment, ...attemptedTaskNames } });
    beginWrite({ kind: 'create', attempted }, 'Creating your changes in ServiceNow…',
      () => crg.actions.createChg(input.environmentValueByKey, { ctaskEnvironmentPlan: input.ctaskEnvironmentPlan, reconcileAutoCtasks: true, shouldKeepDraft: true }));
  }

  /** Switches every environment that has a change back on (a retry switches them off to create only what is missing). */
  function restoreCreatedEnvironments(createdChanges: readonly CreatedChangeSummary[]) {
    const createdLabels = new Set(createdChanges.map((createdChange) => createdChange.environmentLabel));
    for (const { key, stateKey, label } of DRAFT_ENVIRONMENTS) {
      if (createdLabels.has(label) && !crg.state[stateKey].isEnabled) crg.actions.updateEnvironment(key, { isEnabled: true });
    }
  }

  /** Reads back each created change's tasks, so the writing that follows can quote their numbers. */
  async function loadCreatedTasks(createdChanges: readonly CreatedChangeSummary[]) {
    setPhase({ kind: 'working', message: 'Reading back the task numbers…' });
    const createdTasks: CreatedTasksByChange = { ...session.createdTasks };
    for (const createdChange of createdChanges) {
      try {
        createdTasks[createdChange.changeNumber] = await listCreatedChangeTasks(createdChange.changeNumber);
      } catch {
        // The change exists either way; the writing simply cannot quote this change's task numbers.
      }
    }
    updateSession({ createdTasks });
    setPhase({ kind: 'done' });
  }

  /**
   * Records a create attempt's outcome. The changes now exist, so the job goes on to the writing, which can quote
   * their numbers; the finished work and the evidence are saved to them on the last step.
   */
  function settleCreate(pendingWrite: PendingWrite, resultText: string) {
    const outcome = readCreateOutcome(resultText, pendingWrite.attempted);
    const createdChanges = mergeCreatedChanges(session.createdChanges, outcome.createdChanges);
    updateSession({ createdChanges, outcomeNotes: [...session.outcomeNotes, ...outcome.notes], failureText: outcome.failureText });
    restoreCreatedEnvironments(createdChanges);
    void loadCreatedTasks(createdChanges);
  }

  /**
   * Uses changes already in ServiceNow: the draft takes each one's own window, item and real tasks (so saving never
   * changes what they hold by accident), then their task numbers are read back for the writing.
   */
  async function adoptThenLoad(existingChanges: CreatedChangeSummary[]) {
    setPhase({ kind: 'working', message: 'Reading your changes from ServiceNow…' });
    try {
      await restoreFromCreatedChanges(crg.actions, existingChanges);
    } catch (readError) {
      updateSession({ failureText: `Those changes could not be read (${readError instanceof Error ? readError.message : String(readError)}). Check the numbers and try again.` });
      setPhase({ kind: 'idle' });
      return;
    }
    const createdChanges = mergeCreatedChanges(session.createdChanges, existingChanges);
    updateSession({ createdChanges, failureText: null });
    await loadCreatedTasks(createdChanges);
  }

  /** Saves the finished work to every created change, then attaches the evidence and finishes the job. */
  async function saveCreatedThenFinish() {
    const savedNotes: string[] = [];
    try {
      for (const createdChange of session.createdChanges) {
        setPhase({ kind: 'working', message: `Saving ${createdChange.changeNumber} to ServiceNow…` });
        savedNotes.push(await saveCreatedChange({
          draft: crg.state, createdChange, environmentValueByKey: input.environmentValueByKey, ctaskEnvironmentPlan: input.ctaskEnvironmentPlan,
        }));
      }
    } catch (saveError) {
      const reason = saveError instanceof Error ? saveError.message : String(saveError);
      updateSession({ saveFailureText: `Not everything was saved (${reason}). Press “Save to ServiceNow” to try again — it is safe to repeat.` });
      setPhase({ kind: 'idle' });
      return;
    }
    const outcomeNotes = [...session.outcomeNotes, ...savedNotes];
    updateSession({ hasSavedChanges: true, saveFailureText: null, outcomeNotes });
    void attachEvidenceAndFinish(session.createdChanges.map((createdChange) => createdChange.changeNumber), true, outcomeNotes);
  }

  /** Records a modify's outcome, attaching evidence to the change when the change itself was saved. */
  function finishSave(outcomeNotes: string[], failureText: string | null, wasChangeSaved: boolean) {
    const changeNumber = session.modify?.changeNumber ?? '';
    const savedChange: CreatedChangeSummary = { environmentLabel: readEnabledPlanEnvironments(crg.state)[0] ?? null, changeNumber };
    updateSession({ createdChanges: wasChangeSaved ? [savedChange] : [], outcomeNotes, failureText });
    void attachEvidenceAndFinish(wasChangeSaved ? [changeNumber] : [], failureText === null, outcomeNotes);
  }

  /** Once the change itself is saved: rewrites the tasks the user edited and adds the ones they built. */
  async function saveTasksThenFinish(updateText: string) {
    const modifySession = session.modify;
    setPhase({ kind: 'working', message: 'Saving your tasks…' });
    try {
      const tasksText = await saveModifyTasks({
        changeNumber: modifySession?.changeNumber ?? '', changeSysId: modifySession?.changeSysId,
        draftTasks: crg.state.changeTasks, links: modifySession?.existingTasks ?? [],
      });
      finishSave(tasksText ? [updateText, tasksText] : [updateText], null, true);
    } catch (taskError) {
      const reason = taskError instanceof Error ? taskError.message : String(taskError);
      finishSave([updateText], `The change was saved, but not all of its tasks were (${reason}). Check its tasks in ServiceNow before trying again.`, true);
    }
  }

  /** Records a modify's save of the change itself, then saves its tasks. */
  function settleSave(resultText: string) {
    if (resultText.startsWith(ERROR_PREFIX)) {
      finishSave([], resultText.replace(/^Error:\s*/, ''), false);
      return;
    }
    void saveTasksThenFinish(resultText);
  }

  const settlePendingWrite = useEffectEvent((pendingWrite: PendingWrite, resultText: string) => {
    if (pendingWrite.kind === 'create') settleCreate(pendingWrite, resultText);
    else settleSave(resultText);
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
    startSaveCreated: () => { void saveCreatedThenFinish(); },
    adoptExistingChanges: (existingChanges) => { void adoptThenLoad(existingChanges); },
    startSave: () => { void checkConflictsThenSave(); },
    confirmSave,
    cancelSave: () => setPhase({ kind: 'idle' }),
  };
}
