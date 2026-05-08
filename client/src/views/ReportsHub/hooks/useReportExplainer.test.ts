// useReportExplainer.test.ts — Tests for the per-tab explainer card collapsible state hook.

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useReportExplainer } from './useReportExplainer.ts'

const EXPLAINER_STORAGE_KEY = 'tbxReportsHubHelp'

describe('useReportExplainer', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to collapsed=true for any tab not yet in localStorage', () => {
    const { result } = renderHook(() => useReportExplainer())
    expect(result.current.isTabExplainerCollapsed('features')).toBe(true)
    expect(result.current.isTabExplainerCollapsed('throughput')).toBe(true)
  })

  it('expands the explainer card when toggleTabExplainer is called once', () => {
    const { result } = renderHook(() => useReportExplainer())
    act(() => { result.current.toggleTabExplainer('flow') })
    expect(result.current.isTabExplainerCollapsed('flow')).toBe(false)
  })

  it('collapses back when toggleTabExplainer is called a second time', () => {
    const { result } = renderHook(() => useReportExplainer())
    act(() => { result.current.toggleTabExplainer('risks') })
    act(() => { result.current.toggleTabExplainer('risks') })
    expect(result.current.isTabExplainerCollapsed('risks')).toBe(true)
  })

  it('toggling one tab does not affect another tab', () => {
    const { result } = renderHook(() => useReportExplainer())
    act(() => { result.current.toggleTabExplainer('quality') })
    expect(result.current.isTabExplainerCollapsed('quality')).toBe(false)
    expect(result.current.isTabExplainerCollapsed('defects')).toBe(true)
  })

  it('persists the collapsed state to localStorage after a toggle', () => {
    const { result } = renderHook(() => useReportExplainer())
    act(() => { result.current.toggleTabExplainer('individual') })
    const stored = JSON.parse(localStorage.getItem(EXPLAINER_STORAGE_KEY) ?? '{}') as Record<string, boolean>
    expect(stored.individual).toBe(false)
  })

  it('loads a previously expanded tab from localStorage on mount', () => {
    localStorage.setItem(EXPLAINER_STORAGE_KEY, JSON.stringify({ defects: false }))
    const { result } = renderHook(() => useReportExplainer())
    expect(result.current.isTabExplainerCollapsed('defects')).toBe(false)
    // Other tabs still default to collapsed
    expect(result.current.isTabExplainerCollapsed('features')).toBe(true)
  })

  it('defaults to collapsed=true when localStorage contains invalid JSON', () => {
    localStorage.setItem(EXPLAINER_STORAGE_KEY, 'not{valid}json')
    const { result } = renderHook(() => useReportExplainer())
    expect(result.current.isTabExplainerCollapsed('features')).toBe(true)
  })
})
