// piReviewStartDates.test.ts — The rule-based Target Start scheduler for PI Review.
//
// Dates are chosen around a known Monday (2026-01-05 — 2026-01-01 is a Thursday) so the working-day
// arithmetic (including a weekend skip) is asserted against concrete ISO dates, with no dependence on
// the system clock.

import { describe, expect, it } from 'vitest'

import { readPointEstimate, suggestPiReviewStartDates, type RankedFeature } from './piReviewStartDates.ts'

// PI window: Monday 2026-01-05 through Monday 2026-01-12 (one working week + the following Monday).
const PI_WINDOW = { startIso: '2026-01-05', endIso: '2026-01-12' }

describe('readPointEstimate', () => {
  it('reads a positive number and rejects blanks, zero, and non-numbers', () => {
    expect(readPointEstimate('5')).toBe(5)
    expect(readPointEstimate(' 13 ')).toBe(13)
    expect(readPointEstimate('')).toBeNull()
    expect(readPointEstimate('0')).toBeNull()
    expect(readPointEstimate('abc')).toBeNull()
  })
})

describe('suggestPiReviewStartDates', () => {
  it('starts the top-priority Feature on PI day 1 and chains the rest after it', () => {
    const features: RankedFeature[] = [
      { issueKey: 'DENP-1', points: 3 }, // Mon 01-05 → Wed 01-07
      { issueKey: 'DENP-2', points: 2 }, // Thu 01-08 → Fri 01-09
      { issueKey: 'DENP-3', points: 1 }, // Mon 01-12 (weekend skipped) → Mon 01-12
    ]
    const [first, second, third] = suggestPiReviewStartDates(features, PI_WINDOW)

    expect(first).toMatchObject({ issueKey: 'DENP-1', startIso: '2026-01-05', endIso: '2026-01-07', fitsInPi: true })
    expect(second).toMatchObject({ issueKey: 'DENP-2', startIso: '2026-01-08', endIso: '2026-01-09', fitsInPi: true })
    // The weekend (01-10 Sat, 01-11 Sun) is skipped, so the third Feature starts on Monday.
    expect(third).toMatchObject({ issueKey: 'DENP-3', startIso: '2026-01-12', endIso: '2026-01-12', fitsInPi: true })
  })

  it('flags a Feature whose span would finish after the PI ends', () => {
    const features: RankedFeature[] = [
      { issueKey: 'DENP-1', points: 6 }, // Mon 01-05 → next Mon 01-12 (fits, ends on PI's last day)
      { issueKey: 'DENP-2', points: 2 }, // Tue 01-13 → Wed 01-14 — past the 01-12 PI end
    ]
    const [first, second] = suggestPiReviewStartDates(features, PI_WINDOW)

    expect(first.fitsInPi).toBe(true)
    expect(first.endIso).toBe('2026-01-12')
    expect(second.fitsInPi).toBe(false)
    expect(second.startIso).toBe('2026-01-13')
  })

  it('leaves an un-estimated Feature unscheduled and does not let it consume time', () => {
    const features: RankedFeature[] = [
      { issueKey: 'DENP-1', points: 2 },    // Mon 01-05 → Tue 01-06
      { issueKey: 'DENP-2', points: null }, // unscheduled, consumes no time
      { issueKey: 'DENP-3', points: 1 },    // Wed 01-07 — as if DENP-2 were not there
    ]
    const [first, second, third] = suggestPiReviewStartDates(features, PI_WINDOW)

    expect(first).toMatchObject({ startIso: '2026-01-05', endIso: '2026-01-06' })
    expect(second).toMatchObject({ issueKey: 'DENP-2', points: 0, startIso: null, endIso: null, fitsInPi: false })
    // DENP-3 picks up right after DENP-1, proving the un-estimated row did not advance the cursor.
    expect(third).toMatchObject({ issueKey: 'DENP-3', startIso: '2026-01-07', endIso: '2026-01-07' })
  })

  it('rolls a weekend PI start forward to the first working day', () => {
    // 2026-01-03 is a Saturday; scheduling must begin on Monday 2026-01-05.
    const [first] = suggestPiReviewStartDates([{ issueKey: 'DENP-1', points: 1 }], { startIso: '2026-01-03', endIso: '2026-01-31' })
    expect(first.startIso).toBe('2026-01-05')
  })
})
