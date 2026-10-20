// changeWizardSession.test.ts — Proves the change wizard keeps each job's own progress, survives a reload, and forgets on discard.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  CHANGE_SESSION_STORAGE_KEY,
  buildChangeStorageKey,
  createChangeWizardSession,
  markStepReviewed,
  useChangeWizardSessionStore,
} from './changeWizardSession.ts';

describe('changeWizardSession', () => {
  beforeEach(() => {
    localStorage.clear();
    useChangeWizardSessionStore.setState({ sessions: {} });
  });

  it('starts a session on the first step of its mode', () => {
    expect(createChangeWizardSession('create')).toMatchObject({ mode: 'create', currentStepId: 'scope', reviewedStepIds: [], modify: null });
    expect(createChangeWizardSession('modify').currentStepId).toBe('whichChange');
  });

  it('keeps each job apart, and remembers it in the browser', () => {
    const store = useChangeWizardSessionStore.getState();
    store.ensureSession('job-a', 'create');
    store.ensureSession('job-b', 'modify');
    store.updateSession('job-a', { areChecksAcknowledged: true });
    const sessions = useChangeWizardSessionStore.getState().sessions;
    expect(sessions['job-a'].areChecksAcknowledged).toBe(true);
    expect(sessions['job-b'].areChecksAcknowledged).toBe(false);
    expect(localStorage.getItem(CHANGE_SESSION_STORAGE_KEY)).toContain('job-a');
  });

  it('never replaces a session that already exists', () => {
    const store = useChangeWizardSessionStore.getState();
    store.ensureSession('job-a', 'create');
    store.updateSession('job-a', { currentStepId: 'planning' });
    store.ensureSession('job-a', 'create');
    expect(useChangeWizardSessionStore.getState().sessions['job-a'].currentStepId).toBe('planning');
  });

  it('forgets a discarded job and its draft', () => {
    const store = useChangeWizardSessionStore.getState();
    store.ensureSession('job-a', 'create');
    localStorage.setItem(buildChangeStorageKey('job-a'), '{}');
    store.removeSession('job-a');
    expect(useChangeWizardSessionStore.getState().sessions['job-a']).toBeUndefined();
    expect(localStorage.getItem(buildChangeStorageKey('job-a'))).toBeNull();
  });

  it('names the draft slot the way the contract says', () => {
    expect(buildChangeStorageKey('abc')).toBe('snowWizard:change:abc');
  });

  it('adds a reviewed step once', () => {
    expect(markStepReviewed(['scope'], 'scope')).toEqual(['scope']);
    expect(markStepReviewed(['scope'], 'details')).toEqual(['scope', 'details']);
  });
});
