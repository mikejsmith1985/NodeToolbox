// usePrbWizardState.ts — Holds everything the "Turn a problem into Jira work" job knows, step by step, and the
// actions that move it forward. The screens only draw this state, so going Back never loses an entry.

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import type { JiraProject } from '../../types/jira.ts';
import { createPrbJiraWork, EMPTY_PRB_PROGRESS, findExistingPrbWork, type PrbCreateProgress, type PrbCreateResult } from './prbJiraCreate.ts';
import { buildPrbJiraDrafts, buildPrbRecordLink, type PrbJiraDraft, type PrbJiraRole } from './prbJiraPlan.ts';
import {
  loadJiraProjects,
  readRememberedPrbProject,
  readSnowInstanceOrigin,
  rememberPrbProject,
  searchOpenEpics,
  searchProblems,
  type EpicSearchResult,
  type PrbSearchResult,
} from './prbLookups.ts';

// ── Types ──

/** The job's screens, in order. */
export type PrbStepId = 'find' | 'confirm' | 'place' | 'drafts' | 'result';

/** The screens in the order they are walked. */
export const PRB_STEP_IDS: readonly PrbStepId[] = ['find', 'confirm', 'place', 'drafts', 'result'];

/** A list read from ServiceNow or Jira, and where that read stands. */
export interface LoadedList<Item> {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  items: Item[];
}

/** Whether Jira has been checked for work already made for the chosen problem. */
export interface ExistingWorkCheck {
  status: 'idle' | 'checking' | 'done' | 'failed';
  progress: PrbCreateProgress;
}

/** Everything the job holds. */
export interface PrbWizardState {
  stepId: PrbStepId;
  problemSearchText: string;
  problemSearch: LoadedList<PrbSearchResult>;
  chosenProblem: PrbSearchResult | null;
  existingWork: ExistingWorkCheck;
  isNewSetConfirmed: boolean;
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

function createInitialState(): PrbWizardState {
  return {
    stepId: 'find',
    problemSearchText: '',
    problemSearch: { ...IDLE_LIST, items: [] },
    chosenProblem: null,
    existingWork: { status: 'idle', progress: EMPTY_PRB_PROGRESS },
    isNewSetConfirmed: false,
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
  return Object.values(existingWork.progress.createdKeys).some(Boolean);
}

function buildDraftsSourceKey(state: PrbWizardState): string {
  return [state.chosenProblem?.number, state.projectKey, state.chosenEpic?.key].join('|');
}

/** Fresh drafts when the problem, project or Epic changed; otherwise the user's edits are kept. */
function withDraftsFor(state: PrbWizardState): PrbWizardState {
  const sourceKey = buildDraftsSourceKey(state);
  if (!state.chosenProblem || !state.chosenEpic || sourceKey === state.draftsSourceKey) return state;
  const problem = state.chosenProblem;
  const source = { ...problem, link: buildPrbRecordLink(readSnowInstanceOrigin(), problem.number) };
  return { ...state, drafts: buildPrbJiraDrafts(source, state.chosenEpic.key, state.projectKey), draftsSourceKey: sourceKey };
}

function readNeighbourStep(stepId: PrbStepId, offset: number): PrbStepId {
  const nextIndex = PRB_STEP_IDS.indexOf(stepId) + offset;
  return PRB_STEP_IDS[Math.min(Math.max(nextIndex, 0), PRB_STEP_IDS.length - 1)];
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
    setState((previous) => ({ ...previous, existingWork: { status: 'checking', progress: EMPTY_PRB_PROGRESS } }));
    try {
      const progress = await findExistingPrbWork(prbNumber);
      setState((previous) => ({ ...previous, existingWork: { status: 'done', progress } }));
    } catch {
      setState((previous) => ({ ...previous, existingWork: { status: 'failed', progress: EMPTY_PRB_PROGRESS } }));
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

// ── Create ──

function useCreateAction(setState: Dispatch<SetStateAction<PrbWizardState>>) {
  return useCallback(async (state: PrbWizardState) => {
    if (!state.chosenProblem || !state.chosenEpic) return;
    // After a first press, what it made is the starting point and Jira is not re-read: a retry makes only the rest.
    const startingProgress = state.createResult?.progress ?? EMPTY_PRB_PROGRESS;
    const shouldReuseExisting = state.createResult === null && !state.isNewSetConfirmed;
    setState((previous) => ({ ...previous, stepId: 'result', isCreating: true }));
    const createResult = await createPrbJiraWork({
      prbNumber: state.chosenProblem.number,
      projectKey: state.projectKey,
      epicKey: state.chosenEpic.key,
      drafts: state.drafts,
      startingProgress,
      shouldReuseExisting,
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
  const createAll = useCreateAction(setState);

  const chooseProblem = useCallback((problem: PrbSearchResult) => {
    setState((previous) => ({ ...previous, chosenProblem: problem, isNewSetConfirmed: false, createResult: null }));
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
    if (state.stepId === 'drafts') {
      void createAll(state);
      return;
    }
    setState((previous) => withDraftsFor({ ...previous, stepId: readNeighbourStep(previous.stepId, 1) }));
  }, [checkExistingWork, createAll, loadProjects, state]);

  const goBack = useCallback(() => {
    setState((previous) => ({ ...previous, stepId: readNeighbourStep(previous.stepId, -1) }));
  }, []);

  const patchState = useCallback((patch: Partial<PrbWizardState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const retryRest = useCallback(() => { void createAll(state); }, [createAll, state]);

  return {
    state,
    actions: {
      patchState, runProblemSearch, chooseProblem, checkExistingWork, loadProjects, chooseProject,
      runEpicSearch, updateDraft, goNext, goBack, retryRest,
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
  const isEverySummaryFilled = state.drafts.length > 0 && state.drafts.every((draft) => draft.summary.trim() !== '');
  return isEverySummaryFilled ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Give every item a summary' };
}

function readConfirmGate(state: PrbWizardState): PrbStepGate {
  if (state.existingWork.status === 'checking') return { canGoNext: false, blockedReason: 'Checking Jira for work already made…' };
  if (state.existingWork.status !== 'done') return { canGoNext: false, blockedReason: 'Jira must be checked for work already made — press Try again' };
  return { canGoNext: true };
}

/** Next's gate for every screen: each screen needs its one decision made before moving on. */
export function readPrbStepGate(state: PrbWizardState): PrbStepGate {
  switch (state.stepId) {
    case 'find':
      return state.chosenProblem ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Choose a problem from the list' };
    case 'confirm':
      return readConfirmGate(state);
    case 'place':
      if (state.projectKey === '') return { canGoNext: false, blockedReason: 'Choose the Jira project' };
      return state.chosenEpic ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Choose the Epic from the search results' };
    case 'drafts':
      return readDraftsGate(state);
    default:
      return state.isCreating ? { canGoNext: false, blockedReason: 'Creating the items in Jira…' } : { canGoNext: true };
  }
}
