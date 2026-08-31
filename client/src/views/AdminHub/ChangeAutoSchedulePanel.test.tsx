// ChangeAutoSchedulePanel.test.tsx — The Admin Hub panel for the change auto-start sweeper.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChangeAutoSchedulePanel } from './ChangeAutoSchedulePanel.tsx'

const DEFAULT_CONFIG = { isEnabled: false, isDryRun: false, intervalMin: 5, leadTimeMinutes: 0 }

/** One recorded sweep in the shape the runs endpoint returns. */
function buildRun(overrides = {}) {
  return {
    ranAtIso: '2026-08-31T09:00:00.000Z',
    isDryRun: false,
    scheduledChangeNumbers: [] as string[],
    failures: [] as { changeNumber: string; message: string }[],
    skipReason: '',
    consideredCount: 0,
    ...overrides,
  }
}

/** Routes fetch by URL so each endpoint answers independently. */
function mockEndpoints(options: { config?: unknown; runs?: unknown[]; runNow?: unknown } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/config')) {
      return { ok: true, json: async () => options.config ?? DEFAULT_CONFIG } as Response
    }
    if (url.includes('/runs')) {
      return { ok: true, json: async () => ({ runs: options.runs ?? [] }) } as Response
    }
    return { ok: true, json: async () => options.runNow ?? { ok: true, run: buildRun() } } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChangeAutoSchedulePanel', () => {
  it('shows the saved configuration once loaded', async () => {
    mockEndpoints({ config: { isEnabled: true, isDryRun: false, intervalMin: 15, leadTimeMinutes: 30 } })

    render(<ChangeAutoSchedulePanel />)

    await waitFor(() => expect(screen.getByLabelText('Enable auto-start')).toBeChecked())
    expect(screen.getByLabelText('Sweep interval in minutes')).toHaveValue(15)
    expect(screen.getByLabelText('Lead time in minutes')).toHaveValue(30)
  })

  it('states that a write needs the relay, so a quiet sweep is not a mystery', async () => {
    mockEndpoints()

    render(<ChangeAutoSchedulePanel />)

    await waitFor(() => expect(screen.getByLabelText('Enable auto-start')).toBeInTheDocument())
    expect(screen.getByText(/relay bookmarklet/i)).toBeInTheDocument()
  })

  it('saves the enabled toggle immediately, without a separate Save click', async () => {
    const fetchMock = mockEndpoints()
    render(<ChangeAutoSchedulePanel />)
    await waitFor(() => expect(screen.getByLabelText('Enable auto-start')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('Enable auto-start'))

    await waitFor(() => {
      const savePosts = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes('/config') && (init as RequestInit | undefined)?.method === 'POST')
      expect(savePosts).toHaveLength(1)
    })
  })

  it('reports why a sweep changed nothing instead of looking like it did nothing', async () => {
    mockEndpoints({
      runNow: { ok: true, run: buildRun({ skipReason: 'The ServiceNow relay bookmarklet is not registered, so no change could be updated.' }) },
    })
    render(<ChangeAutoSchedulePanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sweep Now' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Sweep Now' }))

    expect(await screen.findByText(/relay bookmarklet is not registered/i)).toBeInTheDocument()
  })

  it('names what a sweep moved', async () => {
    mockEndpoints({ runNow: { ok: true, run: buildRun({ scheduledChangeNumbers: ['CHG0046897'], consideredCount: 3 }) } })
    render(<ChangeAutoSchedulePanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sweep Now' })).toBeEnabled())

    await userEvent.click(screen.getByRole('button', { name: 'Sweep Now' }))

    expect(await screen.findByText(/Started CHG0046897/)).toBeInTheDocument()
  })

  it('blocks Sweep Now while the form holds unsaved edits, since a sweep reads the SAVED config', async () => {
    mockEndpoints()
    render(<ChangeAutoSchedulePanel />)
    await waitFor(() => expect(screen.getByLabelText('Dry run')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('Dry run'))

    expect(screen.getByRole('button', { name: 'Sweep Now' })).toBeDisabled()
    expect(screen.getByText(/Unsaved changes/i)).toBeInTheDocument()
  })

  it('lists recent sweeps, including one that moved nothing', async () => {
    mockEndpoints({
      runs: [
        buildRun({ ranAtIso: '2026-08-31T09:05:00.000Z', scheduledChangeNumbers: ['CHG1'] }),
        buildRun({ ranAtIso: '2026-08-31T09:00:00.000Z', consideredCount: 2 }),
      ],
    })

    render(<ChangeAutoSchedulePanel />)

    expect(await screen.findByText(/Started CHG1/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing was due \(2 change\(s\) checked\)/)).toBeInTheDocument()
  })

  it('offers a retry instead of hanging on Loading when the load fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, statusText: 'Bad Gateway' } as Response)))

    render(<ChangeAutoSchedulePanel />)

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
