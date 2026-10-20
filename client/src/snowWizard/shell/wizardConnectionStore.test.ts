// wizardConnectionStore.test.ts — Proves the Wizard tracks each system's connection separately and only calls itself
// ready when both are live.

import { beforeEach, describe, expect, it } from 'vitest';

import { isWizardReady, useWizardConnectionStore } from './wizardConnectionStore.ts';

beforeEach(() => {
  useWizardConnectionStore.getState().resetConnections();
});

describe('useWizardConnectionStore', () => {
  it('starts with both systems not connected', () => {
    const { snow, jira } = useWizardConnectionStore.getState();
    expect(snow.status).toBe('notConnected');
    expect(jira.status).toBe('notConnected');
    expect(isWizardReady(snow, jira)).toBe(false);
  });

  it('is ready only when both systems are connected', () => {
    useWizardConnectionStore.getState().setConnection('snow', { status: 'connected', identity: 'A' });
    expect(isWizardReady(useWizardConnectionStore.getState().snow, useWizardConnectionStore.getState().jira)).toBe(false);
    useWizardConnectionStore.getState().setConnection('jira', { status: 'connected', identity: 'A' });
    expect(isWizardReady(useWizardConnectionStore.getState().snow, useWizardConnectionStore.getState().jira)).toBe(true);
  });

  it('keeps the other system untouched when one changes', () => {
    useWizardConnectionStore.getState().setConnection('snow', { status: 'connected', identity: 'A' });
    useWizardConnectionStore.getState().setConnection('jira', { status: 'expired', detail: 'gone' });
    expect(useWizardConnectionStore.getState().snow.identity).toBe('A');
    expect(useWizardConnectionStore.getState().jira).toEqual({ status: 'expired', identity: '', detail: 'gone' });
  });
});
