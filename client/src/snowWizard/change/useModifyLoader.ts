// useModifyLoader.ts — Loads an existing change into the draft for a modify, refusing one that can no longer be edited.
//
// The draft is filled by Toolbox's own load path (useCrgState.cloneFromChg). That path copies the change's tasks as
// cards; each is linked here to the task it came from, so saving rewrites an edited task instead of making a copy.
// The change's planned window, which the load path does not copy, is set here, and so are the Jira issues the change
// names in its text (GH #475: the load path keeps no issues, so "Add proof" found none and the AI had no scope).
// Toolbox's own reader finds them (changeJiraStories, the risk check's), and they are read back from Jira.

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { fetchChangeJiraStories, findJiraKeysInChangeText } from '../../views/SnowHub/chgFormula/changeJiraStories.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { DRAFT_ENVIRONMENTS, readChangeTextFields, type CrgDraftState, type CrgHook } from './changeDraft.ts';
import type { ModifySession } from './changeWizardSession.ts';
import { readStepValues } from './modifyDiff.ts';
import { fetchChangeForModify, fetchExistingTasks, normalizeChangeNumber, type LoadedChange } from './modifyLoad.ts';
import { linkExistingTasks } from './modifyTasks.ts';

/** Where a look-up stands, for the screen to show. */
export type ModifyLoadStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'refused'; stateLabel: string }
  | { kind: 'failed'; message: string };

/** The look-up and its status. */
export interface ModifyLoader {
  status: ModifyLoadStatus;
  lookUp: () => void;
}

/** The draft as it stands once tidied: the change's own window on its environment. */
function buildTidiedDraft(draft: CrgDraftState, loadedChange: LoadedChange): CrgDraftState {
  const enabledEntry = DRAFT_ENVIRONMENTS.find(({ stateKey }) => draft[stateKey].isEnabled);
  if (!enabledEntry) return draft;
  return { ...draft, [enabledEntry.stateKey]: { ...draft[enabledEntry.stateKey], plannedStartDate: loadedChange.plannedStartInput, plannedEndDate: loadedChange.plannedEndInput } };
}

/** Writes the tidy into the draft through the hook's own actions. */
function applyTidy(crg: CrgHook, loadedChange: LoadedChange): void {
  crg.actions.setReconcileAutoCtasks(false);
  const enabledEntry = DRAFT_ENVIRONMENTS.find(({ stateKey }) => crg.state[stateKey].isEnabled);
  if (enabledEntry) crg.actions.updateEnvironment(enabledEntry.key, { plannedStartDate: loadedChange.plannedStartInput, plannedEndDate: loadedChange.plannedEndInput });
}

/** The Jira issues the change names — in its writing and its tasks' descriptions — read back; none when Jira cannot answer. */
async function readNamedJiraIssues(draft: CrgDraftState): Promise<JiraIssue[]> {
  const changeTexts = [...Object.values(readChangeTextFields(draft)), ...draft.changeTasks.map((task) => task.description)];
  const issueKeys = findJiraKeysInChangeText(changeTexts);
  if (issueKeys.length === 0) return [];
  try {
    return await fetchChangeJiraStories(issueKeys);
  } catch {
    return [];
  }
}

/** The loader for one modify job; `onLoaded` receives the change as loaded. */
export function useModifyLoader(crg: CrgHook, onLoaded: (modifySession: ModifySession) => void): ModifyLoader {
  const [status, setStatus] = useState<ModifyLoadStatus>({ kind: 'idle' });
  const clonedChangeRef = useRef<LoadedChange | null>(null);

  const finishLoad = useEffectEvent((loadedChange: LoadedChange, tidiedDraft: CrgDraftState) => {
    void Promise.all([fetchExistingTasks(loadedChange.changeSysId), readNamedJiraIssues(tidiedDraft)]).then(([existingTasks, namedIssues]) => {
      if (namedIssues.length > 0) crg.actions.adoptIssues(namedIssues);
      // The issues come with the change, so the scope step starts unedited with them chosen.
      const loadedDraft = { ...tidiedDraft, selectedIssueKeys: new Set([...tidiedDraft.selectedIssueKeys, ...namedIssues.map((jiraIssue) => jiraIssue.key)]) };
      onLoaded({
        changeNumber: loadedChange.changeNumber, stateLabel: loadedChange.stateLabel, loadedSnapshot: loadedChange.snapshot,
        loadedStepValues: readStepValues(loadedDraft), existingTaskNames: existingTasks.map((existingTask) => existingTask.label),
        changeSysId: loadedChange.changeSysId, existingTasks: linkExistingTasks(tidiedDraft.changeTasks, existingTasks),
      });
      setStatus({ kind: 'idle' });
    });
  });

  // Once the hook's own load has finished, tidy the draft and record the change as loaded.
  useEffect(() => {
    const loadedChange = clonedChangeRef.current;
    if (!loadedChange || crg.state.isCloning) return;
    clonedChangeRef.current = null;
    if (crg.state.cloneError) { void Promise.resolve().then(() => setStatus({ kind: 'failed', message: crg.state.cloneError ?? '' })); return; }
    applyTidy(crg, loadedChange);
    finishLoad(loadedChange, buildTidiedDraft(crg.state, loadedChange));
  }, [crg]);

  async function lookUp() {
    const changeNumber = normalizeChangeNumber(crg.state.cloneChgNumber);
    if (!changeNumber) { setStatus({ kind: 'failed', message: 'Type a change number, such as CHG0012345.' }); return; }
    setStatus({ kind: 'working' });
    try {
      const loadedChange = await fetchChangeForModify(changeNumber);
      if (!loadedChange.isEditable) { setStatus({ kind: 'refused', stateLabel: loadedChange.stateLabel }); return; }
      // Set before the load starts: the load marks itself busy at once, so the tidy waits for it to finish.
      clonedChangeRef.current = loadedChange;
      await crg.actions.cloneFromChg();
    } catch (lookUpError) {
      setStatus({ kind: 'failed', message: lookUpError instanceof Error ? lookUpError.message : String(lookUpError) });
    }
  }

  return { status, lookUp: () => { void lookUp(); } };
}
