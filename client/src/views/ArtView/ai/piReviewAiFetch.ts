// piReviewAiFetch.ts — Gathers everything the PI Review AI prompt needs about each Feature.
//
// This is the AI panel's OWN Jira fetch, and it is deliberately separate from the one every page
// load performs. Three reasons:
//
//   1. Description and acceptance criteria are large rich-text fields the AI needs and nothing else
//      does. Adding them to the shared DEFAULT_LINK_FIELDS would tax every page load to serve an
//      occasional button click.
//   2. DEFAULT_LINK_FIELDS is mirrored by hand in the server's RECONCILE_FIELDS (piReviewRefresh.js)
//      with a comment asserting the two are identical. Touching one would make that comment a lie.
//   3. Nothing here may reach a PiReviewRow. Reconciliation rebuilds rows from Jira on every load
//      using a fixed field list; a description on a row would be enrolled in the "Jira updated N
//      fields" delta and become a Jira-owned column. These are prompt inputs, read-only, full stop.

import { jiraGet } from '../../../services/jiraApi.ts'
import { readAcceptanceCriteriaText, resolveAcceptanceCriteriaFieldIds } from '../../../utils/acceptanceCriteria.ts'
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts'
import type { JiraIssue } from '../../../types/jira.ts'
import { extractPiReviewFeatureKey } from '../piReviewJira.ts'
import type { PiReviewRow } from '../piReviewTable.ts'

/** Jira caps how many keys one `key in (...)` query can carry; mirrors the PI Review fetch's batching. */
const FEATURE_QUERY_BATCH_SIZE = 50
/** The fields only the AI needs. Deliberately NOT added to the shared page-load field list. */
const AI_ONLY_FIELD_IDS = ['summary', 'priority', 'description'] as const

/** One Feature's worth of prompt input. Read-only — never written to a PiReviewRow. */
export interface PiReviewAiFeatureContext {
  issueKey: string
  summary: string
  priority: string | null
  /** Plain-text description, or null when Jira has none — the prompt says "absent", not "". */
  description: string | null
  /** Plain-text acceptance criteria, or null when absent. */
  acceptanceCriteria: string | null
  /** The Dependency cell's entries, shaped `KEY - Summary (Status)`. */
  linkedDependencies: string[]
  /** The Risks cell's entries, shaped `KEY - Summary (Status)`. */
  linkedRisks: string[]
  /** What the row's estimate says today, so the model can see the gap it is filling. */
  currentPointEstimate: string
  /** Whether a human has already written notes — the model should add, not repeat. */
  hasExistingNotes: boolean
}

/** Splits a Dependency/Risks cell into its entries. They are newline-joined, never comma-joined. */
function splitLinkedIssueCell(cellValue: string): string[] {
  return cellValue
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/** Reads a rich-text field to plain text, collapsing "no content" to null so the prompt can say so. */
function readOptionalPlainText(fieldValue: unknown): string | null {
  const plainText = normalizeRichTextToPlainText(fieldValue).trim()
  return plainText === '' ? null : plainText
}

/** Splits keys into query-sized batches so a large PI Review page still fetches in one pass. */
function batchIssueKeys(issueKeys: string[]): string[][] {
  const batches: string[][] = []
  for (let batchStart = 0; batchStart < issueKeys.length; batchStart += FEATURE_QUERY_BATCH_SIZE) {
    batches.push(issueKeys.slice(batchStart, batchStart + FEATURE_QUERY_BATCH_SIZE))
  }
  return batches
}

/** Fetches the AI-only fields for a batch of keys and folds them into the issue map. */
async function fetchIssueBatch(
  issueKeys: string[],
  queryFieldIds: string[],
  issuesByKey: Map<string, JiraIssue>,
): Promise<void> {
  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(`key in (${issueKeys.join(',')})`)}`
    + `&fields=${encodeURIComponent(queryFieldIds.join(','))}`
    + `&maxResults=${Math.max(200, issueKeys.length)}`
  const searchResponse = await jiraGet<{ issues?: JiraIssue[] }>(searchPath)
  for (const jiraIssue of searchResponse.issues ?? []) {
    issuesByKey.set(jiraIssue.key.toUpperCase(), jiraIssue)
  }
}

/**
 * Builds one prompt context per Feature on the page, in page-row order.
 *
 * Rows whose feature cell carries no Jira key are skipped — there is nothing to size. The
 * acceptance-criteria field id is resolved once for the whole fetch (it is instance-specific), and
 * a failed lookup degrades to the common default rather than failing the run.
 */
export async function fetchPiReviewAiContexts(rows: readonly PiReviewRow[]): Promise<PiReviewAiFeatureContext[]> {
  const rowsWithKeys = rows
    .map((row) => ({ row, issueKey: extractPiReviewFeatureKey(row.feature) }))
    .filter((entry): entry is { row: PiReviewRow; issueKey: string } => entry.issueKey !== null)
  if (rowsWithKeys.length === 0) {
    return []
  }

  const acceptanceCriteriaFieldIds = await resolveAcceptanceCriteriaFieldIds()
  const queryFieldIds = [...new Set([...AI_ONLY_FIELD_IDS, ...acceptanceCriteriaFieldIds])].filter(Boolean)

  const issuesByKey = new Map<string, JiraIssue>()
  const uniqueIssueKeys = [...new Set(rowsWithKeys.map((entry) => entry.issueKey))]
  for (const batch of batchIssueKeys(uniqueIssueKeys)) {
    // Batches run sequentially to bound Jira load, mirroring the PI Review feature fetch.
    await fetchIssueBatch(batch, queryFieldIds, issuesByKey)
  }

  return rowsWithKeys.map(({ row, issueKey }) => {
    const jiraIssue = issuesByKey.get(issueKey)
    const issueFields = (jiraIssue?.fields ?? {}) as unknown as Record<string, unknown>
    return {
      issueKey,
      summary: typeof issueFields.summary === 'string' ? issueFields.summary : '',
      priority: (jiraIssue?.fields?.priority?.name ?? '').trim() || null,
      description: readOptionalPlainText(issueFields.description),
      acceptanceCriteria: jiraIssue ? readAcceptanceCriteriaText(jiraIssue, acceptanceCriteriaFieldIds) : null,
      linkedDependencies: splitLinkedIssueCell(row.dependency),
      linkedRisks: splitLinkedIssueCell(row.risks),
      currentPointEstimate: row.pointEstimate,
      hasExistingNotes: row.notes.trim() !== '',
    }
  })
}
