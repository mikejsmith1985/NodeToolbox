// piReviewAiApply.test.ts — The cell-write contract.
//
// This is the most valuable test in the feature. The PI Review table's columns have different
// owners, and writing to the wrong one does not fail loudly — it fails on the NEXT page load, when
// reconciliation rebuilds the cell and the user's AI results appear to vanish. So the guarantee
// "the AI touches exactly two cells" is asserted here mechanically rather than trusted.
//
// See specs/016-pi-review-ai-assist/contracts/cell-write-contract.md.

import { describe, expect, it } from 'vitest'

import { applyPiReviewSuggestion, MAX_AI_NOTE_LENGTH } from './piReviewAiApply.ts'
import type { PiReviewAiSuggestion } from './piReviewAiAssist.ts'
import type { PiReviewRow } from '../piReviewTable.ts'

function row(overrides: Partial<PiReviewRow> = {}): PiReviewRow {
  return {
    rowId: 'row-1',
    carryOver: 'Yes',
    priority: 'High',
    feature: 'ALPHA-1 - Enrollment support',
    pointEstimate: '',
    dependency: 'PLAT-5 - Auth shim (In Progress)',
    risks: 'RISK-2 - Vendor SLA (Open)',
    committed: 'Yes',
    notes: '',
    devWork: 'Dev A',
    testSupport: 'Test B',
    carryToNext: '',
    ...overrides,
  }
}

function suggestion(overrides: Partial<PiReviewAiSuggestion> = {}): PiReviewAiSuggestion {
  return {
    issueKey: 'ALPHA-1',
    size: 'M',
    derivedPoints: 40,
    userSuppliedPoints: null,
    riskNote: null,
    dependencyNote: null,
    implementationNote: null,
    devWork: null,
    testSupport: null,
    rationale: 'Two integrations.',
    state: 'pending',
    ...overrides,
  }
}

// ── CW-1: the forbidden surface ──

describe('applyPiReviewSuggestion — CW-1: only two cells may ever change', () => {
  it('leaves every field except pointEstimate and notes untouched', () => {
    const originalRow = row({ notes: 'Existing note' })

    const nextRow = applyPiReviewSuggestion(originalRow, suggestion({
      riskNote: 'Vendor SLA unconfirmed.',
      dependencyNote: 'Auth shim must land first.',
      implementationNote: 'Needs a BAT window.',
    }))

    // The whole point of the feature's design: everything below mirrors Jira or belongs to a human.
    expect(nextRow.rowId).toBe(originalRow.rowId)
    expect(nextRow.feature).toBe(originalRow.feature)
    expect(nextRow.carryOver).toBe(originalRow.carryOver)
    expect(nextRow.committed).toBe(originalRow.committed)
    // A suggestion that says nothing about the boxes must leave them exactly as they were.
    expect(nextRow.devWork).toBe(originalRow.devWork)
    expect(nextRow.testSupport).toBe(originalRow.testSupport)
  })

  it('never writes the Dependency or Risks columns — they mirror Jira links (FR-025)', () => {
    const originalRow = row()

    const nextRow = applyPiReviewSuggestion(originalRow, suggestion({
      riskNote: 'A risk the AI spotted.',
      dependencyNote: 'A dependency the AI spotted.',
    }))

    // If these moved, the next page load would rebuild them from Jira and the AI text would vanish.
    expect(nextRow.dependency).toBe('PLAT-5 - Auth shim (In Progress)')
    expect(nextRow.risks).toBe('RISK-2 - Vendor SLA (Open)')
  })

  it('never writes Priority — Jira owns it', () => {
    expect(applyPiReviewSuggestion(row(), suggestion()).priority).toBe('High')
  })

  it('changes only the four permitted keys and no others', () => {
    const originalRow = row()
    const nextRow = applyPiReviewSuggestion(originalRow, suggestion({
      riskNote: 'Something.',
      devWork: true,
      testSupport: true,
    }))

    const changedKeys = (Object.keys(originalRow) as (keyof PiReviewRow)[])
      .filter((fieldName) => nextRow[fieldName] !== originalRow[fieldName])

    // Dev Work and Test Support joined the surface because — unlike Dependency/Risks — reconcile
    // does not rebuild them from Jira, so an accepted value survives the next page load.
    expect(changedKeys.sort()).toEqual(['devWork', 'notes', 'pointEstimate', 'testSupport'])
  })

  it('returns a new row rather than mutating the one it was given (CW-4, unit level)', () => {
    const originalRow = row()
    const snapshot = { ...originalRow }

    const nextRow = applyPiReviewSuggestion(originalRow, suggestion({ riskNote: 'Something.' }))

    expect(originalRow).toEqual(snapshot) // pure: no I/O, no mutation
    expect(nextRow).not.toBe(originalRow)
  })
})

// ── CW-5: prompt inputs must never become row fields ──

describe('applyPiReviewSuggestion — CW-5', () => {
  it('never puts description or acceptanceCriteria on a row', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({ riskNote: 'Something.' }))

    expect(nextRow).not.toHaveProperty('description')
    expect(nextRow).not.toHaveProperty('acceptanceCriteria')
  })
})

// ── Notes: overwrite with the AI block, labelled, capped ──

describe('applyPiReviewSuggestion — notes', () => {
  it('writes labelled lines using the convention reconciliation already writes', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({
      riskNote: 'Vendor SLA unconfirmed.',
      dependencyNote: 'Auth shim must land first.',
      implementationNote: 'Needs a BAT window.',
    }))

    expect(nextRow.notes).toContain('Dependency note: Auth shim must land first.')
    expect(nextRow.notes).toContain('Risk note: Vendor SLA unconfirmed.')
    expect(nextRow.notes).toContain('Implementation note: Needs a BAT window.')
  })

  it('orders notes Dependency → Risk → Implementation, mirroring reconciliation', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({
      riskNote: 'R.',
      dependencyNote: 'D.',
      implementationNote: 'I.',
    }))

    expect(nextRow.notes).toBe('Dependency note: D.\nRisk note: R.\nImplementation note: I.')
  })

  it('joins lines with \\n — the separator that survives the Confluence round-trip', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({ riskNote: 'R.', implementationNote: 'I.' }))

    expect(nextRow.notes.split('\n')).toEqual(['Risk note: R.', 'Implementation note: I.'])
    expect(nextRow.notes).not.toContain('<br')
  })

  it('overwrites existing notes with the AI block, like the estimate replaces the estimate cell', () => {
    // The user asked for parity with points: an accepted note STATES the cell, it does not add to it.
    // The per-field selection is the guard that lets them keep their own text (see the selection suite).
    const nextRow = applyPiReviewSuggestion(row({ notes: 'A human wrote this.' }), suggestion({ riskNote: 'R.' }))

    expect(nextRow.notes).toBe('Risk note: R.')
  })

  it('leaves notes alone when every note value is blank-ish — silence never blanks the cell', () => {
    const nextRow = applyPiReviewSuggestion(row({ notes: 'Kept.' }), suggestion({
      riskNote: 'n/a',
      dependencyNote: '',
      implementationNote: '  ',
    }))

    expect(nextRow.notes).toBe('Kept.')
  })

  it('caps a long note at MAX_AI_NOTE_LENGTH', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({ riskNote: 'x'.repeat(500) }))

    // The note line is "Risk note: " + the capped text (+ the ellipsis).
    expect(nextRow.notes.length).toBeLessThanOrEqual('Risk note: '.length + MAX_AI_NOTE_LENGTH + 1)
    expect(nextRow.notes.endsWith('…')).toBe(true)
  })

  it('leaves notes untouched when the suggestion carries none', () => {
    const nextRow = applyPiReviewSuggestion(row({ notes: 'Only mine.' }), suggestion())

    expect(nextRow.notes).toBe('Only mine.')
  })
})

// ── The Dev Work / Test Support boxes ──

describe('applyPiReviewSuggestion — the checkboxes', () => {
  it('ticks Dev Work when the team must build it', () => {
    expect(applyPiReviewSuggestion(row(), suggestion({ devWork: true })).devWork).toBe('Yes')
  })

  it(`ticks Test Support when the team only supports another team's testing`, () => {
    expect(applyPiReviewSuggestion(row(), suggestion({ testSupport: true })).testSupport).toBe('Yes')
  })

  it('writes the literal the table reads as ticked — not true, not "true"', () => {
    // The renderer checks `cellValue === 'Yes'`; anything else is an unticked box.
    const nextRow = applyPiReviewSuggestion(row(), suggestion({ devWork: true, testSupport: true }))

    expect(nextRow.devWork).toBe('Yes')
    expect(nextRow.testSupport).toBe('Yes')
  })

  it('unticks a box when the model says false', () => {
    const nextRow = applyPiReviewSuggestion(row({ devWork: 'Yes' }), suggestion({ devWork: false }))

    expect(nextRow.devWork).toBe('')
  })

  it('leaves a box alone when the model said nothing — silence is not a verdict', () => {
    // The important one: absent must never untick a human's box.
    const nextRow = applyPiReviewSuggestion(
      row({ devWork: 'Yes', testSupport: 'Yes' }),
      suggestion({ devWork: null, testSupport: null }),
    )

    expect(nextRow.devWork).toBe('Yes')
    expect(nextRow.testSupport).toBe('Yes')
  })

  it('can tick one box without touching the other', () => {
    const nextRow = applyPiReviewSuggestion(row({ testSupport: 'Yes' }), suggestion({ devWork: true }))

    expect(nextRow.devWork).toBe('Yes')
    expect(nextRow.testSupport).toBe('Yes')
  })

  it('applies a box verdict even when the size was unusable', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({ size: null, derivedPoints: null, devWork: true }))

    expect(nextRow.devWork).toBe('Yes')
    expect(nextRow.pointEstimate).toBe('')
  })
})

// ── CW-3: idempotence ──

describe('applyPiReviewSuggestion — CW-3: applying twice equals applying once', () => {
  it('does not duplicate a note line on a repeat run (FR-027)', () => {
    // Overwrite is idempotent by construction: the second run replaces the notes with the same block.
    const appliedOnce = applyPiReviewSuggestion(row(), suggestion({ riskNote: 'Vendor SLA unconfirmed.' }))
    const appliedTwice = applyPiReviewSuggestion(appliedOnce, suggestion({ riskNote: 'Vendor SLA unconfirmed.' }))

    expect(appliedTwice.notes).toBe(appliedOnce.notes)
  })

  it('is idempotent for the estimate too', () => {
    const appliedOnce = applyPiReviewSuggestion(row(), suggestion())
    const appliedTwice = applyPiReviewSuggestion(appliedOnce, suggestion())

    expect(appliedTwice.pointEstimate).toBe(appliedOnce.pointEstimate)
  })

  it('is idempotent for the boxes too', () => {
    const boxSuggestion = suggestion({ devWork: true, testSupport: false })
    const appliedOnce = applyPiReviewSuggestion(row({ testSupport: 'Yes' }), boxSuggestion)
    const appliedTwice = applyPiReviewSuggestion(appliedOnce, boxSuggestion)

    expect(appliedTwice.devWork).toBe(appliedOnce.devWork)
    expect(appliedTwice.testSupport).toBe(appliedOnce.testSupport)
  })
})

// ── The estimate ──

describe('applyPiReviewSuggestion — the estimate', () => {
  it('writes the derived points for a valid size', () => {
    expect(applyPiReviewSuggestion(row(), suggestion({ size: 'L', derivedPoints: 60 })).pointEstimate).toBe('60')
  })

  it('leaves the estimate untouched when the size was outside the scale', () => {
    const nextRow = applyPiReviewSuggestion(row({ pointEstimate: '8' }), suggestion({
      size: null,
      derivedPoints: null,
      riskNote: 'The notes are still useful.',
    }))

    expect(nextRow.pointEstimate).toBe('8')
    expect(nextRow.notes).toContain('Risk note: The notes are still useful.')
  })

  it('replaces a human estimate only when the caller has accepted the suggestion (FR-023)', () => {
    // The conflict is surfaced in the review UI; by the time apply runs, the user has chosen.
    expect(applyPiReviewSuggestion(row({ pointEstimate: '8' }), suggestion()).pointEstimate).toBe('40')
  })

  it('uses the user-supplied number for an XXL suggestion', () => {
    const nextRow = applyPiReviewSuggestion(row(), suggestion({
      size: 'XXL',
      derivedPoints: null,
      userSuppliedPoints: 120,
    }))

    expect(nextRow.pointEstimate).toBe('120')
  })

  it('refuses to write an XXL estimate that still has no number (research R-7)', () => {
    const nextRow = applyPiReviewSuggestion(row({ pointEstimate: '' }), suggestion({
      size: 'XXL',
      derivedPoints: null,
      userSuppliedPoints: null,
      state: 'needsPoints',
    }))

    // 100+ is a floor, not a value. The app must never invent the number.
    expect(nextRow.pointEstimate).toBe('')
  })
})

// ── Per-field selection: the user picks which of the four cells to apply ──

describe('applyPiReviewSuggestion — field selection', () => {
  const everything = suggestion({
    size: 'L',
    derivedPoints: 60,
    riskNote: 'A risk.',
    devWork: true,
    testSupport: true,
  })

  it('applies all four cells when the selection includes them all', () => {
    const nextRow = applyPiReviewSuggestion(row({ pointEstimate: '8', notes: 'Mine.' }), everything, {
      pointEstimate: true,
      notes: true,
      devWork: true,
      testSupport: true,
    })

    expect(nextRow.pointEstimate).toBe('60')
    expect(nextRow.notes).toBe('Risk note: A risk.')
    expect(nextRow.devWork).toBe('Yes')
    expect(nextRow.testSupport).toBe('Yes')
  })

  it('leaves a deselected estimate alone while still applying the notes', () => {
    const nextRow = applyPiReviewSuggestion(row({ pointEstimate: '8' }), everything, {
      pointEstimate: false,
      notes: true,
      devWork: true,
      testSupport: true,
    })

    expect(nextRow.pointEstimate).toBe('8') // the human's estimate stands
    expect(nextRow.notes).toBe('Risk note: A risk.')
  })

  it('keeps the human notes when notes are deselected — the whole point of the opt-out', () => {
    const nextRow = applyPiReviewSuggestion(row({ notes: 'A human wrote this.' }), everything, {
      pointEstimate: true,
      notes: false,
      devWork: true,
      testSupport: true,
    })

    expect(nextRow.notes).toBe('A human wrote this.')
    expect(nextRow.pointEstimate).toBe('60') // the other selected fields still apply
  })

  it('leaves a deselected box exactly as it was', () => {
    const nextRow = applyPiReviewSuggestion(row({ devWork: '', testSupport: 'Yes' }), everything, {
      pointEstimate: true,
      notes: true,
      devWork: false,
      testSupport: false,
    })

    expect(nextRow.devWork).toBe('') // deselected — the false verdict was not written
    expect(nextRow.testSupport).toBe('Yes')
  })

  it('changes nothing when no field is selected', () => {
    const originalRow = row({ pointEstimate: '8', notes: 'Mine.', devWork: 'Yes', testSupport: '' })
    const nextRow = applyPiReviewSuggestion(originalRow, everything, {
      pointEstimate: false,
      notes: false,
      devWork: false,
      testSupport: false,
    })

    expect(nextRow).toEqual(originalRow)
  })

  it('defaults to applying everything when no selection is given', () => {
    const withDefault = applyPiReviewSuggestion(row(), everything)
    const withAll = applyPiReviewSuggestion(row(), everything, {
      pointEstimate: true,
      notes: true,
      devWork: true,
      testSupport: true,
    })

    expect(withDefault).toEqual(withAll)
  })
})
