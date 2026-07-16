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
  it('fetches the last comment only for issues that will actually get a stale ask', async () => {
    mockJiraGet.mockResolvedValue({
      fields: {
        comment: {
          comments: [
            { author: { displayName: 'Old Author' }, created: '2026-06-01T10:00:00.000+0000', body: 'First.' },
            { author: { displayName: 'Jordan, John' }, created: '2026-07-01T10:00:00.000+0000', body: 'Blocked till ESI Recon work is complete.' },
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
    expect(contexts['TBX-1']).toEqual({
      lastCommentAuthor: 'Jordan, John',
      lastCommentDate: '2026-07-01',
      lastCommentBody: 'Blocked till ESI Recon work is complete.',
    })
  })

  it('does not fetch for a stale issue whose blocked status already removed the ask', async () => {
    await fetchStaleIssueContexts([finding('TBX-1', ['stale'], 'Blocked')])

    expect(mockJiraGet).not.toHaveBeenCalled()
  })

  it('returns an empty context for an issue with no comments', async () => {
    mockJiraGet.mockResolvedValue({ fields: { comment: { comments: [] } } })

    const contexts = await fetchStaleIssueContexts([finding('TBX-1', ['stale'])])

    expect(contexts['TBX-1']).toEqual({ lastCommentAuthor: null, lastCommentDate: null, lastCommentBody: null })
  })

  it('degrades a failed fetch to "no comment context" instead of failing the prompt build', async () => {
    mockJiraGet.mockRejectedValue(new Error('403'))

    const contexts = await fetchStaleIssueContexts([finding('TBX-1', ['stale'])])

    expect(contexts['TBX-1']).toEqual({ lastCommentAuthor: null, lastCommentDate: null, lastCommentBody: null })
  })
})
