// wizardJobStore.ts — Remembers the Wizard job in progress of each kind, so closing the window never loses work
// (data-model.md WizardJob). Uses zustand's own persist middleware rather than hand-written storage code.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WizardJobKind = 'newChange' | 'modifyChange' | 'prbToJira' | 'reviewChange';

/** One run of a job: where the user got to, and where its entries are kept. */
export interface WizardJob {
  jobId: string;
  kind: WizardJobKind;
  stepId: string;
  status: 'inProgress' | 'finished';
  updatedAt: number;
  /** Storage key holding the job's own entries (e.g. the change draft). */
  payloadKey: string;
}

export const JOB_STORAGE_KEY = 'snowWizard:jobs';
/** A finished job stays for the result screen this long, then is tidied away. */
export const FINISHED_JOB_RETENTION_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface WizardJobState {
  jobs: Partial<Record<WizardJobKind, WizardJob>>;
  startJob: (kind: WizardJobKind, firstStepId: string, now: number) => { job: WizardJob; isResumed: boolean };
  recordStep: (kind: WizardJobKind, stepId: string, now: number) => void;
  finishJob: (kind: WizardJobKind, now: number) => void;
  discardJob: (kind: WizardJobKind) => void;
  pruneFinishedJobs: (now: number) => void;
}

function createJob(kind: WizardJobKind, firstStepId: string, now: number): WizardJob {
  const jobId = crypto.randomUUID();
  return { jobId, kind, stepId: firstStepId, status: 'inProgress', updatedAt: now, payloadKey: `snowWizard:${kind}:${jobId}` };
}

/** The job store. One in-progress job per kind; starting again hands back that job so the user can resume it. */
export const useWizardJobStore = create<WizardJobState>()(persist((setState, getState) => ({
  jobs: {},
  startJob: (kind, firstStepId, now) => {
    const existingJob = getState().jobs[kind];
    if (existingJob && existingJob.status === 'inProgress') return { job: existingJob, isResumed: true };
    const newJob = createJob(kind, firstStepId, now);
    setState((state) => ({ jobs: { ...state.jobs, [kind]: newJob } }));
    return { job: newJob, isResumed: false };
  },
  recordStep: (kind, stepId, now) => setState((state) => {
    const existingJob = state.jobs[kind];
    return existingJob ? { jobs: { ...state.jobs, [kind]: { ...existingJob, stepId, updatedAt: now } } } : state;
  }),
  finishJob: (kind, now) => setState((state) => {
    const existingJob = state.jobs[kind];
    return existingJob ? { jobs: { ...state.jobs, [kind]: { ...existingJob, status: 'finished', updatedAt: now } } } : state;
  }),
  discardJob: (kind) => setState((state) => {
    const remainingJobs = { ...state.jobs };
    delete remainingJobs[kind];
    return { jobs: remainingJobs };
  }),
  pruneFinishedJobs: (now) => setState((state) => {
    const retentionMs = FINISHED_JOB_RETENTION_DAYS * MILLISECONDS_PER_DAY;
    const keptEntries = Object.entries(state.jobs).filter(([, job]) => job && (job.status !== 'finished' || now - job.updatedAt <= retentionMs));
    return { jobs: Object.fromEntries(keptEntries) };
  }),
}), { name: JOB_STORAGE_KEY, storage: createJSONStorage(() => localStorage), partialize: (state) => ({ jobs: state.jobs }) }));
