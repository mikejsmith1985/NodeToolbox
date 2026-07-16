// hygieneAiFetch.test.ts — The stale-nudge context fetch: last comment only, stale issues only,
// and per-issue failures degrade instead of failing the prompt build.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }))
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }))

import { fetchStaleIssueContexts } from './hygieneAiFetch.ts'
import type { HygieneFinding } from '../checks/hygieneChecks.ts'

function finding(issueKey: string, checkIds: string[], statusName = 'In Progress'): HygieneFinding {
  return {
    issue: {
      key: issueKey,
      fields: { summary: 'S', issuetype: { name: 'Story' }, status: { name: statusName } },
    } as HygieneFinding['issue'],
    flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })) as HygieneFinding['flags'],
    programIncrement: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchStaleIssueContexts', () => {
  it('fetches the recent conversation (newest few, oldest-first) only for issues getting a stale ask', async () => {
    mockJiraGet.mockResolvedValue({
      fields: {
        comment: {
          comments: [
            { author: { displayName: 'Ancient Author' }, created: '2026-01-01T10:00:00.000+0000', body: 'Kickoff.' },
            { author: { displayName: 'A' }, created: '2026-05-01T10:00:00.000+0000', body: 'Two.' },
            { author: { displayName: 'B' }, created: '2026-05-02T10:00:00.000+0000', body: 'Three.' },
            { author: { displayName: 'C' }, created: '2026-05-03T10:00:00.000+0000', body: 'Four.' },
            { author: { displayName: 'Sun, Zhiyong' }, created: '2026-06-16T13:50:00.000+0000', body: 'Pushed to dev, ready for internal testing' },
            { author: { displayName: 'Smith, Michael' }, created: '2026-06-25T12:04:00.000+0000', body: 'Thank you Sun, Zhiyong' },
          ],
        },
      },
    })

    const contexts = await fetchStaleIssueContexts([
      finding('TBX-1', ['stale']),
      finding('TBX-2', ['missing-sp']), // no stale ask — must not be fetched
    ])

    expect(mockJiraGet).toHaveBeenCalledTimes(1)
    expect(String(mockJiraGet.mock.calls[0][0])).toContain('TBX-1')
    const recentComments = contexts['TBX-1'].recentComments
    // The newest five, kept oldest-first — the "thanks" AND the comment beneath it that explains the wait.
    expect(recentComments).toHaveLength(5)
    expect(recentComments[0].body).toBe('Two.')
    expect(recentComments[3]).toEqual({
      author: 'Sun, Zhiyong',
      date: '2026-06-16',
      body: 'Pushed to dev, ready for internal testing',
    })
    expect(recentComments[4].body).toBe('Thank you Sun, Zhiyong')
    expect(recentComments.map((comment) => comment.body)).not.toContain('Kickoff.')
  })

  it('does not fetch for a stale issue whose blocked status already removed the ask', async () => {
    await fetchStaleIssueContexts([finding('TBX-1', ['stale'], 'Blocked')])

    expect(mockJiraGet).not.toHaveBeenCalled()
  })

  it('returns an empty context for an issue with no comments', async () => {
    mockJiraGet.mockResolvedValue({ fields: { comment: { comments: [] } } })

    const contexts = await fetchStaleIssueContexts([finding('TBX-1', ['stale'])])

    expect(contexts['TBX-1']).toEqual({ recentComments: [] })
  })

  it('degrades a failed fetch to "no comment context" instead of failing the prompt build', async () => {
    mockJiraGet.mockRejectedValue(new Error('403'))

    const contexts = await fetchStaleIssueContexts([finding('TBX-1', ['stale'])])

    expect(contexts['TBX-1']).toEqual({ recentComments: [] })
  })
})
