// wizardJobStore.test.ts — Proves the Wizard keeps one resumable job per kind and tidies finished ones away.

import { beforeEach, describe, expect, it } from 'vitest';

import { FINISHED_JOB_RETENTION_DAYS, JOB_STORAGE_KEY, useWizardJobStore } from './wizardJobStore.ts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const START_TIME = Date.parse('2026-10-20T09:00:00Z');

beforeEach(() => {
  localStorage.clear();
  useWizardJobStore.setState({ jobs: {} });
});

describe('useWizardJobStore', () => {
  it('starts a new job with its own storage key prefixed snowWizard:', () => {
    const { job, isResumed } = useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    expect(isResumed).toBe(false);
    expect(job.kind).toBe('newChange');
    expect(job.status).toBe('inProgress');
    expect(job.payloadKey.startsWith('snowWizard:newChange:')).toBe(true);
  });

  it('hands back the in-progress job of that kind instead of starting a second one', () => {
    const firstStart = useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    const secondStart = useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME + 1000);
    expect(secondStart.isResumed).toBe(true);
    expect(secondStart.job.jobId).toBe(firstStart.job.jobId);
  });

  it('keeps different kinds independent', () => {
    useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    const prbStart = useWizardJobStore.getState().startJob('prbToJira', 'find', START_TIME);
    expect(prbStart.isResumed).toBe(false);
  });

  it('records the step the user reached', () => {
    useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    useWizardJobStore.getState().recordStep('newChange', 'details', START_TIME + 5);
    expect(useWizardJobStore.getState().jobs.newChange?.stepId).toBe('details');
  });

  it('discarding lets a fresh job start', () => {
    const firstStart = useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    useWizardJobStore.getState().discardJob('newChange');
    const freshStart = useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    expect(freshStart.job.jobId).not.toBe(firstStart.job.jobId);
  });

  it('keeps a finished job for the result screen, then prunes it after the retention period', () => {
    useWizardJobStore.getState().startJob('newChange', 'scope', START_TIME);
    useWizardJobStore.getState().finishJob('newChange', START_TIME);

    useWizardJobStore.getState().pruneFinishedJobs(START_TIME + (FINISHED_JOB_RETENTION_DAYS - 1) * MILLISECONDS_PER_DAY);
    expect(useWizardJobStore.getState().jobs.newChange?.status).toBe('finished');

    useWizardJobStore.getState().pruneFinishedJobs(START_TIME + (FINISHED_JOB_RETENTION_DAYS + 1) * MILLISECONDS_PER_DAY);
    expect(useWizardJobStore.getState().jobs.newChange).toBeUndefined();
  });

  it('saves jobs in the browser under one snowWizard: key', () => {
    useWizardJobStore.getState().startJob('reviewChange', 'which', START_TIME);
    expect(localStorage.getItem(JOB_STORAGE_KEY)).toContain('reviewChange');
  });
});
