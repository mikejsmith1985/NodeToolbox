// captureOriginals.ts — Snapshots each issue's current summary/description/AC as the immutable "before"
// of a re-write batch (spec 030). Reuses jiraGet + normalizeRichTextToPlainText so the snapshot compares
// like-for-like with the draft and the later drift re-read (GH #200 lesson). A key that can't be fetched
// becomes an item carrying a captureError — the rest of the batch still captures (FR-001/002).

import { jiraGet } from '../../../services/jiraApi.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import type { RewriteItem } from './rewriteBatchModel';

/** De-duplicates and normalises a pasted key list (upper-cased, trimmed, blanks dropped). */
export function parseIssueKeys(rawText: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const rawEntry of rawText.split(/[\n,\s]+/)) {
    const key = rawEntry.trim().toUpperCase();
    if (key !== '' && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** Reads the current time as ISO; isolated so the fetch logic stays otherwise pure. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Builds a fresh RewriteItem in the `captured` state (optionally carrying a capture error). */
function buildCapturedItem(
  jiraKey: string,
  summary: string,
  description: string,
  acceptanceCriteria: string,
  captureError: string | null,
): RewriteItem {
  return {
    jiraKey,
    original: { summary, description, acceptanceCriteria, capturedAtIso: nowIso() },
    proposed: null,
    state: 'captured',
    captureError,
    submitResult: null,
  };
}

/**
 * Captures the current content of each key. Each issue is fetched independently; an unreachable key
 * yields an item with a `captureError` rather than aborting the batch. Description/AC are normalized to
 * plain text so later comparisons are like-for-like.
 */
export async function captureOriginals(keys: string[], acceptanceCriteriaFieldId: string | null): Promise<RewriteItem[]> {
  const requestedFields = ['summary', 'description', ...(acceptanceCriteriaFieldId ? [acceptanceCriteriaFieldId] : [])];
  const items: RewriteItem[] = [];
  for (const jiraKey of keys) {
    try {
      const issue = await jiraGet<{ fields: Record<string, unknown> }>(
        `/rest/api/2/issue/${encodeURIComponent(jiraKey)}?fields=${encodeURIComponent(requestedFields.join(','))}`,
      );
      const acValue = acceptanceCriteriaFieldId ? issue.fields[acceptanceCriteriaFieldId] : '';
      items.push(buildCapturedItem(
        jiraKey,
        String(issue.fields.summary ?? ''),
        normalizeRichTextToPlainText(issue.fields.description),
        normalizeRichTextToPlainText(acValue),
        null,
      ));
    } catch (captureError) {
      const reason = captureError instanceof Error ? captureError.message : String(captureError);
      items.push(buildCapturedItem(jiraKey, '', '', '', reason));
    }
  }
  return items;
}
