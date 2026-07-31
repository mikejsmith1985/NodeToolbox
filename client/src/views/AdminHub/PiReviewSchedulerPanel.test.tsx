// PiReviewSchedulerPanel.test.tsx — Admin Hub panel behavior for the PI Review scheduler (feature 015),
// including the configured-teams page picker and the polling frequency (sync-page redesign).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadRoster } = vi.hoisted(() => ({ mockReadRoster: vi.fn() }))

vi.mock('../SprintDashboard/hooks/useStandupRosterStore.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readStoredStandupRosterMembers: mockReadRoster,
}))

import { PiReviewSchedulerPanel } from './PiReviewSchedulerPanel.tsx'
import { useSettingsStore } from '../../store/settingsStore.ts'
import type { SprintDashboardTeamProfile } from '../../store/settingsStore.ts'

function teamProfile(overrides: Partial<SprintDashboardTeamProfile> = {}): SprintDashboardTeamProfile {
  return {
    id: 'profile-1',
    name: 'Autobots',
    projectKey: 'AUT',
    boardId: '42',
    boardName: 'AUT board',
    boardType: 'scrum',
    scopeMode: 'sprint',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: '',
    piReviewPages: [
      { piName: 'PI 26.4', pageUrl: 'https://wiki/pages/111' },
      { piName: 'PI 26.5', pageUrl: 'https://wiki/pages/222' },
    ],
    ...overrides,
  }
}

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

function oneTeam() {
  return {
    teamName: 'Transformers',
    isEnabled: true,
    scheduleTime: '06:30',
    productOwnerAssignee: 'C73130',
    piFieldId: 'customfield_10301',
    dependencyLinkTypes: [],
    pages: [{ pageUrlOrId: '12345', piName: 'PI 26.4' }],
  }
}

beforeEach(() => {
  mockReadRoster.mockReturnValue([])
  act(() => useSettingsStore.getState().setSprintDashboardTeamProfiles([]))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('PiReviewSchedulerPanel', () => {
  it('loads and renders the configured team', async () => {
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
    })

    render(<PiReviewSchedulerPanel />)

    expect(await screen.findByLabelText('Team name 1')).toHaveValue('Transformers')
    expect(screen.getByLabelText('Product Owner 1')).toHaveValue('C73130')
    expect(screen.getByLabelText('Page PI 1-1')).toHaveValue('PI 26.4')
  })

  it('saves edited config back to the server', async () => {
    let savedTeams: unknown = null
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
      'POST /api/pi-review-scheduler/config': (init) => {
        savedTeams = JSON.parse(String(init?.body)).teams
        return { ok: true, teams: savedTeams }
      },
    })

    render(<PiReviewSchedulerPanel />)
    const productOwnerInput = await screen.findByLabelText('Product Owner 1')
    fireEvent.change(productOwnerInput, { target: { value: 'C99999' } })
    fireEvent.click(screen.getByRole('button', { name: /save schedules/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i))
    expect((savedTeams as { productOwnerAssignee: string }[])[0].productOwnerAssignee).toBe('C99999')
  })

  it('disables Run now while there are unsaved edits and re-enables after saving', async () => {
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
      'POST /api/pi-review-scheduler/config': () => ({ ok: true, teams: [oneTeam()] }),
    })

    render(<PiReviewSchedulerPanel />)
    expect(await screen.findByRole('button', { name: /run now/i })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Product Owner 1'), { target: { value: 'C99999' } })
    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled() // dirty → gated

    fireEvent.click(screen.getByRole('button', { name: /save schedules/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /run now/i })).toBeEnabled())
  })

  it('runs a team now and shows the outcome', async () => {
    let ranTeamIndex: number | null = null
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
      'POST /api/pi-review-scheduler/run-now': (init) => {
        ranTeamIndex = JSON.parse(String(init?.body)).teamIndex
        return { ok: true, results: [{ status: 'success', pageUrlOrId: '12345', ranAtIso: 'now', message: '' }] }
      },
    })

    render(<PiReviewSchedulerPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /run now/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/run complete/i))
    expect(ranTeamIndex).toBe(0)
  })

  it('lists configured team pages and imports the ticked ones into the schedule', async () => {
    mockReadRoster.mockReturnValue([
      { id: 'r1', displayName: 'Pat Owner', assigneeQueryValue: 'C73130', roleCapabilities: { canProductOwner: true } },
    ])
    act(() => useSettingsStore.getState().setSprintDashboardTeamProfiles([teamProfile()]))
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
    })

    render(<PiReviewSchedulerPanel />)

    // Both configured pages are offered, pre-ticked; untick the second before importing.
    const firstPageCheckbox = await screen.findByLabelText('Sync Autobots page PI 26.4')
    expect(firstPageCheckbox).toBeChecked()
    fireEvent.click(screen.getByLabelText('Sync Autobots page PI 26.5'))
    fireEvent.click(screen.getByRole('button', { name: /add team to schedule/i }))

    // The team card arrives prefilled from the app config + roster; new teams start disabled.
    expect(screen.getByLabelText('Team name 1')).toHaveValue('Autobots')
    expect(screen.getByLabelText('Product Owner 1')).toHaveValue('C73130')
    expect(screen.getByLabelText('Enable schedule for team 1')).not.toBeChecked()
    expect(screen.getByLabelText('Page URL 1-1')).toHaveValue('https://wiki/pages/111')
    expect(screen.queryByLabelText('Page URL 1-2')).not.toBeInTheDocument()
  })

  it('explains itself when no team profile has PI Review pages configured', async () => {
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
    })

    render(<PiReviewSchedulerPanel />)

    expect(await screen.findByText(/no team profile has pi review pages configured yet/i)).toBeInTheDocument()
  })

  it('round-trips the polling frequency through save', async () => {
    let savedTeams: unknown = null
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
      'POST /api/pi-review-scheduler/config': (init) => {
        savedTeams = JSON.parse(String(init?.body)).teams
        return { ok: true, teams: savedTeams }
      },
    })

    render(<PiReviewSchedulerPanel />)
    const frequencySelect = await screen.findByLabelText('Run frequency 1')
    // A config saved before the polling feature loads as once-daily.
    expect(frequencySelect).toHaveValue('0')

    fireEvent.change(frequencySelect, { target: { value: '30' } })
    expect(screen.getByText(/polls on wall-clock boundaries every 30 minutes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /save schedules/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i))
    expect((savedTeams as { intervalMin: number }[])[0].intervalMin).toBe(30)
  })

  it('updates an existing scheduled team with only the missing pages', async () => {
    act(() => useSettingsStore.getState().setSprintDashboardTeamProfiles([
      teamProfile({ name: 'Transformers', piReviewPages: [
        { piName: 'PI 26.4', pageUrl: '12345' }, // already scheduled
        { piName: 'PI 26.5', pageUrl: '67890' }, // new
      ] }),
    ]))
    installFetch({
      'GET /api/pi-review-scheduler/config': () => ({ teams: [oneTeam()] }),
      'GET /api/pi-review-scheduler/status': () => ({ teams: {} }),
    })

    render(<PiReviewSchedulerPanel />)

    const updateButton = await screen.findByRole('button', { name: /update scheduled pages/i })
    fireEvent.click(updateButton)

    const pageUrlInputs = screen.getAllByLabelText(/^Page URL 1-/)
    expect(pageUrlInputs).toHaveLength(2)
    expect(within(screen.getByLabelText('Team name 1').closest('fieldset') as HTMLElement)
      .getByDisplayValue('67890')).toBeInTheDocument()
  })
})
