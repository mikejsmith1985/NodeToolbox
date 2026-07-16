// hygieneAiFetch.ts — On-demand context fetch for the Hygiene AI panel's stale-nudge asks.
//
// The hygiene scan itself never fetches comments (200 issues × full comment threads would bloat
// every run). The AI panel fetches the LAST comment only, only for issues actually getting a stale
// ask, at prompt-build time — the model needs it to judge whether a nudge is warranted or the
// ticket already explains its own delay ("blocked till ESI Recon work is complete").

import { jiraGet } from '../../../services/jiraApi.ts'
import type { HygieneFinding } from '../checks/hygieneChecks.ts'
import { readAiFixableFlags, type StaleIssueContext } from './hygieneAiAssist.ts'

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

/** Reads the newest comment from Jira's oldest-first comment array. */
function readLastComment(response: JiraCommentResponse): StaleIssueContext {
  const comments = response.fields?.comment?.comments ?? []
  const lastComment = comments[comments.length - 1]
  if (!lastComment || typeof lastComment.body !== 'string' || lastComment.body.trim() === '') {
    return { lastCommentAuthor: null, lastCommentDate: null, lastCommentBody: null }
  }
  return {
    lastCommentAuthor: lastComment.author?.displayName ?? null,
    // Jira dates carry a time + zone suffix; the day is all the model needs.
    lastCommentDate: (lastComment.created ?? '').slice(0, 10) || null,
    lastCommentBody: lastComment.body.trim(),
  }
}

/**
 * Fetches the last comment for every finding that will receive a stale ask.
 *
 * Per-issue failures degrade to "no comment context" rather than failing the prompt build — a
 * missing comment only means the model judges from status alone, exactly as it would for an issue
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
        return [finding.issue.key, readLastComment(response)] as const
      } catch {
        return [
          finding.issue.key,
          { lastCommentAuthor: null, lastCommentDate: null, lastCommentBody: null },
        ] as const
      }
    }),
  )

  return Object.fromEntries(contextEntries)
}
