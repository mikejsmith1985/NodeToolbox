// useChecklistCompletion.ts — Daily check-off state for the "Today" dashboard.
//
// A category counts as "done for today" when it is either auto-complete (its live count is
// zero) or the user has manually ticked it off. Manual completions are persisted per user and
// per business day through the checklist-state API, so the list resets on the next working day
// without any scheduler. This hook merges the live counts with the persisted manual state.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../../services/jiraApi.ts';
import {
  fetchDailyChecklist,
  setCategoryComplete,
  type ChecklistCompletionMap,
} from '../../../../services/checklistStateApi.ts';
import { mostRecentBusinessDayKey } from '../../../../utils/businessDays.ts';
import {
  CATEGORY_CATALOG,
  isDoneForToday as evaluateIsDoneForToday,
  type CategoryId,
} from '../todayCategories.ts';

const MYSELF_PATH = '/rest/api/2/myself';

/** What the dashboard needs to render and toggle the daily checklist. */
export interface ChecklistCompletionData {
  completionByCategory: Record<CategoryId, boolean>;
  toggle: (categoryId: CategoryId) => Promise<void>;
  isDoneForToday: boolean;
}

/** Raw shape of the /rest/api/2/myself response we rely on for the per-user key. */
interface JiraMyself {
  accountId?: string | null;
  name?: string | null;
  key?: string | null;
  displayName?: string | null;
}

/** Resolves the stable per-user key the same way the Mentions report does. */
async function loadCurrentUserKey(): Promise<string> {
  const myself = await jiraGet<JiraMyself>(MYSELF_PATH);
  return myself.accountId || myself.name || myself.key || myself.displayName || '';
}

/** Merges live counts with manual completions: a category is done if auto-complete OR ticked. */
function buildCompletionMap(
  countByCategory: Record<CategoryId, number>,
  manualCompletions: ChecklistCompletionMap,
): Record<CategoryId, boolean> {
  const completionMap = {} as Record<CategoryId, boolean>;
  for (const catalogEntry of CATEGORY_CATALOG) {
    const isAutoComplete = (countByCategory[catalogEntry.id] ?? 0) === 0;
    const isManuallyComplete = Boolean(manualCompletions[catalogEntry.id]);
    completionMap[catalogEntry.id] = isAutoComplete || isManuallyComplete;
  }
  return completionMap;
}

/** Returns a new manual-completion map with one category added or removed. */
function applyManualCompletion(
  previous: ChecklistCompletionMap,
  categoryId: CategoryId,
  isComplete: boolean,
): ChecklistCompletionMap {
  const next = { ...previous };
  if (isComplete) {
    next[categoryId] = { completedAt: new Date().toISOString() };
  } else {
    delete next[categoryId];
  }
  return next;
}

/**
 * Owns the daily check-off state for the Today dashboard.
 *
 * @param countByCategory Live counts per category; a count of zero auto-completes the card.
 */
export function useChecklistCompletion(
  countByCategory: Record<CategoryId, number>,
): ChecklistCompletionData {
  const [manualCompletions, setManualCompletions] = useState<ChecklistCompletionMap>({});
  const [userKey, setUserKey] = useState<string>('');
  // Anchor the whole view to the most recent working day so weekend visits show Friday's list.
  const dayKey = useMemo(() => mostRecentBusinessDayKey(), []);

  useEffect(() => {
    let isMounted = true;

    async function loadCompletions(): Promise<void> {
      try {
        const resolvedUserKey = await loadCurrentUserKey();
        const completions = await fetchDailyChecklist(resolvedUserKey, dayKey);
        if (!isMounted) return;
        setUserKey(resolvedUserKey);
        setManualCompletions(completions);
      } catch {
        // A failed load must never block the dashboard — treat it as no manual completions.
      }
    }

    void loadCompletions();
    return () => {
      isMounted = false;
    };
  }, [dayKey]);

  const completionByCategory = useMemo(
    () => buildCompletionMap(countByCategory, manualCompletions),
    [countByCategory, manualCompletions],
  );

  const toggle = useCallback(
    async (categoryId: CategoryId): Promise<void> => {
      if (!userKey) {
        return;
      }

      const isCurrentlyComplete = Boolean(manualCompletions[categoryId]);
      const nextComplete = !isCurrentlyComplete;
      // Optimistically flip so the card reacts immediately; roll back if the write fails.
      setManualCompletions((previous) => applyManualCompletion(previous, categoryId, nextComplete));

      try {
        const updatedCompletions = await setCategoryComplete({
          userKey,
          day: dayKey,
          categoryId,
          isComplete: nextComplete,
        });
        setManualCompletions(updatedCompletions);
      } catch {
        setManualCompletions((previous) => applyManualCompletion(previous, categoryId, isCurrentlyComplete));
      }
    },
    [userKey, dayKey, manualCompletions],
  );

  return {
    completionByCategory,
    toggle,
    isDoneForToday: evaluateIsDoneForToday(completionByCategory),
  };
}
