// useCreatedTaskNumbers.ts — Reads back the task numbers of a job's created changes it does not know yet.

import { useEffect } from 'react';

import type { ChangeWizardSession } from './changeWizardSession.ts';
import { listCreatedChangeTasks, type CreatedTasksByChange } from './createdChanges.ts';

/**
 * Reads the task numbers of any created change the job does not know them for yet — a change picked up by number, or
 * a job from before they were kept — so the AI prompt and "Create in ServiceNow" always show them. One read per change.
 */
export function useCreatedTaskNumbers(session: ChangeWizardSession, updateSession: (update: Partial<ChangeWizardSession>) => void): void {
  const missingNumbersText = session.createdChanges
    .map((createdChange) => createdChange.changeNumber)
    .filter((changeNumber) => session.createdTasks?.[changeNumber] === undefined)
    .join(' ');
  const knownTasks = session.createdTasks;
  useEffect(() => {
    if (missingNumbersText === '') return undefined;
    let isCurrent = true;
    void (async () => {
      const readTasks: CreatedTasksByChange = {};
      for (const changeNumber of missingNumbersText.split(' ')) {
        try { readTasks[changeNumber] = await listCreatedChangeTasks(changeNumber); } catch { readTasks[changeNumber] = []; }
      }
      if (isCurrent) updateSession({ createdTasks: { ...knownTasks, ...readTasks } });
    })();
    return () => { isCurrent = false; };
  }, [missingNumbersText, knownTasks, updateSession]);
}
