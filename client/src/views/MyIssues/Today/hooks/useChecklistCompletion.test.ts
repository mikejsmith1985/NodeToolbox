// useChecklistCompletion.test.ts — Unit tests for the daily check-off hook.
//
// The checklist-state API and the identity fetch are mocked. We verify auto-completion when a
// count is zero, the merge of manual completions over live counts, that a manual toggle
// persists through the API, and that the business-day key anchors the persisted state.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockFetchDailyChecklist, mockSetCategoryComplete } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchDailyChecklist: vi.fn(),
  mockSetCategoryComplete: vi.fn(),
}));

vi.mock('../../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../../../../services/checklistStateApi.ts', () => ({
  fetchDailyChecklist: mockFetchDailyChecklist,
  setCategoryComplete: mockSetCategoryComplete,
}));

import { mostRecentBusinessDayKey } from '../../../../utils/businessDays.ts';
import { CATEGORY_CATALOG, type CategoryId } from '../todayCategories.ts';
import { useChecklistCompletion } from './useChecklistCompletion.ts';

const EXPECTED_DAY_KEY = mostRecentBusinessDayKey();

/** Builds a full count map, defaulting every category to zero unless overridden. */
function buildCounts(overrides: Partial<Record<CategoryId, number>> = {}): Record<CategoryId, number> {
  const counts = {} as Record<CategoryId, number>;
  for (const catalogEntry of CATEGORY_CATALOG) {
    counts[catalogEntry.id] = overrides[catalogEntry.id] ?? 0;
  }
  return counts;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue({ accountId: 'acc-1', name: 'jsmith' });
  mockFetchDailyChecklist.mockResolvedValue({});
  mockSetCategoryComplete.mockResolvedValue({});
});

describe('useChecklistCompletion', () => {
  it('auto-completes every category when all counts are zero', async () => {
    const { result } = renderHook(() => useChecklistCompletion(buildCounts()));

    await waitFor(() => expect(mockFetchDailyChecklist).toHaveBeenCalled());

    expect(result.current.completionByCategory.mentions).toBe(true);
    expect(result.current.isDoneForToday).toBe(true);
  });

  it('merges a manual completion over a non-zero count', async () => {
    mockFetchDailyChecklist.mockResolvedValue({ mentions: { completedAt: '2026-06-30T10:00:00.000Z' } });

    const { result } = renderHook(() => useChecklistCompletion(buildCounts({ mentions: 3 })));

    await waitFor(() => expect(result.current.completionByCategory.mentions).toBe(true));

    expect(result.current.isDoneForToday).toBe(true);
  });

  it('persists a manual toggle through the checklist-state API with the business-day key', async () => {
    // A manual completion on a counted category lets us observe when the identity load finishes.
    mockFetchDailyChecklist.mockResolvedValue({ unassigned: { completedAt: 'x' } });

    const { result } = renderHook(() =>
      useChecklistCompletion(buildCounts({ blockers: 2, unassigned: 2 })),
    );

    await waitFor(() => expect(result.current.completionByCategory.unassigned).toBe(true));

    await act(async () => {
      await result.current.toggle('blockers');
    });

    expect(mockSetCategoryComplete).toHaveBeenCalledWith({
      userKey: 'acc-1',
      day: EXPECTED_DAY_KEY,
      categoryId: 'blockers',
      isComplete: true,
    });
  });

  it('does not auto-complete a category whose count is non-zero', async () => {
    const { result } = renderHook(() => useChecklistCompletion(buildCounts({ blockers: 4 })));

    await waitFor(() => expect(mockFetchDailyChecklist).toHaveBeenCalled());

    expect(result.current.completionByCategory.blockers).toBe(false);
    expect(result.current.isDoneForToday).toBe(false);
  });
});
