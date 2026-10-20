// useStartingPoint.ts — Starts a new change from somewhere: a copy of a change raised before, or a saved template.
//
// Both reuse Toolbox's own draft actions — cloneFromChg (the Create CHG tab's "Clone CHG") and applyTemplate — run
// once when the job opens. The status tells the job screen what to say: still copying, copied, failed, or filled in.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgHook } from './changeDraft.ts';

/** Where a new change begins, when not blank. */
export type ChangeStartingPoint =
  | { kind: 'existingChange'; changeNumber: string }
  | { kind: 'template'; template: CrgTemplate; ctaskTemplates: CtaskTemplate[] };

/** What the job screen tells the user about the starting point. */
export type StartingPointStatus =
  | { kind: 'none' }
  | { kind: 'copying'; changeNumber: string }
  | { kind: 'copied'; changeNumber: string }
  | { kind: 'failed'; changeNumber: string; message: string }
  | { kind: 'applied'; templateName: string };

/** The status, plus the ways to retry a failed copy and to put the message away. */
export interface StartingPointHandle {
  status: StartingPointStatus;
  retry: () => void;
  dismiss: () => void;
}

/** The status of a copy, from the draft's own cloning flags. */
function readCopyStatus(crg: CrgHook, changeNumber: string, hasCopyFinished: boolean): StartingPointStatus {
  if (crg.state.isCloning || !hasCopyFinished) return { kind: 'copying', changeNumber };
  if (crg.state.cloneError) return { kind: 'failed', changeNumber, message: crg.state.cloneError };
  return { kind: 'copied', changeNumber };
}

/** Applies the starting point once, and reports how it went. */
export function useStartingPoint(crg: CrgHook, startingPoint: ChangeStartingPoint | null): StartingPointHandle {
  const hasStartedRef = useRef(false);
  const [hasCopyFinished, setHasCopyFinished] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { setCloneChgNumber, cloneFromChg, applyTemplate } = crg.actions;
  const cloneNumberInDraft = crg.state.cloneChgNumber;

  const runCopy = useCallback(() => { void cloneFromChg().then(() => setHasCopyFinished(true)); }, [cloneFromChg]);

  useEffect(() => {
    if (!startingPoint || hasStartedRef.current) return;
    if (startingPoint.kind === 'template') {
      hasStartedRef.current = true;
      applyTemplate(startingPoint.template, startingPoint.ctaskTemplates);
      return;
    }
    // cloneFromChg reads the number from the draft, so the number goes in first and the copy runs on the next pass.
    if (cloneNumberInDraft !== startingPoint.changeNumber) {
      setCloneChgNumber(startingPoint.changeNumber);
      return;
    }
    hasStartedRef.current = true;
    runCopy();
  }, [startingPoint, cloneNumberInDraft, applyTemplate, setCloneChgNumber, runCopy]);

  const dismiss = useCallback(() => setIsDismissed(true), []);
  if (!startingPoint || isDismissed) return { status: { kind: 'none' }, retry: runCopy, dismiss };
  if (startingPoint.kind === 'template') return { status: { kind: 'applied', templateName: startingPoint.template.name }, retry: runCopy, dismiss };
  return { status: readCopyStatus(crg, startingPoint.changeNumber, hasCopyFinished), retry: runCopy, dismiss };
}
