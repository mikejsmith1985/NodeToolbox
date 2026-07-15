// PiReviewSizingCard.test.tsx — The sizing rubric, in the app.
//
// This serves MANUAL sizing, which is still the norm — so unlike everything else in this module it
// must render whether or not AI Assist is unlocked. A rubric nobody can find is a rubric nobody
// applies.

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PiReviewSizingCard } from './PiReviewSizingCard.tsx'
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts'
import { SIZING_GUIDANCE_URL } from './piReviewSizing.ts'

describe('PiReviewSizingCard', () => {
  it('renders every rung of the scale from the shared constant', () => {
    render(<PiReviewSizingCard />)

    for (const [size, points] of [['XS', '10'], ['S', '20'], ['M', '40'], ['L', '60'], ['XL', '80'], ['XXL', '100+']]) {
      const sizeCell = screen.getByText(size)
      expect(sizeCell).toBeInTheDocument()
      expect(sizeCell.closest('tr')).toHaveTextContent(points)
    }
  })

  it('links to the authoritative Confluence guidance', () => {
    render(<PiReviewSizingCard />)

    const guidanceLink = screen.getByRole('link', { name: /sizing guidance/i })
    expect(guidanceLink).toHaveAttribute('href', SIZING_GUIDANCE_URL)
    expect(guidanceLink).toHaveAttribute('target', '_blank')
  })

  it('renders while AI Assist is LOCKED — it serves manual sizing (FR-035)', () => {
    act(() => setAiAssistUnlocked(false))

    render(<PiReviewSizingCard />)

    // The rest of this module hides when locked. This must not: sizing by hand is the common case.
    expect(screen.getByText('XS')).toBeInTheDocument()
    expect(screen.getByText('XXL')).toBeInTheDocument()
  })

  it('still renders when AI Assist is unlocked', () => {
    act(() => setAiAssistUnlocked(true))

    render(<PiReviewSizingCard />)

    expect(screen.getByText('M')).toBeInTheDocument()
    act(() => setAiAssistUnlocked(false))
  })
})
