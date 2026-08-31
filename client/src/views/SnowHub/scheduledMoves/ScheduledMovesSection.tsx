// ScheduledMovesSection.tsx — Book one of your changes to move to a chosen state at a chosen moment.
//
// This sits in Release Management because that is where changes are worked: the tab has already
// loaded your active changes and already knows the states each can move to, so booking a move is one
// more thing to do with a change you are already looking at, not a separate place to go.
//
// It takes the host tab's class vocabulary the way CabPrepSection does, so it reads as part of the
// tab rather than as a panel dropped into it.

import { useCallback, useEffect, useState } from 'react';

import { ALL_CHG_STATES, CHG_STATE_TRANSITIONS } from '../hooks/useReleaseManagement.ts';

const SECTION_TITLE = 'Scheduled Moves';
const EMPTY_BOOKINGS_MESSAGE = 'Nothing booked. Pick a change, the state to move it to, and when.';
const EMPTY_CHANGES_MESSAGE = 'No active changes are assigned to you, so there is nothing to book.';
const MISSING_SELECTION_MESSAGE = 'Pick a change and a date and time first.';

/** The minimum a booking needs from a change: which one, and where it can go from here. */
export interface BookableChange {
  number: string;
  shortDescription: string;
  /** Human-readable current state, e.g. "Scheduled". */
  state: string;
  /** Raw ServiceNow choice value for the current state, e.g. "-2". */
  stateValue: string;
}

/** One booked move as the server stores it. */
interface ChangeMoveBooking {
  id: string;
  changeNumber: string;
  targetState: string;
  targetStateLabel: string;
  dueAtIso: string;
  status: 'pending' | 'done' | 'failed' | 'cancelled';
  message: string;
}

interface ChangeMoveRun {
  movedChangeNumbers: string[];
  failures: { changeNumber: string; message: string }[];
  skipReason: string;
  dueCount: number;
}

export interface ScheduledMovesSectionProps {
  /** The tab's already-loaded active changes — booking adds no fetch of its own. */
  activeChanges: BookableChange[];
  /** The host tab's class vocabulary, so this section looks like the tab it sits in. */
  styles: Record<string, string>;
}

// ── API helpers ──

/**
 * Reads the booked moves. A server that cannot answer yields an empty list rather than throwing:
 * booking is one section of a tab that has other work to do, and it must not take the tab down.
 */
async function fetchBookings(): Promise<ChangeMoveBooking[]> {
  try {
    const response = await fetch('/api/change-moves/bookings');
    if (!response.ok) return [];
    const body = await response.json() as { bookings?: ChangeMoveBooking[] };
    return body.bookings ?? [];
  } catch (_fetchError) {
    return [];
  }
}

async function postBooking(booking: {
  changeNumber: string; targetState: string; targetStateLabel: string; dueAtIso: string;
}) {
  const response = await fetch('/api/change-moves/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking),
  });
  return await response.json() as { ok: boolean; message?: string; bookings?: ChangeMoveBooking[] };
}

async function deleteBooking(bookingId: string): Promise<ChangeMoveBooking[]> {
  const response = await fetch('/api/change-moves/bookings/' + encodeURIComponent(bookingId), { method: 'DELETE' });
  const body = await response.json() as { bookings?: ChangeMoveBooking[] };
  return body.bookings ?? [];
}

async function postRunDueNow() {
  const response = await fetch('/api/change-moves/run-now', { method: 'POST' });
  return await response.json() as { ok: boolean; message?: string; run?: ChangeMoveRun; bookings?: ChangeMoveBooking[] };
}

// ── Presentation helpers ──

/** Renders an ISO timestamp in the reader's own locale, or a dash when it cannot be read. */
function formatMoment(isoText: string): string {
  const parsedMilliseconds = Date.parse(isoText);
  return Number.isNaN(parsedMilliseconds) ? '—' : new Date(parsedMilliseconds).toLocaleString();
}

/** One run in a sentence: what it moved, or why it moved nothing. */
function describeRun(run: ChangeMoveRun): string {
  if (run.skipReason) return run.skipReason;
  if (run.dueCount === 0) return 'Nothing was due.';
  if (run.movedChangeNumbers.length === 0) return 'Nothing moved — see the failures listed below.';
  return `Moved ${run.movedChangeNumbers.join(', ')}.`;
}

/**
 * The states the selected change can be moved to.
 *
 * ServiceNow's own transition map is the source, so the list offered is the list that will actually
 * be accepted; a change in an unmapped state falls back to the full set rather than to nothing.
 */
export function listTargetStatesForChange(currentStateValue: string): { value: string; label: string }[] {
  const mappedTransitions = CHG_STATE_TRANSITIONS[currentStateValue];
  if (mappedTransitions && mappedTransitions.length > 0) {
    return mappedTransitions.map((transition) => ({ value: transition.value, label: transition.label }));
  }
  return ALL_CHG_STATES.map((changeState) => ({ value: changeState.value, label: changeState.label }));
}

/**
 * Turns the datetime-local value the browser gives (local wall-clock, no zone) into an instant.
 *
 * An unreadable value yields '' so the caller refuses the booking, rather than silently booking one
 * for the epoch.
 */
function readDueAtIso(localDateTimeText: string): string {
  if (localDateTimeText === '') return '';
  const parsedMilliseconds = Date.parse(localDateTimeText);
  return Number.isNaN(parsedMilliseconds) ? '' : new Date(parsedMilliseconds).toISOString();
}

// ── Component ──

/** Renders the booking form and the booked moves, inside Release Management. */
export function ScheduledMovesSection({ activeChanges, styles }: ScheduledMovesSectionProps) {
  const [bookings, setBookings] = useState<ChangeMoveBooking[]>([]);
  const [selectedChangeNumber, setSelectedChangeNumber] = useState('');
  const [selectedTargetState, setSelectedTargetState] = useState('');
  const [selectedDueAtLocal, setSelectedDueAtLocal] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const loadBookings = useCallback(async () => {
    setBookings(await fetchBookings());
  }, []);

  // Deferred to a macrotask (house pattern) so the effect never setStates synchronously.
  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadBookings(); }, 0);
    return () => clearTimeout(timeoutHandle);
  }, [loadBookings]);

  const selectedChange = activeChanges.find((change) => change.number === selectedChangeNumber) ?? null;
  const targetStateOptions = listTargetStatesForChange(selectedChange?.stateValue ?? '');

  /** Selecting a change re-offers the states IT can reach, so a stale target cannot be submitted. */
  function handleSelectChange(changeNumber: string) {
    setSelectedChangeNumber(changeNumber);
    setSelectedTargetState('');
  }

  async function handleBook() {
    const dueAtIso = readDueAtIso(selectedDueAtLocal);
    if (selectedChangeNumber === '' || selectedTargetState === '' || dueAtIso === '') {
      setStatusMessage(MISSING_SELECTION_MESSAGE);
      return;
    }
    setIsBusy(true);
    setStatusMessage('');
    try {
      const targetLabel = targetStateOptions.find((option) => option.value === selectedTargetState)?.label
        ?? selectedTargetState;
      const outcome = await postBooking({
        changeNumber: selectedChangeNumber,
        targetState: selectedTargetState,
        targetStateLabel: targetLabel,
        dueAtIso,
      });
      if (outcome.ok) {
        setBookings(outcome.bookings ?? await fetchBookings());
        setStatusMessage(`Booked: ${selectedChangeNumber} → ${targetLabel} at ${formatMoment(dueAtIso)}.`);
      } else {
        setStatusMessage(outcome.message || 'Could not book that move.');
      }
    } catch (bookError) {
      setStatusMessage(bookError instanceof Error ? bookError.message : 'Could not book that move.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancelBooking(bookingId: string) {
    setIsBusy(true);
    try {
      setBookings(await deleteBooking(bookingId));
      setStatusMessage('Booking withdrawn.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRunDueNow() {
    setIsBusy(true);
    setStatusMessage('');
    try {
      const outcome = await postRunDueNow();
      if (outcome.ok && outcome.run) {
        setStatusMessage(describeRun(outcome.run));
        setBookings(outcome.bookings ?? await fetchBookings());
      } else {
        setStatusMessage(outcome.message || 'Could not run the due moves.');
      }
    } catch (runError) {
      setStatusMessage(runError instanceof Error ? runError.message : 'Could not run the due moves.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLE}</h3>
        <button
          className={styles.secondaryButton}
          disabled={isBusy}
          onClick={() => void handleRunDueNow()}
          type="button"
        >
          Run Due Now
        </button>
      </div>
      <div className={styles.sectionBody}>
        <p className={styles.mutedText}>
          The move happens at the moment you book it for, whether or not this page is open. A move that
          comes due while the ServiceNow relay is closed stays booked and runs as soon as it is back.
        </p>

        {activeChanges.length === 0
          ? <p className={styles.mutedText}>{EMPTY_CHANGES_MESSAGE}</p>
          : (
            <>
              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Change</span>
                <select
                  aria-label="Change to move"
                  className={styles.input}
                  value={selectedChangeNumber}
                  onChange={(event) => handleSelectChange(event.target.value)}
                >
                  <option value="">Select a change…</option>
                  {activeChanges.map((change) => (
                    <option key={change.number} value={change.number}>
                      {change.number} — {change.state} — {change.shortDescription}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Move to</span>
                <select
                  aria-label="Target state"
                  className={styles.input}
                  disabled={selectedChangeNumber === ''}
                  value={selectedTargetState}
                  onChange={(event) => setSelectedTargetState(event.target.value)}
                >
                  <option value="">Select a state…</option>
                  {targetStateOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>At</span>
                <input
                  aria-label="Move at"
                  className={styles.input}
                  type="datetime-local"
                  value={selectedDueAtLocal}
                  onChange={(event) => setSelectedDueAtLocal(event.target.value)}
                />
              </label>

              <div className={styles.buttonRow}>
                <button
                  className={styles.primaryButton}
                  disabled={isBusy}
                  onClick={() => void handleBook()}
                  type="button"
                >
                  {isBusy ? 'Working…' : 'Book Move'}
                </button>
              </div>
            </>
          )}

        {statusMessage !== '' && <p className={styles.mutedText} role="status">{statusMessage}</p>}

        {bookings.length === 0
          ? <p className={styles.mutedText}>{EMPTY_BOOKINGS_MESSAGE}</p>
          : (
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Move to</th>
                  <th>At</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.changeNumber}</td>
                    <td>{booking.targetStateLabel}</td>
                    <td>{formatMoment(booking.dueAtIso)}</td>
                    <td>
                      {booking.status}
                      {booking.message !== '' && <p className={styles.alertMessageText}>{booking.message}</p>}
                    </td>
                    <td>
                      {booking.status === 'pending' && (
                        <button
                          className={styles.secondaryButton}
                          disabled={isBusy}
                          onClick={() => void handleCancelBooking(booking.id)}
                          type="button"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </section>
  );
}
