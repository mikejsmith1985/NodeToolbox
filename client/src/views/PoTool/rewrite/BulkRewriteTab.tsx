// BulkRewriteTab.tsx — Bulk "re-write" workspace (spec 030). A PO pastes a list of Jira keys (or imports
// them from the PI Review page); the tool captures each issue's current summary/description/AC as an
// immutable "before", then a gated, manual AI round-trip proposes nine-section re-writes. The before/after
// is PUBLISHED to a Confluence page, where the reviewing PO edits the proposals and ticks an Approve
// checkbox; "Write approved to Jira" reads that page back and submits only the ticked rows, one issue at a
// time through the reused single-issue write path, with a live drift guard so nothing that changed in Jira
// since capture is silently overwritten. The Confluence page is the shared, editable, durable review record.
//
// AI rules (load-bearing): the AI step is PoAiPanel — a copy-prompt / paste-reply round trip that renders
// nothing when AI Assist is locked. Toolbox never calls an AI service, never writes AI output to Jira
// without an explicit approve + submit, and never attributes content to AI.

import { useCallback, useMemo, useState } from 'react';

import { useToast } from '../../../components/Toast/ToastContext.ts';
import { fetchConfluencePageByReference, updateConfluencePage } from '../../../services/confluenceApi.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { normalizeFeatureDescription, stripAiAttribution } from '../ai/featureDocSections.ts';
import { importPiReviewFeatureKeys } from './importPiReviewFeatures.ts';
import PoAiPanel from '../ai/PoAiPanel';
import { buildBulkRewritePrompts, parseBulkRewriteReply } from './ai/bulkRewriteAiAssist';
import { usePoHygieneContext } from '../hooks/usePoHygieneContext';
import BeforeAfterRow from './BeforeAfterRow.tsx';
import { captureOriginals, parseIssueKeys } from './captureOriginals';
import type {
  BatchExportInput,
  ItemState,
  RewriteBatch,
  RewriteBatchSummary,
  RewriteItem,
} from './rewriteBatchModel';
import { buildReviewPageStorage, parseReviewPageStorage } from './rewriteReviewDoc.ts';
import { deleteBatch, listBatches, loadBatch, saveBatch } from './rewriteBatchStore';
import { canPersistDrafts } from '../drafts/splitDraftStorage';
import { submitApprovedItems } from './rewriteSubmit';
import styles from './rewrite.module.css';

interface BulkRewriteTabProps {
  /** The PO Tool's own team profile — scopes stored batches and the configured field ids used. */
  dashboardTeamProfileId: string;
  /** The PO Tool's selected Program Increment, used to seed the intake from PI Review. Optional so the
   *  tab renders identically for any caller that does not pass one (the import control just stays honest). */
  selectedPiName?: string;
  /** The selected team as an ArtTeam — carries the PI Review page URLs the import reads. Optional for the
   *  same reason: without it the import control is present but reports it has no PI Review page to read. */
  piReviewTeam?: ArtTeam;
}

/** Human order for the state summary chips. */
const STATE_ORDER: ItemState[] = [
  'captured', 'proposed', 'reviewing', 'approved', 'changed', 'rejected', 'submitted', 'failed',
];

/** Mints a short, collision-unlikely batch id (no security requirement — just uniqueness in localStorage). */
function mintBatchId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function BulkRewriteTab({ dashboardTeamProfileId, selectedPiName = '', piReviewTeam }: BulkRewriteTabProps) {
  const { showToast } = useToast();
  const { fieldConfig, fieldConfigError } = usePoHygieneContext(dashboardTeamProfileId);

  const acceptanceCriteriaFieldId = useMemo(
    () => fieldConfig.acceptanceCriteriaFieldIds.find((fieldId) => fieldId !== 'description') ?? null,
    [fieldConfig],
  );

  const [canPersist] = useState(canPersistDrafts);
  const [keysInput, setKeysInput] = useState('');
  const [batch, setBatch] = useState<RewriteBatch | null>(null);
  // The Confluence page this batch is reviewed on — mirrored locally for the input, persisted on the batch.
  const [reviewPageUrl, setReviewPageUrl] = useState('');
  // Seeded once on mount (the tab is keyed by team, so the id is stable here) and refreshed imperatively
  // after every mutation — no effect needed.
  const [savedBatches, setSavedBatches] = useState<RewriteBatchSummary[]>(() => listBatches(dashboardTeamProfileId));
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isWritingApproved, setIsWritingApproved] = useState(false);
  // Ephemeral per-session override: a PO who accepts a drift warning can force a single submit.
  const [submitAnywayKeys, setSubmitAnywayKeys] = useState<string[]>([]);
  const [ingestNotice, setIngestNotice] = useState<{ accepted: number; rejected: { key: string; reason: string }[]; unparsedCount: number } | null>(null);

  const refreshBatchList = useCallback(() => {
    setSavedBatches(listBatches(dashboardTeamProfileId));
  }, [dashboardTeamProfileId]);

  /** Persists a batch and mirrors it into state; a blocked store degrades to session-only (no throw). */
  const persistBatch = useCallback((nextBatch: RewriteBatch) => {
    const stamped = { ...nextBatch, updatedAtIso: new Date().toISOString() };
    setBatch(stamped);
    saveBatch(stamped);
    refreshBatchList();
  }, [refreshBatchList]);

  // ── Intake (US1) ──────────────────────────────────────────────────────────

  async function handleStartBatch(): Promise<void> {
    const keys = parseIssueKeys(keysInput);
    if (keys.length === 0) {
      showToast('Paste at least one Jira key.', 'error');
      return;
    }
    setIsCapturing(true);
    try {
      const items = await captureOriginals(keys, acceptanceCriteriaFieldId);
      const nowIso = new Date().toISOString();
      persistBatch({
        id: mintBatchId(),
        name: `Re-write of ${keys.length} issue${keys.length === 1 ? '' : 's'}`,
        teamProfileId: dashboardTeamProfileId,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        items,
      });
      setReviewPageUrl('');
      setIngestNotice(null);
      setSubmitAnywayKeys([]);
    } finally {
      setIsCapturing(false);
    }
  }

  /**
   * Seeds the keys box with every Feature on the team's PI Review page for the selected PI — read straight
   * off the Confluence-backed table, so cross-project and hand-added Features come through (a fresh Jira
   * query would drop them). Fill-then-capture: the PO reviews the list and clicks Capture; nothing is
   * fetched-and-captured behind their back. Merges with anything already typed, de-duplicated.
   */
  async function handleImportFromPiReview(): Promise<void> {
    if (!piReviewTeam) {
      showToast('Select a team at the top of the PO Tool first.', 'error');
      return;
    }
    setIsImporting(true);
    try {
      const result = await importPiReviewFeatureKeys(piReviewTeam, selectedPiName);
      if (result.blockedReason === 'no-pi') {
        showToast('Select a Program Increment at the top of the PO Tool first.', 'error');
        return;
      }
      if (result.blockedReason === 'no-page') {
        showToast(`No PI Review page is configured for ${selectedPiName} on this team (Settings → team → PI Review pages).`, 'error');
        return;
      }
      if (result.keys.length === 0) {
        showToast(`The PI Review page for ${selectedPiName} has no Features on it yet.`, 'error');
        return;
      }
      // Union the imported keys with whatever is already typed, preserving order and dropping dupes.
      const existingKeys = parseIssueKeys(keysInput);
      const mergedKeys = [...new Set([...existingKeys, ...result.keys])];
      setKeysInput(mergedKeys.join('\n'));
      const addedCount = mergedKeys.length - existingKeys.length;
      showToast(`Imported ${addedCount} Feature${addedCount === 1 ? '' : 's'} from the ${selectedPiName} PI Review page. Review the list, then capture.`, 'success');
    } finally {
      setIsImporting(false);
    }
  }

  // The prompt is partitioned over EVERY capturable issue — not just the ones still lacking a proposal —
  // so the split into parts is STABLE: ingesting part 1's reply must not re-pack the remaining issues and
  // make part 2's panel disappear out from under an in-flight review (GH #220). The honest "not yet
  // re-written" count (below) still narrows to the outstanding issues; the partition does not.
  const capturableItems = useMemo(
    () => (batch ? batch.items.filter((item) => !item.captureError) : []),
    [batch],
  );
  const prompts = useMemo(
    () => buildBulkRewritePrompts(capturableItems.map((item) => ({ jiraKey: item.jiraKey, original: item.original }))),
    [capturableItems],
  );

  /** Ingests one (possibly partial) reply, merging proposals into the batch by key. No Jira write here. */
  function handleIngest(replyText: string): { acceptedCount: number; errors: string[] } {
    if (!batch) {
      return { acceptedCount: 0, errors: ['Start a batch first.'] };
    }
    const knownKeys = batch.items.map((item) => item.jiraKey);
    // A reply the parser cannot read (no JSON, malformed JSON, or the wrong "kind") throws — surface that
    // as a plain message rather than letting it bubble up and make "Read the reply" look like it did
    // nothing (GH #220). The most common cause is a truncated or partially-pasted reply.
    let result: ReturnType<typeof parseBulkRewriteReply>;
    try {
      result = parseBulkRewriteReply(replyText, knownKeys);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the reply could not be read';
      setIngestNotice(null);
      return {
        acceptedCount: 0,
        errors: [`Could not read the reply: ${reason} Paste the assistant's full reply (it must be the JSON that starts with {"kind":"featureRewriteBatch"}).`],
      };
    }
    const items = batch.items.map((item) => {
      const proposed = result.rewritesByKey[item.jiraKey];
      if (!proposed) {
        return item;
      }
      // A fresh proposal lands in `proposed`; an edited/approved item re-opens to `reviewing` for a look.
      return { ...item, proposed, state: 'proposed' as ItemState };
    });
    persistBatch({ ...batch, items });
    const acceptedCount = Object.keys(result.rewritesByKey).length;
    setIngestNotice({ accepted: acceptedCount, rejected: result.rejected, unparsedCount: result.unparsedCount });
    const errors = [
      ...result.rejected.map((entry) => `${entry.key}: ${entry.reason}`),
      ...(result.unparsedCount > 0 ? [`${result.unparsedCount} issue(s) had no usable re-write in the reply.`] : []),
    ];
    return { acceptedCount, errors };
  }

  // ── Review (US2) ──────────────────────────────────────────────────────────

  function handleItemChange(index: number, nextItem: RewriteItem): void {
    if (!batch) {
      return;
    }
    const items = batch.items.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
    persistBatch({ ...batch, items });
  }

  const countsByState = useMemo(() => {
    const counts: Partial<Record<ItemState, number>> = {};
    (batch?.items ?? []).forEach((item) => {
      counts[item.state] = (counts[item.state] ?? 0) + 1;
    });
    return counts;
  }, [batch]);

  // ── Confluence review page (US3) ────────────────────────────────────────────

  // Everything with a proposal that has not been rejected — the before/after set published for review.
  const reviewItems = useMemo<BatchExportInput[]>(
    () => (batch?.items ?? [])
      .filter((item) => item.proposed && item.state !== 'rejected')
      .map((item) => ({ jiraKey: item.jiraKey, original: item.original, proposed: item.proposed! })),
    [batch],
  );

  /** Persists the review page URL onto the batch so it survives reload. */
  function commitReviewPageUrl(): void {
    if (batch && (batch.reviewPageUrl ?? '') !== reviewPageUrl.trim()) {
      persistBatch({ ...batch, reviewPageUrl: reviewPageUrl.trim() });
    }
  }

  /** Writes the before/after table to the configured Confluence page for the reviewing PO to edit + approve. */
  async function handlePublishToConfluence(): Promise<void> {
    if (!batch || reviewPageUrl.trim() === '' || reviewItems.length === 0) {
      return;
    }
    setIsPublishing(true);
    try {
      persistBatch({ ...batch, reviewPageUrl: reviewPageUrl.trim() });
      const page = await fetchConfluencePageByReference(reviewPageUrl.trim());
      await updateConfluencePage({
        pageId: page.id,
        pageTitle: page.title,
        storageValue: buildReviewPageStorage(reviewItems),
        nextVersionNumber: page.version.number + 1,
      });
      showToast(
        `Published ${reviewItems.length} before/after row(s) to Confluence. The reviewing PO can edit the Proposed columns and tick Approve on the page.`,
        'success',
      );
    } catch (error) {
      showToast(error instanceof Error ? `Could not publish to Confluence: ${error.message}` : 'Could not publish to Confluence.', 'error');
    } finally {
      setIsPublishing(false);
    }
  }

  // ── Read approvals back + submit (US4/US5) ───────────────────────────────────

  const submitDeps = useMemo(
    () => ({
      // The drift re-read reuses the exact capture path, so it compares like-for-like with the "before".
      fetchLive: async (jiraKey: string) => (await captureOriginals([jiraKey], acceptanceCriteriaFieldId))[0].original,
      saveField: (issueKey: string, fieldId: string, value: unknown) =>
        saveFeatureReviewSimpleField(issueKey, fieldId, String(value ?? '')),
    }),
    [acceptanceCriteriaFieldId],
  );

  /**
   * Reads the Confluence review page back, applies the PO's edits + Approve ticks to the batch, then submits
   * only the ticked (approved) rows to Jira with the live drift guard. The page is authoritative for both
   * the final wording and the approval decision.
   */
  async function handleWriteApprovedToJira(): Promise<void> {
    if (!batch || reviewPageUrl.trim() === '') {
      return;
    }
    setIsWritingApproved(true);
    try {
      const page = await fetchConfluencePageByReference(reviewPageUrl.trim());
      const pageRows = parseReviewPageStorage(page.body.storage.value);
      if (pageRows.length === 0) {
        showToast('No review table was found on that Confluence page — publish the before/after first.', 'error');
        return;
      }
      const rowsByKey = new Map(pageRows.map((row) => [row.jiraKey, row]));
      // Apply each page row to its item: a ticked row → approved with the PO's (re-normalized) wording; an
      // un-ticked row → reviewing. Descriptions are re-normalized to the nine sections (idempotent, 029).
      const nextItems = batch.items.map((item) => {
        const pageRow = rowsByKey.get(item.jiraKey);
        if (!pageRow || !item.proposed) {
          return item;
        }
        const description = stripAiAttribution(normalizeFeatureDescription(pageRow.description));
        const hasEdit = description !== item.proposed.description || pageRow.acceptanceCriteria !== item.proposed.acceptanceCriteria;
        return {
          ...item,
          proposed: {
            description,
            acceptanceCriteria: pageRow.acceptanceCriteria,
            isEdited: item.proposed.isEdited || hasEdit,
          },
          state: (pageRow.isApproved ? 'approved' : 'reviewing') as ItemState,
        };
      });
      const withPageState: RewriteBatch = { ...batch, items: nextItems, reviewPageUrl: reviewPageUrl.trim() };
      persistBatch(withPageState);

      if (nextItems.filter((item) => item.state === 'approved').length === 0) {
        showToast('No rows are ticked Approve on the Confluence page yet.', 'error');
        return;
      }
      const result = await submitApprovedItems(
        withPageState,
        { acceptanceCriteriaFieldId, fieldDescriptors: [] },
        submitDeps,
        { submitAnywayKeys },
      );
      persistBatch(result);
      const submitted = result.items.filter((item) => item.state === 'submitted').length;
      const failed = result.items.filter((item) => item.state === 'failed').length;
      const held = result.items.filter((item) => item.state === 'changed').length;
      showToast(
        `Wrote ${submitted} approved to Jira. ${failed} failed, ${held} held (changed in Jira).`,
        failed > 0 ? 'error' : 'success',
      );
    } catch (error) {
      showToast(error instanceof Error ? `Could not read the Confluence page: ${error.message}` : 'Could not read the Confluence page.', 'error');
    } finally {
      setIsWritingApproved(false);
    }
  }

  /** Force-submits a single held item on the next write run, per FR-053's operator override. */
  function handleSubmitAnyway(jiraKey: string): void {
    setSubmitAnywayKeys((keys) => (keys.includes(jiraKey) ? keys : [...keys, jiraKey]));
    showToast(`${jiraKey} will be written on the next run despite the change.`, 'success');
  }

  // ── Resume (US5) ──────────────────────────────────────────────────────────────

  function handleOpenBatch(batchId: string): void {
    const loaded = loadBatch(dashboardTeamProfileId, batchId);
    if (loaded) {
      setBatch(loaded);
      setReviewPageUrl(loaded.reviewPageUrl ?? '');
      setIngestNotice(null);
      setSubmitAnywayKeys([]);
    }
  }

  function handleDeleteBatch(batchId: string): void {
    deleteBatch(dashboardTeamProfileId, batchId);
    if (batch?.id === batchId) {
      setBatch(null);
    }
    refreshBatchList();
  }

  // ── Honest states (US6) ───────────────────────────────────────────────────────

  const captureErrors = (batch?.items ?? []).filter((item) => item.captureError);
  const notYetRewritten = (batch?.items ?? []).filter((item) => !item.proposed && !item.captureError);
  const failedItems = (batch?.items ?? []).filter((item) => item.state === 'failed');
  const changedItems = (batch?.items ?? []).filter((item) => item.state === 'changed');

  return (
    <div className={styles.rewriteTab}>
      {!canPersist ? (
        <p className={styles.warningBanner}>
          This browser is not letting NodeToolbox save batches, so a re-write batch will be lost on reload.
          Publish the before/after to Confluence to keep a durable copy.
        </p>
      ) : null}
      {fieldConfigError ? <p className={styles.warningBanner}>{fieldConfigError}</p> : null}

      {/* ── Intake ── */}
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Start a re-write batch</h3>
        <p className={styles.helpText}>
          Paste the Jira keys to re-write. Each issue&apos;s current summary, description, and acceptance
          criteria are captured as the &quot;before&quot; — nothing in Jira is touched until you approve and submit.
        </p>
        <label className={styles.fieldLabel} htmlFor="rewrite-keys">Jira keys</label>
        <textarea
          id="rewrite-keys"
          className={styles.textArea}
          placeholder="ABC-1, ABC-2 ABC-3…"
          value={keysInput}
          onChange={(changeEvent) => setKeysInput(changeEvent.target.value)}
        />
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} type="button" disabled={isCapturing} onClick={handleStartBatch}>
            {isCapturing ? 'Capturing…' : 'Capture originals'}
          </button>
          <button className={styles.secondaryButton} type="button" disabled={isImporting} onClick={handleImportFromPiReview}>
            {isImporting ? 'Importing…' : 'Import from PI Review'}
          </button>
        </div>
        <p className={styles.helpText}>
          &ldquo;Import from PI Review&rdquo; fills the keys above with every Feature on this team&apos;s PI
          Review page{selectedPiName ? ` for ${selectedPiName}` : ''} — exactly what&apos;s on the page, across
          all projects. No typing needed; review the list, then capture.
        </p>
      </section>

      {/* ── Saved batches (resume) ── */}
      {savedBatches.length > 0 ? (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Saved batches</h3>
          <ul className={styles.batchList} aria-label="Saved re-write batches">
            {savedBatches.map((summary) => (
              <li className={styles.batchRow} key={summary.id}>
                <div className={styles.batchRowMeta}>
                  <strong>{summary.name}</strong>
                  <span>{summary.itemCount} issue{summary.itemCount === 1 ? '' : 's'} · updated {new Date(summary.updatedAtIso).toLocaleString()}</span>
                </div>
                <div className={styles.batchRowActions}>
                  <button className={styles.secondaryButton} type="button" onClick={() => handleOpenBatch(summary.id)}>Open</button>
                  <button className={styles.dangerButton} type="button" onClick={() => handleDeleteBatch(summary.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {batch ? (
        <>
          {/* ── Batch header + honest states ── */}
          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>{batch.name}</h3>
            <div className={styles.summaryStrip}>
              {STATE_ORDER.filter((state) => countsByState[state]).map((state) => (
                <span className={styles.stateChip} key={state}>{state}: {countsByState[state]}</span>
              ))}
            </div>

            {captureErrors.length > 0 ? (
              <ul className={styles.noticeList} aria-label="Capture errors">
                {captureErrors.map((item) => (
                  <li className={styles.outcomeFailed} key={item.jiraKey}>Could not capture {item.jiraKey}: {item.captureError}</li>
                ))}
              </ul>
            ) : null}
            {notYetRewritten.length > 0 ? (
              <p className={styles.helpText}>{notYetRewritten.length} issue(s) not yet re-written.</p>
            ) : null}
            {prompts.length > 1 ? (
              <p className={styles.infoBanner}>The prompt is split into {prompts.length} parts (batch exceeds the size cap) — run each part and paste every reply back.</p>
            ) : null}
            {ingestNotice ? (
              <ul className={styles.noticeList} aria-label="Ingest results">
                <li className={styles.outcomeCreated}>Applied {ingestNotice.accepted} re-write(s).</li>
                {ingestNotice.rejected.map((entry) => (
                  <li className={styles.outcomeFailed} key={entry.key}>Ignored {entry.key}: {entry.reason}</li>
                ))}
                {ingestNotice.unparsedCount > 0 ? (
                  <li className={styles.outcomeFailed}>{ingestNotice.unparsedCount} issue(s) had no usable re-write.</li>
                ) : null}
              </ul>
            ) : null}
            {failedItems.length > 0 ? (
              <ul className={styles.noticeList} aria-label="Submit failures">
                {failedItems.map((item) => (
                  <li className={styles.outcomeFailed} key={item.jiraKey}>Failed to submit {item.jiraKey}: {(item.submitResult?.fieldErrors ?? []).join('; ') || 'unknown error'}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* ── Gated AI round-trip: one stable panel per prompt part; hidden once nothing remains ── */}
          {notYetRewritten.length > 0 ? prompts.map((promptText, partIndex) => (
            <PoAiPanel
              key={`prompt-part-${partIndex}`}
              title={prompts.length > 1 ? `Re-write prompt — part ${partIndex + 1} of ${prompts.length}` : 'Re-write these issues'}
              helpText="Builds a prompt that asks for a re-write of every issue in this batch, in the nine-section format. Paste the reply back and it fills the After column below — every word stays editable, and nothing reaches Jira until you approve and submit."
              buildPrompt={() => promptText}
              onIngest={handleIngest}
            />
          )) : null}

          {/* ── Before/after review grid ── */}
          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Review before / after</h3>
            <div className={styles.reviewGrid}>
              {batch.items.map((item, index) => (
                <BeforeAfterRow
                  key={item.jiraKey}
                  item={item}
                  onChange={(nextItem) => handleItemChange(index, nextItem)}
                />
              ))}
            </div>
          </section>

          {/* ── Confluence review + submit ── */}
          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Review on Confluence &amp; submit</h3>
            <p className={styles.helpText}>
              Publish the before/after to a Confluence page. The reviewing PO edits the Proposed columns and
              ticks Approve on the page; then Write approved to Jira reads the page back and writes only the
              ticked rows (with a live drift check). The page is the shared, editable record — nothing reaches
              Jira until you click Write approved.
            </p>
            <label className={styles.fieldLabel} htmlFor="rewrite-review-url">Confluence review page URL</label>
            <input
              id="rewrite-review-url"
              className={styles.textInput}
              type="url"
              placeholder="https://…/wiki/spaces/…/pages/123456/Review"
              value={reviewPageUrl}
              onChange={(changeEvent) => setReviewPageUrl(changeEvent.target.value)}
              onBlur={commitReviewPageUrl}
            />
            <div className={styles.buttonRow}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={isPublishing || reviewItems.length === 0 || reviewPageUrl.trim() === ''}
                onClick={handlePublishToConfluence}
              >
                {isPublishing ? 'Publishing…' : 'Publish before/after to Confluence'}
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={isWritingApproved || reviewPageUrl.trim() === ''}
                onClick={handleWriteApprovedToJira}
              >
                {isWritingApproved ? 'Writing…' : 'Write approved to Jira'}
              </button>
            </div>

            {changedItems.length > 0 ? (
              <div className={styles.warningBanner}>
                <strong>Changed in Jira since capture — held back:</strong>
                <ul className={styles.noticeList}>
                  {changedItems.map((item) => (
                    <li key={item.jiraKey}>
                      {item.jiraKey}
                      {' '}
                      <button className={styles.secondaryButton} type="button" onClick={() => handleSubmitAnyway(item.jiraKey)}>Write anyway</button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
