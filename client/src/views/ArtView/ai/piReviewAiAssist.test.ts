// piReviewAiAssist.test.ts — The prompt the model reads and the parser that reads it back.
//
// These are the feature's two pure functions: no React, no I/O. Between them they enforce the
// decisions that make the feature safe — the model returns a SIZE and never a point number, and a
// bad reply degrades per field rather than discarding every good suggestion.

import { describe, expect, it } from 'vitest'

import { buildPiReviewAiPrompt, parsePiReviewAiReply } from './piReviewAiAssist.ts'
import type { PiReviewAiColumnAvailability } from './piReviewAiAssist.ts'
import type { PiReviewAiFeatureContext } from './piReviewAiFetch.ts'

/** Which optional columns the page's table actually has. Both present unless a test says otherwise. */
function columns(overrides: Partial<PiReviewAiColumnAvailability> = {}): PiReviewAiColumnAvailability {
  return { hasDevWorkColumn: true, hasTestSupportColumn: true, ...overrides }
}

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
    currentDevWork: '',
    currentTestSupport: '',
    ...overrides,
  }
}

// ── The prompt (FR-013 … FR-017, FR-031) ──

describe('buildPiReviewAiPrompt', () => {
  it("carries every Feature's key, summary, priority, description, AC and linked issues (FR-013)", () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    expect(prompt).toContain('ALPHA-1')
    expect(prompt).toContain('Enrollment support')
    expect(prompt).toContain('High')
    expect(prompt).toContain('Add enrollment support to the portal.')
    expect(prompt).toContain('Given a member, when they enroll, then a record is created.')
    expect(prompt).toContain('PLAT-5 - Auth shim (In Progress)')
    expect(prompt).toContain('RISK-2 - Vendor SLA (Open)')
  })

  it('embeds the T-shirt scale from the shared constant (FR-014)', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    // The rubric shown on the sizing card and the rubric given to the model are the same object.
    for (const rung of ['XS', 'S', 'M', 'L', 'XL', 'XXL', '10', '20', '40', '60', '80', '100+']) {
      expect(prompt).toContain(rung)
    }
  })

  it('states an absent description or AC explicitly rather than as an empty label (FR-015)', () => {
    const prompt = buildPiReviewAiPrompt([context({ description: null, acceptanceCriteria: null })], columns())

    expect(prompt).toMatch(/description: \(none in Jira\)/)
    expect(prompt).toMatch(/acceptance criteria: \(none in Jira\)/)
    // An empty label would invite the model to invent content to fill it.
    expect(prompt).not.toMatch(/description:\s*\n/)
  })

  it('asks for a size and never a point number — the model cannot contradict the rubric (FR-017)', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    expect(prompt).toMatch(/"size"/)
    expect(prompt).not.toMatch(/"points"/)
    expect(prompt).toMatch(/do not .*point number|never .*point number/i)
  })

  it('instructs the model to use only the listed issue keys (FR-021 guard, prompt side)', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    expect(prompt).toMatch(/only the issue keys listed|never invent/i)
  })

  it('asks for the reply envelope the parser expects (FR-016)', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

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

    const prompt = buildPiReviewAiPrompt(everyFeature, columns())

    expect(prompt).toContain('ALPHA-1')
    expect(prompt).toContain('ALPHA-2')
    expect(prompt).toContain('ALPHA-3')
    expect(prompt).toMatch(/3 Features/)
  })

  it('asks whether the team must BUILD it — the Dev Work box', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    expect(prompt).toContain('"devWork"')
    expect(prompt).toMatch(/dev work/i)
    // The distinction the PO actually draws: does OUR team write the code?
    expect(prompt).toMatch(/development .*by (the|our) team|team .*must build|requires development/i)
  })

  it(`asks whether the team is ONLY supporting another team's testing — the Test Support box`, () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

    expect(prompt).toContain('"testSupport"')
    expect(prompt).toMatch(/test support/i)
    // "only" is the whole point — this is the case where we do NOT build it.
    expect(prompt).toMatch(/only .*support(ing)? (the )?test/i)
    expect(prompt).toMatch(/another team/i)
  })

  it(`does not ask for a column the page's table does not have`, () => {
    // These are OPTIONAL columns. Asking for a value the table cannot hold would produce a
    // suggestion that silently goes nowhere.
    const withoutDevWork = buildPiReviewAiPrompt([context()], columns({ hasDevWorkColumn: false }))
    expect(withoutDevWork).not.toContain('"devWork"')
    expect(withoutDevWork).toContain('"testSupport"')

    const withoutTestSupport = buildPiReviewAiPrompt([context()], columns({ hasTestSupportColumn: false }))
    expect(withoutTestSupport).not.toContain('"testSupport"')
    expect(withoutTestSupport).toContain('"devWork"')

    const withNeither = buildPiReviewAiPrompt([context()], columns({ hasDevWorkColumn: false, hasTestSupportColumn: false }))
    expect(withNeither).not.toContain('"devWork"')
    expect(withNeither).not.toContain('"testSupport"')
    // The rest of the prompt is unaffected.
    expect(withNeither).toContain('"size"')
  })

  it('shows the model what each box says today, so it can disagree with intent', () => {
    const prompt = buildPiReviewAiPrompt([context({ currentDevWork: 'Yes', currentTestSupport: '' })], columns())

    expect(prompt).toMatch(/dev work (is )?already (ticked|checked|yes)|dev work: yes/i)
  })

  it('tells the model the notes are for what Jira links cannot say', () => {
    const prompt = buildPiReviewAiPrompt([context()], columns())

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

  it('yields ONE suggestion for a Feature the page carries on more than one row (no repeated cards)', () => {
    // A key typed by hand onto a row a pull already added leaves the same Feature on two rows. That
    // must not surface as two identical AI cards.
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', rationale: 'Once is enough.' }]),
      ['ALPHA-1', 'ALPHA-1', 'ALPHA-2'],
    )

    expect(result.suggestions.filter((suggestion) => suggestion.issueKey === 'ALPHA-1')).toHaveLength(1)
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

  it('reads devWork and testSupport as booleans', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', devWork: true, testSupport: false }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions[0].devWork).toBe(true)
    expect(result.suggestions[0].testSupport).toBe(false)
  })

  it('leaves a box absent — not false — when the model says nothing about it', () => {
    // Absent must not mean "uncheck it": silence is not a judgement, and applying it would erase a
    // human's tick.
    const result = parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', size: 'M' }]), KNOWN_KEYS)

    expect(result.suggestions[0].devWork).toBeNull()
    expect(result.suggestions[0].testSupport).toBeNull()
  })

  it('ignores a non-boolean box value rather than guessing what it meant', () => {
    const result = parsePiReviewAiReply(
      reply([{ issueKey: 'ALPHA-1', size: 'M', devWork: 'maybe', testSupport: 1 }]),
      KNOWN_KEYS,
    )

    expect(result.suggestions[0].devWork).toBeNull()
    expect(result.suggestions[0].testSupport).toBeNull()
  })

  it('keeps an item that carries only a box verdict and no size', () => {
    const result = parsePiReviewAiReply(reply([{ issueKey: 'ALPHA-1', devWork: true }]), KNOWN_KEYS)

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].devWork).toBe(true)
    expect(result.suggestions[0].size).toBeNull()
    expect(result.unparsedCount).toBe(0)
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
