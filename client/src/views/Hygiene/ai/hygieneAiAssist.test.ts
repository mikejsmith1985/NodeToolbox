// hygieneAiAssist.test.ts — The prompt and the reply parser for the Hygiene AI panel.
//
// The parser is the panel's safety boundary: it must keep good proposals through a partly-bad
// reply, and must never let an unknown issue key or an off-catalog checkId produce a write.

import { describe, expect, it } from 'vitest'

import {
  AI_FIXABLE_CHECK_INSTRUCTIONS,
  buildHygieneAiPrompt,
  buildHygieneAiPromptPlan,
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

  // ── Stale asks carry context, and parked tickets are never nudged ──

  it('drops the stale ask outright for an issue in a blocked-like status', () => {
    const blockedFinding = finding('TBX-1', ['stale', 'missing-sp'], { status: { name: 'Blocked' } })

    const promptText = buildHygieneAiPrompt([blockedFinding])

    // The other fix survives; the nudge does not — a blocked ticket already says why it waits.
    expect(promptText).toContain('missing-sp')
    expect(promptText).not.toContain('stale:')
  })

  it('omits the issue entirely when a blocked status removes its only fixable flag', () => {
    const blockedFinding = finding('TBX-1', ['stale'], { status: { name: 'On Hold — vendor' } })

    const promptText = buildHygieneAiPrompt([blockedFinding, finding('TBX-2', ['missing-sp'])])

    expect(promptText).not.toContain('TBX-1')
    expect(promptText).toContain('TBX-2')
  })

  it('carries the status and the recent CONVERSATION beside a stale ask — not just the newest line', () => {
    // The user's real case: "Thank you" sits on top of "pushed to dev, ready for internal testing".
    // Only the thread explains the wait; a single newest comment would not.
    const staleFinding = finding('TBX-1', ['stale'], { status: { name: 'In Progress' } })

    const promptText = buildHygieneAiPrompt([staleFinding], {
      'TBX-1': {
        recentComments: [
          { author: 'Sun, Zhiyong', date: '2026-06-16', body: 'Pushed to dev, ready for internal testing' },
          { author: 'Smith, Michael', date: '2026-06-25', body: 'Thank you Sun, Zhiyong' },
        ],
      },
    })

    expect(promptText).toContain('status: In Progress')
    expect(promptText).toContain('recent comments (oldest first):')
    expect(promptText).toContain('- (Sun, Zhiyong, 2026-06-16) Pushed to dev, ready for internal testing')
    expect(promptText).toContain('- (Smith, Michael, 2026-06-25) Thank you Sun, Zhiyong')
    // And the standing rule that tells the model to read the WHOLE thread before nudging.
    expect(promptText).toContain('OMIT the stale fix')
    expect(promptText).toContain('not just the newest line')
  })

  it('says "(none)" rather than omitting the comment line when a stale issue has no comments', () => {
    const promptText = buildHygieneAiPrompt([finding('TBX-1', ['stale'], { status: { name: 'In Progress' } })])

    expect(promptText).toContain('recent comments: (none)')
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

  it('rejects non-positive points and unknown fixes rather than writing garbage', () => {
    // The date fixes this used to cover are no longer offered to the model at all — they are derived
    // arithmetic, not proposals. The parser's date validation stays as a guard against a reply that
    // invents one, but the reachable cases are the value fixes below.
    const result = parseHygieneAiReply(
      reply([{
        issueKey: 'TBX-1',
        fixes: [
          { checkId: 'missing-due-date', value: 'next Tuesday' },
          { checkId: 'missing-sp', value: '-2' },
          { checkId: 'missing-summary', value: 'A real summary' },
        ],
      }]),
      KNOWN_KEYS,
    )

    expect(result.proposals).toEqual([
      { issueKey: 'TBX-1', checkId: 'missing-summary', proposedValue: 'A real summary', rationale: null },
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

describe('buildHygieneAiPrompt — fix versions must be real', () => {
  /** One finding flagged as missing a fix version. */
  function buildFixVersionFinding(issueKey: string) {
    return {
      issue: { key: issueKey, fields: { summary: issueKey, status: { name: 'To Do' } } },
      flags: ['missing-fix-version'],
    } as unknown as Parameters<typeof buildHygieneAiPrompt>[0][number]
  }

  it('lists the project\'s open releases and requires the value be copied from them', () => {
    // Without this the model invented plausible names — "PY 2027 AEP" — which Jira rejected with a 400.
    const prompt = buildHygieneAiPrompt([buildFixVersionFinding('ENCUC-2223')], {}, {
      ENCUC: ['09/10/2026', '10/08/2026'],
    })

    expect(prompt).toContain('ENCUC: 09/10/2026 | 10/08/2026')
    expect(prompt).toContain('MUST be copied exactly from this list')
  })

  it('tells the model to omit the fix entirely when no releases are known', () => {
    const prompt = buildHygieneAiPrompt([buildFixVersionFinding('ENCUC-2223')], {}, {})

    expect(prompt).toContain('OMIT every fix-version fix rather than guessing')
  })

  it('leaves out a project that has no open releases rather than listing it empty', () => {
    const prompt = buildHygieneAiPrompt([buildFixVersionFinding('ENCUC-2223')], {}, {
      ENCUC: ['09/10/2026'], DENP: [],
    })

    expect(prompt).toContain('ENCUC: 09/10/2026')
    expect(prompt).not.toContain('DENP:')
  })

  it('no longer asks the model to produce a name from nothing', () => {
    expect(AI_FIXABLE_CHECK_INSTRUCTIONS['missing-fix-version']).toContain('never invent one')
  })
})


describe('date fixes carry the facts the policy needs', () => {
  function buildDateFinding(overrides: Record<string, unknown> = {}) {
    return {
      issue: {
        key: 'ENFCT-1',
        fields: {
          summary: 'A story committed to a release',
          issuetype: { name: 'Story' },
          status: { name: 'Ready to Work', statusCategory: { key: 'indeterminate' } },
          fixVersions: [{ name: '10/08/2026', releaseDate: '2026-10-08', released: false }],
          ...overrides,
        },
      },
      flags: [
        { checkId: 'missing-due-date', label: 'Missing Due Date', severity: 'warn' },
        { checkId: 'missing-target-end', label: 'Missing Target End', severity: 'warn' },
      ],
      programIncrement: 'PI 26.4',
    } as unknown as HygieneFinding
  }

  it('offers the date fixes again — they were removed and should not have been', () => {
    expect(Object.keys(AI_FIXABLE_CHECK_INSTRUCTIONS)).toContain('missing-due-date')
    expect(Object.keys(AI_FIXABLE_CHECK_INSTRUCTIONS)).toContain('missing-target-end')
    expect(Object.keys(AI_FIXABLE_CHECK_INSTRUCTIONS)).toContain('missing-target-start')
  })

  it('leaves dates-out-of-sync out — it names three fields, so a proposal has nowhere to be written', () => {
    // Its fix descriptor resolves no single field id, so an accepted proposal would be refused by
    // the apply path. The three specific date fixes cover the same ground with a target each.
    expect(Object.keys(AI_FIXABLE_CHECK_INSTRUCTIONS)).not.toContain('dates-out-of-sync')
  })

  it('states the DERIVED value in the prompt, so the model copies rather than calculates', () => {
    // The first attempt put the policy in the prompt without the facts — no fix version, no release
    // date — so the model correctly omitted everything and replied with an empty item list to 53
    // issues. Handing it the answer the deterministic fix would write removes both failure modes:
    // it cannot be unanswerable, and it cannot disagree with the button beside it.
    const prompt = buildHygieneAiPrompt([buildDateFinding()], {}, {})

    expect(prompt).toContain('fix version: 10/08/2026 (releases 2026-10-08)')
    expect(prompt).toContain('policy value for Due Date: 2026-10-08')
    expect(prompt).toContain('policy value for Target End: 2026-09-17')
  })

  it('omits an undated issue entirely rather than asking a question it answers itself', () => {
    // This used to print "Due Date cannot be derived — omit that fix" and leave the ask in place.
    // Printing an instruction to omit IS the omission, done in the most expensive way available:
    // 133 such issues bought 118,630 characters of prompt and one empty reply (GH #375).
    const prompt = buildHygieneAiPrompt([buildDateFinding({ fixVersions: [] })], {}, {})

    expect(prompt).not.toContain('policy value for Due Date:')
    expect(prompt).not.toContain('missing-due-date')
  })
})

describe('buildHygieneAiPromptPlan — the prompt has to fit in the agent box', () => {
  // A run over a whole board produced 181,411 characters against a 128,000 limit, so the paste was
  // simply refused (GH #375). Two things shrink it: asking only about the flag the page is filtered
  // to, and refusing to emit more than the box will take.
  function manyFindings(issueCount: number): HygieneFinding[] {
    return Array.from({ length: issueCount }, (_unused, index) =>
      finding(`TBX-${index + 1}`, ['missing-sp', 'no-ac', 'stale']))
  }

  it('asks only about the checks the page is filtered to', () => {
    const plan = buildHygieneAiPromptPlan([finding('TBX-1', ['missing-sp', 'no-ac', 'stale'])], {
      restrictToCheckIds: ['missing-sp'],
    })

    expect(plan.promptText).toContain('missing-sp')
    expect(plan.promptText).not.toContain('no-ac')
    expect(plan.promptText).not.toContain('stale')
  })

  it('drops a finding entirely when the filter leaves it no fixable flag', () => {
    const plan = buildHygieneAiPromptPlan(
      [finding('TBX-1', ['missing-sp']), finding('TBX-2', ['no-ac'])],
      { restrictToCheckIds: ['missing-sp'] },
    )

    expect(plan.promptText).toContain('TBX-1')
    expect(plan.promptText).not.toContain('TBX-2')
    expect(plan.includedCount).toBe(1)
  })

  it('keeps the whole prompt inside the character budget', () => {
    const plan = buildHygieneAiPromptPlan(manyFindings(400), { maxCharacterCount: 5_000 })

    expect(plan.promptText.length).toBeLessThanOrEqual(5_000)
  })

  it('reports what it left out rather than truncating in silence', () => {
    const plan = buildHygieneAiPromptPlan(manyFindings(400), { maxCharacterCount: 5_000 })

    expect(plan.omittedCount).toBeGreaterThan(0)
    expect(plan.includedCount + plan.omittedCount).toBe(400)
    expect(plan.includedCount).toBeGreaterThan(0)
  })

  it('omits nothing and reports zero when the whole set fits', () => {
    const plan = buildHygieneAiPromptPlan(manyFindings(2))

    expect(plan.omittedCount).toBe(0)
    expect(plan.includedCount).toBe(2)
  })

  it('never emits a partial issue block — every key it lists is a key it described', () => {
    const plan = buildHygieneAiPromptPlan(manyFindings(400), { maxCharacterCount: 5_000 })
    const listedKeys = plan.promptText.slice(plan.promptText.indexOf('Issue keys you may use:'))

    for (let issueIndex = 1; issueIndex <= plan.includedCount; issueIndex += 1) {
      expect(listedKeys).toContain(`TBX-${issueIndex}`)
    }
  })

  it('still returns a usable prompt when a single finding alone exceeds the budget', () => {
    const plan = buildHygieneAiPromptPlan(manyFindings(3), { maxCharacterCount: 10 })

    expect(plan.includedCount).toBe(0)
    expect(plan.omittedCount).toBe(3)
    expect(plan.promptText).toContain('hygiene')
  })
})

describe('buildHygieneAiPromptPlan — the parser must not trust a key the prompt never carried', () => {
  it('reports exactly the keys it described', () => {
    const plan = buildHygieneAiPromptPlan(
      [finding('TBX-1', ['missing-sp']), finding('TBX-2', ['missing-sp'])],
    )

    expect(plan.includedIssueKeys).toEqual(['TBX-1', 'TBX-2'])
  })

  it('leaves a budget-trimmed issue out of the trusted key list', () => {
    const crowded = Array.from({ length: 200 }, (_unused, index) =>
      finding(`TBX-${index + 1}`, ['missing-sp']))

    const plan = buildHygieneAiPromptPlan(crowded, { maxCharacterCount: 4_000 })

    expect(plan.includedIssueKeys).toHaveLength(plan.includedCount)
    expect(plan.includedIssueKeys).not.toContain('TBX-200')
  })
})

describe('buildHygieneAiPromptPlan — never ask for what the prompt itself says to omit', () => {
  // A real run over 133 issues produced 118,630 characters in which the ONLY fix requested for
  // nearly every issue was missing-target-start, beside the line "Target Start cannot be derived
  // here — omit that fix". The prompt asked the model to omit the only thing it asked for, so the
  // only correct reply was an empty list (GH #375).
  function datedFinding(issueKey: string, checkIds: string[], fixVersions: unknown[]): HygieneFinding {
    return finding(issueKey, checkIds, { fixVersions })
  }

  it('does not ask for Target Start, which it can never derive in a prompt', () => {
    const plan = buildHygieneAiPromptPlan([
      datedFinding('TBX-1', ['missing-target-start', 'missing-sp'], [
        { name: '09/10/2026', releaseDate: '2026-09-10', released: false },
      ]),
    ])

    expect(plan.promptText).not.toContain('missing-target-start')
    expect(plan.promptText).toContain('missing-sp')
  })

  it('drops an issue whose only ask is one it cannot answer', () => {
    const plan = buildHygieneAiPromptPlan([
      datedFinding('TBX-1', ['missing-target-start'], []),
      datedFinding('TBX-2', ['missing-sp'], []),
    ])

    expect(plan.promptText).not.toContain('TBX-1')
    expect(plan.promptText).toContain('TBX-2')
    expect(plan.includedCount).toBe(1)
  })

  it('drops a due-date ask when no fix version dates it', () => {
    const plan = buildHygieneAiPromptPlan([datedFinding('TBX-1', ['missing-due-date'], [])])

    expect(plan.includedCount).toBe(0)
  })

  it('KEEPS a due-date ask when the fix version does date it', () => {
    // The derivable dates must survive — removing them wholesale was the previous wrong answer.
    const plan = buildHygieneAiPromptPlan([
      datedFinding('TBX-1', ['missing-due-date', 'missing-target-end'], [
        { name: '09/10/2026', releaseDate: '2026-09-10', released: false },
      ]),
    ])

    expect(plan.promptText).toContain('missing-due-date')
    expect(plan.promptText).toContain('policy value for Due Date: 2026-09-10')
    expect(plan.promptText).toContain('missing-target-end')
  })
})

describe('buildHygieneAiPromptPlan — descriptions carry text, not markup', () => {
  it('strips the HTML a Jira description is stored as', () => {
    const htmlFinding = finding('TBX-1', ['missing-sp'], {
      description: '<p dir="auto" style="animation-duration:0.01ms"><b>Impact</b>: blocked.</p>'
        + '<table border="1"><colgroup><col width="89"></colgroup><tbody><tr><td>cell</td></tr></tbody></table>',
    })

    const plan = buildHygieneAiPromptPlan([htmlFinding])

    expect(plan.promptText).not.toContain('colgroup')
    expect(plan.promptText).not.toContain('animation-duration')
    expect(plan.promptText).toContain('Impact')
    expect(plan.promptText).toContain('blocked')
  })

  it('decodes the entities that survive that markup', () => {
    const plan = buildHygieneAiPromptPlan([
      finding('TBX-1', ['missing-sp'], { description: '<p>Blocked&nbsp;due to&nbsp;Letter Queue</p>' }),
    ])

    expect(plan.promptText).not.toContain('&nbsp;')
    expect(plan.promptText).toContain('Blocked due to Letter Queue')
  })
})
