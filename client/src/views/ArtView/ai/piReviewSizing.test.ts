// piReviewSizing.test.ts — The T-shirt sizing scale is the rubric both the AI prompt and the in-app
// sizing card read, so it must be exact and closed. Source: GitHub issue #147.

import { describe, expect, it } from 'vitest'

import {
  FEATURE_SIZING_SCALE,
  SIZING_GUIDANCE_URL,
  isFeatureSizeName,
  readPointsForSize,
  type FeatureSizeName,
} from './piReviewSizing.ts'

describe('FEATURE_SIZING_SCALE', () => {
  it('maps every size to the points the organisation defined', () => {
    // The exact table from GitHub #147 — XXL is "100+", a floor rather than a value.
    expect(FEATURE_SIZING_SCALE.map((entry) => [entry.size, entry.points])).toEqual([
      ['XS', 10],
      ['S', 20],
      ['M', 40],
      ['L', 60],
      ['XL', 80],
      ['XXL', null],
    ])
  })

  it('labels XXL as 100+ so the card can show the floor it actually has', () => {
    const extraExtraLarge = FEATURE_SIZING_SCALE.find((entry) => entry.size === 'XXL')
    expect(extraExtraLarge?.pointsLabel).toBe('100+')
    expect(FEATURE_SIZING_SCALE.find((entry) => entry.size === 'M')?.pointsLabel).toBe('40')
  })

  it('is frozen — the rubric is not editable at runtime', () => {
    expect(Object.isFrozen(FEATURE_SIZING_SCALE)).toBe(true)
  })

  it('points to the authoritative Confluence guidance', () => {
    expect(SIZING_GUIDANCE_URL).toContain('Feature+Template+for+Jira+Feature+Sizing+Guidance')
  })
})

describe('readPointsForSize', () => {
  it('derives the points for every sized entry', () => {
    expect(readPointsForSize('XS')).toBe(10)
    expect(readPointsForSize('S')).toBe(20)
    expect(readPointsForSize('M')).toBe(40)
    expect(readPointsForSize('L')).toBe(60)
    expect(readPointsForSize('XL')).toBe(80)
  })

  it('returns null for XXL — "100+" is a floor the user must resolve, never a number we invent', () => {
    expect(readPointsForSize('XXL')).toBeNull()
  })
})

describe('isFeatureSizeName', () => {
  it('accepts exactly the six sizes on the scale', () => {
    const everySize: FeatureSizeName[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
    for (const size of everySize) {
      expect(isFeatureSizeName(size)).toBe(true)
    }
  })

  it('is case-insensitive about surrounding noise a model might emit', () => {
    expect(isFeatureSizeName('m')).toBe(true)
    expect(isFeatureSizeName(' L ')).toBe(true)
  })

  it('rejects anything the scale does not define — never coerced to a neighbour (FR-020)', () => {
    for (const notASize of ['HUGE', 'XXXL', 'M/L', 'medium', '40', '', 'XS-S']) {
      expect(isFeatureSizeName(notASize)).toBe(false)
    }
  })

  it('rejects non-string input without throwing', () => {
    expect(isFeatureSizeName(null)).toBe(false)
    expect(isFeatureSizeName(40)).toBe(false)
    expect(isFeatureSizeName(undefined)).toBe(false)
  })
})
