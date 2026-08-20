// intReadiness.test.ts — The PI's Definition of Done, and the trap in checking it.
//
// A Feature is INT-ready when EVERY non-cancelled child is. An all-satisfied check over an empty set
// returns true, which would report a Feature nobody has started as having met the PI commitment —
// the single most damaging thing this module could get wrong, and the least visible.
//
// The other rule worth stating: an instance with no sub-status field has not FAILED the check, it
// could not RUN it. "Not checked" and "not ready" are different claims and are kept apart.

import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_TEST_SUB_STATUS,
  isInternalTestReady,
  readIntReadyState,
  rollUpFeatureIntReadiness,
} from './intReadiness.ts';
import type { IntReadinessInput } from './forecastTypes.ts';

function input(overrides: Partial<IntReadinessInput> = {}): IntReadinessInput {
  return {
    statusName: 'Ready for Testing',
    subStatusValue: INTEGRATION_TEST_SUB_STATUS,
    hasSubStatusField: true,
    ...overrides,
  };
}

function child(issueKey: string, overrides: Partial<IntReadinessInput> = {}) {
  return { issueKey, ...input(overrides) };
}

describe('readIntReadyState', () => {
  it('accepts the status and sub-status pair that means Integration Test', () => {
    expect(readIntReadyState(input())).toBe('int-ready');
  });

  it('matches regardless of casing or padding, because Jira spelling varies', () => {
    expect(readIntReadyState(input({ statusName: '  ready for testing ', subStatusValue: 'integration test' })))
      .toBe('int-ready');
  });

  it('rejects the same status under a different sub-status', () => {
    // SL Testing and Integration Test share a status; the sub-status is the only thing telling them
    // apart, which is why a board without one cannot express this workflow at all.
    expect(readIntReadyState(input({ subStatusValue: 'Testing' }))).toBe('not-int-ready');
  });

  it('rejects a different status entirely', () => {
    expect(readIntReadyState(input({ statusName: 'Working', subStatusValue: null }))).toBe('not-int-ready');
  });

  it('reports a cancelled issue as cancelled rather than as not ready', () => {
    expect(readIntReadyState(input({ statusName: 'Cancelled', subStatusValue: null }))).toBe('cancelled');
  });

  it('says NOT CHECKED when the instance has no sub-status field', () => {
    // Not the same claim as "not ready". One is a verdict; the other is the absence of one.
    expect(readIntReadyState(input({ hasSubStatusField: false }))).toBe('unknown-sub-status');
  });
});

describe('isInternalTestReady', () => {
  it('accepts Ready for Testing with no sub-status — the state that releases SL to start', () => {
    expect(isInternalTestReady(input({ subStatusValue: null }))).toBe(true);
  });

  it('treats a blank sub-status as none', () => {
    expect(isInternalTestReady(input({ subStatusValue: '   ' }))).toBe(true);
  });

  it('rejects Ready for Testing once a sub-status has been set', () => {
    expect(isInternalTestReady(input())).toBe(false);
  });

  it('rejects any other status', () => {
    expect(isInternalTestReady(input({ statusName: 'Working', subStatusValue: null }))).toBe(false);
  });

  it('reads the status and sub-status directly, never a board column', () => {
    // A team that has not added the Internal Test Ready column to its saved vocabulary still gets a
    // correct chain forecast; they simply see the card in Unmapped. The column is presentation.
    expect(isInternalTestReady({ statusName: 'Ready for Testing', subStatusValue: null, hasSubStatusField: false }))
      .toBe(true);
  });
});

describe('rollUpFeatureIntReadiness', () => {
  it('reports a Feature whose every child is INT-ready as INT-ready', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [child('ENC-1'), child('ENC-2'), child('ENC-3')]);
    expect(readiness.state).toBe('int-ready');
    expect(readiness.blockingIssueKeys).toEqual([]);
  });

  it('names the child holding a Feature back, rather than only a percentage', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [
      child('ENC-1'),
      child('ENC-2', { statusName: 'Working', subStatusValue: null }),
    ]);
    expect(readiness.state).toBe('not-int-ready');
    expect(readiness.blockingIssueKeys).toEqual(['ENC-2']);
  });

  it('ignores cancelled children for the verdict but still lists them', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [
      child('ENC-1'),
      child('ENC-2', { statusName: 'Cancelled', subStatusValue: null }),
    ]);
    expect(readiness.state).toBe('int-ready');
    expect(readiness.cancelledIssueKeys).toEqual(['ENC-2']);
  });

  it('reports a Feature whose work was all cancelled as cancelled, not as done', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [
      child('ENC-1', { statusName: 'Cancelled', subStatusValue: null }),
    ]);
    expect(readiness.state).toBe('cancelled');
  });

  it('reports a Feature with NO children as not ready, never as complete', () => {
    // The load-bearing negative. An all-satisfied check over an empty set returns true, which would
    // report an untouched Feature as having met the PI commitment.
    const readiness = rollUpFeatureIntReadiness('DENP-1', []);
    expect(readiness.state).toBe('not-int-ready');
    expect(readiness.blockingIssueKeys).toEqual([]);
    expect(readiness.contributingIssueCount).toBe(0);
  });

  it('reports the whole Feature as NOT CHECKED when any child could not be evaluated', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [
      child('ENC-1'),
      child('ENC-2', { hasSubStatusField: false }),
    ]);
    expect(readiness.state).toBe('unknown-sub-status');
  });

  it('counts only the children that count toward the verdict', () => {
    const readiness = rollUpFeatureIntReadiness('DENP-1', [
      child('ENC-1'),
      child('ENC-2', { statusName: 'Cancelled', subStatusValue: null }),
    ]);
    expect(readiness.contributingIssueCount).toBe(1);
  });

  it('carries the Feature key through', () => {
    expect(rollUpFeatureIntReadiness('DENP-9', []).featureKey).toBe('DENP-9');
  });
});
