// checklistStateApi.test.ts — Unit tests for the daily-checklist client wrapper.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDailyChecklist, setCategoryComplete } from './checklistStateApi.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchDailyChecklist', () => {
  it('requests the per-user/day endpoint and returns the completed map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ completed: { 'cat-1': { completedAt: 'x' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDailyChecklist('jane smith', '2026-06-30');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sm-checklist-state?user=jane%20smith&day=2026-06-30',
    );
    expect(result).toHaveProperty('cat-1');
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchDailyChecklist('jsmith', '2026-06-30')).rejects.toThrow(/HTTP 500/);
  });
});

describe('setCategoryComplete', () => {
  it('posts the category payload and returns the updated map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ completed: { 'cat-1': { completedAt: 'x' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setCategoryComplete({
      userKey: 'jsmith',
      day: '2026-06-30',
      categoryId: 'cat-1',
      isComplete: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sm-checklist-state',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toHaveProperty('cat-1');
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      setCategoryComplete({ userKey: 'jsmith', day: '2026-06-30', categoryId: 'cat-1', isComplete: false }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
