// changeWizardSession.ts — What the change wizard remembers per job beyond the change draft itself: step, reviews, plan, results.
//
// The change's own values live in useCrgState under `snowWizard:change:<jobId>`. Everything the wizard adds on top
// (which steps were passed, the tasks each change was made with, the AI verdict, the create results) is kept here, with
// zustand's own persist middleware — the same framework the shell's job store uses — so a reload resumes the job.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CrgHook } from './changeDraft.ts';
import type { ChangeWizardMode, ChangeWizardStepId } from './changeWizardSteps.ts';
import type { CreatedChangeSummary } from './createOutcome.ts';
import type { PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import type { StepValueMap } from './modifyDiff.ts';
import type { ExistingTaskLink } from './modifyTasks.ts';

/** A modify's memory of the change as it was loaded. */
export interface ModifySession {
  changeNumber: string;
  stateLabel: string;
  /** The tracked record values at load, for the conflict check before saving. */
  loadedSnapshot: Record<string, string>;
  /** The draft's step values at load, for marking which steps were edited. */
  loadedStepValues: StepValueMap;
  /** The tasks the change had when loaded, as "number — short description". */
  existingTaskNames: string[];
  /** The change's own id, so its tasks can be saved without looking it up again (absent in older jobs). */
  changeSysId?: string;
  /** Which cards are the change's own tasks, so saving rewrites only edited ones (absent in older jobs). */
  existingTasks?: ExistingTaskLink[];
}

/** Everything one change job remembers. */
export interface ChangeWizardSession {
  mode: ChangeWizardMode;
  currentStepId: ChangeWizardStepId;
  reviewedStepIds: ChangeWizardStepId[];
  /** Each environment's tasks as the user built them, kept when the changes are made so the result can list them. */
  taskNamesByEnvironment?: Partial<Record<PlanEnvironmentKey, string[]>>;
  riskReview: { isReady: boolean } | null;
  areChecksAcknowledged: boolean;
  isPaperworkDone: boolean;
  evidenceFileNames: string[];
  createdChanges: CreatedChangeSummary[];
  outcomeNotes: string[];
  failureText: string | null;
  /** Per change number: "attached" or why the evidence could not be attached. */
  evidenceResults: Record<string, string>;
  modify: ModifySession | null;
  /** The last checks verdict, so a resumed job knows the checks passed before they are re-run. */
  wereChecksReady: boolean;
  /**
   * The environments switched on. Toolbox's draft deliberately forgets these ticks on reload (a Toolbox decision),
   * so a resumed Wizard job puts them back from here.
   */
  enabledEnvironments: PlanEnvironmentKey[];
  /**
   * The step a fix button was pressed on ("Will it pass review?"), so the step it opened offers one button straight
   * back instead of making the user press Next through every finished step (GH #468). Absent in older jobs.
   */
  returnToStepId?: ChangeWizardStepId | null;
}

/** How a step asks to move: `shouldReturnHere` makes the next screen's Next lead straight back to this step. */
export interface StepMoveOptions {
  shouldReturnHere?: boolean;
}

/** What every step screen receives: the draft hook, the job's session, and the way to move to another step. */
export interface ChangeStepProps {
  crg: CrgHook;
  session: ChangeWizardSession;
  updateSession: (update: Partial<ChangeWizardSession>) => void;
  goToStep: (stepId: ChangeWizardStepId, options?: StepMoveOptions) => void;
}

/** Where every job's session is kept in this browser. */
export const CHANGE_SESSION_STORAGE_KEY = 'snowWizard:changeSessions';

/** The useCrgState draft slot for one job (contracts/change-wizard.md). */
export function buildChangeStorageKey(jobId: string): string {
  return `snowWizard:change:${jobId}`;
}

/** A fresh session, on the first step of its mode. */
export function createChangeWizardSession(mode: ChangeWizardMode): ChangeWizardSession {
  return {
    mode,
    currentStepId: mode === 'modify' ? 'whichChange' : 'scope',
    reviewedStepIds: [],
    riskReview: null,
    areChecksAcknowledged: false,
    isPaperworkDone: false,
    evidenceFileNames: [],
    createdChanges: [],
    outcomeNotes: [],
    failureText: null,
    evidenceResults: {},
    modify: null,
    wereChecksReady: false,
    enabledEnvironments: [],
    returnToStepId: null,
  };
}

/** The reviewed list with one more step, never repeated. */
export function markStepReviewed(reviewedStepIds: readonly ChangeWizardStepId[], stepId: ChangeWizardStepId): ChangeWizardStepId[] {
  return reviewedStepIds.includes(stepId) ? [...reviewedStepIds] : [...reviewedStepIds, stepId];
}

interface ChangeWizardSessionState {
  sessions: Record<string, ChangeWizardSession>;
  ensureSession: (jobId: string, mode: ChangeWizardMode) => void;
  updateSession: (jobId: string, update: Partial<ChangeWizardSession>) => void;
  removeSession: (jobId: string) => void;
}

/** Every change job's session, kept across reloads. */
export const useChangeWizardSessionStore = create<ChangeWizardSessionState>()(persist((setState) => ({
  sessions: {},
  ensureSession: (jobId, mode) => setState((state) => (state.sessions[jobId]
    ? state : { sessions: { ...state.sessions, [jobId]: createChangeWizardSession(mode) } })),
  updateSession: (jobId, update) => setState((state) => {
    const existingSession = state.sessions[jobId];
    return existingSession ? { sessions: { ...state.sessions, [jobId]: { ...existingSession, ...update } } } : state;
  }),
  removeSession: (jobId) => setState((state) => {
    const remainingSessions = { ...state.sessions };
    delete remainingSessions[jobId];
    try { localStorage.removeItem(buildChangeStorageKey(jobId)); } catch { /* the draft is gone with the browser's data anyway */ }
    return { sessions: remainingSessions };
  }),
}), { name: CHANGE_SESSION_STORAGE_KEY, storage: createJSONStorage(() => localStorage), partialize: (state) => ({ sessions: state.sessions }) }));
