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

  it('changes exactly the two permitted keys and no others', () => {
    const originalRow = row()
    const nextRow = applyPiReviewSuggestion(originalRow, suggestion({ riskNote: 'Something.' }))

    const changedKeys = (Object.keys(originalRow) as (keyof PiReviewRow)[])
      .filter((fieldName) => nextRow[fieldName] !== originalRow[fieldName])

    expect(changedKeys.sort()).toEqual(['notes', 'pointEstimate'])
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

// ── Notes: append-only, labelled, deduped, capped ──

describe('applyPiReviewSuggestion — notes', () => {
  it('appends labelled lines using the convention reconciliation already writes', () => {
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

  it('appends after existing notes and never overwrites them (FR-023 — a note cannot clobber)', () => {
    const nextRow = applyPiReviewSuggestion(row({ notes: 'A human wrote this.' }), suggestion({ riskNote: 'R.' }))

    expect(nextRow.notes).toBe('A human wrote this.\nRisk note: R.')
  })

  it('drops blank-ish note values so they never reach a cell', () => {
    const nextRow = applyPiReviewSuggestion(row({ notes: 'Kept.' }), suggestion({
      riskNote: 'n/a',
      dependencyNote: '',
      implementationNote: '  ',
    }))

    expect(nextRow.notes).toBe('Kept.')
  })

  it('caps a long note at MAX_AI_NOTE_LENGTH before appending', () => {
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

// ── CW-3: idempotence ──

describe('applyPiReviewSuggestion — CW-3: applying twice equals applying once', () => {
  it('does not duplicate a note line on a repeat run (FR-027)', () => {
    const appliedOnce = applyPiReviewSuggestion(row(), suggestion({ riskNote: 'Vendor SLA unconfirmed.' }))
    const appliedTwice = applyPiReviewSuggestion(appliedOnce, suggestion({ riskNote: 'Vendor SLA unconfirmed.' }))

    expect(appliedTwice.notes).toBe(appliedOnce.notes)
  })

  it('is idempotent for the estimate too', () => {
    const appliedOnce = applyPiReviewSuggestion(row(), suggestion())
    const appliedTwice = applyPiReviewSuggestion(appliedOnce, suggestion())

    expect(appliedTwice.pointEstimate).toBe(appliedOnce.pointEstimate)
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
