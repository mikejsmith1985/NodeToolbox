// rewriteBatchModel.ts — The plain-data contracts for the Bulk Feature Re-write batch (spec 030).
//
// A batch is a persisted, resumable workspace: a set of issues captured at a point in time, each with an
// AI-proposed nine-section re-write, a per-issue lifecycle state, and a submission outcome. Pure data —
// no I/O, no clock — so the store, the AI ingest, the export, and the submit layer all share one shape.

/** Per-issue lifecycle. See spec data-model.md for the transition diagram. */
import type { ReferencedSource } from '../sources/sourceModel.ts';

export type ItemState =
  | 'captured'    // original snapshotted, no proposal yet
  | 'proposed'    // an AI re-write exists, not yet reviewed
  | 'reviewing'   // the PO is working it (also where any edit to an approved item returns it)
  | 'approved'    // cleared for submit
  | 'rejected'    // excluded from export/submit
  | 'changed'     // live Jira content differs from the captured snapshot (set at submit-time drift check)
  | 'submitted'   // written to Jira (terminal for a re-run)
  | 'failed'      // a submit write failed (retryable)
  | 'reverted'    // the captured original was written back over the Toolbox re-write
  | 'revert-blocked'; // a revert would discard somebody else's later edit; the fields are named

/** The immutable "before" — the issue's current content captured at a recorded time. */
export interface CapturedOriginal {
  summary: string;
  description: string;
  acceptanceCriteria: string;
  capturedAtIso: string;
}

/** The AI-proposed re-write (nine-section description + acceptance criteria), editable by the PO. */
export interface ProposedRewrite {
  description: string;
  acceptanceCriteria: string;
  isEdited: boolean;
}

/** One issue in the batch. */
export interface RewriteItem {
  jiraKey: string;
  original: CapturedOriginal;
  proposed: ProposedRewrite | null;
  state: ItemState;
  captureError: string | null;
  submitResult: { ok: boolean; fieldErrors?: string[] } | null;
}

/** The persisted batch workspace. */
export interface RewriteBatch {
  id: string;
  name: string;
  teamProfileId: string;
  createdAtIso: string;
  updatedAtIso: string;
  items: RewriteItem[];
  /** The Confluence page this batch's before/after review is published to and read back from (US3). */
  reviewPageUrl?: string;
  /**
   * Documents that apply to the WHOLE batch — a new standard, a compliance note, a design decision.
   *
   * Persisted with the batch rather than held in the page, because the approval loop spans days and
   * a PO returning to a batch has to see the material the re-writes were made from. Optional, so
   * every batch saved before this loads unchanged.
   */
  sharedSources?: ReferencedSource[];
}

/** A lightweight batch listing entry (for the resume/batch-list UI), with per-state counts. */
export interface RewriteBatchSummary {
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  itemCount: number;
  countsByState: Partial<Record<ItemState, number>>;
}

/** The result of ingesting a `{kind:'featureRewriteBatch'}` reply. */
export interface BatchReplyParseResult {
  rewritesByKey: Record<string, ProposedRewrite>;
  rejected: { key: string; reason: string }[];
  unparsedCount: number;
}

/** The per-item subset the before/after export renders (excluded items are filtered out by the caller). */
export interface BatchExportInput {
  jiraKey: string;
  original: CapturedOriginal;
  proposed: ProposedRewrite;
}
