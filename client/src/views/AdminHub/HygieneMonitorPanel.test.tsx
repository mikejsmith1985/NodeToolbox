// HygieneMonitorPanel.test.tsx — Unit tests for the Admin Hub hygiene monitor panel.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HygieneMonitorPanel } from './HygieneMonitorPanel'

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function buildFetchOk(body: unknown) {
  return Promise.resolve({
    ok:   true,
    json: () => Promise.resolve(body),
  })
}

function buildFetchError(statusCode: number) {
  return Promise.resolve({ ok: false, status: statusCode, json: () => Promise.resolve({ error: 'Error' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: empty config
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('/api/hygiene-monitor/config') && String(url).includes('GET')) {
      return buildFetchOk({ teams: [] })
    }
    return buildFetchOk({ teams: [] })
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HygieneMonitorPanel', () => {
  it('renders the panel title', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teams: [] }) })
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Hygiene Monitor/i)).toBeTruthy()
    })
  })

  it('shows an empty-state hint when no teams are configured', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teams: [] }) })
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByText(/No teams configured/i)).toBeTruthy()
    })
  })

  it('renders a configured team when the config returns one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve({
        teams: [{
          teamName:           'Platform',
          projectKeys:        ['PLAT'],
          scheduleTime:       '06:00',
          weekdays:           ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          teamsWebhookUrl:    '',
          teamsWebhookSecret: '',
          enabledCheckIds:    [],
        }],
      }),
    })

    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Platform')).toBeTruthy()
    })
  })

  it('adds a new team when the Add team button is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teams: [] }) })
    render(<HygieneMonitorPanel />)
    await waitFor(() => screen.getByText(/Add team/i))

    fireEvent.click(screen.getByText(/Add team/i))

    // A new team form appears with an empty team name input.
    const teamNameInputs = screen.getAllByPlaceholderText('Platform')
    expect(teamNameInputs.length).toBeGreaterThanOrEqual(1)
  })

  it('calls POST /api/hygiene-monitor/config when Save is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teams: [] }) })
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

    render(<HygieneMonitorPanel />)
    await waitFor(() => screen.getByText('Save'))

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      const saveCall = mockFetch.mock.calls.find(
        (call) => String(call[0]).includes('/api/hygiene-monitor/config') && call[1]?.method === 'POST'
      )
      expect(saveCall).toBeTruthy()
    })
  })

  it('hides the Scan Now button when teamName is empty', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teams: [] }) })
    render(<HygieneMonitorPanel />)
    await waitFor(() => screen.getByText(/Add team/i))

    fireEvent.click(screen.getByText(/Add team/i))
    const scanButton = screen.getByLabelText(/Scan now for team/i)
    expect(scanButton).toBeDisabled()
  })
})
