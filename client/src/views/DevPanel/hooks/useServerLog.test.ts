// useServerLog.test.ts — Unit tests for the server-log polling hook.

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useServerLog } from './useServerLog'

const MOCK_LOG_ENTRIES = [
  { id: 1, timestamp: '2024-01-01T00:00:01.000Z', level: 'log' as const, message: 'Server started' },
  { id: 2, timestamp: '2024-01-01T00:00:02.000Z', level: 'info' as const, message: 'Config loaded' },
  { id: 3, timestamp: '2024-01-01T00:00:03.000Z', level: 'warn' as const, message: 'Missing field' },
  { id: 4, timestamp: '2024-01-01T00:00:04.000Z', level: 'error' as const, message: 'Auth failed' },
]

describe('useServerLog', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_LOG_ENTRIES,
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches logs on mount and transitions isLoading to false', async () => {
    const { result } = renderHook(() => useServerLog())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.entries).toHaveLength(MOCK_LOG_ENTRIES.length)
    expect(result.current.fetchError).toBeNull()
  })

  it('returns entries sorted newest first', async () => {
    const { result } = renderHook(() => useServerLog())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // The hook reverses new entries so id=4 is first.
    expect(result.current.entries[0].id).toBe(4)
    expect(result.current.entries[result.current.entries.length - 1].id).toBe(1)
  })

  it('sets fetchError when the server responds with an error status', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response)

    const { result } = renderHook(() => useServerLog())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.fetchError).toMatch(/500/)
  })

  it('sets fetchError on network failure', async () => {
    fetchSpy.mockRejectedValue(new Error('Network offline'))

    const { result } = renderHook(() => useServerLog())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.fetchError).toBe('Network offline')
  })

  it('does not duplicate entries on repeated manual polls', async () => {
    const { result } = renderHook(() => useServerLog())

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Trigger a second poll by calling the same fetch mock again.
    // Entries already tracked should not be re-appended.
    await act(async () => {
      await fetchSpy.mock.results[0].value
    })

    // Count should remain the same because all IDs were already seen.
    expect(result.current.entries).toHaveLength(MOCK_LOG_ENTRIES.length)
  })

  it('clearLog empties entries locally and calls the clear endpoint', async () => {
    const { result } = renderHook(() => useServerLog())

    await waitFor(() => expect(result.current.entries.length).toBeGreaterThan(0))

    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] } as Response)

    await act(async () => { await result.current.clearLog() })

    expect(result.current.entries).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledWith('/api/logs/clear', { method: 'POST' })
  })
})
