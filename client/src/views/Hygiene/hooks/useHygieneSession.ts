// useHygieneSession.ts — Ephemeral state machine for the guided hygiene cleanup session.
//
// The session walks the filtered findings with a visible cursor. Outcomes are honest by
// construction (spec 019 clarification #1): only fix / comment / an explicit Skip settle a
// finding — merely advancing past one leaves it untouched, and the end-of-session summary
// reports all four buckets separately so progress is never overstated. Nothing persists:
// the whole machine lives in component state (spec: fresh list ⇒ fresh session).

import { useCallback, useEffect, useRef, useState } from 'react';

/** The ways a finding can be settled during a session; untouched = no recorded outcome. */
export type HygieneSessionOutcome = 'fixed' | 'commented' | 'skipped';

/** The honest end-of-session report — the four buckets always sum to totalCount. */
export interface HygieneSessionSummary {
  totalCount: number;
  fixedCount: number;
  commentedCount: number;
  skippedCount: number;
  untouchedCount: number;
}

// Outcome strength: an acted-on finding never downgrades (fixed > commented > skipped).
const OUTCOME_PRECEDENCE: Record<HygieneSessionOutcome, number> = { fixed: 3, commented: 2, skipped: 1 };

/** Returns true when the keyboard event originated in a form field — typing never navigates. */
function isTypingTarget(keyboardEvent: KeyboardEvent): boolean {
  const eventTarget = keyboardEvent.target;
  if (!(eventTarget instanceof HTMLElement)) return false;
  const targetTagName = eventTarget.tagName;
  return targetTagName === 'INPUT'
    || targetTagName === 'TEXTAREA'
    || targetTagName === 'SELECT'
    || eventTarget.isContentEditable;
}

/** Owns the cleanup-session state: cursor, per-finding outcomes, keyboard flow, and summary. */
export function useHygieneSession() {
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [outcomeByKey, setOutcomeByKey] = useState<Record<string, HygieneSessionOutcome>>({});
  const [endedSummary, setEndedSummary] = useState<HygieneSessionSummary | null>(null);
  // Ref mirrors let endSession read the latest keys/outcomes from stable callbacks (the keyboard
  // effect holds them) without impure nested state updaters.
  const orderedKeysRef = useRef<string[]>([]);
  const outcomeByKeyRef = useRef<Record<string, HygieneSessionOutcome>>({});

  const currentKey: string | null = isSessionActive ? (orderedKeys[cursorIndex] ?? null) : null;

  const startSession = useCallback((findingKeys: string[]) => {
    orderedKeysRef.current = findingKeys;
    outcomeByKeyRef.current = {};
    setOrderedKeys(findingKeys);
    setCursorIndex(0);
    setOutcomeByKey({});
    setEndedSummary(null);
    setIsSessionActive(true);
  }, []);

  const endSession = useCallback(() => {
    setIsSessionActive(false);
    setEndedSummary(buildSessionSummary(orderedKeysRef.current, outcomeByKeyRef.current));
  }, []);

  const dismissSummary = useCallback(() => setEndedSummary(null), []);

  const goNext = useCallback(() => {
    setCursorIndex((currentIndex) => Math.min(currentIndex + 1, Math.max(0, orderedKeys.length - 1)));
  }, [orderedKeys.length]);

  const goPrevious = useCallback(() => {
    setCursorIndex((currentIndex) => Math.max(0, currentIndex - 1));
  }, []);

  /** Records an outcome, honoring precedence so an acted-on finding never downgrades. */
  const recordOutcome = useCallback((findingKey: string, outcome: HygieneSessionOutcome) => {
    const existingOutcome = outcomeByKeyRef.current[findingKey];
    if (existingOutcome && OUTCOME_PRECEDENCE[existingOutcome] >= OUTCOME_PRECEDENCE[outcome]) {
      return;
    }
    outcomeByKeyRef.current = { ...outcomeByKeyRef.current, [findingKey]: outcome };
    setOutcomeByKey(outcomeByKeyRef.current);
  }, []);

  const markFixed = useCallback((findingKey: string) => recordOutcome(findingKey, 'fixed'), [recordOutcome]);
  const markCommented = useCallback((findingKey: string) => recordOutcome(findingKey, 'commented'), [recordOutcome]);

  /** The explicit Skip action: records the outcome on the CURRENT finding and advances. */
  const skipCurrent = useCallback(() => {
    if (currentKey === null) return;
    recordOutcome(currentKey, 'skipped');
    goNext();
  }, [currentKey, goNext, recordOutcome]);

  /** Ends the session when the finding list changes underneath it (fresh list ⇒ fresh session). */
  const syncWithKeys = useCallback((latestKeys: string[]) => {
    if (!isSessionActive) return;
    const hasSameKeys = latestKeys.length === orderedKeys.length
      && latestKeys.every((findingKey, keyIndex) => findingKey === orderedKeys[keyIndex]);
    if (!hasSameKeys) {
      endSession();
    }
  }, [endSession, isSessionActive, orderedKeys]);

  // Keyboard flow — attached only while a session is active; typing in a field never navigates.
  useEffect(() => {
    if (!isSessionActive) return;

    function handleSessionKeyDown(keyboardEvent: KeyboardEvent): void {
      if (isTypingTarget(keyboardEvent)) return;
      if (keyboardEvent.key === 'ArrowRight') { keyboardEvent.preventDefault(); goNext(); }
      if (keyboardEvent.key === 'ArrowLeft') { keyboardEvent.preventDefault(); goPrevious(); }
      if (keyboardEvent.key.toLowerCase() === 's') { keyboardEvent.preventDefault(); skipCurrent(); }
      if (keyboardEvent.key === 'Escape') { keyboardEvent.preventDefault(); endSession(); }
    }

    window.addEventListener('keydown', handleSessionKeyDown);
    return () => window.removeEventListener('keydown', handleSessionKeyDown);
  }, [endSession, goNext, goPrevious, isSessionActive, skipCurrent]);

  return {
    isSessionActive,
    cursorIndex,
    orderedKeys,
    currentKey,
    outcomeByKey,
    endedSummary,
    startSession,
    endSession,
    dismissSummary,
    goNext,
    goPrevious,
    markFixed,
    markCommented,
    skipCurrent,
    syncWithKeys,
  };
}

/** Computes the four-bucket summary; the buckets always sum to the session size. */
function buildSessionSummary(
  sessionKeys: string[],
  outcomes: Record<string, HygieneSessionOutcome>,
): HygieneSessionSummary {
  let fixedCount = 0;
  let commentedCount = 0;
  let skippedCount = 0;
  for (const findingKey of sessionKeys) {
    const findingOutcome = outcomes[findingKey];
    if (findingOutcome === 'fixed') fixedCount++;
    else if (findingOutcome === 'commented') commentedCount++;
    else if (findingOutcome === 'skipped') skippedCount++;
  }
  return {
    totalCount: sessionKeys.length,
    fixedCount,
    commentedCount,
    skippedCount,
    untouchedCount: sessionKeys.length - fixedCount - commentedCount - skippedCount,
  };
}
