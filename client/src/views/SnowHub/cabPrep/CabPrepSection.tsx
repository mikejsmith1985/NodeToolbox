// CabPrepSection.tsx — Preparing for a Change Advisory Board, from a loaded change.
//
// It lives beside a loaded CHG rather than inside the create wizard because CAB happens AFTER the
// change exists: you arrive at the meeting with a number, not a draft.
//
// The Jira scope is an EDITABLE list, seeded from the keys written into the change's own text.
// Nothing in ServiceNow records which issues a change covers, so a scope nobody can see or correct
// would be a scope you simply have to trust — and "is everything in this change finished?" is one of
// the questions the board actually asks.

import { useState } from 'react';

import { useAiAssist } from '../hooks/useAiAssist.ts';
import type { ChangeRequest } from '../../../types/snow.ts';
import { buildCabFactSheet } from './cabFactSheet.ts';
import { buildCabPrepPrompt, parseCabPrepReply } from './cabPrepPrompt.ts';
import { buildCabPrepPack, formatCabPrepPack } from './cabPrepPack.ts';
import { loadCabScopeIssues } from './cabScopeFetch.ts';
import { readJiraKeysFromChange, readRejectedIssueKeys, readTypedIssueKeys } from './cabScopeSource.ts';
import type { CabScopedIssue } from './cabFactSheet.ts';

/** What the caller must provide to open a copy-out / paste-back round trip. */
export interface CabPrepSectionProps {
  loadedChange: ChangeRequest;
  /** The host tab's class vocabulary, so this section looks like the tab it sits in. */
  styles: Record<string, string>;
}

/** Renders the CAB preparation affordance for one loaded change. */
export function CabPrepSection({ loadedChange, styles }: CabPrepSectionProps) {
  const { isUnlocked } = useAiAssist();
  // The operator's EDIT, not the value itself. Null means "use the keys the change names".
  //
  // Nothing resets this when a different change loads, because nothing needs to: the host mounts
  // this section with the change number as its React `key`, so a new change gets a new component
  // and every piece of state below starts clean. That is why there is no effect here — a reset
  // effect would re-render twice and fight the edit it was meant to preserve.
  const [editedScopeKeys, setEditedScopeKeys] = useState<string | null>(null);
  const [scopedIssues, setScopedIssues] = useState<CabScopedIssue[]>([]);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [isLoadingScope, setLoadingScope] = useState(false);
  const [scopeStatus, setScopeStatus] = useState<string | null>(null);
  const [packText, setPackText] = useState<string | null>(null);
  // The copy-out / paste-back round trip, owned here rather than threaded in: this section is the
  // only affordance on this tab, so a shared modal would be a shared thing with one user.
  const [promptText, setPromptText] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  // The keys the change itself names — the seed the operator edits from.
  const seededScopeKeys = readJiraKeysFromChange(
    loadedChange.shortDescription ?? '',
    loadedChange.description ?? '',
  ).join(' ');
  const scopeKeysText = editedScopeKeys ?? seededScopeKeys;

  async function loadScope(): Promise<void> {
    const requestedKeys = readTypedIssueKeys(scopeKeysText);
    const rejectedEntries = readRejectedIssueKeys(scopeKeysText);
    setLoadingScope(true);
    setScopeStatus(null);
    try {
      const outcome = await loadCabScopeIssues(requestedKeys);
      setScopedIssues(outcome.issues);
      setMissingKeys(outcome.missingKeys);
      setScopeStatus(
        `Loaded ${outcome.issues.length} issue(s).`
        + (outcome.missingKeys.length > 0 ? ` Not found in Jira: ${outcome.missingKeys.join(', ')}.` : '')
        // Said out loud rather than dropped: an entry that vanished is one nobody knows is absent.
        + (rejectedEntries.length > 0 ? ` Ignored, not a Jira key: ${rejectedEntries.join(', ')}.` : ''),
      );
    } catch (caughtError) {
      setScopeStatus(caughtError instanceof Error ? caughtError.message : 'Could not read those issues.');
    } finally {
      setLoadingScope(false);
    }
  }

  function openCabPrompt(): void {
    const factSheet = buildCabFactSheet({
      changeNumber: loadedChange.number,
      shortDescription: loadedChange.shortDescription ?? '',
      description: loadedChange.description ?? '',
      justification: loadedChange.justification ?? '',
      riskImpactAnalysis: loadedChange.riskImpactAnalysis ?? '',
      implementationPlan: loadedChange.implementationPlan ?? '',
      backoutPlan: loadedChange.backoutPlan ?? '',
      testPlan: loadedChange.testPlan ?? '',
      assessment: {
        Risk: loadedChange.risk ?? '',
        Impact: loadedChange.impact ?? '',
        'System availability implication': loadedChange.availabilityImpact ?? '',
        'Has been tested': loadedChange.hasBeenTested ?? '',
        'Performed previously': loadedChange.performedPreviously ?? '',
        'Success probability': loadedChange.successProbability ?? '',
        'Can be backed out': loadedChange.canBeBackedOut ?? '',
      },
      environments: [{
        name: 'Planned window',
        plannedStart: loadedChange.plannedStartDate ?? '',
        plannedEnd: loadedChange.plannedEndDate ?? '',
      }],
      // The change tasks are not read here: this reports on the change as it stands, and a CTASK
      // list belongs to the create flow that staged it.
      changeTaskNames: [],
    }, scopedIssues);

    setPromptText(buildCabPrepPrompt(factSheet));
    setReplyText('');
    setApplyStatus(null);
  }

  /** Consumes the pasted reply and renders the pack, or says why it could not. */
  function applyReply(): void {
    try {
      const ingest = parseCabPrepReply(replyText);
      if (ingest.answers.length === 0) {
        setApplyStatus('No usable answers were in that reply.');
        return;
      }
      const pack = buildCabPrepPack(ingest.answers);
      setPackText(formatCabPrepPack(pack, loadedChange.number));
      // Rejections are reported, never swallowed: an answer that vanished silently is one the
      // presenter walks in without and does not know it.
      const rejectionNote = ingest.rejectedItems.length === 0
        ? ''
        : ` ${ingest.rejectedItems.length} item(s) rejected: `
          + ingest.rejectedItems.map((rejected) => `${rejected.id} ${rejected.reason}`).join('; ');
      setApplyStatus(
        `CAB pack built — ${pack.answeredCount} answered, `
        + `${pack.unanswerableAnswers.length} not answerable from what is recorded.${rejectionNote}`,
      );
    } catch (caughtError) {
      setApplyStatus(caughtError instanceof Error ? caughtError.message : 'That reply could not be read.');
    }
  }

  // Same gate as every other AI affordance: nothing here appears until AI Assist is unlocked.
  if (!isUnlocked) {
    return null;
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Prepare for CAB review</h3>
      </div>
      <div className={styles.sectionBody}>
        <p>
          Answers the questions a Change Advisory Board asks about {loadedChange.number}, from the
          change and the Jira work below. Nothing is written to ServiceNow or Jira.
        </p>

        <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="cab-scope-keys">
          Jira issues to draw context from
        </label>
        {/* Seeded from the keys the change itself names, then editable — because nothing in
            ServiceNow records which issues a change covers, and a scope you cannot see is one you
            simply have to trust. */}
        <textarea
          className={styles.input}
          id="cab-scope-keys"
          onChange={(changeEvent) => setEditedScopeKeys(changeEvent.target.value)}
          placeholder="ENCUC-2213 ENCUC-2358 — seeded from the change text, edit freely"
          rows={3}
          value={scopeKeysText}
        />
        </div>

        <div className={styles.buttonRow}>
          <button
            className={styles.secondaryButton}
            disabled={isLoadingScope}
            onClick={() => void loadScope()}
            type="button"
          >
            {isLoadingScope ? 'Loading…' : 'Load these issues'}
          </button>
          <button
            className={styles.secondaryButton}
            onClick={openCabPrompt}
            title="Build the prompt from this change and the loaded issues"
            type="button"
          >
            Prepare for CAB review
          </button>
        </div>

        {scopeStatus !== null ? <p role="status">{scopeStatus}</p> : null}
        {missingKeys.length > 0 ? (
          <p role="alert">
            {`These keys are named on the change but were not found in Jira: ${missingKeys.join(', ')}. `
              + 'The pack will answer "is everything finished?" without them.'}
          </p>
        ) : null}

        {promptText !== null ? (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="cab-prep-prompt">
              Copy this prompt into AI Assist
            </label>
            <textarea className={styles.input} id="cab-prep-prompt" readOnly rows={6} value={promptText} />
            <label className={styles.fieldLabel} htmlFor="cab-prep-reply">
              Paste the assistant&apos;s reply here
            </label>
            <textarea
              className={styles.input}
              id="cab-prep-reply"
              onChange={(changeEvent) => setReplyText(changeEvent.target.value)}
              rows={4}
              value={replyText}
            />
            <div className={styles.buttonRow}>
              <button
                className={styles.primaryButton}
                disabled={replyText.trim() === ''}
                onClick={applyReply}
                type="button"
              >
                Build the CAB pack
              </button>
              <button className={styles.secondaryButton} onClick={() => setPromptText(null)} type="button">
                Close
              </button>
            </div>
            {applyStatus !== null ? <p role="status">{applyStatus}</p> : null}
          </div>
        ) : null}

        {packText !== null ? (
          <div>
            <p className={styles.fieldLabel}>CAB preparation pack</p>
            <pre>{packText}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
