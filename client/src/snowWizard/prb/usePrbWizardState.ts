// usePrbWizardState.ts — Holds everything the "Turn a problem into Jira work" job knows, step by step, and the
// actions that move it forward. The screens only draw this state, so going Back never loses an entry.

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type { JiraProject } from '../../types/jira.ts';
import { loadSnowUrl } from '../shell/wizardSettings.ts';
import { createPrbJiraWork, EMPTY_PRB_PROGRESS, findExistingPrbIssues, hasPrbWorkToDo, type PrbCreateResult } from './prbJiraCreate.ts';
import {
  buildDefaultRoleChoices,
  buildPrbJiraDrafts,
  buildPrbRecordLink,
  PRB_JIRA_ROLES,
  PRB_ROLE_NAMES,
  readNewRoles,
  type PrbExistingIssue,
  type PrbJiraDraft,
  type PrbJiraRole,
  type PrbRoleChoice,
  type PrbRoleChoices,
  type PrbRoleMode,
} from './prbJiraPlan.ts';
import {
  loadJiraProjects,
  readRememberedPrbProject,
  rememberPrbProject,
  searchExistingIssues,
  searchOpenEpics,
  searchProblems,
  type EpicSearchResult,
  type PrbSearchResult,
} from './prbLookups.ts';

// ── Types ──

/** The job's screens, in order. */
export type PrbStepId = 'find' | 'confirm' | 'choose' | 'place' | 'drafts' | 'result';

/** Every screen in the order it is walked; Place and Drafts are passed by when nothing is made new. */
export const PRB_STEP_IDS: readonly PrbStepId[] = ['find', 'confirm', 'choose', 'place', 'drafts', 'result'];

/** The screens only a new item needs: where it goes, and its wording. */
const NEW_ITEM_STEP_IDS: readonly PrbStepId[] = ['place', 'drafts'];

/** A list read from ServiceNow or Jira, and where that read stands. */
export interface LoadedList<Item> {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  items: Item[];
}

/** Whether Jira has been checked for work already made for the chosen problem, and what was found per item. */
export interface ExistingWorkCheck {
  status: 'idle' | 'checking' | 'done' | 'failed';
  foundIssues: Partial<Record<PrbJiraRole, PrbExistingIssue>>;
}

/** One item's search for an issue already in Jira to use. */
export interface RoleIssueSearch {
  searchText: string;
  results: LoadedList<PrbExistingIssue>;
}

/** Everything the job holds. */
export interface PrbWizardState {
  stepId: PrbStepId;
  problemSearchText: string;
  problemSearch: LoadedList<PrbSearchResult>;
  chosenProblem: PrbSearchResult | null;
  existingWork: ExistingWorkCheck;
  roleChoices: PrbRoleChoices;
  roleSearches: Record<PrbJiraRole, RoleIssueSearch>;
  projectList: LoadedList<JiraProject>;
  projectKey: string;
  epicSearchText: string;
  epicSearch: LoadedList<EpicSearchResult>;
  chosenEpic: EpicSearchResult | null;
  drafts: PrbJiraDraft[];
  draftsSourceKey: string;
  isCreating: boolean;
  createResult: PrbCreateResult | null;
}

/** The editable parts of one draft. */
export type PrbDraftEdit = Partial<Pick<PrbJiraDraft, 'summary' | 'description'>>;

const IDLE_LIST = { status: 'idle', items: [] } as const;
const NO_FOUND_ISSUES = {};

function createIdleRoleSearches(): Record<PrbJiraRole, RoleIssueSearch> {
  const idleSearch = (): RoleIssueSearch => ({ searchText: '', results: { ...IDLE_LIST, items: [] } });
  return { defect: idleSearch(), sl: idleSearch(), qe: idleSearch() };
}

function createInitialState(): PrbWizardState {
  return {
    stepId: 'find',
    problemSearchText: '',
    problemSearch: { ...IDLE_LIST, items: [] },
    chosenProblem: null,
    existingWork: { status: 'idle', foundIssues: NO_FOUND_ISSUES },
    roleChoices: buildDefaultRoleChoices(NO_FOUND_ISSUES),
    roleSearches: createIdleRoleSearches(),
    projectList: { ...IDLE_LIST, items: [] },
    projectKey: readRememberedPrbProject(),
    epicSearchText: '',
    epicSearch: { ...IDLE_LIST, items: [] },
    chosenEpic: null,
    drafts: [],
    draftsSourceKey: '',
    isCreating: false,
    createResult: null,
  };
}

// ── Pure helpers ──

/** True when Jira already holds at least one item for the chosen problem. */
export function hasExistingWork(existingWork: ExistingWorkCheck): boolean {
  return Object.values(existingWork.foundIssues).some(Boolean);
}

/** The screens this run walks: Place and Drafts only when at least one item is made new. */
export function readActiveStepIds(state: PrbWizardState): PrbStepId[] {
  const isAnyItemNew = readNewRoles(state.roleChoices).length > 0;
  return PRB_STEP_IDS.filter((stepId) => isAnyItemNew || !NEW_ITEM_STEP_IDS.includes(stepId));
}

/** The screen after (offset 1) or before (offset -1) the current one, among the screens this run walks. */
export function readNeighbourStep(state: PrbWizardState, offset: number): PrbStepId {
  const activeStepIds = readActiveStepIds(state);
  const nextIndex = activeStepIds.indexOf(state.stepId) + offset;
  return activeStepIds[Math.min(Math.max(nextIndex, 0), activeStepIds.length - 1)];
}

function buildDraftsSourceKey(state: PrbWizardState): string {
  return [state.chosenProblem?.number, state.projectKey, state.chosenEpic?.key].join('|');
}

/** Fresh drafts when the problem, project or Epic changed; otherwise the user's edits are kept. */
function withDraftsFor(state: PrbWizardState): PrbWizardState {
  const sourceKey = buildDraftsSourceKey(state);
  if (!state.chosenProblem || !state.chosenEpic || sourceKey === state.draftsSourceKey) return state;
  const problem = state.chosenProblem;
  const source = { ...problem, link: buildPrbRecordLink(loadSnowUrl(), problem.number) };
  return { ...state, drafts: buildPrbJiraDrafts(source, state.chosenEpic.key, state.projectKey), draftsSourceKey: sourceKey };
}

// ── Reads ──

function useProblemActions(setState: Dispatch<SetStateAction<PrbWizardState>>) {
  const runProblemSearch = useCallback(async (searchText: string) => {
    setState((previous) => ({ ...previous, problemSearch: { status: 'loading', items: [] } }));
    try {
      const items = await searchProblems(searchText);
      setState((previous) => ({ ...previous, problemSearch: { status: 'ready', items } }));
    } catch {
      setState((previous) => ({ ...previous, problemSearch: { status: 'failed', items: [] } }));
    }
  }, [setState]);

  const checkExistingWork = useCallback(async (prbNumber: string) => {
    setState((previous) => ({ ...previous, existingWork: { status: 'checking', foundIssues: NO_FOUND_ISSUES } }));
    try {
      const foundIssues = await findExistingPrbIssues(prbNumber);
      // What Jira already holds starts out used; everything else starts out made new.
      setState((previous) => ({ ...previous, existingWork: { status: 'done', foundIssues }, roleChoices: buildDefaultRoleChoices(foundIssues) }));
    } catch {
      setState((previous) => ({ ...previous, existingWork: { status: 'failed', foundIssues: NO_FOUND_ISSUES } }));
    }
  }, [setState]);

  return { runProblemSearch, checkExistingWork };
}

function useJiraPlaceActions(setState: Dispatch<SetStateAction<PrbWizardState>>) {
  const loadProjects = useCallback(async () => {
    setState((previous) => ({ ...previous, projectList: { status: 'loading', items: [] } }));
    try {
      const items = await loadJiraProjects();
      setState((previous) => ({
        ...previous,
        projectList: { status: 'ready', items },
        // A remembered project Jira no longer lists is dropped, so only a real project can be chosen.
        projectKey: items.some((project) => project.key === previous.projectKey) ? previous.projectKey : '',
      }));
    } catch {
      setState((previous) => ({ ...previous, projectList: { status: 'failed', items: [] } }));
    }
  }, [setState]);

  const runEpicSearch = useCallback(async (searchText: string) => {
    setState((previous) => ({ ...previous, epicSearch: { status: 'loading', items: [] } }));
    try {
      const items = await searchOpenEpics(searchText);
      setState((previous) => ({ ...previous, epicSearch: { status: 'ready', items } }));
    } catch {
      setState((previous) => ({ ...previous, epicSearch: { status: 'failed', items: [] } }));
    }
  }, [setState]);

  return { loadProjects, runEpicSearch };
}

// ── Choices ──

function withRoleSearch(state: PrbWizardState, role: PrbJiraRole, patch: Partial<RoleIssueSearch>): PrbWizardState {
  return { ...state, roleSearches: { ...state.roleSearches, [role]: { ...state.roleSearches[role], ...patch } } };
}

function useChoiceActions(setState: Dispatch<SetStateAction<PrbWizardState>>) {
  const chooseRoleMode = useCallback((role: PrbJiraRole, mode: PrbRoleMode) => {
    setState((previous) => {
      const currentChoice = previous.roleChoices[role];
      if (currentChoice.mode === mode) return previous;
      // Switching to "use one already in Jira" starts on the item found for this problem, when there is one.
      const nextChoice: PrbRoleChoice = mode === 'existing'
        ? { mode: 'existing', issue: previous.existingWork.foundIssues[role] ?? null }
        : { mode: mode === 'new' ? 'new' : 'skip' };
      return { ...previous, roleChoices: { ...previous.roleChoices, [role]: nextChoice } };
    });
  }, [setState]);

  const pickExistingIssue = useCallback((role: PrbJiraRole, issue: PrbExistingIssue) => {
    setState((previous) => ({ ...previous, roleChoices: { ...previous.roleChoices, [role]: { mode: 'existing', issue } } }));
  }, [setState]);

  const changeRoleSearchText = useCallback((role: PrbJiraRole, searchText: string) => {
    setState((previous) => withRoleSearch(previous, role, { searchText }));
  }, [setState]);

  const runRoleSearch = useCallback(async (role: PrbJiraRole, searchText: string) => {
    setState((previous) => withRoleSearch(previous, role, { results: { status: 'loading', items: [] } }));
    try {
      const items = await searchExistingIssues(searchText);
      setState((previous) => withRoleSearch(previous, role, { results: { status: 'ready', items } }));
    } catch {
      setState((previous) => withRoleSearch(previous, role, { results: { status: 'failed', items: [] } }));
    }
  }, [setState]);

  return { chooseRoleMode, pickExistingIssue, changeRoleSearchText, runRoleSearch };
}

// ── Create ──

function useCreateAction(setState: Dispatch<SetStateAction<PrbWizardState>>) {
  return useCallback(async (state: PrbWizardState) => {
    if (!state.chosenProblem) return;
    // After a first press, what it did is the starting point: a retry does only the rest.
    const startingProgress = state.createResult?.progress ?? EMPTY_PRB_PROGRESS;
    setState((previous) => ({ ...previous, stepId: 'result', isCreating: true }));
    const createResult = await createPrbJiraWork({
      prbNumber: state.chosenProblem.number,
      projectKey: state.projectKey,
      epicKey: state.chosenEpic?.key ?? '',
      drafts: state.drafts,
      roleChoices: state.roleChoices,
      startingProgress,
    });
    setState((previous) => ({ ...previous, isCreating: false, createResult }));
  }, [setState]);
}

// ── Hook ──

/** The job's state and every action its screens call. */
export function usePrbWizardState() {
  const [state, setState] = useState<PrbWizardState>(createInitialState);
  const { runProblemSearch, checkExistingWork } = useProblemActions(setState);
  const { loadProjects, runEpicSearch } = useJiraPlaceActions(setState);
  const choiceActions = useChoiceActions(setState);
  const createAll = useCreateAction(setState);

  const chooseProblem = useCallback((problem: PrbSearchResult) => {
    setState((previous) => ({ ...previous, chosenProblem: problem, roleSearches: createIdleRoleSearches(), createResult: null }));
  }, []);

  const chooseProject = useCallback((projectKey: string) => {
    rememberPrbProject(projectKey);
    setState((previous) => ({ ...previous, projectKey }));
  }, []);

  const updateDraft = useCallback((role: PrbJiraRole, edit: PrbDraftEdit) => {
    setState((previous) => ({
      ...previous,
      drafts: previous.drafts.map((draft) => (draft.role === role ? { ...draft, ...edit } : draft)),
    }));
  }, []);

  const goNext = useCallback(() => {
    if (state.stepId === 'find' && state.chosenProblem) void checkExistingWork(state.chosenProblem.number);
    if (state.stepId === 'confirm' && state.projectList.status !== 'ready') void loadProjects();
    if (readNeighbourStep(state, 1) === 'result') {
      void createAll(state);
      return;
    }
    setState((previous) => withDraftsFor({ ...previous, stepId: readNeighbourStep(previous, 1) }));
  }, [checkExistingWork, createAll, loadProjects, state]);

  const goBack = useCallback(() => {
    setState((previous) => ({ ...previous, stepId: readNeighbourStep(previous, -1) }));
  }, []);

  const patchState = useCallback((patch: Partial<PrbWizardState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const retryRest = useCallback(() => { void createAll(state); }, [createAll, state]);

  return {
    state,
    actions: {
      patchState, runProblemSearch, chooseProblem, checkExistingWork, loadProjects, chooseProject,
      runEpicSearch, updateDraft, goNext, goBack, retryRest, ...choiceActions,
    },
  };
}

// ── Step gate ──

/** Whether Next may be pressed on the current screen, and if not, the plain reason shown beneath it. */
export interface PrbStepGate {
  canGoNext: boolean;
  blockedReason?: string;
}

function readDraftsGate(state: PrbWizardState): PrbStepGate {
  const newRoles = readNewRoles(state.roleChoices);
  const newDrafts = state.drafts.filter((draft) => newRoles.includes(draft.role));
  const isEverySummaryFilled = newDrafts.length > 0 && newDrafts.every((draft) => draft.summary.trim() !== '');
  return isEverySummaryFilled ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Give every item a summary' };
}

function readConfirmGate(state: PrbWizardState): PrbStepGate {
  if (state.existingWork.status === 'checking') return { canGoNext: false, blockedReason: 'Checking Jira for work already made…' };
  if (state.existingWork.status !== 'done') return { canGoNext: false, blockedReason: 'Jira must be checked for work already made — press Try again' };
  return { canGoNext: true };
}

function readPickedKeys(state: PrbWizardState): string[] {
  return PRB_JIRA_ROLES.flatMap((role) => {
    const choice = state.roleChoices[role];
    return choice.mode === 'existing' && choice.issue ? [choice.issue.key] : [];
  });
}

function readChooseGate(state: PrbWizardState): PrbStepGate {
  const unpickedRole = PRB_JIRA_ROLES.find((role) => {
    const choice = state.roleChoices[role];
    return choice.mode === 'existing' && choice.issue === null;
  });
  if (unpickedRole) return { canGoNext: false, blockedReason: `Pick the ${PRB_ROLE_NAMES[unpickedRole]} from the search results` };
  const pickedKeys = readPickedKeys(state);
  if (new Set(pickedKeys).size !== pickedKeys.length) return { canGoNext: false, blockedReason: 'One Jira issue cannot be two of the items — pick a different one' };
  if (!hasPrbWorkToDo(state.chosenProblem?.number ?? '', state.roleChoices)) {
    return { canGoNext: false, blockedReason: 'Everything chosen is already in Jira and linked — choose "Make a new one" for an item, or go back to home' };
  }
  return { canGoNext: true };
}

/** Next's gate for every screen: each screen needs its one decision made before moving on. */
export function readPrbStepGate(state: PrbWizardState): PrbStepGate {
  switch (state.stepId) {
    case 'find':
      return state.chosenProblem ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Choose a problem from the list' };
    case 'confirm':
      return readConfirmGate(state);
    case 'choose':
      return readChooseGate(state);
    case 'place':
      if (state.projectKey === '') return { canGoNext: false, blockedReason: 'Choose the Jira project' };
      return state.chosenEpic ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Choose the Epic from the search results' };
    case 'drafts':
      return readDraftsGate(state);
    default:
      return state.isCreating ? { canGoNext: false, blockedReason: 'Creating the items in Jira…' } : { canGoNext: true };
  }
}
