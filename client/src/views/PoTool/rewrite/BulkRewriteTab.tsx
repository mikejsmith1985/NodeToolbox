// BulkRewriteTab.tsx — Bulk "re-write" workspace (spec 030). A PO pastes a list of Jira keys; the tool
// captures each issue's current summary/description/AC as an immutable "before", then a gated, manual AI
// round-trip proposes nine-section re-writes. The batch persists for days so a reviewing PO can be sent a
// before/after export and send back edits. Approved items — and only approved items — are submitted to
// Jira one at a time through the reused single-issue write path, with a live drift guard so nothing that
// changed in Jira since capture is silently overwritten.
//
// AI rules (load-bearing): the AI step is PoAiPanel — a copy-prompt / paste-reply round trip that renders
// nothing when AI Assist is locked. Toolbox never calls an AI service, never writes AI output to Jira
// without an explicit approve + submit, and never attributes content to AI.

import { useCallback, useMemo, useState } from 'react';

import { useToast } from '../../../components/Toast/ToastContext.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';
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
import { buildHtmlExport, buildMarkdownExport } from './rewriteBatchExport';
import {
  deleteBatch,
  exportBatchFile,
  importBatchFile,
  listBatches,
  loadBatch,
  saveBatch,
} from './rewriteBatchStore';
import { canPersistDrafts } from '../drafts/splitDraftStorage';
import { checkForDrift, submitApprovedItems } from './rewriteSubmit';
import styles from './rewrite.module.css';

interface BulkRewriteTabProps {
  /** The PO Tool's own team profile — scopes stored batches and the configured field ids used. */
  dashboardTeamProfileId: string;
}

/** Human order for the state summary chips. */
const STATE_ORDER: ItemState[] = [
  'captured', 'proposed', 'reviewing', 'approved', 'changed', 'rejected', 'submitted', 'failed',
];

/** Mints a short, collision-unlikely batch id (no security requirement — just uniqueness in localStorage). */
function mintBatchId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function BulkRewriteTab({ dashboardTeamProfileId }: BulkRewriteTabProps) {
  const { showToast } = useToast();
  const { fieldConfig, fieldConfigError } = usePoHygieneContext(dashboardTeamProfileId);

  const acceptanceCriteriaFieldId = useMemo(
    () => fieldConfig.acceptanceCriteriaFieldIds.find((fieldId) => fieldId !== 'description') ?? null,
    [fieldConfig],
  );

  const [canPersist] = useState(canPersistDrafts);
  const [keysInput, setKeysInput] = useState('');
  const [batch, setBatch] = useState<RewriteBatch | null>(null);
  // Seeded once on mount (the tab is keyed by team, so the id is stable here) and refreshed imperatively
  // after every mutation — no effect needed.
  const [savedBatches, setSavedBatches] = useState<RewriteBatchSummary[]>(() => listBatches(dashboardTeamProfileId));
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingDrift, setIsCheckingDrift] = useState(false);
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
      setIngestNotice(null);
      setSubmitAnywayKeys([]);
    } finally {
      setIsCapturing(false);
    }
  }

  // Items still needing a re-write drive the prompt(s); once every issue has a proposal there is nothing
  // left to generate. buildBulkRewritePrompts splits deterministically once the batch exceeds the char cap.
  const itemsNeedingRewrite = useMemo(
    () => (batch ? batch.items.filter((item) => !item.captureError && !item.proposed) : []),
    [batch],
  );
  const prompts = useMemo(
    () => buildBulkRewritePrompts(itemsNeedingRewrite.map((item) => ({ jiraKey: item.jiraKey, original: item.original }))),
    [itemsNeedingRewrite],
  );

  /** Ingests one (possibly partial) reply, merging proposals into the batch by key. No Jira write here. */
  function handleIngest(replyText: string): { acceptedCount: number; errors: string[] } {
    if (!batch) {
      return { acceptedCount: 0, errors: ['Start a batch first.'] };
    }
    const knownKeys = batch.items.map((item) => item.jiraKey);
    const result = parseBulkRewriteReply(replyText, knownKeys);
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

  // ── Export (US3) ────────────────────────────────────────────────────────────

  // Everything with a proposal that has not been rejected — the shareable before/after set.
  const exportItems = useMemo<BatchExportInput[]>(
    () => (batch?.items ?? [])
      .filter((item) => item.proposed && item.state !== 'rejected')
      .map((item) => ({ jiraKey: item.jiraKey, original: item.original, proposed: item.proposed! })),
    [batch],
  );

  async function handleCopyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(buildMarkdownExport(exportItems));
      showToast('Before/after Markdown copied.', 'success');
    } catch {
      showToast('Could not access the clipboard.', 'error');
    }
  }

  function handleDownloadHtml(): void {
    const html = buildHtmlExport(exportItems);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${batch?.name ?? 'feature-rewrite'}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ── Submit + drift (US4/US5) ─────────────────────────────────────────────────

  const submitDeps = useMemo(
    () => ({
      // The drift re-read reuses the exact capture path, so it compares like-for-like with the "before".
      fetchLive: async (jiraKey: string) => (await captureOriginals([jiraKey], acceptanceCriteriaFieldId))[0].original,
      saveField: (issueKey: string, fieldId: string, value: unknown) =>
        saveFeatureReviewSimpleField(issueKey, fieldId, String(value ?? '')),
    }),
    [acceptanceCriteriaFieldId],
  );

  async function handleSubmit(): Promise<void> {
    if (!batch) {
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await submitApprovedItems(
        batch,
        { acceptanceCriteriaFieldId, fieldDescriptors: [] },
        submitDeps,
        { submitAnywayKeys },
      );
      persistBatch(result);
      const submitted = result.items.filter((item) => item.state === 'submitted').length;
      const failed = result.items.filter((item) => item.state === 'failed').length;
      const held = result.items.filter((item) => item.state === 'changed').length;
      showToast(
        `Submitted ${submitted}. ${failed} failed, ${held} held (changed in Jira).`,
        failed > 0 ? 'error' : 'success',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCheckForChanges(): Promise<void> {
    if (!batch) {
      return;
    }
    setIsCheckingDrift(true);
    try {
      const result = await checkForDrift(batch, submitDeps);
      persistBatch(result);
      const changed = result.items.filter((item) => item.state === 'changed').length;
      showToast(changed === 0 ? 'No approved issue has changed in Jira since capture.' : `${changed} issue(s) changed in Jira since capture.`, changed === 0 ? 'success' : 'error');
    } finally {
      setIsCheckingDrift(false);
    }
  }

  /** Force-submits a single held item on the next submit run, per FR-053's operator override. */
  function handleSubmitAnyway(jiraKey: string): void {
    setSubmitAnywayKeys((keys) => (keys.includes(jiraKey) ? keys : [...keys, jiraKey]));
    showToast(`${jiraKey} will be submitted on the next run despite the change.`, 'success');
  }

  // ── Resume / portability (US5) ────────────────────────────────────────────────

  function handleOpenBatch(batchId: string): void {
    const loaded = loadBatch(dashboardTeamProfileId, batchId);
    if (loaded) {
      setBatch(loaded);
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

  function handleExportFile(): void {
    if (!batch) {
      return;
    }
    const { fileName, json } = exportBatchFile(batch);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File): Promise<void> {
    try {
      const imported = importBatchFile(await file.text());
      persistBatch({ ...imported, teamProfileId: dashboardTeamProfileId });
      showToast(`Imported batch "${imported.name}".`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'That file could not be imported.', 'error');
    }
  }

  // ── Honest states (US6) ───────────────────────────────────────────────────────

  const captureErrors = (batch?.items ?? []).filter((item) => item.captureError);
  const notYetRewritten = (batch?.items ?? []).filter((item) => !item.proposed && !item.captureError);
  const failedItems = (batch?.items ?? []).filter((item) => item.state === 'failed');
  const changedItems = (batch?.items ?? []).filter((item) => item.state === 'changed');
  const approvedCount = countsByState.approved ?? 0;

  return (
    <div className={styles.rewriteTab}>
      {!canPersist ? (
        <p className={styles.warningBanner}>
          This browser is not letting NodeToolbox save batches, so a re-write batch will be lost on reload.
          Export it to a file if you need to keep it.
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
        </div>
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
          <div className={styles.buttonRow}>
            <label className={styles.secondaryButton}>
              Import batch file
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                aria-label="Import batch file"
                onChange={(changeEvent) => {
                  const file = changeEvent.target.files?.[0];
                  if (file) {
                    void handleImportFile(file);
                  }
                  changeEvent.target.value = '';
                }}
              />
            </label>
          </div>
        </section>
      ) : null}

      {batch ? (
        <>
          {/* ── Batch header + honest states ── */}
          <section className={styles.panel}>
            <div className={styles.rowHeader}>
              <h3 className={styles.panelTitle}>{batch.name}</h3>
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} type="button" onClick={handleExportFile}>Export batch file</button>
              </div>
            </div>
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

          {/* ── Gated AI round-trip: one panel per prompt part ── */}
          {prompts.map((promptText, partIndex) => (
            <PoAiPanel
              key={partIndex}
              title={prompts.length > 1 ? `Re-write prompt — part ${partIndex + 1} of ${prompts.length}` : 'Re-write these issues'}
              helpText="Builds a prompt that asks for a re-write of every issue in this batch, in the nine-section format. Paste the reply back and it fills the After column below — every word stays editable, and nothing reaches Jira until you approve and submit."
              buildPrompt={() => promptText}
              onIngest={handleIngest}
            />
          ))}

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

          {/* ── Export + submit ── */}
          <section className={styles.panel}>
            <h3 className={styles.panelTitle}>Share &amp; submit</h3>
            <p className={styles.helpText}>
              Export a before/after for the reviewing PO, then submit only the issues you have approved.
              Rejected issues are never exported or submitted.
            </p>
            <div className={styles.buttonRow}>
              <button className={styles.secondaryButton} type="button" disabled={exportItems.length === 0} onClick={handleCopyMarkdown}>Copy before/after (Markdown)</button>
              <button className={styles.secondaryButton} type="button" disabled={exportItems.length === 0} onClick={handleDownloadHtml}>Download before/after (HTML)</button>
              <button className={styles.secondaryButton} type="button" disabled={isCheckingDrift || approvedCount === 0} onClick={handleCheckForChanges}>
                {isCheckingDrift ? 'Checking…' : 'Check for changes in Jira'}
              </button>
              <button className={styles.primaryButton} type="button" disabled={isSubmitting || approvedCount === 0} onClick={handleSubmit}>
                {isSubmitting ? 'Submitting…' : `Submit ${approvedCount} approved`}
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
                      <button className={styles.secondaryButton} type="button" onClick={() => handleSubmitAnyway(item.jiraKey)}>Submit anyway</button>
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
