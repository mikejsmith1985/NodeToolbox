// useHygieneSession.test.ts — Unit tests for the guided cleanup session state machine.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useHygieneSession } from './useHygieneSession.ts';

const THREE_KEYS = ['TBX-1', 'TBX-2', 'TBX-3'];

function startedSession(keys: string[] = THREE_KEYS) {
  const rendered = renderHook(() => useHygieneSession());
  act(() => rendered.result.current.startSession(keys));
  return rendered;
}

describe('useHygieneSession', () => {
  it('starts inactive and activates on startSession with the cursor at the first finding', () => {
    const { result } = renderHook(() => useHygieneSession());
    expect(result.current.isSessionActive).toBe(false);

    act(() => result.current.startSession(THREE_KEYS));

    expect(result.current.isSessionActive).toBe(true);
    expect(result.current.cursorIndex).toBe(0);
    expect(result.current.currentKey).toBe('TBX-1');
  });

  it('clamps cursor navigation at both ends', () => {
    const { result } = startedSession();

    act(() => result.current.goPrevious());
    expect(result.current.cursorIndex).toBe(0);

    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.cursorIndex).toBe(2);
  });

  it('merely navigating past findings records NO outcome — untouched stays untouched', () => {
    const { result } = startedSession();

    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.endSession());

    expect(result.current.endedSummary).toEqual({
      totalCount: 3, fixedCount: 0, commentedCount: 0, skippedCount: 0, untouchedCount: 3,
    });
  });

  it('skip records the outcome and advances; fix and comment record without advancing (FR-014)', () => {
    const { result } = startedSession();

    act(() => result.current.skipCurrent());
    expect(result.current.outcomeByKey['TBX-1']).toBe('skipped');
    expect(result.current.cursorIndex).toBe(1);

    act(() => result.current.markCommented('TBX-2'));
    expect(result.current.outcomeByKey['TBX-2']).toBe('commented');
    expect(result.current.cursorIndex).toBe(1);

    act(() => result.current.markFixed('TBX-2'));
    expect(result.current.outcomeByKey['TBX-2']).toBe('fixed');
  });

  it('never downgrades an outcome: fixed beats commented beats skipped', () => {
    const { result } = startedSession();

    act(() => result.current.markFixed('TBX-1'));
    act(() => result.current.markCommented('TBX-1'));
    expect(result.current.outcomeByKey['TBX-1']).toBe('fixed');

    act(() => result.current.markCommented('TBX-2'));
    act(() => result.current.skipCurrent());
    // TBX-2 is not current (cursor is at 0), so skipCurrent applies to TBX-1 — which is fixed
    // and must not downgrade.
    expect(result.current.outcomeByKey['TBX-1']).toBe('fixed');
    expect(result.current.outcomeByKey['TBX-2']).toBe('commented');
  });

  it('ends with an honest four-bucket summary that sums to the session size', () => {
    const { result } = startedSession();

    act(() => result.current.markCommented('TBX-1'));
    act(() => result.current.goNext());
    act(() => result.current.skipCurrent());
    act(() => result.current.endSession());

    expect(result.current.isSessionActive).toBe(false);
    expect(result.current.endedSummary).toEqual({
      totalCount: 3, fixedCount: 0, commentedCount: 1, skippedCount: 1, untouchedCount: 1,
    });

    act(() => result.current.dismissSummary());
    expect(result.current.endedSummary).toBeNull();
  });

  it('ends the session when the finding list changes (fresh list ⇒ fresh session)', () => {
    const { result } = startedSession();

    act(() => result.current.syncWithKeys(['TBX-9', 'TBX-10']));

    expect(result.current.isSessionActive).toBe(false);
  });

  it('keeps the session alive when syncWithKeys reports the same list', () => {
    const { result } = startedSession();

    act(() => result.current.syncWithKeys(THREE_KEYS));

    expect(result.current.isSessionActive).toBe(true);
  });

  it('drives navigation and skip from the keyboard while active', () => {
    const { result } = startedSession();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(result.current.cursorIndex).toBe(1);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(result.current.cursorIndex).toBe(0);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); });
    expect(result.current.outcomeByKey['TBX-1']).toBe('skipped');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(result.current.isSessionActive).toBe(false);
    expect(result.current.endedSummary?.skippedCount).toBe(1);
  });

  it('ignores keys typed into form fields — writing a comment never navigates or skips', () => {
    const { result } = startedSession();
    const commentBox = document.createElement('textarea');
    document.body.appendChild(commentBox);

    act(() => {
      commentBox.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
      commentBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(result.current.cursorIndex).toBe(0);
    expect(result.current.outcomeByKey['TBX-1']).toBeUndefined();
    commentBox.remove();
  });
});
