// PiReviewSchedulerPanel.test.tsx — Admin Hub panel behavior for the PI Review scheduler (feature 015).

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PiReviewSchedulerPanel } from './PiReviewSchedulerPanel.tsx'

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

afterEach(() => {
  vi.unstubAllGlobals()
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
})
