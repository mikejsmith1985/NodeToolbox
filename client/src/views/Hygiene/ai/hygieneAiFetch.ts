// hygieneAiFetch.ts — On-demand context fetch for the Hygiene AI panel's stale-nudge asks.
//
// The hygiene scan itself never fetches comments (200 issues × full comment threads would bloat
// every run). The AI panel fetches the RECENT CONVERSATION — the last few comments, not just the
// newest one — only for issues actually getting a stale ask, at prompt-build time. One comment is
// not enough to judge: a bare "Thank you" often sits on top of the "pushed to dev, ready for
// internal testing" that actually explains the wait (GH #167).

import { jiraGet } from '../../../services/jiraApi.ts'
import type { HygieneFinding } from '../checks/hygieneChecks.ts'
import { readAiFixableFlags, type StaleIssueComment, type StaleIssueContext } from './hygieneAiAssist.ts'

/** How many of the newest comments the prompt carries per stale issue. */
const RECENT_COMMENT_COUNT = 5

/** The comment field shape Jira returns on GET /issue/{key}?fields=comment. */
interface JiraCommentResponse {
  fields?: {
    comment?: {
      comments?: Array<{
        author?: { displayName?: string }
        created?: string
        body?: string
      }>
    }
  }
}

/** Reads the newest few comments (kept oldest-first) from Jira's oldest-first comment array. */
function readRecentComments(response: JiraCommentResponse): StaleIssueContext {
  const recentComments = (response.fields?.comment?.comments ?? [])
    .slice(-RECENT_COMMENT_COUNT)
    .filter((comment): comment is { author?: { displayName?: string }; created?: string; body: string } =>
      typeof comment.body === 'string' && comment.body.trim() !== '',
    )
    .map<StaleIssueComment>((comment) => ({
      author: comment.author?.displayName ?? null,
      // Jira dates carry a time + zone suffix; the day is all the model needs.
      date: (comment.created ?? '').slice(0, 10) || null,
      body: comment.body.trim(),
    }))
  return { recentComments }
}

/**
 * Fetches the recent conversation for every finding that will receive a stale ask.
 *
 * Per-issue failures degrade to "no comment context" rather than failing the prompt build — a
 * missing thread only means the model judges from status alone, exactly as it would for an issue
 * that was never commented.
 */
export async function fetchStaleIssueContexts(
  findings: readonly HygieneFinding[],
): Promise<Record<string, StaleIssueContext>> {
  const staleFindings = findings.filter((finding) =>
    readAiFixableFlags(finding).some((flag) => flag.checkId === 'stale'),
  )

  const contextEntries = await Promise.all(
    staleFindings.map(async (finding) => {
      try {
        const response = await jiraGet<JiraCommentResponse>(
          `/rest/api/2/issue/${encodeURIComponent(finding.issue.key)}?fields=comment`,
        )
        return [finding.issue.key, readRecentComments(response)] as const
      } catch {
        return [finding.issue.key, { recentComments: [] }] as const
      }
    }),
  )

  return Object.fromEntries(contextEntries)
}
