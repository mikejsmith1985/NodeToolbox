// diagnosticsStore.test.ts — Proves diagnostics stay off unless somebody deliberately turns them on,
// and that unlocking Admin Hub is not on its own enough to reveal raw Jira field ids.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  canShowBoardDiagnostics,
  readStoredBoardDiagnosticsEnabled,
  useDiagnosticsStore,
} from './diagnosticsStore.ts';

beforeEach(() => {
  localStorage.clear();
  useDiagnosticsStore.setState({ isBoardDiagnosticsEnabled: false });
});

describe('canShowBoardDiagnostics — two gates, and both must be open', () => {
  it('stays hidden for an ordinary viewer', () => {
    expect(canShowBoardDiagnostics(false, false)).toBe(false);
  });

  it('stays hidden for an admin who has NOT switched it on', () => {
    // The property that matters most: unlocking Admin Hub for something unrelated must not put raw
    // custom field ids on somebody's board.
    expect(canShowBoardDiagnostics(true, false)).toBe(false);
  });

  it('stays hidden when the toggle is on but the viewer is locked out', () => {
    // A flag left on by an admin must not leak to the next person who opens the app locked.
    expect(canShowBoardDiagnostics(false, true)).toBe(false);
  });

  it('shows only when both are true', () => {
    expect(canShowBoardDiagnostics(true, true)).toBe(true);
  });
});

describe('the stored flag', () => {
  it('is off when nothing has ever been stored', () => {
    expect(readStoredBoardDiagnosticsEnabled()).toBe(false);
  });

  it('is off for any stored value other than the explicit on marker', () => {
    // Anything ambiguous means off — a diagnostics surface must never appear by accident.
    for (const storedValue of ['0', 'true', 'yes', '', 'null']) {
      localStorage.setItem('tbxFeatureBoardDiagnostics', storedValue);
      expect(readStoredBoardDiagnosticsEnabled()).toBe(false);
    }
  });

  it('is on only for the explicit marker', () => {
    localStorage.setItem('tbxFeatureBoardDiagnostics', '1');
    expect(readStoredBoardDiagnosticsEnabled()).toBe(true);
  });
});

describe('setBoardDiagnosticsEnabled', () => {
  it('persists the choice, so it survives a reload rather than resetting mid-investigation', () => {
    useDiagnosticsStore.getState().setBoardDiagnosticsEnabled(true);

    expect(localStorage.getItem('tbxFeatureBoardDiagnostics')).toBe('1');
    expect(useDiagnosticsStore.getState().isBoardDiagnosticsEnabled).toBe(true);
  });

  it('turns back off, and records that it is off rather than removing the key', () => {
    useDiagnosticsStore.getState().setBoardDiagnosticsEnabled(true);
    useDiagnosticsStore.getState().setBoardDiagnosticsEnabled(false);

    expect(localStorage.getItem('tbxFeatureBoardDiagnostics')).toBe('0');
    expect(useDiagnosticsStore.getState().isBoardDiagnosticsEnabled).toBe(false);
  });
});
