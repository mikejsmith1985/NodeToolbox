// ReadinessFixControl.tsx — Inline "fix it here" control for one readiness alert on one feature.
//
// The org dashboard names each problem and sends you to Jira to fix it. This does the fixing in
// place. It introduces NO new Jira write path: every write delegates to the proven featureReviewFixes
// helpers (Article VII — the drift is control-shape only, recorded in plan.md). An alert whose field
// family is not configured on this instance links out instead of pretending it can edit.

import { useEffect, useState } from 'react';

import {
  saveFeatureReviewSimpleField,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
} from '../../SprintDashboard/featureReviewFixes.ts';
import { normalizePcodeInput, type ReadinessAlertFamilyState, type ReadinessAlertId, type ReadinessFeature, type ReadinessWriteFieldIds } from './readinessScan.ts';
import styles from './ReadinessFixControl.module.css';

const FIX_SUCCESS_MESSAGE = 'Saved — Jira accepted the change.';
// The native assignee field id — ownership can target this or the configured Product Owner field.
const ASSIGNEE_FIELD_ID = 'assignee';

export interface ReadinessFixControlProps {
  feature: ReadinessFeature;
  alertId: ReadinessAlertId;
  writeFieldIds: ReadinessWriteFieldIds;
  alertFamilyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState>;
  onFixed: () => void;
}

/** Routes one alert to its inline editor, or an Open-in-Jira link when the field is not configured. */
export function ReadinessFixControl({ feature, alertId, writeFieldIds, alertFamilyStates, onFixed }: ReadinessFixControlProps) {
  if (alertFamilyStates[alertId] === 'notConfigured') {
    return <OpenInJiraLink issueKey={feature.key} />;
  }
  if (alertId === 'missing-ownership') {
    return <OwnershipFix feature={feature} productOwnerFieldId={writeFieldIds.productOwnerFieldId} onFixed={onFixed} />;
  }
  if (alertId === 'missing-pcode') {
    if (!writeFieldIds.pcodeFieldId) return <OpenInJiraLink issueKey={feature.key} />;
    return <PcodeFix issueKey={feature.key} fieldId={writeFieldIds.pcodeFieldId} onFixed={onFixed} />;
  }
  if (alertId === 'missing-estimate') {
    if (!writeFieldIds.estimateFieldId) return <OpenInJiraLink issueKey={feature.key} />;
    return <ValueFix issueKey={feature.key} fieldId={writeFieldIds.estimateFieldId} label="Estimate" inputType="text" onFixed={onFixed} />;
  }
  if (alertId === 'target-end-missing-or-past') {
    if (!writeFieldIds.targetEndFieldId) return <OpenInJiraLink issueKey={feature.key} />;
    return <ValueFix issueKey={feature.key} fieldId={writeFieldIds.targetEndFieldId} label="Target End" inputType="date" onFixed={onFixed} />;
  }
  // due-date-missing-or-past — always the native duedate field.
  return <ValueFix issueKey={feature.key} fieldId="duedate" label="Due Date" inputType="date" onFixed={onFixed} />;
}

/** Shared submit lifecycle: runs one write, surfaces Jira's response, calls onFixed on success. */
function useFixSubmit(onFixed: () => void) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function submitFix(write: () => Promise<void>): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await write();
      setSuccessMessage(FIX_SUCCESS_MESSAGE);
      onFixed();
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return { isSubmitting, errorMessage, successMessage, setErrorMessage, submitFix };
}

/** Renders the shared status line (success / error) beneath a fix input. */
function FixStatus({ errorMessage, successMessage }: { errorMessage: string | null; successMessage: string | null }) {
  return (
    <>
      {successMessage && <span className={styles.success}>{successMessage}</span>}
      {errorMessage && <span className={styles.error} role="alert">{errorMessage}</span>}
    </>
  );
}

/** A single value input (text/number for estimate, date for target/due) plus a Fix button. */
function ValueFix({
  issueKey,
  fieldId,
  label,
  inputType,
  onFixed,
}: {
  issueKey: string;
  fieldId: string;
  label: string;
  inputType: 'text' | 'date';
  onFixed: () => void;
}) {
  const [value, setValue] = useState('');
  const { isSubmitting, errorMessage, successMessage, submitFix } = useFixSubmit(onFixed);

  return (
    <span className={styles.fixControl}>
      <span className={styles.fixLabel}>{label}:</span>
      <input
        className={styles.fixInput}
        type={inputType}
        aria-label={`Set ${label}`}
        value={value}
        disabled={isSubmitting}
        onChange={(event) => setValue(event.target.value)}
      />
      <FixButton
        disabled={isSubmitting || value.trim() === ''}
        isSubmitting={isSubmitting}
        onClick={() => void submitFix(() => saveFeatureReviewSimpleField(issueKey, fieldId, value.trim()))}
      />
      <FixStatus errorMessage={errorMessage} successMessage={successMessage} />
    </span>
  );
}

/** PCode input: normalizes P-prefixed / zero-padded input to a whole number before writing. */
function PcodeFix({ issueKey, fieldId, onFixed }: { issueKey: string; fieldId: string; onFixed: () => void }) {
  const [value, setValue] = useState('');
  const { isSubmitting, errorMessage, successMessage, setErrorMessage, submitFix } = useFixSubmit(onFixed);

  function handleFix(): void {
    const normalized = normalizePcodeInput(value);
    if (!normalized.ok) {
      setErrorMessage(normalized.reason);
      return;
    }
    void submitFix(() => saveFeatureReviewSimpleField(issueKey, fieldId, normalized.value));
  }

  return (
    <span className={styles.fixControl}>
      <span className={styles.fixLabel}>PCode:</span>
      <input
        className={styles.fixInput}
        type="text"
        aria-label="Set PCode"
        placeholder="12345"
        value={value}
        disabled={isSubmitting}
        onChange={(event) => setValue(event.target.value)}
      />
      <FixButton disabled={isSubmitting || value.trim() === ''} isSubmitting={isSubmitting} onClick={handleFix} />
      <FixStatus errorMessage={errorMessage} successMessage={successMessage} />
    </span>
  );
}

/** One picked user candidate ready to write. */
interface OwnerCandidate {
  label: string;
  value: string;
}

/** Ownership fix: search users, choose a target field (assignee or PO), then write the user. */
function OwnershipFix({
  feature,
  productOwnerFieldId,
  onFixed,
}: {
  feature: ReadinessFeature;
  productOwnerFieldId: string | null;
  onFixed: () => void;
}) {
  const [targetFieldId, setTargetFieldId] = useState(ASSIGNEE_FIELD_ID);
  const [query, setQuery] = useState('');
  const [candidateResult, setCandidateResult] = useState<{ query: string; options: OwnerCandidate[] }>({ query: '', options: [] });
  const [selectedIdentifier, setSelectedIdentifier] = useState('');
  const { isSubmitting, errorMessage, successMessage, submitFix } = useFixSubmit(onFixed);

  // Derived, not synchronised: results only show for the query that produced them.
  const candidates = query.trim() !== '' && candidateResult.query === query ? candidateResult.options : [];

  useEffect(() => {
    if (query.trim() === '') return;
    let isActive = true;
    searchFeatureReviewUsers(query)
      .then((users) => {
        if (isActive) {
          setCandidateResult({ query, options: users.map((user) => ({ label: user.displayName, value: user.userIdentifier })) });
        }
      })
      .catch(() => { if (isActive) setCandidateResult({ query, options: [] }); });
    return () => { isActive = false; };
  }, [query]);

  return (
    <span className={styles.fixControl}>
      <span className={styles.fixLabel}>Owner:</span>
      {productOwnerFieldId && (
        <select
          className={styles.fixSelect}
          aria-label="Ownership target"
          value={targetFieldId}
          disabled={isSubmitting}
          onChange={(event) => setTargetFieldId(event.target.value)}
        >
          <option value={ASSIGNEE_FIELD_ID}>Assignee</option>
          <option value={productOwnerFieldId}>Product Owner</option>
        </select>
      )}
      <input
        className={styles.fixInput}
        type="text"
        aria-label="Search users for owner"
        placeholder="Search users…"
        value={query}
        disabled={isSubmitting}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        className={styles.fixSelect}
        aria-label="Owner candidate"
        value={selectedIdentifier}
        disabled={isSubmitting || candidates.length === 0}
        onChange={(event) => setSelectedIdentifier(event.target.value)}
      >
        <option value="">Choose owner…</option>
        {candidates.map((candidate) => (
          <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
        ))}
      </select>
      <FixButton
        disabled={isSubmitting || selectedIdentifier === ''}
        isSubmitting={isSubmitting}
        onClick={() => void submitFix(() => saveFeatureReviewUserField(feature.key, targetFieldId, selectedIdentifier))}
      />
      <FixStatus errorMessage={errorMessage} successMessage={successMessage} />
    </span>
  );
}

/** The shared Fix button. */
function FixButton({ disabled, isSubmitting, onClick }: { disabled: boolean; isSubmitting: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.fixButton} disabled={disabled} onClick={onClick}>
      {isSubmitting ? 'Saving…' : 'Fix'}
    </button>
  );
}

/** Fallback for an unconfigured field family: link out to Jira with an honest note. */
function OpenInJiraLink({ issueKey }: { issueKey: string }) {
  return (
    <span className={styles.fixControl}>
      <a className={styles.fixLink} href={`/browse/${encodeURIComponent(issueKey)}`} target="_blank" rel="noreferrer">
        Open in Jira ↗
      </a>
      <span className={styles.fixLabel}>not editable here — no matching field</span>
    </span>
  );
}
