// HygieneFixControl.tsx — Inline, per-flag "fix it here" control for the Hygiene view.
//
// Each Hygiene flag renders one of these next to its chip. The control looks up the flag's fix
// descriptor, resolves the target Jira field, and either offers an inline editor (delegating the
// actual write to the proven Feature Review fix helpers) or — for derived flags and unconfigured
// fields — a link out to Jira. Every write shows Jira's actual response and refreshes the finding.

import { useEffect, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import {
  fetchFeatureReviewEditMeta,
  fetchFeatureReviewFixVersions,
  fetchFeatureReviewTransitions,
  readFeatureReviewSelectOptions,
  readProjectKeyFromIssueKey,
  saveFeatureReviewFixVersion,
  saveFeatureReviewIssueLinkField,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewStoryPoints,
  saveFeatureReviewTransition,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
  type FeatureReviewEditMetaField,
  type FeatureReviewSelectOption,
} from '../SprintDashboard/featureReviewFixes.ts';
import type { HygieneFlag, HygieneFieldConfig, JiraIssue, BuiltInHygieneCheckId } from './checks/hygieneChecks.ts';
import { HYGIENE_FIX_BY_CHECK, resolveFixFieldId, type HygieneFixKind } from './hygieneFix.ts';
import styles from './HygieneView.module.css';

const RELATIVE_BROWSE_PREFIX = '/browse/';
const REST_PATH_MARKER = '/rest/';
const DERIVED_FLAG_NOTE = 'This flag is a derived condition — review and fix it in Jira.';
const UNCONFIGURED_FIELD_NOTE = 'This field is not configured for inline editing — open the issue in Jira.';
const FIX_SUCCESS_MESSAGE = 'Saved — Jira accepted the change.';
const ISSUE_SEARCH_MAX_RESULTS = 15;
// Kinds whose write targets a specific Jira field id; without a resolved id they must link out.
const FIELD_ID_REQUIRED_KINDS = new Set<HygieneFixKind>([
  'text',
  'date',
  'assignee',
  'feature',
  'parent',
  'select',
  'programIncrement',
]);

/** Props shared by the fix control and its inline editors. */
export interface HygieneFixControlProps {
  issue: JiraIssue;
  flag: HygieneFlag;
  fieldConfig: HygieneFieldConfig;
  /** Called after a successful write so the parent can rescan and clear the resolved flag. */
  onFixed: (issueKey: string) => void;
}

/** One picked option/candidate ready to be written back to Jira. */
interface FixChoiceOption {
  label: string;
  value: string;
}

/** Routes a flag to the right inline editor, or to an Open-in-Jira link when no inline fix applies. */
export function HygieneFixControl({ issue, flag, fieldConfig, onFixed }: HygieneFixControlProps) {
  const descriptor = HYGIENE_FIX_BY_CHECK[flag.checkId as BuiltInHygieneCheckId];
  if (!descriptor || descriptor.kind === 'openInJira') {
    return <OpenInJiraLink issue={issue} note={descriptor ? DERIVED_FLAG_NOTE : UNCONFIGURED_FIELD_NOTE} />;
  }

  const fieldId = resolveFixFieldId(descriptor, fieldConfig);
  if (FIELD_ID_REQUIRED_KINDS.has(descriptor.kind) && !fieldId) {
    return <OpenInJiraLink issue={issue} note={UNCONFIGURED_FIELD_NOTE} />;
  }

  return (
    <HygieneFixEditor issue={issue} kind={descriptor.kind} fieldId={fieldId ?? ''} label={descriptor.label} onFixed={onFixed} />
  );
}

/** Props for the concrete inline editor once a fix kind and target field are resolved. */
interface HygieneFixEditorProps {
  issue: JiraIssue;
  kind: HygieneFixKind;
  fieldId: string;
  label: string;
  onFixed: (issueKey: string) => void;
}

/** Owns the shared submit lifecycle (submitting flag, success/error message) for one inline fix. */
function HygieneFixEditor({ issue, kind, fieldId, label, onFixed }: HygieneFixEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Runs one Jira write, surfacing Jira's actual response (success text or caught error) and, on
  // success, asking the parent to refresh so the now-fixed flag disappears.
  async function submitFix(write: () => Promise<void>): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await write();
      setSuccessMessage(FIX_SUCCESS_MESSAGE);
      onFixed(issue.key);
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.fixControl}>
      <FixInput issue={issue} kind={kind} fieldId={fieldId} label={label} isSubmitting={isSubmitting} onSubmit={submitFix} />
      {successMessage && <span className={styles.fixSuccess}>{successMessage}</span>}
      {errorMessage && (
        <span className={styles.fixError} role="alert">
          {errorMessage}
        </span>
      )}
    </div>
  );
}

/** Props passed to every concrete input variant. */
interface FixInputProps {
  issue: JiraIssue;
  kind: HygieneFixKind;
  fieldId: string;
  label: string;
  isSubmitting: boolean;
  onSubmit: (write: () => Promise<void>) => Promise<void>;
}

/** Renders the input variant that matches the fix kind. */
function FixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  if (kind === 'assignee') {
    return <UserFixInput issue={issue} kind={kind} fieldId={fieldId} label={label} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
  }
  if (kind === 'feature' || kind === 'parent') {
    return <IssueLinkFixInput issue={issue} kind={kind} fieldId={fieldId} label={label} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
  }
  if (kind === 'fixVersion' || kind === 'select' || kind === 'programIncrement' || kind === 'transition') {
    return <OptionFixInput issue={issue} kind={kind} fieldId={fieldId} label={label} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
  }
  return <ValueFixInput issue={issue} kind={kind} fieldId={fieldId} label={label} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
}

/** Text, date, and story-points inputs — a single value field plus a Fix button. */
function ValueFixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [value, setValue] = useState('');
  const inputType = kind === 'date' ? 'date' : kind === 'storyPoints' ? 'number' : 'text';

  function writeValue(): Promise<void> {
    if (kind === 'storyPoints') {
      return saveFeatureReviewStoryPoints(issue.key, value);
    }
    return saveFeatureReviewSimpleField(issue.key, fieldId, value);
  }

  return (
    <>
      <input
        className={styles.fixInput}
        type={inputType}
        aria-label={label}
        value={value}
        disabled={isSubmitting}
        onChange={(changeEvent) => setValue(changeEvent.target.value)}
      />
      <FixButton label={label} disabled={isSubmitting || value.trim() === ''} isSubmitting={isSubmitting} onClick={() => void onSubmit(writeValue)} />
    </>
  );
}

/** Assignee / product-owner picker: search Jira users, pick one, then write the user field. */
function UserFixInput({ issue, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<FixChoiceOption[]>([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState('');

  useEffect(() => {
    let isActive = true;
    if (query.trim() === '') {
      setCandidates([]);
      return () => { isActive = false; };
    }
    searchFeatureReviewUsers(query)
      .then((users) => {
        if (isActive) setCandidates(users.map((user) => ({ label: user.displayName, value: user.userIdentifier })));
      })
      .catch(() => { if (isActive) setCandidates([]); });
    return () => { isActive = false; };
  }, [query]);

  return (
    <>
      <input
        className={styles.fixInput}
        type="text"
        aria-label={`Search users for ${label}`}
        placeholder="Search users…"
        value={query}
        disabled={isSubmitting}
        onChange={(changeEvent) => setQuery(changeEvent.target.value)}
      />
      <OptionSelect
        label={label}
        options={candidates}
        value={selectedIdentifier}
        disabled={isSubmitting || candidates.length === 0}
        onChange={setSelectedIdentifier}
      />
      <FixButton
        label={label}
        disabled={isSubmitting || selectedIdentifier === ''}
        isSubmitting={isSubmitting}
        onClick={() => void onSubmit(() => saveFeatureReviewUserField(issue.key, fieldId, selectedIdentifier))}
      />
    </>
  );
}

/** Feature-link / parent-link picker: search issues (Feature/Epic for feature links), pick a key. */
function IssueLinkFixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FixChoiceOption[]>([]);
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    let isActive = true;
    if (query.trim() === '') {
      setMatches([]);
      return () => { isActive = false; };
    }
    searchLinkableIssues(query, kind === 'feature', readProjectKeyFromIssueKey(issue.key))
      .then((issues) => { if (isActive) setMatches(issues); })
      .catch(() => { if (isActive) setMatches([]); });
    return () => { isActive = false; };
  }, [query, kind, issue.key]);

  return (
    <>
      <input
        className={styles.fixInput}
        type="text"
        aria-label={`Search issues for ${label}`}
        placeholder="Search issues…"
        value={query}
        disabled={isSubmitting}
        onChange={(changeEvent) => setQuery(changeEvent.target.value)}
      />
      <OptionSelect label={label} options={matches} value={selectedKey} disabled={isSubmitting || matches.length === 0} onChange={setSelectedKey} />
      <FixButton
        label={label}
        disabled={isSubmitting || selectedKey === ''}
        isSubmitting={isSubmitting}
        onClick={() => void onSubmit(() => saveFeatureReviewIssueLinkField(issue.key, fieldId, selectedKey))}
      />
    </>
  );
}

/** Fix version, select/option custom fields, program increment, and status transition dropdowns. */
function OptionFixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [options, setOptions] = useState<FixChoiceOption[]>([]);
  const [editMetaField, setEditMetaField] = useState<FeatureReviewEditMetaField | undefined>(undefined);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let isActive = true;
    loadOptionsForKind(kind, issue.key, fieldId)
      .then((loaded) => {
        if (!isActive) return;
        setOptions(loaded.options);
        setEditMetaField(loaded.editMetaField);
      })
      .catch(() => { if (isActive) setOptions([]); });
    return () => { isActive = false; };
  }, [kind, issue.key, fieldId]);

  function writeOption(): Promise<void> {
    if (kind === 'fixVersion') return saveFeatureReviewFixVersion(issue.key, selected);
    if (kind === 'transition') return saveFeatureReviewTransition(issue.key, selected);
    return saveFeatureReviewOptionField(issue.key, fieldId, selected, editMetaField);
  }

  return (
    <>
      <OptionSelect label={label} options={options} value={selected} disabled={isSubmitting || options.length === 0} onChange={setSelected} />
      <FixButton label={label} disabled={isSubmitting || selected === ''} isSubmitting={isSubmitting} onClick={() => void onSubmit(writeOption)} />
    </>
  );
}

/** A labelled dropdown of fix choices with a leading placeholder option. */
function OptionSelect({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: FixChoiceOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className={styles.fixSelect}
      aria-label={`${label} options`}
      value={value}
      disabled={disabled}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
    >
      <option value="">Choose…</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** The shared "Fix" submit button used by every inline editor. */
function FixButton({ label, disabled, isSubmitting, onClick }: { label: string; disabled: boolean; isSubmitting: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.fixButton} title={label} disabled={disabled} onClick={onClick}>
      {isSubmitting ? 'Saving…' : 'Fix'}
    </button>
  );
}

/** Renders an "Open in Jira" link for derived flags and fields that cannot be edited inline. */
function OpenInJiraLink({ issue, note }: { issue: JiraIssue; note: string }) {
  return (
    <span className={styles.fixOpenInJira}>
      <a className={styles.fixOpenInJiraLink} href={buildBrowseUrl(issue)} target="_blank" rel="noreferrer">
        Open in Jira ↗
      </a>
      <span className={styles.fixNote}>{note}</span>
    </span>
  );
}

/** Loads the dropdown choices for an option-style fix (fix version, select field, or transition). */
async function loadOptionsForKind(
  kind: HygieneFixKind,
  issueKey: string,
  fieldId: string,
): Promise<{ options: FixChoiceOption[]; editMetaField?: FeatureReviewEditMetaField }> {
  if (kind === 'fixVersion') {
    return { options: await fetchFeatureReviewFixVersions(readProjectKeyFromIssueKey(issueKey)) };
  }
  if (kind === 'transition') {
    const transitions = await fetchFeatureReviewTransitions(issueKey);
    return { options: transitions.map((transition) => ({ label: transition.name, value: transition.id })) };
  }
  const editMetaFields = await fetchFeatureReviewEditMeta(issueKey);
  const editMetaField = editMetaFields[fieldId];
  return { options: toFixChoiceOptions(readFeatureReviewSelectOptions(editMetaField)), editMetaField };
}

/** Normalizes Feature Review select options into the control's simpler choice shape. */
function toFixChoiceOptions(selectOptions: FeatureReviewSelectOption[]): FixChoiceOption[] {
  return selectOptions.map((selectOption) => ({ label: selectOption.label, value: selectOption.value }));
}

/** Searches Jira for issues that can be linked, restricting to Feature/Epic types for feature links. */
async function searchLinkableIssues(query: string, isFeatureLink: boolean, projectKey: string): Promise<FixChoiceOption[]> {
  const searchResponse = await jiraGet<{ issues?: Array<{ key: string; fields?: { summary?: string } }> }>(
    `/rest/api/2/search?jql=${encodeURIComponent(buildLinkSearchJql(query, isFeatureLink, projectKey))}&fields=summary&maxResults=${ISSUE_SEARCH_MAX_RESULTS}`,
  );
  return (searchResponse.issues ?? []).map((foundIssue) => ({
    label: `${foundIssue.key} — ${foundIssue.fields?.summary ?? ''}`.trim(),
    value: foundIssue.key,
  }));
}

/** Builds the JQL for a link search: match by key when the query looks like one, else by summary. */
function buildLinkSearchJql(query: string, isFeatureLink: boolean, projectKey: string): string {
  const trimmedQuery = query.trim();
  const issueTypeClause = isFeatureLink ? 'issuetype in (Feature, Epic) AND ' : '';
  const projectClause = projectKey ? `project = ${projectKey} AND ` : '';
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(trimmedQuery)) {
    return `${issueTypeClause}key = ${trimmedQuery.toUpperCase()}`;
  }
  const escapedQuery = trimmedQuery.replace(/"/g, '\\"');
  return `${projectClause}${issueTypeClause}summary ~ "${escapedQuery}" ORDER BY updated DESC`;
}

/** Derives the Jira browse URL for an issue from its `self` link, falling back to a relative path. */
function buildBrowseUrl(issue: JiraIssue): string {
  const restIndex = issue.self ? issue.self.indexOf(REST_PATH_MARKER) : -1;
  if (issue.self && restIndex > 0) {
    return `${issue.self.slice(0, restIndex)}${RELATIVE_BROWSE_PREFIX}${issue.key}`;
  }
  return `${RELATIVE_BROWSE_PREFIX}${issue.key}`;
}
