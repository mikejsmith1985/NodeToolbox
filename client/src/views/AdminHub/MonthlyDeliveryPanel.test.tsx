// MonthlyDeliveryPanel.test.tsx — Admin Hub panel behavior for the Monthly Delivery Report
// scheduler (feature 018): config load/snapshot/save, Run Now gating, last-run display, Copy Prompt.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MonthlyDeliveryPanel } from './MonthlyDeliveryPanel.tsx'

// The panel snapshots Team Dashboard profiles from the settings store; the store is mocked so the
// selector runs against a plain object (AdminHubView.test.tsx house pattern).
vi.mock('../../store/settingsStore.ts', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    sprintDashboardTeamProfiles: [
      { id: 'p1', name: 'Transformers', projectKey: 'TRFM', boardId: '42', boardName: '', boardType: '', scopeMode: '', selectedSprintId: '', selectedFixVersion: '', selectedPiValue: '' },
      { id: 'p2', name: 'Cleanup Crew', projectKey: 'CLNC', boardId: '77', boardName: '', boardType: '', scopeMode: '', selectedSprintId: '', selectedFixVersion: '', selectedPiValue: '' },
    ],
  }),
}))

interface FetchHandlers {
  [methodAndUrl: string]: (init?: RequestInit) => unknown
}

function installFetch(handlers: FetchHandlers) {
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase()
    const handler = handlers[`${method} ${url}`]
    const body = handler ? handler(init) : {}
    return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

function savedConfig() {
  return {
    isEnabled: true,
    scheduleTime: '08:00',
    featureLinkFieldId: 'customfield_10108',
    teams: [{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }],
    triggerUrl: '',
    triggerSecret: '',
  }
}

function noRunYet() {
  return { hasRun: false }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MonthlyDeliveryPanel — configuration & team snapshot (US1)', () => {
  it('loads and renders the saved config', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
    })

    render(<MonthlyDeliveryPanel />)

    expect(await screen.findByLabelText('Enable monthly schedule')).toBeChecked()
    expect(screen.getByLabelText('Schedule time (HH:MM)')).toHaveValue('08:00')
    expect(screen.getByText('Transformers')).toBeInTheDocument()
    expect(screen.getByText('TRFM')).toBeInTheDocument()
  })

  it('snapshots the Team Dashboard profiles into the team list', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => ({ ...savedConfig(), teams: [] }),
      'GET /api/monthly-delivery/status': () => noRunYet(),
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /snapshot teams/i }))

    expect(screen.getByText('Transformers')).toBeInTheDocument()
    expect(screen.getByText('Cleanup Crew')).toBeInTheDocument()
    expect(screen.getByText('CLNC')).toBeInTheDocument()
  })

  it('saves the config back to the server and clears the dirty state', async () => {
    let savedBody: Record<string, unknown> | null = null
    installFetch({
      'GET /api/monthly-delivery/config': () => ({ ...savedConfig(), teams: [] }),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/config': (init) => {
        savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return { ok: true, teams: 2 }
      },
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /snapshot teams/i }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i))
    const savedTeams = (savedBody as unknown as { teams: { projectKey: string }[] }).teams
    expect(savedTeams).toHaveLength(2)
    expect(savedTeams[1].projectKey).toBe('CLNC')
  })

  it('saves the Enabled toggle IMMEDIATELY — the master switch must never silently discard itself', async () => {
    // The reported bug: toggling Enabled and reloading lost the setting, because the toggle sat in
    // the buffered form awaiting a Save click. It now commits on change.
    let savedBody: Record<string, unknown> | null = null
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/config': (init) => {
        savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return { ok: true }
      },
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.click(await screen.findByLabelText('Enable monthly schedule'))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved — schedule disabled/i))
    expect((savedBody as unknown as { isEnabled: boolean }).isEnabled).toBe(false)
  })

  it('marks the webhook fields dirty for the buffered save, and posts them with the config', async () => {
    let savedBody: Record<string, unknown> | null = null
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/config': (init) => {
        savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return { ok: true }
      },
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.change(await screen.findByLabelText('Automation webhook URL'), {
      target: { value: 'https://api-private.atlassian.com/automation/webhooks/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i))
    expect((savedBody as unknown as { triggerUrl: string }).triggerUrl)
      .toBe('https://api-private.atlassian.com/automation/webhooks/x')
  })

  it('shows the load error with a Retry button — never an eternal loading state (v0.74.0 exe bug)', async () => {
    // A server whose monthly-delivery routes failed to mount answers /api/* with the SPA fallback
    // HTML; response.json() then rejects. The panel must surface that, not sit on "Loading…".
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => { throw new Error('Unexpected token < in JSON') },
    } as unknown as Response))
    vi.stubGlobal('fetch', fetchSpy)

    render(<MonthlyDeliveryPanel />)

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/could not load|failed|unexpected token/i)
    expect(screen.queryByText(/loading monthly delivery scheduler/i)).not.toBeInTheDocument()
  })

  it('recovers when Retry succeeds after a failed load', async () => {
    let hasFailedOnce = false
    const fetchSpy = vi.fn(async (url: string) => {
      if (!hasFailedOnce) {
        hasFailedOnce = true
        return { ok: true, status: 200, statusText: 'OK', json: async () => { throw new Error('bad json') } } as unknown as Response
      }
      const body = String(url).includes('/status') ? noRunYet() : savedConfig()
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchSpy)

    render(<MonthlyDeliveryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }))

    expect(await screen.findByLabelText('Enable monthly schedule')).toBeChecked()
  })

  it('marks the panel dirty when the schedule time is edited', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.change(await screen.findByLabelText('Schedule time (HH:MM)'), { target: { value: '09:30' } })

    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
  })
})

describe('MonthlyDeliveryPanel — Run Now, last-run display, Copy Prompt (US2)', () => {
  function completedRun() {
    return {
      hasRun: true,
      ranAtIso: '2026-07-14T08:00:00.000Z',
      coveredMonth: '2026-06',
      trigger: 'manual',
      promptText: 'THE PROMPT TEXT',
      teams: [
        { teamName: 'Transformers', status: 'ok', productionCount: 3, externalTestCount: 1, message: '' },
        { teamName: 'Broken Team', status: 'error', productionCount: 0, externalTestCount: 0, message: 'Jira search failed: 401' },
      ],
    }
  }

  it('disables Run Now while there are unsaved edits and re-enables after saving', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/config': () => ({ ok: true, teams: 1 }),
    })

    render(<MonthlyDeliveryPanel />)
    expect(await screen.findByRole('button', { name: /run now/i })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Schedule time (HH:MM)'), { target: { value: '09:30' } })
    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^save$|saving/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /run now/i })).toBeEnabled())
  })

  it('runs now, then shows the covered month, per-team outcomes (including errors), and the prompt', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/run-now': () => ({ ok: true, result: completedRun() }),
    })

    render(<MonthlyDeliveryPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /run now/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/run complete/i))
    expect(screen.getByText(/2026-06/)).toBeInTheDocument()
    expect(screen.getByText(/3 production, 1 external test/)).toBeInTheDocument()
    expect(screen.getByText(/Jira search failed: 401/)).toBeInTheDocument()
    expect(screen.getByLabelText('Generated prompt')).toHaveValue('THE PROMPT TEXT')
  })

  it('shows what the run did about delivery — delivered, failed, or skipped', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => ({
        ...completedRun(),
        delivery: { attempted: true, ok: true, message: 'Delivered to the Automation webhook.' },
      }),
    })

    render(<MonthlyDeliveryPanel />)

    expect(await screen.findByText(/✓ Delivered to the Automation webhook/)).toBeInTheDocument()
  })

  it('says delivery was skipped when no webhook is configured', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => ({ ...completedRun(), delivery: { attempted: false } }),
    })

    render(<MonthlyDeliveryPanel />)

    expect(await screen.findByText(/skipped — no Automation webhook configured/)).toBeInTheDocument()
  })

  it('Copy Prompt is disabled with no prompt, then copies the prompt and confirms', async () => {
    const writeTextSpy = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: writeTextSpy } })
    installFetch({
      'GET /api/monthly-delivery/config': () => savedConfig(),
      'GET /api/monthly-delivery/status': () => noRunYet(),
      'POST /api/monthly-delivery/run-now': () => ({ ok: true, result: completedRun() }),
    })

    render(<MonthlyDeliveryPanel />)
    const copyButton = await screen.findByRole('button', { name: /copy prompt/i })
    expect(copyButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /run now/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /copy prompt/i })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument())
    expect(writeTextSpy).toHaveBeenCalledWith('THE PROMPT TEXT')
  })

  it('shows the no-teams notice and disables Run Now when the saved config has zero teams (FR-006)', async () => {
    installFetch({
      'GET /api/monthly-delivery/config': () => ({ ...savedConfig(), teams: [] }),
      'GET /api/monthly-delivery/status': () => noRunYet(),
    })

    render(<MonthlyDeliveryPanel />)

    expect(await screen.findByText(/no teams configured — snapshot teams and save first/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled()
  })
})
