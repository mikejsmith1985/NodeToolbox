// PiReviewSuggestionTable.test.tsx — The review gate. Every suggestion passes through here before it
// can touch a row, so these tests are what make "nothing lands without your say-so" true.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PiReviewSuggestionTable } from './PiReviewSuggestionTable.tsx'
import type { PiReviewAiSuggestion } from './piReviewAiAssist.ts'

function suggestion(overrides: Partial<PiReviewAiSuggestion> = {}): PiReviewAiSuggestion {
  return {
    issueKey: 'ALPHA-1',
    size: 'M',
    derivedPoints: 40,
    userSuppliedPoints: null,
    riskNote: 'Vendor SLA unconfirmed.',
    dependencyNote: null,
    implementationNote: null,
    devWork: null,
    testSupport: null,
    rationale: 'Two integrations and a migration.',
    state: 'pending',
    ...overrides,
  }
}

function renderTable(
  suggestions: PiReviewAiSuggestion[] = [suggestion()],
  handlers: Partial<{ onAccept: () => void; onReject: () => void; onSupplyPoints: () => void }> = {},
) {
  const onAccept = handlers.onAccept ?? vi.fn()
  const onReject = handlers.onReject ?? vi.fn()
  const onSupplyPoints = handlers.onSupplyPoints ?? vi.fn()
  render(
    <PiReviewSuggestionTable
      currentEstimatesByKey={{ 'ALPHA-1': '' }}
      onAccept={onAccept}
      onReject={onReject}
      onSupplyPoints={onSupplyPoints}
      suggestions={suggestions}
    />,
  )
  return { onAccept, onReject, onSupplyPoints }
}

describe('PiReviewSuggestionTable', () => {
  it('shows each suggestion against its Feature with the size and the derived points (FR-019)', () => {
    renderTable()

    expect(screen.getByText('ALPHA-1')).toBeInTheDocument()
    expect(screen.getByText(/\bM\b/)).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
  })

  it('shows the rationale so Accept is never a blind click', () => {
    renderTable()

    expect(screen.getByText(/two integrations and a migration/i)).toBeInTheDocument()
  })

  it('shows what Accept will write — the note text, labelled as it will appear', () => {
    renderTable([suggestion({ riskNote: 'Vendor SLA unconfirmed.', implementationNote: 'Needs a BAT window.' })])

    expect(screen.getByText(/vendor sla unconfirmed/i)).toBeInTheDocument()
    expect(screen.getByText(/needs a bat window/i)).toBeInTheDocument()
  })

  it('calls onAccept with the suggestion, and only that suggestion (FR-032)', () => {
    const { onAccept } = renderTable([
      suggestion({ issueKey: 'ALPHA-1' }),
      suggestion({ issueKey: 'ALPHA-2', rationale: 'Second.' }),
    ])

    fireEvent.click(screen.getAllByRole('button', { name: /^accept$/i })[1])

    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'ALPHA-2' }), expect.anything())
  })

  // ── Per-field selection: pick and choose, not all-or-nothing ──

  it('accepts every offered field by default, so a plain Accept applies the whole suggestion', () => {
    const { onAccept } = renderTable([suggestion({ size: 'M', derivedPoints: 40, riskNote: 'A risk.', devWork: true })])

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'ALPHA-1' }),
      { pointEstimate: true, notes: true, devWork: true, testSupport: false },
    )
  })

  it('excludes a field the user unticks before accepting', () => {
    const { onAccept } = renderTable([suggestion({ size: 'M', derivedPoints: 40, riskNote: 'A risk.' })])

    // Untick the notes so only the estimate is applied.
    fireEvent.click(screen.getByRole('checkbox', { name: /overwrite implementation notes for alpha-1/i }))
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))

    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: 'ALPHA-1' }),
      expect.objectContaining({ pointEstimate: true, notes: false }),
    )
  })

  it('lets an XXL suggestion be accepted for its notes alone by unticking the estimate', () => {
    renderTable([suggestion({ size: 'XXL', derivedPoints: null, state: 'needsPoints', riskNote: 'A risk.' })])

    // Blocked while the (still-numberless) estimate is selected…
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeDisabled()
    // …but unticking the estimate lifts the block, because no number is needed for a field not applied.
    fireEvent.click(screen.getByRole('checkbox', { name: /apply point estimate for alpha-1/i }))
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeEnabled()
  })

  it('disables Accept when the user unticks every offered field', () => {
    renderTable([suggestion({ size: 'M', derivedPoints: 40, riskNote: 'A risk.' })])

    fireEvent.click(screen.getByRole('checkbox', { name: /apply point estimate for alpha-1/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /overwrite implementation notes for alpha-1/i }))

    expect(screen.getByRole('button', { name: /^accept$/i })).toBeDisabled()
  })

  it('calls onReject with the suggestion', () => {
    const { onReject } = renderTable()

    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }))

    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'ALPHA-1' }))
  })

  it('surfaces a conflict when the row already has a human estimate, and does not hide it (FR-023)', () => {
    render(
      <PiReviewSuggestionTable
        currentEstimatesByKey={{ 'ALPHA-1': '8' }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onSupplyPoints={vi.fn()}
        suggestions={[suggestion()]}
      />,
    )

    // Both values visible: the user chooses, nothing is silently replaced. "40" appears in both the
    // points badge and the conflict sentence, so assert the sentence carries both numbers.
    const conflictLine = screen.getByText(/replaces your estimate/i)
    expect(conflictLine).toHaveTextContent('8')
    expect(conflictLine).toHaveTextContent('40')
  })

  it('leaves the estimate alone when the size was outside the scale, keeping the row for its notes', () => {
    renderTable([suggestion({ size: null, derivedPoints: null, riskNote: 'Still useful.' })])

    expect(screen.getByText(/size not recognised/i)).toBeInTheDocument()
    expect(screen.getByText(/still useful/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeEnabled()
  })

  // ── The Dev Work / Test Support verdicts ──

  it('shows what Accept will do to each box, so it is never a blind tick', () => {
    renderTable([suggestion({ devWork: true, testSupport: false })])

    expect(screen.getByText(/dev work/i)).toBeInTheDocument()
    expect(screen.getByText(/test support/i)).toBeInTheDocument()
  })

  it('says nothing about a box the model had no verdict on', () => {
    renderTable([suggestion({ devWork: null, testSupport: null })])

    expect(screen.queryByText(/dev work/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/test support/i)).not.toBeInTheDocument()
  })

  it('distinguishes ticking a box from unticking one', () => {
    renderTable([suggestion({ devWork: true, testSupport: false })])

    // The user must be able to tell "we will build this" from "we will not only be testing it".
    expect(screen.getByText(/dev work.*tick/i)).toBeInTheDocument()
    expect(screen.getByText(/test support.*untick|test support.*clear/i)).toBeInTheDocument()
  })

  // ── XXL: "100+" is a floor, not a value (research R-7) ──

  it('blocks Accept for an XXL suggestion until a number is supplied', () => {
    renderTable([suggestion({ size: 'XXL', derivedPoints: null, state: 'needsPoints' })])

    expect(screen.getByText(/100\+/)).toBeInTheDocument()
    expect(screen.getByText(/set a value/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeDisabled()
  })

  it('reports the number the user supplies for an XXL suggestion', () => {
    const { onSupplyPoints } = renderTable([suggestion({ size: 'XXL', derivedPoints: null, state: 'needsPoints' })])

    fireEvent.change(screen.getByLabelText(/points for alpha-1/i), { target: { value: '120' } })

    expect(onSupplyPoints).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'ALPHA-1' }), 120)
  })

  it('enables Accept once an XXL suggestion carries a user-supplied number', () => {
    renderTable([suggestion({ size: 'XXL', derivedPoints: null, userSuppliedPoints: 120, state: 'pending' })])

    expect(screen.getByRole('button', { name: /^accept$/i })).toBeEnabled()
  })

  it('ignores a non-numeric value rather than accepting garbage as an estimate', () => {
    const { onSupplyPoints } = renderTable([suggestion({ size: 'XXL', derivedPoints: null, state: 'needsPoints' })])

    fireEvent.change(screen.getByLabelText(/points for alpha-1/i), { target: { value: 'lots' } })

    expect(onSupplyPoints).not.toHaveBeenCalled()
  })

  it('renders nothing when there are no suggestions to review', () => {
    const { container } = render(
      <PiReviewSuggestionTable
        currentEstimatesByKey={{}}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onSupplyPoints={vi.fn()}
        suggestions={[]}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
