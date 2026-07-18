// ReadinessAiPanel.tsx — The Readiness tab's gated, propose-only AI insights panel (021 US3).
//
// Invisible while AI Assist is locked. When unlocked it builds one prompt over the active lens's
// features, ingests the {kind:'featureReadiness'} reply as per-feature proposals, and offers each
// writable field (estimate / target end / due date) an individual Accept. Accepted writes go through
// the SAME featureReviewFixes writers as the manual controls. Ownership and insight are display-only
// guidance — the model cannot know valid account identities, so they carry no write affordance.

import { useMemo, useState } from 'react';

import { useAiAssistStore } from '../../../../store/aiAssistStore.ts';
import { saveFeatureReviewSimpleField } from '../../../SprintDashboard/featureReviewFixes.ts';
import type { ReadinessLens, ReadinessWriteFieldIds } from '../readinessScan.ts';
import {
  buildReadinessAiPrompt,
  parseReadinessAiReply,
  type ReadinessAiProposal,
} from './readinessAiAssist.ts';
import styles from './ReadinessAiPanel.module.css';

const DISCLOSURE = 'review each proposal · an accepted estimate or date updates the Jira Feature';

export interface ReadinessAiPanelProps {
  lens: ReadinessLens;
  writeFieldIds: ReadinessWriteFieldIds;
  onProposalWritten: () => void;
}

/** One writable field on a proposal, with the label, value, and the write it performs. */
interface WritableField {
  key: 'estimate' | 'targetEnd' | 'dueDate';
  label: string;
  value: string;
  write: (issueKey: string) => Promise<void>;
}

/** Renders the readiness AI insights panel, or nothing when AI Assist is locked. */
export function ReadinessAiPanel({ lens, writeFieldIds, onProposalWritten }: ReadinessAiPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);
  const [replyText, setReplyText] = useState('');
  const [proposals, setProposals] = useState<ReadinessAiProposal[]>([]);
  const [writtenKeys, setWrittenKeys] = useState<Record<string, boolean>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const prompt = useMemo(() => buildReadinessAiPrompt(lens.features), [lens.features]);
  const knownKeys = useMemo(() => lens.features.map((feature) => feature.key), [lens.features]);

  if (!isUnlocked) return null;

  function loadProposals(): void {
    setErrorMessage(null);
    try {
      const result = parseReadinessAiReply(replyText, knownKeys);
      setProposals(result.proposals);
      setWrittenKeys({});
    } catch (parseError) {
      setErrorMessage(parseError instanceof Error ? parseError.message : 'Could not read the AI reply.');
      setProposals([]);
    }
  }

  /** The writable fields a proposal actually carries, wired to the shared writers. */
  function writableFieldsFor(proposal: ReadinessAiProposal): WritableField[] {
    const fields: WritableField[] = [];
    if (proposal.estimateSuggestion && writeFieldIds.estimateFieldId) {
      const fieldId = writeFieldIds.estimateFieldId;
      fields.push({
        key: 'estimate',
        label: 'Estimate',
        value: proposal.estimateSuggestion,
        write: (issueKey) => saveFeatureReviewSimpleField(issueKey, fieldId, proposal.estimateSuggestion as string),
      });
    }
    if (proposal.targetEndSuggestion && writeFieldIds.targetEndFieldId) {
      const fieldId = writeFieldIds.targetEndFieldId;
      fields.push({
        key: 'targetEnd',
        label: 'Target End',
        value: proposal.targetEndSuggestion,
        write: (issueKey) => saveFeatureReviewSimpleField(issueKey, fieldId, proposal.targetEndSuggestion as string),
      });
    }
    if (proposal.dueDateSuggestion) {
      fields.push({
        key: 'dueDate',
        label: 'Due Date',
        value: proposal.dueDateSuggestion,
        write: (issueKey) => saveFeatureReviewSimpleField(issueKey, 'duedate', proposal.dueDateSuggestion as string),
      });
    }
    return fields;
  }

  async function acceptField(proposal: ReadinessAiProposal, field: WritableField): Promise<void> {
    setErrorMessage(null);
    try {
      await field.write(proposal.issueKey);
      setWrittenKeys((current) => ({ ...current, [`${proposal.issueKey}:${field.key}`]: true }));
      onProposalWritten();
    } catch (writeError) {
      setErrorMessage(writeError instanceof Error ? writeError.message : 'Jira rejected the change.');
    }
  }

  function declineProposal(issueKey: string): void {
    setProposals((current) => current.filter((proposal) => proposal.issueKey !== issueKey));
  }

  return (
    <section className={styles.aiPanel} aria-label="Readiness AI insights">
      <header className={styles.header}>
        <h3 className={styles.title}>⚡ AI readiness insights</h3>
        <span className={styles.disclosure}>{DISCLOSURE}</span>
      </header>

      <label className={styles.field}>
        AI prompt
        <textarea className={styles.textarea} aria-label="AI prompt" readOnly value={prompt} rows={4} />
      </label>

      <label className={styles.field}>
        Paste AI reply
        <textarea
          className={styles.textarea}
          aria-label="Paste AI reply"
          value={replyText}
          rows={3}
          onChange={(event) => setReplyText(event.target.value)}
        />
      </label>
      <button type="button" className={styles.loadButton} onClick={loadProposals} disabled={replyText.trim() === ''}>
        Load proposals
      </button>

      {errorMessage && <p className={styles.error} role="alert">⚠ {errorMessage}</p>}

      {proposals.map((proposal) => (
        <article key={proposal.issueKey} className={styles.proposal}>
          <div className={styles.proposalHead}>
            <span className={styles.proposalKey}>{proposal.issueKey}</span>
            <button type="button" className={styles.declineButton} onClick={() => declineProposal(proposal.issueKey)}>
              Decline
            </button>
          </div>
          {writableFieldsFor(proposal).map((field) => (
            <div key={field.key} className={styles.proposalField}>
              <span>{field.label}: <strong>{field.value}</strong></span>
              {writtenKeys[`${proposal.issueKey}:${field.key}`] ? (
                <span className={styles.accepted}>✓ written</span>
              ) : (
                <button type="button" className={styles.acceptButton} onClick={() => void acceptField(proposal, field)}>
                  {`Accept ${field.label}`}
                </button>
              )}
            </div>
          ))}
          {/* Ownership and insight are guidance only — no write affordance. */}
          {proposal.ownershipSuggestion && (
            <p className={styles.guidance}>Ownership: {proposal.ownershipSuggestion}</p>
          )}
          {proposal.insight && <p className={styles.guidance}>Insight: {proposal.insight}</p>}
        </article>
      ))}
    </section>
  );
}
