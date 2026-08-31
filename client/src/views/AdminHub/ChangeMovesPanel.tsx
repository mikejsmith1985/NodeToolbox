// ChangeMovesPanel.tsx — Book a ServiceNow change to move to a chosen state at a chosen moment.
//
// This replaced a polling sweep that decided for itself which changes were due. Here the change, the
// target state and the moment are all picked, so nothing is inferred and no move happens that nobody
// asked for. Both pickers are fed from ServiceNow's own vocabulary rather than typed, because a
// mistyped change number or state saves cleanly and then silently does nothing.

import { useCallback, useEffect, useState } from 'react'

import styles from './AdminHubView.module.css'

// ── Types (mirror src/routes/changeMoves.js) ──

interface PickableChange {
  number: string
  shortDescription: string
  stateValue: string
  stateLabel: string
  plannedStart: string
}

interface ChangeMoveBooking {
  id: string
  changeNumber: string
  targetState: string
  targetStateLabel: string
  dueAtIso: string
  status: 'pending' | 'done' | 'failed' | 'cancelled'
  createdAtIso: string
  completedAtIso: string
  message: string
}

interface ChangeMoveRun {
  movedChangeNumbers: string[]
  failures: { changeNumber: string; message: string }[]
  skipReason: string
  dueCount: number
}

/**
 * The states a change can be moved to, in ServiceNow's own raw values.
 *
 * Same vocabulary as Release Management's inline transitions. Offered as a list rather than a box
 * because a state value that ServiceNow does not recognise is accepted silently and never applied.
 */
const TARGET_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: '-4', label: 'Submitted' },
  { value: '-2', label: 'Scheduled' },
  { value: '1', label: 'Implement' },
  { value: '3', label: 'Review' },
  { value: '4', label: 'Close' },
  { value: '-3', label: 'Cancel' },
]

// ── API helpers ──

async function fetchMyChanges(): Promise<{ changes: PickableChange[]; message: string }> {
  const response = await fetch('/api/change-moves/my-changes')
  if (!response.ok) throw new Error('Failed to list your changes: ' + response.statusText)
  return await response.json() as { changes: PickableChange[]; message: string }
}

async function fetchBookings(): Promise<ChangeMoveBooking[]> {
  const response = await fetch('/api/change-moves/bookings')
  if (!response.ok) return []
  const body = await response.json() as { bookings?: ChangeMoveBooking[] }
  return body.bookings ?? []
}

async function postBooking(booking: { changeNumber: string; targetState: string; targetStateLabel: string; dueAtIso: string }) {
  const response = await fetch('/api/change-moves/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking),
  })
  return await response.json() as { ok: boolean; message?: string; bookings?: ChangeMoveBooking[] }
}

async function deleteBooking(bookingId: string): Promise<ChangeMoveBooking[]> {
  const response = await fetch('/api/change-moves/bookings/' + encodeURIComponent(bookingId), { method: 'DELETE' })
  const body = await response.json() as { bookings?: ChangeMoveBooking[] }
  return body.bookings ?? []
}

async function postRunNow() {
  const response = await fetch('/api/change-moves/run-now', { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; run?: ChangeMoveRun; bookings?: ChangeMoveBooking[] }
}

// ── Presentation helpers ──

/** Renders an ISO timestamp in the reader's own locale, or a dash when it cannot be read. */
function formatMoment(isoText: string): string {
  const parsedMilliseconds = Date.parse(isoText)
  return Number.isNaN(parsedMilliseconds) ? '—' : new Date(parsedMilliseconds).toLocaleString()
}

/** One run in a sentence: what it moved, or why it moved nothing. */
function describeRun(run: ChangeMoveRun): string {
  if (run.skipReason) return run.skipReason
  if (run.dueCount === 0) return 'Nothing was due.'
  if (run.movedChangeNumbers.length === 0) return 'Nothing moved — see the failures below.'
  return `Moved ${run.movedChangeNumbers.join(', ')}.`
}

/**
 * Turns the datetime-local value the browser gives (local wall-clock, no zone) into an instant.
 *
 * The empty string is passed straight through so the caller can refuse the booking rather than
 * silently book one for the epoch.
 */
function readDueAtIso(localDateTimeText: string): string {
  if (localDateTimeText === '') return ''
  const parsedMilliseconds = Date.parse(localDateTimeText)
  return Number.isNaN(parsedMilliseconds) ? '' : new Date(parsedMilliseconds).toISOString()
}

// ── Component ──

/** Admin Hub panel for booking change moves and seeing what is booked. */
export function ChangeMovesPanel() {
  const [pickableChanges, setPickableChanges] = useState<PickableChange[]>([])
  const [pickerMessage, setPickerMessage] = useState('')
  const [bookings, setBookings] = useState<ChangeMoveBooking[]>([])
  const [selectedChangeNumber, setSelectedChangeNumber] = useState('')
  const [selectedTargetState, setSelectedTargetState] = useState('1')
  const [selectedDueAtLocal, setSelectedDueAtLocal] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const loadEverything = useCallback(async () => {
    try {
      const [changesResult, loadedBookings] = await Promise.all([fetchMyChanges(), fetchBookings()])
      setPickableChanges(changesResult.changes)
      setPickerMessage(changesResult.message)
      setBookings(loadedBookings)
    } catch (loadError) {
      setPickerMessage(loadError instanceof Error ? loadError.message : 'Failed to load your changes.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Deferred to a macrotask (house pattern) so the effect never setStates synchronously.
  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadEverything() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [loadEverything])

  async function handleBook() {
    const dueAtIso = readDueAtIso(selectedDueAtLocal)
    if (selectedChangeNumber === '' || dueAtIso === '') {
      setStatusMessage('Pick a change and a date and time first.')
      return
    }
    setIsBusy(true)
    setStatusMessage('')
    try {
      const targetLabel = TARGET_STATE_OPTIONS.find((option) => option.value === selectedTargetState)?.label ?? selectedTargetState
      const outcome = await postBooking({
        changeNumber: selectedChangeNumber,
        targetState: selectedTargetState,
        targetStateLabel: targetLabel,
        dueAtIso,
      })
      if (outcome.ok) {
        setBookings(outcome.bookings ?? await fetchBookings())
        setStatusMessage(`Booked: ${selectedChangeNumber} → ${targetLabel} at ${formatMoment(dueAtIso)}.`)
      } else {
        setStatusMessage(outcome.message || 'Could not book that move.')
      }
    } catch (bookError) {
      setStatusMessage(bookError instanceof Error ? bookError.message : 'Could not book that move.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCancel(bookingId: string) {
    setIsBusy(true)
    try {
      setBookings(await deleteBooking(bookingId))
      setStatusMessage('Booking withdrawn.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleRunNow() {
    setIsBusy(true)
    setStatusMessage('')
    try {
      const outcome = await postRunNow()
      if (outcome.ok && outcome.run) {
        setStatusMessage(describeRun(outcome.run))
        setBookings(outcome.bookings ?? await fetchBookings())
      } else {
        setStatusMessage(outcome.message || 'Run failed.')
      }
    } catch (runError) {
      setStatusMessage(runError instanceof Error ? runError.message : 'Run failed.')
    } finally {
      setIsBusy(false)
    }
  }

  if (isLoading) {
    return <p>Loading booked change moves…</p>
  }

  return (
    <div className={styles.panelSection}>
      <h2>🗓 Scheduled Change Moves</h2>
      <p>
        Pick one of your ServiceNow changes, the state you want it moved to, and when. The move is
        performed at that moment whether or not this page is open. Nothing is decided for you: only the
        moves booked here ever happen.
      </p>
      <p className={styles.panelStatusLine}>
        ServiceNow writes ride the <strong>relay bookmarklet</strong>. A booking that comes due while it is
        closed stays booked and runs as soon as it is back — late, never lost.
      </p>

      <fieldset className={styles.panelCard}>
        <label>Change
          <select
            aria-label="Change to move"
            className={styles.inputField}
            value={selectedChangeNumber}
            onChange={(event) => setSelectedChangeNumber(event.target.value)}
          >
            <option value="">Select a change…</option>
            {pickableChanges.map((change) => (
              <option key={change.number} value={change.number}>
                {change.number} — {change.stateLabel} — {change.shortDescription}
              </option>
            ))}
          </select>
        </label>
        {pickerMessage !== '' && <p className={styles.panelStatusLine}>{pickerMessage}</p>}

        <label>Move to
          <select
            aria-label="Target state"
            className={styles.inputField}
            value={selectedTargetState}
            onChange={(event) => setSelectedTargetState(event.target.value)}
          >
            {TARGET_STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>At
          <input
            aria-label="Move at"
            className={styles.inputField}
            type="datetime-local"
            value={selectedDueAtLocal}
            onChange={(event) => setSelectedDueAtLocal(event.target.value)}
          />
        </label>

        <div className={styles.panelActions}>
          <button type="button" className={styles.saveButton} disabled={isBusy} onClick={() => void handleBook()}>
            {isBusy ? 'Working…' : 'Book Move'}
          </button>
          <button type="button" className={styles.actionButton} disabled={isBusy} onClick={() => void handleRunNow()}>
            Run Due Now
          </button>
          <button type="button" className={styles.actionButton} disabled={isBusy} onClick={() => void loadEverything()}>
            Refresh
          </button>
        </div>
        {statusMessage !== '' && <p role="status" className={styles.panelStatusLine}>{statusMessage}</p>}
      </fieldset>

      <fieldset className={styles.panelCard}>
        <p><strong>Booked moves</strong></p>
        {bookings.length === 0
          ? <p className={styles.panelStatusLine}>Nothing booked yet.</p>
          : (
            <ul>
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <span>{booking.changeNumber}</span> → <span>{booking.targetStateLabel}</span>
                  {' at '}<span>{formatMoment(booking.dueAtIso)}</span>
                  {' — '}<strong>{booking.status}</strong>
                  {booking.message !== '' && <span> ({booking.message})</span>}
                  {booking.status === 'pending' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className={styles.actionButton}
                        disabled={isBusy}
                        onClick={() => void handleCancel(booking.id)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
      </fieldset>
    </div>
  )
}
