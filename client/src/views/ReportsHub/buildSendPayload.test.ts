// Tests for the Reports Hub send-payload shaping helpers.

import { describe, expect, it } from 'vitest';

import { buildFeatureChangeSendPayload, buildScopeChangeSendPayload, surfaceForTab } from './buildSendPayload.ts';
import type { FeatureChangeEntry, ScopeChangeEntry } from './hooks/useReportsHubState.ts';

describe('surfaceForTab', () => {
  it('maps the scope and feature change tabs to surfaces', () => {
    expect(surfaceForTab('scopeChange')).toBe('scope-change');
    expect(surfaceForTab('featureChange')).toBe('feature-change');
  });

  it('returns undefined for non-deliverable tabs', () => {
    expect(surfaceForTab('dashboard')).toBeUndefined();
  });
});

describe('buildScopeChangeSendPayload', () => {
  it('splits entries into release (fixVersion) and sprint changes', () => {
    const entries = [
      { changeType: 'fixVersion', issueKey: 'A-1' },
      { changeType: 'sprint', issueKey: 'A-2' },
      { changeType: 'fixVersion', issueKey: 'A-3' },
    ] as unknown as ScopeChangeEntry[];

    const payload = buildScopeChangeSendPayload(entries);

    expect(payload.releaseChanges).toHaveLength(2);
    expect(payload.sprintChanges).toHaveLength(1);
  });
});

describe('buildFeatureChangeSendPayload', () => {
  it('wraps entries in a featureChanges field', () => {
    const entries = [{ changeType: 'status' }] as unknown as FeatureChangeEntry[];
    expect(buildFeatureChangeSendPayload(entries)).toEqual({ featureChanges: entries });
  });
});
