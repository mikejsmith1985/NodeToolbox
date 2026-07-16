// hygieneAiAssist.test.ts — The prompt and the reply parser for the Hygiene AI panel.
//
// The parser is the panel's safety boundary: it must keep good proposals through a partly-bad
// reply, and must never let an unknown issue key or an off-catalog checkId produce a write.

import { describe, expect, it } from 'vitest'

import {
  buildHygieneAiPrompt,
  hasAiFixableFlags,
  parseHygieneAiReply,
  MAX_AI_COMMENT_LENGTH,
  MAX_AI_FIX_VALUE_LENGTH,
} from './hygieneAiAssist.ts'
import type { HygieneFinding } from '../checks/hygieneChecks.ts'

function finding(issueKey: string, checkIds: string[], overrides: Record<string, unknown> = {}): HygieneFinding {
  return {
    issue: {
      key: issueKey,
      fields: {
        summary: 'Automate CMS downloads',
        issuetype: { name: 'Story' },
        description: 'Given files arrive nightly, they must be pulled automatically.',
        ...overrides,
      },
    } as HygieneFinding['issue'],
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })) as HygieneFinding['flags'],
    programIncrement: null,
  }
}

describe('hasAiFixableFlags', () => {
  it('is true for a finding carrying at least one AI-fixable flag', () => {
    expect(hasAiFixableFlags(finding('TBX-1', ['missing-sp', 'no-assignee']))).toBe(true)
  })

  it('is false when every flag is outside the AI remit (human judgement or fixed elsewhere)', () => {
    expect(hasAiFixableFlags(finding('TBX-1', ['no-assignee', 'old-in-sprint', 'missing-child-story-points']))).toBe(false)
  })
})

describe('buildHygieneAiPrompt', () => {
  it('carries each fixable issue with its per-flag instruction and the allowed key list', () => {
    const promptText = buildHygieneAiPrompt([finding('TBX-1', ['missing-sp', 'stale'])])

    expect(promptText).toContain('TBX-1')
    expect(promptText).toContain('missing-sp: propose a story-point estimate')
    expect(promptText).toContain('stale: propose a short, polite nudge comment')
    expect(promptText).toContain('Issue keys you may use: TBX-1')
    expect(promptText).toContain('"kind": "hygiene"')
  })

  it('omits issues whose flags are all outside the AI remit', () => {
    const promptText = buildHygieneAiPrompt([
      finding('TBX-1', ['missing-sp']),
      finding('TBX-2', ['no-assignee']),
    ])

    expect(promptText).toContain('TBX-1')
    expect(promptText).not.toContain('TBX-2')
  })

  it('never asks for fixes the AI is not allowed to propose', () => {
    const promptText = buildHygieneAiPrompt([finding('TBX-1', ['missing-sp', 'no-assignee'])])

    expect(promptText).not.toContain('no-assignee')
  })
})

describe('parseHygieneAiReply', () => {
  const KNOWN_KEYS = ['TBX-1', 'TBX-2']

  function reply(items: unknown[]): string {
    return JSON.stringify({ kind: 'hygiene', items })
  }

  it('parses proposals keyed by issue and check', () => {
    const result = parseHygieneAiReply(
      reply([{ issueKey: 'TBX-1', fixes: [{ checkId: 'missing-sp', value: 5, rationale: 'Two integrations.' }] }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toEqual([
      { issueKey: 'TBX-1', checkId: 'missing-sp', proposedValue: '5', rationale: 'Two integrations.' },
    ])
    expect(result.unknownKeys).toEqual([])
    expect(result.unparsedCount).toBe(0)
  })

  it('throws for a reply echoing another surface’s kind', () => {
    expect(() => parseHygieneAiReply(JSON.stringify({ kind: 'piReview', items: [] }), KNOWN_KEYS)).toThrow(/kind/)
  })

  it('reports keys not on the page and never applies them', () => {
    const result = parseHygieneAiReply(
      reply([{ issueKey: 'EVIL-9', fixes: [{ checkId: 'missing-sp', value: 5 }] }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toEqual([])
    expect(result.unknownKeys).toEqual(['EVIL-9'])
  })

  it('drops a fix with an off-catalog checkId without losing the rest', () => {
    const result = parseHygieneAiReply(
      reply([{
        issueKey: 'TBX-1',
        fixes: [
          { checkId: 'delete-issue', value: 'now' },
          { checkId: 'missing-sp', value: '3' },
        ],
      }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].checkId).toBe('missing-sp')
    expect(result.unparsedCount).toBe(1)
  })

  it('rejects malformed dates and non-positive points rather than writing garbage', () => {
    const result = parseHygieneAiReply(
      reply([{
        issueKey: 'TBX-1',
        fixes: [
          { checkId: 'missing-due-date', value: 'next Tuesday' },
          { checkId: 'missing-target-start', value: '2026-08-01' },
          { checkId: 'missing-sp', value: '-2' },
        ],
      }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toEqual([
      { issueKey: 'TBX-1', checkId: 'missing-target-start', proposedValue: '2026-08-01', rationale: null },
    ])
    expect(result.unparsedCount).toBe(2)
  })

  it('drops blank-ish values so "n/a" can never be written to a field', () => {
    const result = parseHygieneAiReply(
      reply([{ issueKey: 'TBX-1', fixes: [{ checkId: 'no-ac', value: 'n/a' }] }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toEqual([])
    expect(result.unparsedCount).toBe(1)
  })

  it('caps runaway values — fields at the field cap, stale comments at the comment cap', () => {
    const result = parseHygieneAiReply(
      reply([{
        issueKey: 'TBX-1',
        fixes: [
          { checkId: 'no-ac', value: 'x'.repeat(1000) },
          { checkId: 'stale', value: 'y'.repeat(1000) },
        ],
      }]),
      KNOWN_KEYS,
    )

    expect(result.proposals[0].proposedValue.length).toBeLessThanOrEqual(MAX_AI_FIX_VALUE_LENGTH + 1)
    expect(result.proposals[1].proposedValue.length).toBeLessThanOrEqual(MAX_AI_COMMENT_LENGTH + 1)
  })

  it('reads a reply wrapped in prose or code fences via the shared payload extractor', () => {
    const wrappedReply = `Here you go:\n\n\`\`\`json\n${reply([
      { issueKey: 'tbx-1', fixes: [{ checkId: 'missing-sp', value: '8' }] },
    ])}\n\`\`\`\nLet me know!`

    const result = parseHygieneAiReply(wrappedReply, KNOWN_KEYS)

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].issueKey).toBe('TBX-1') // key normalized to upper case
  })
})
