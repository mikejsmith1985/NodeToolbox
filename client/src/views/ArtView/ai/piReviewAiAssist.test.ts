// piReviewAiAssist.test.ts — The prompt the model reads and the parser that reads it back.
//
// These are the feature's two pure functions: no React, no I/O. Between them they enforce the
// decisions that make the feature safe — the model returns a SIZE and never a point number, and a
// bad reply degrades per field rather than discarding every good suggestion.

import { describe, expect, it } from 'vitest'

import { buildPiReviewAiPrompt, parsePiReviewAiReply } from './piReviewAiAssist.ts'
import type { PiReviewAiFeatureContext } from './piReviewAiFetch.ts'

function context(overrides: Partial<PiReviewAiFeatureContext> = {}): PiReviewAiFeatureContext {
  return {
    issueKey: 'ALPHA-1',
    summary: 'Enrollment support',
    priority: 'High',
    description: 'Add enrollment support to the portal.',
    acceptanceCriteria: 'Given a member, when they enroll, then a record is created.',
    linkedDependencies: ['PLAT-5 - Auth shim (In Progress)'],
    linkedRisks: ['RISK-2 - Vendor SLA (Open)'],
    currentPointEstimate: '',
    hasExistingNotes: false,
    ...overrides,
  }
}

// ── The prompt (FR-013 … FR-017, FR-031) ──

describe('buildPiReviewAiPrompt', () => {
  it("carries every Feature's key, summary, priority, description, AC and linked issues (FR-013)", () => {
    const prompt = buildPiReviewAiPrompt([context()])

    expect(prompt).toContain('ALPHA-1')
    expect(prompt).toContain('Enrollment support')
    expect(prompt).toContain('High')
    expect(prompt).toContain('Add enrollment support to the portal.')
    expect(prompt).toContain('Given a member, when they enroll, then a record is created.')
    expect(prompt).toContain('PLAT-5 - Auth shim (In Progress)')
    expect(prompt).toContain('RISK-2 - Vendor SLA (Open)')
  })

  it('embeds the T-shirt scale from the shared constant (FR-014)', () => {
    const prompt = buildPiReviewAiPrompt([context()])

    // The rubric shown on the sizing card and the rubric given to the model are the same object.
    for (const rung of ['XS', 'S', 'M', 'L', 'XL', 'XXL', '10', '20', '40', '60', '80', '100+']) {
      expect(prompt).toContain(rung)
    }
  })

  it('states an absent description or AC explicitly rather than as an empty label (FR-015)', () => {
    const prompt = buildPiReviewAiPrompt([context({ description: null, acceptanceCriteria: null })])

    expect(prompt).toMatch(/description: \(none in Jira\)/)
    expect(prompt).toMatch(/acceptance criteria: \(none in Jira\)/)
    // An empty label would invite the model to invent content to fill it.
    expect(prompt).not.toMatch(/description:\s*\n/)
  })

  it('asks for a size and never a point number — the model cannot contradict the rubric (FR-017)', () => {
    const prompt = buildPiReviewAiPrompt([context()])

    expect(prompt).toMatch(/"size"/)
    expect(prompt).not.toMatch(/"points"/)
    expect(prompt).toMatch(/do not .*point number|never .*point number/i)
  })

  it('instructs the model to use only the listed issue keys (FR-021 guard, prompt side)', () => {
    const prompt = buildPiReviewAiPrompt([context()])

    expect(prompt).toMatch(/only the issue keys listed|never invent/i)
  })

  it('asks for the reply envelope the parser expects (FR-016)', () => {
    const prompt = buildPiReviewAiPrompt([context()])

    expect(prompt).toContain('"kind": "piReview"')
    expect(prompt).toContain('"items"')
    expect(prompt).toContain('"issueKey"')
  })

  it('covers EVERY Feature on the page in one prompt (FR-031)', () => {
    // Deliberately more than one: a single-Feature fixture would pass this vacuously.
    const everyFeature = [
      context({ issueKey: 'ALPHA-1', summary: 'One' }),
      context({ issueKey: 'ALPHA-2', summary: 'Two' }),
      context({ issueKey: 'ALPHA-3', summary: 'Three' }),
    ]

    const prompt = buildPiReviewAiPrompt(everyFeature)

    expect(prompt).toContain('ALPHA-1')
    expect(prompt).toContain('ALPHA-2')
    expect(prompt).toContain('ALPHA-3')
    expect(prompt).toMatch(/3 Features/)
  })

  it('tells the model the notes are for what Jira links cannot say', () => {
    const prompt = buildPiReviewAiPrompt([context()])

    // The AI must not try to restate or set the Dependency/Risks columns — those mirror Jira.
    expect(prompt).toMatch(/do not restate|not the keys|why/i)
  })
})

// ── The parser (FR-016, FR-020, FR-021, FR-024) ──

const KNOWN_KEYS = ['ALPHA-1', 'ALPHA-2']

function reply(items: unknown[], kind = 'piReview'): string {
  return JSON.stringify({ kind, items })
}

describe('parsePiReviewAiReply', () => {
  it('parses a clean reply into one suggestion per item', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', riskNote: 'Vendor SLA unconfirmed.', rationale: 'Two integrations.' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({
      issueKey: 'ALPHA-1',
      size: 'M',
      derivedPoints: 40,
      riskNote: 'Vendor SLA unconfirmed.',
      rationale: 'Two integrations.',
      state: 'pending',
    })
  })

  it('derives points from the scale and ignores any the model volunteers', () => {
    // A model claiming M=45 is contradicting the rubric. The scale wins; 45 never reaches a cell.
    const result = parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', size: 'M', points: 45 }]), KNOWN_KEYS)

    expect(result.suggestions[0].derivedPoints).toBe(40)
  })

  it('reads a reply wrapped in prose and code fences', () => {
    const chatty = 'Sure! Here you go:\n```json\n' + reply([{ issueKey: 'ALPHA-1', size: 'S' }]) + '\n```\nHope that helps.'
    const result = parsePiReviewAiReply(chatty, KNOWN_KEYS)

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].derivedPoints).toBe(20)
  })

  it('rejects the WHOLE reply when kind does not match — a wrong reply is not a partial one', () => {
    expect(() => parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', size: 'M' }], 'agingTriage'), KNOWN_KEYS))
      .toThrow(/agingTriage|does not match/i)
  })

  it('throws a clear error when the reply contains no JSON at all', () => {
    expect(() => parsePiReviewAiReply('I could not size these, sorry.', KNOWN_KEYS)).toThrow(/No JSON object/i)
  })

  it('drops an out-of-scale size to null but KEEPS the row and its notes (FR-020, FR-024)', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-2', size: 'HUGE', implementationNote: 'Needs a BAT window.' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].size).toBeNull()
    expect(result.suggestions[0].derivedPoints).toBeNull()
    expect(result.suggestions[0].implementationNote).toBe('Needs a BAT window.')
    expect(result.unparsedCount).toBe(0) // the item is usable — it is not unparsed
  })

  it('reports an unknown issue key and never applies it (FR-021)', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M' }, { issueKey: 'GHOST-9', size: 'S' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions.map((suggestion) => suggestion.issueKey)).toEqual(['ALPHA-1'])
    expect(result.unknownKeys).toEqual(['GHOST-9'])
  })

  it('counts an item with no issueKey as unparsed', () => {
    const result = parsePiReviewAiReply(reply([{ size: 'M' }, { issueKey: 'ALPHA-1', size: 'L' }]), KNOWN_KEYS)

    expect(result.suggestions).toHaveLength(1)
    expect(result.unparsedCount).toBe(1)
  })

  it('counts an item with no usable content at all as unparsed', () => {
    const result = parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', size: 'NOPE' }]), KNOWN_KEYS)

    expect(result.suggestions).toHaveLength(0)
    expect(result.unparsedCount).toBe(1)
  })

  it('yields the valid suggestions plus a report when a reply covers only some Features (FR-024)', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M' }, { issueKey: 'GHOST-1', size: 'S' }, { size: 'L' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions).toHaveLength(1)
    expect(result.unknownKeys).toEqual(['GHOST-1'])
    expect(result.unparsedCount).toBe(1)
  })

  it('marks XXL needsPoints with no number — 100+ is a floor the user resolves (R-7)', () => {
    const result = parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', size: 'XXL' }]), KNOWN_KEYS)

    expect(result.suggestions[0]).toMatchObject({ size: 'XXL', derivedPoints: null, state: 'needsPoints' })
    expect(result.suggestions[0].userSuppliedPoints).toBeNull()
  })

  it('matches issue keys case-insensitively', () => {
    const result = parsePiReviewAiReply(reply([{ issueKey: 'alpha-1', size: 'XS' }]), KNOWN_KEYS)

    expect(result.suggestions[0].issueKey).toBe('ALPHA-1')
  })

  it('drops blank-ish note values so they never reach a cell', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', riskNote: 'n/a', dependencyNote: '  ', implementationNote: 'none' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions[0].riskNote).toBeNull()
    expect(result.suggestions[0].dependencyNote).toBeNull()
    expect(result.suggestions[0].implementationNote).toBeNull()
  })

  it('caps a long note at MAX_AI_NOTE_LENGTH so a cell cannot become unbounded', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', riskNote: 'x'.repeat(500) }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions[0].riskNote?.length).toBeLessThanOrEqual(301) // 300 + the ellipsis
    expect(result.suggestions[0].riskNote?.endsWith('…')).toBe(true)
  })

  it('tolerates a missing or non-array items field', () => {
    expect(parsePiReviewAiReply(JSON.stringify({ kind: 'piReview' }), KNOWN_KEYS).suggestions).toEqual([])
    expect(parsePiReviewAiReply(JSON.stringify({ kind: 'piReview', items: 'nope' }), KNOWN_KEYS).suggestions).toEqual([])
  })

  it('returns suggestions in page-row order, not reply order', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-2', size: 'S' }, { issueKey: 'ALPHA-1', size: 'M' }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions.map((suggestion) => suggestion.issueKey)).toEqual(['ALPHA-1', 'ALPHA-2'])
  })
})
