// ChangeMovesPanel.test.tsx — Booking a change move: pick a change, pick a state, pick a moment.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChangeMovesPanel } from './ChangeMovesPanel.tsx'

const ONE_CHANGE = [{
  number: 'CHG0046897', shortDescription: 'Deploy Enrolment',
  stateValue: '-2', stateLabel: 'Scheduled', plannedStart: '31/08/2026 09:00:00',
}]

/** Routes fetch by URL so each endpoint answers independently. */
function mockEndpoints(options: { changes?: unknown[]; pickerMessage?: string; bookings?: unknown[]; post?: unknown; run?: unknown } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/my-changes')) {
      return { ok: true, json: async () => ({ changes: options.changes ?? ONE_CHANGE, message: options.pickerMessage ?? '' }) } as Response
    }
    if (url.includes('/run-now')) {
      return { ok: true, json: async () => options.run ?? { ok: true, run: { movedChangeNumbers: [], failures: [], skipReason: '', dueCount: 0 } } } as Response
    }
    if (url.includes('/bookings') && init?.method === 'POST') {
      return { ok: true, json: async () => options.post ?? { ok: true, bookings: [] } } as Response
    }
    return { ok: true, json: async () => ({ bookings: options.bookings ?? [] }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => { vi.unstubAllGlobals() })

describe('ChangeMovesPanel', () => {
  it('offers your changes as a list rather than a box to type into', async () => {
    // A mistyped change number saves cleanly and then silently does nothing, so it is picked.
    mockEndpoints()

    render(<ChangeMovesPanel />)

    const changePicker = await screen.findByLabelText('Change to move')
    expect(changePicker.tagName).toBe('SELECT')
    expect(await screen.findByRole('option', { name: /CHG0046897 — Scheduled — Deploy Enrolment/ })).toBeInTheDocument()
  })

  it('offers the target state as a list too', async () => {
    mockEndpoints()

    render(<ChangeMovesPanel />)

    const statePicker = await screen.findByLabelText('Target state')
    expect(statePicker.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'Implement' })).toBeInTheDocument()
  })

  it('books exactly the change, state and moment that were picked', async () => {
    const fetchMock = mockEndpoints({ post: { ok: true, bookings: [] } })
    render(<ChangeMovesPanel />)
    await screen.findByLabelText('Change to move')

    await userEvent.selectOptions(screen.getByLabelText('Change to move'), 'CHG0046897')
    await userEvent.selectOptions(screen.getByLabelText('Target state'), '1')
    await userEvent.type(screen.getByLabelText('Move at'), '2026-08-31T14:00')
    await userEvent.click(screen.getByRole('button', { name: 'Book Move' }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes('/bookings') && (init as RequestInit | undefined)?.method === 'POST')
      expect(postCall).toBeDefined()
      const posted = JSON.parse((postCall![1] as RequestInit).body as string) as Record<string, string>
      expect(posted.changeNumber).toBe('CHG0046897')
      expect(posted.targetState).toBe('1')
      expect(Date.parse(posted.dueAtIso)).toBe(Date.parse('2026-08-31T14:00'))
    })
  })

  it('refuses to book without a change and a moment, instead of posting a booking that cannot run', async () => {
    const fetchMock = mockEndpoints()
    render(<ChangeMovesPanel />)
    await screen.findByLabelText('Change to move')

    await userEvent.click(screen.getByRole('button', { name: 'Book Move' }))

    expect(await screen.findByText(/Pick a change and a date and time first/i)).toBeInTheDocument()
    const postCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/bookings') && (init as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('lists what is booked, with the reason a failed one failed', async () => {
    mockEndpoints({
      bookings: [
        { id: 'b1', changeNumber: 'CHG1', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T14:00:00.000Z', status: 'pending', createdAtIso: '', completedAtIso: '', message: '' },
        { id: 'b2', changeNumber: 'CHG2', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00.000Z', status: 'failed', createdAtIso: '', completedAtIso: '', message: 'ServiceNow said no' },
      ],
    })

    render(<ChangeMovesPanel />)

    expect(await screen.findByText('CHG1')).toBeInTheDocument()
    expect(screen.getByText(/ServiceNow said no/)).toBeInTheDocument()
  })

  it('offers Cancel only on a booking that has not run', async () => {
    mockEndpoints({
      bookings: [
        { id: 'b1', changeNumber: 'CHG1', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T14:00:00.000Z', status: 'pending', createdAtIso: '', completedAtIso: '', message: '' },
        { id: 'b2', changeNumber: 'CHG2', targetState: '1', targetStateLabel: 'Implement', dueAtIso: '2026-08-31T09:00:00.000Z', status: 'done', createdAtIso: '', completedAtIso: '', message: '' },
      ],
    })

    render(<ChangeMovesPanel />)

    await screen.findByText('CHG1')
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
  })

  it('explains an empty picker when the relay is closed', async () => {
    mockEndpoints({ changes: [], pickerMessage: 'The ServiceNow relay bookmarklet is not registered, so your changes could not be listed.' })

    render(<ChangeMovesPanel />)

    expect(await screen.findByText(/relay bookmarklet is not registered/i)).toBeInTheDocument()
  })

  it('reports what Run Due Now did', async () => {
    mockEndpoints({ run: { ok: true, run: { movedChangeNumbers: ['CHG0046897'], failures: [], skipReason: '', dueCount: 1 } } })
    render(<ChangeMovesPanel />)
    await screen.findByLabelText('Change to move')

    await userEvent.click(screen.getByRole('button', { name: 'Run Due Now' }))

    expect(await screen.findByText(/Moved CHG0046897/)).toBeInTheDocument()
  })
})
