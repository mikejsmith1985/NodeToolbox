// useLastGenerated.test.ts — Tests for the per-tab last-generated timestamp hook and formatter.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatRelativeTime, useLastGenerated } from './useLastGenerated.ts'

const LAST_GENERATED_STORAGE_KEY = 'tbxReportsLastGenerated'

describe('formatRelativeTime', () => {
  it('returns "just now" when fewer than 10 seconds have elapsed', () => {
    const recentTimestamp = new Date(Date.now() - 5000).toISOString()
    expect(formatRelativeTime(recentTimestamp)).toBe('just now')
  })

  it('returns "N seconds ago" when between 10 and 59 seconds have elapsed', () => {
    const timestamp = new Date(Date.now() - 30000).toISOString()
    expect(formatRelativeTime(timestamp)).toBe('30 seconds ago')
  })

  it('returns "1 minute ago" when exactly 60 seconds have elapsed', () => {
    const timestamp = new Date(Date.now() - 60000).toISOString()
    expect(formatRelativeTime(timestamp)).toBe('1 minute ago')
  })

  it('returns "N minutes ago" (plural) when more than 1 minute has elapsed', () => {
    const timestamp = new Date(Date.now() - 180000).toISOString()
    expect(formatRelativeTime(timestamp)).toBe('3 minutes ago')
  })

  it('returns "1 hour ago" when exactly 1 hour has elapsed', () => {
    const timestamp = new Date(Date.now() - 3_600_000).toISOString()
    expect(formatRelativeTime(timestamp)).toBe('1 hour ago')
  })

  it('returns "N hours ago" (plural) when more than 1 hour has elapsed', () => {
    const timestamp = new Date(Date.now() - 7_200_000).toISOString()
    expect(formatRelativeTime(timestamp)).toBe('2 hours ago')
  })
})

describe('useLastGenerated', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('returns null for a tab that has never been generated', () => {
    const { result } = renderHook(() => useLastGenerated())
    expect(result.current.getTabTimestamp('features')).toBeNull()
  })

  it('returns a non-null timestamp after markGenerated is called', () => {
    const { result } = renderHook(() => useLastGenerated())
    act(() => { result.current.markGenerated('defects') })
    expect(result.current.getTabTimestamp('defects')).not.toBeNull()
  })

  it('persists the timestamp to localStorage after markGenerated', () => {
    const { result } = renderHook(() => useLastGenerated())
    act(() => { result.current.markGenerated('risks') })
    const stored = JSON.parse(localStorage.getItem(LAST_GENERATED_STORAGE_KEY) ?? '{}') as Record<string, string>
    expect(typeof stored.risks).toBe('string')
  })

  it('loads a pre-existing timestamp from localStorage on mount', () => {
    const savedTimestamp = '2024-01-01T12:00:00.000Z'
    localStorage.setItem(LAST_GENERATED_STORAGE_KEY, JSON.stringify({ quality: savedTimestamp }))
    const { result } = renderHook(() => useLastGenerated())
    expect(result.current.getTabTimestamp('quality')).toBe(savedTimestamp)
  })

  it('returns null for all tabs when localStorage contains malformed JSON', () => {
    localStorage.setItem(LAST_GENERATED_STORAGE_KEY, '{bad json')
    const { result } = renderHook(() => useLastGenerated())
    expect(result.current.getTabTimestamp('features')).toBeNull()
  })

  it('marking one tab does not overwrite another tab timestamp', () => {
    const { result } = renderHook(() => useLastGenerated())
    act(() => { result.current.markGenerated('flow') })
    const timestampAfterFlow = result.current.getTabTimestamp('flow')
    act(() => { result.current.markGenerated('impact') })
    expect(result.current.getTabTimestamp('flow')).toBe(timestampAfterFlow)
    expect(result.current.getTabTimestamp('impact')).not.toBeNull()
  })
})
