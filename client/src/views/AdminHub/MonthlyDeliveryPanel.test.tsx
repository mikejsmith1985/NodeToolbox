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
