// HygieneMonitorPanel.test.tsx — Unit tests for the in-view hygiene monitor status panel.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HygieneMonitorPanel } from './HygieneMonitorPanel'

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function buildStatusResponse(overrides: Partial<{
  lastScanAt: string | null;
  teamStatuses: { teamName: string; violationsFound: number; scannedAt: string | null }[];
}> = {}) {
  return {
    ok:   true,
    json: () => Promise.resolve({
      lastScanAt:   overrides.lastScanAt ?? null,
      nextScanAt:   null,
      teamStatuses: overrides.teamStatuses ?? [],
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue(buildStatusResponse())
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HygieneMonitorPanel', () => {
  it('renders the panel title', async () => {
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Rovo Hygiene Monitor/i)).toBeTruthy()
    })
  })

  it('shows no-scan-data message when status has no lastScanAt', async () => {
    mockFetch.mockResolvedValueOnce(buildStatusResponse({ lastScanAt: null, teamStatuses: [] }))
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByText(/No teams configured/i)).toBeTruthy()
    })
  })

  it('renders a team row with violation count', async () => {
    mockFetch.mockResolvedValueOnce(buildStatusResponse({
      lastScanAt:   '2026-06-16T06:00:00.000Z',
      teamStatuses: [{ teamName: 'Platform', violationsFound: 5, scannedAt: '2026-06-16T06:00:00.000Z' }],
    }))
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByText('Platform')).toBeTruthy()
      expect(screen.getByText(/5 violations/i)).toBeTruthy()
    })
  })

  it('shows a Scan Now button for each team', async () => {
    mockFetch.mockResolvedValueOnce(buildStatusResponse({
      lastScanAt:   '2026-06-16T06:00:00.000Z',
      teamStatuses: [{ teamName: 'Checkout', violationsFound: 2, scannedAt: null }],
    }))
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByLabelText(/Scan now for Checkout/i)).toBeTruthy()
    })
  })

  it('disables the Scan Now button while a scan is running', async () => {
    mockFetch
      .mockResolvedValueOnce(buildStatusResponse({
        lastScanAt:   '2026-06-16T06:00:00.000Z',
        teamStatuses: [{ teamName: 'Platform', violationsFound: 3, scannedAt: null }],
      }))
      // Scan call — hangs until we let it resolve
      .mockImplementationOnce(() => new Promise(() => { /* intentionally pending */ }))
      .mockResolvedValue(buildStatusResponse())

    render(<HygieneMonitorPanel />)
    await waitFor(() => screen.getByLabelText(/Scan now for Platform/i))

    fireEvent.click(screen.getByLabelText(/Scan now for Platform/i))

    // Button should now show the scanning label.
    await waitFor(() => {
      expect(screen.getByLabelText(/Scan now for Platform/i)).toBeDisabled()
    })
  })

  it('shows an error message when the status fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
    render(<HygieneMonitorPanel />)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })
})
