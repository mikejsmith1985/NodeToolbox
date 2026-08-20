// HygieneFixControl.tsx — Inline, per-flag "fix it here" control for the Hygiene view.
//
// Each Hygiene flag renders one of these next to its chip. The control looks up the flag's fix
// descriptor, resolves the target Jira field, and either offers an inline editor (delegating the
// actual write to the proven Feature Review fix helpers) or — for derived flags and unconfigured
// fields — a link out to Jira. Every write shows Jira's actual response and refreshes the finding.

import { useEffect, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { TransitionRequiredFields } from '../../components/TransitionRequiredFields/index.tsx';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
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
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../SprintDashboard/featureReviewFixes.ts';
import { HYGIENE_STORY_POINTS_FIELD_ID } from './checks/hygieneChecks.ts';
import type { HygieneFlag, HygieneFieldConfig, JiraIssue, BuiltInHygieneCheckId } from './checks/hygieneChecks.ts';
import { HYGIENE_FIX_BY_CHECK, resolveFixFieldId, type HygieneFixKind } from './hygieneFix.ts';
import { applyDerivedDates, planDerivedDateWrites, type DerivedDatePlan } from './derivedDateFix.ts';
import { applyInheritedFeatureLink, planInheritedFeatureLink } from './featureLinkInheritFix.ts';
import type { InheritedFeatureLinkChoice } from './featureLinkInheritance.ts';
import styles from './HygieneView.module.css';

const RELATIVE_BROWSE_PREFIX = '/browse/';
const REST_PATH_MARKER = '/rest/';
const DERIVED_FLAG_NOTE = 'This flag is a derived condition — review and fix it in Jira.';
const UNCONFIGURED_FIELD_NOTE = 'This field is not configured for inline editing — open the issue in Jira.';
// Shown when a dropdown-style fix loads with no choices (Jira offers no allowed values for the field
// on this instance): a greyed, empty dropdown is a dead end, so we link out to Jira instead.
const OPTIONLESS_FIELD_NOTE = 'No selectable options for this field here — set it in Jira.';
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

/** A settled option load tagged with the request (kind|issue|field) it answers, so stale loads are ignored. */
interface LoadedOptionState {
  requestKey: string;
  options: FixChoiceOption[];
  editMetaField?: FeatureReviewEditMetaField;
  requiredFieldsByTransitionId: Record<string, TransitionRequiredField[]>;
}

/** Routes a flag to the right inline editor, or to an Open-in-Jira link when no inline fix applies. */
export function HygieneFixControl({ issue, flag, fieldConfig, onFixed }: HygieneFixControlProps) {
  const descriptor = HYGIENE_FIX_BY_CHECK[flag.checkId as BuiltInHygieneCheckId];
  if (!descriptor || descriptor.kind === 'openInJira') {
    return <OpenInJiraLink issue={issue} note={descriptor ? DERIVED_FLAG_NOTE : UNCONFIGURED_FIELD_NOTE} />;
  }

  // The derived-dates fix needs the whole field config rather than one target field: it writes three
  // fields at once, and works out their values instead of taking them from an input.
  if (descriptor.kind === 'derivedDates') {
    return <DerivedDatesFixInput issue={issue} fieldConfig={fieldConfig} onFixed={onFixed} />;
  }

  const fieldId = resolveFixFieldId(descriptor, fieldConfig);
  if (FIELD_ID_REQUIRED_KINDS.has(descriptor.kind) && !fieldId) {
    return <OpenInJiraLink issue={issue} note={UNCONFIGURED_FIELD_NOTE} />;
  }

  // A flag whose rule names two remedies renders both, side by side, in the order the rule states
  // them: move the work forward, or move the date.
  const alternateFieldId = descriptor.alternateFix
    ? resolveFixFieldId(descriptor.alternateFix, fieldConfig)
    : null;
  const hasUsableAlternate = descriptor.alternateFix !== undefined
    && (!FIELD_ID_REQUIRED_KINDS.has(descriptor.alternateFix.kind) || alternateFieldId !== null);

  return (
    <>
      <HygieneFixEditor issue={issue} kind={descriptor.kind} fieldId={fieldId ?? ''} label={descriptor.label} onFixed={onFixed} />
      {hasUsableAlternate && descriptor.alternateFix ? (
        <HygieneFixEditor
          issue={issue}
          kind={descriptor.alternateFix.kind}
          fieldId={alternateFieldId ?? ''}
          label={descriptor.alternateFix.label}
          onFixed={onFixed}
        />
      ) : null}
    </>
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
      {/* Every fix input carries a VISIBLE label naming what it writes (spec 019 FR-015). */}
      <span className={styles.fixLabel}>{label}:</span>
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

/**
 * The derived-dates fix: no input, because the dates follow from the fix version.
 *
 * It SHOWS what it will write before it writes it. A control that silently sets three dates on
 * somebody's ticket is not a fix, it is a surprise — and the one thing this must never be is a
 * button whose effect you learn afterwards.
 */
function DerivedDatesFixInput({
  issue,
  fieldConfig,
  onFixed,
}: {
  issue: JiraIssue;
  fieldConfig: HygieneFieldConfig;
  onFixed: (issueKey: string) => void;
}) {
  const [plan, setPlan] = useState<DerivedDatePlan | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void planDerivedDateWrites(issue, fieldConfig)
      .then((loadedPlan) => { if (isMounted) setPlan(loadedPlan); })
      .catch(() => { if (isMounted) setPlan({ issueKey: issue.key, writes: [], undecidedReasons: ['could not read the issue'] }); });
    return () => { isMounted = false; };
  }, [issue, fieldConfig]);

  if (plan === null) {
    return <span className={styles.fixNote}>Working out the dates…</span>;
  }
  if (plan.writes.length === 0) {
    return <span className={styles.fixNote}>{plan.undecidedReasons.join('; ') || 'Dates already match the release.'}</span>;
  }

  async function applyPlan(): Promise<void> {
    if (plan === null) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const outcome = await applyDerivedDates([issue], fieldConfig);
      if (outcome.failures.length > 0) {
        setApplyError(outcome.failures[0].reason);
        return;
      }
      onFixed(issue.key);
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <span className={styles.fixRow}>
      <span className={styles.fixNote}>
        {plan.writes.map((write) => `${write.fieldName} → ${write.value}`).join(', ')}
      </span>
      <button className={styles.fixButton} disabled={isApplying} type="button" onClick={() => void applyPlan()}>
        {isApplying ? 'Applying…' : 'Apply'}
      </button>
      {applyError && <span className={styles.fixError}>{applyError}</span>}
    </span>
  );
}

/** Text, date, and story-points inputs — a single value field plus a Fix button. */
function ValueFixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [value, setValue] = useState('');
  const inputType = kind === 'date' ? 'date' : kind === 'storyPoints' ? 'number' : 'text';

  function writeValue(): Promise<void> {
    if (kind === 'storyPoints') {
      // Same pinning as the AI apply path: the inline Fix must write where this view reads, or it
      // reports success and leaves the flag standing.
      return saveFeatureReviewStoryPoints(issue.key, value, HYGIENE_STORY_POINTS_FIELD_ID);
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
  // Results are kept with the query that produced them, so a result can never be shown against a
  // query it does not answer.
  const [candidateResult, setCandidateResult] = useState<{ query: string; options: FixChoiceOption[] }>({ query: '', options: [] });
  const [selectedIdentifier, setSelectedIdentifier] = useState('');

  // Derived rather than synchronised. An empty box has no candidates, and the previous query's
  // results are not this query's — so no effect has to clear them, and none can linger while a newer
  // search is still in flight (which they briefly did when the results were plain state).
  const candidates = query.trim() !== '' && candidateResult.query === query ? candidateResult.options : [];

  useEffect(() => {
    if (query.trim() === '') {
      return; // Nothing to search for; `candidates` is already empty by derivation.
    }
    let isActive = true;
    searchFeatureReviewUsers(query)
      .then((users) => {
        if (isActive) setCandidateResult({ query, options: users.map((user) => ({ label: user.displayName, value: user.userIdentifier })) });
      })
      .catch(() => { if (isActive) setCandidateResult({ query, options: [] }); });
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
        placeholder={searchDrivenPlaceholder(query, candidates.length, 'name')}
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
  // Kept with the query that produced them - see the note in UserFixInput.
  const [matchResult, setMatchResult] = useState<{ query: string; options: FixChoiceOption[] }>({ query: '', options: [] });
  const [selectedKey, setSelectedKey] = useState('');

  const matches = query.trim() !== '' && matchResult.query === query ? matchResult.options : [];

  useEffect(() => {
    if (query.trim() === '') {
      return; // Nothing to search for; `matches` is already empty by derivation.
    }
    let isActive = true;
    searchLinkableIssues(query, kind === 'feature', readProjectKeyFromIssueKey(issue.key))
      .then((issues) => { if (isActive) setMatchResult({ query, options: issues }); })
      .catch(() => { if (isActive) setMatchResult({ query, options: [] }); });
    return () => { isActive = false; };
  }, [query, kind, issue.key]);

  return (
    <>
      {kind === 'feature' && (
        <InheritFeatureLinkButton
          issue={issue}
          fieldId={fieldId}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />
      )}
      <input
        className={styles.fixInput}
        type="text"
        aria-label={`Search issues for ${label}`}
        placeholder="Search issues…"
        value={query}
        disabled={isSubmitting}
        onChange={(changeEvent) => setQuery(changeEvent.target.value)}
      />
      <OptionSelect
        label={label}
        options={matches}
        value={selectedKey}
        disabled={isSubmitting || matches.length === 0}
        onChange={setSelectedKey}
        placeholder={searchDrivenPlaceholder(query, matches.length, 'search term')}
      />
      <FixButton
        label={label}
        disabled={isSubmitting || selectedKey === ''}
        isSubmitting={isSubmitting}
        onClick={() => void onSubmit(() => saveFeatureReviewIssueLinkField(issue.key, fieldId, selectedKey))}
      />
    </>
  );
}

/**
 * Copies the Feature link from a linked story in the same project.
 *
 * The team splits work into a [DEV] story and an [SL] test story, links them, and puts the Feature
 * link on the DEV one — so the SL story sits flagged while the answer is one field away on an issue
 * it is already linked to. The AI panel is no help here and never will be: a Feature link is a
 * lookup, not a judgement, and a model offered that question could only guess.
 *
 * It states the value BEFORE writing (the derived-dates control's rule), and refuses rather than
 * choosing when linked issues name different Features.
 */
function InheritFeatureLinkButton({ issue, fieldId, isSubmitting, onSubmit }: {
  issue: JiraIssue;
  fieldId: string;
  isSubmitting: boolean;
  onSubmit: (write: () => Promise<void>) => Promise<void>;
}) {
  const [plan, setPlan] = useState<InheritedFeatureLinkChoice | null>(null);

  useEffect(() => {
    let isActive = true;
    planInheritedFeatureLink(issue, fieldId)
      .then((foundPlan) => { if (isActive) setPlan(foundPlan); })
      .catch(() => { if (isActive) setPlan(null); });
    return () => { isActive = false; };
  }, [issue, fieldId]);

  // Nothing to inherit is the ordinary case, and an always-present disabled button beside every
  // Feature-link flag would be noise on the issues it can never help.
  if (plan === null || plan.featureLinkValue === null) {
    return null;
  }

  return (
    <span className={styles.fixNote}>
      <button
        type="button"
        className={styles.fixButton}
        disabled={isSubmitting}
        title={`Copy ${plan.featureLinkValue} from linked issue ${plan.sourceIssueKey}`}
        onClick={() => void onSubmit(async () => { await applyInheritedFeatureLink(issue, fieldId); })}
      >
        {isSubmitting ? 'Saving…' : `Copy ${plan.featureLinkValue} from ${plan.sourceIssueKey}`}
      </button>
    </span>
  );
}

/** Fix version, select/option custom fields, program increment, and status transition dropdowns. */
function OptionFixInput({ issue, kind, fieldId, label, isSubmitting, onSubmit }: FixInputProps) {
  const [selected, setSelected] = useState('');
  // The settled option load, TAGGED with the request it answers. Deriving "loaded"/"options" from
  // this tag (rather than resetting state inside the effect) keeps the effect free of synchronous
  // setState and prevents a stale load being shown against a newer request (the useReadinessData
  // pattern, react-hooks/set-state-in-effect).
  const [loadedOptions, setLoadedOptions] = useState<LoadedOptionState | null>(null);
  // Transitions only: the user's answers for the fields each transition's workflow screen requires —
  // posting the bare id 400s when the workflow demands them (GH #177 follow-up).
  const [transitionFieldSelections, setTransitionFieldSelections] = useState<Record<string, TransitionFieldSelection>>({});

  const requestKey = `${kind}|${issue.key}|${fieldId}`;
  useEffect(() => {
    let isActive = true;
    loadOptionsForKind(kind, issue.key, fieldId)
      .then((loaded) => {
        if (isActive) setLoadedOptions({ requestKey, options: loaded.options, editMetaField: loaded.editMetaField, requiredFieldsByTransitionId: loaded.requiredFieldsByTransitionId ?? {} });
      })
      .catch(() => { if (isActive) setLoadedOptions({ requestKey, options: [], requiredFieldsByTransitionId: {} }); });
    return () => { isActive = false; };
  }, [kind, issue.key, fieldId, requestKey]);

  // Only trust a settled load that answers THIS request; a load for a previous request is stale.
  const hasLoadedOptions = loadedOptions?.requestKey === requestKey;
  const options = hasLoadedOptions ? loadedOptions.options : [];
  const editMetaField = hasLoadedOptions ? loadedOptions.editMetaField : undefined;
  const requiredFieldsByTransitionId = hasLoadedOptions ? loadedOptions.requiredFieldsByTransitionId : {};

  const selectedTransitionRequiredFields = kind === 'transition' ? (requiredFieldsByTransitionId[selected] ?? []) : [];
  const areRequiredAnswersComplete = selectedTransitionRequiredFields.length === 0
    || areTransitionSelectionsComplete(selectedTransitionRequiredFields, transitionFieldSelections);

  function handleSelectOption(nextSelected: string): void {
    setSelected(nextSelected);
    // A different transition has different required fields — stale answers must not carry over.
    setTransitionFieldSelections({});
  }

  function writeOption(): Promise<void> {
    if (kind === 'fixVersion') return saveFeatureReviewFixVersion(issue.key, selected);
    if (kind === 'transition') {
      return saveFeatureReviewTransition(
        issue.key,
        selected,
        buildTransitionFieldsPayload(selectedTransitionRequiredFields, transitionFieldSelections),
      );
    }
    return saveFeatureReviewOptionField(issue.key, fieldId, selected, editMetaField);
  }

  // A dropdown Jira gives no choices for is a dead end — offer the working Jira link instead of a
  // permanently greyed, empty control (the "nothing shows / nothing happens" report).
  if (hasLoadedOptions && options.length === 0) {
    return <OpenInJiraLink issue={issue} note={OPTIONLESS_FIELD_NOTE} />;
  }

  return (
    <>
      <OptionSelect label={label} options={options} value={selected} disabled={isSubmitting || options.length === 0} onChange={handleSelectOption} />
      <TransitionRequiredFields
        requiredFields={selectedTransitionRequiredFields}
        selectionByFieldId={transitionFieldSelections}
        isDisabled={isSubmitting}
        onSelectionChange={(requiredFieldId, selection) =>
          setTransitionFieldSelections((currentSelections) => ({ ...currentSelections, [requiredFieldId]: selection }))}
      />
      <FixButton
        label={label}
        disabled={isSubmitting || selected === '' || !areRequiredAnswersComplete}
        isSubmitting={isSubmitting}
        onClick={() => void onSubmit(writeOption)}
      />
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
  placeholder,
}: {
  label: string;
  options: FixChoiceOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Overrides the leading option text — used to explain a disabled, search-driven dropdown. */
  placeholder?: string;
}) {
  return (
    <select
      className={styles.fixSelect}
      aria-label={`${label} options`}
      value={value}
      disabled={disabled}
      onChange={(changeEvent) => onChange(changeEvent.target.value)}
    >
      <option value="">{placeholder ?? `Choose ${label.toLowerCase()}…`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Guidance text for a search-driven dropdown that stays empty (and disabled) until the user types a
 * query. Without it the greyed control reads as broken ("nothing happens when clicked"); this tells
 * the user to type in the adjacent search box first.
 */
function searchDrivenPlaceholder(query: string, resultCount: number, subject: string): string {
  // Says WHICH box to type in rather than where it sits: the search input is beside this dropdown,
  // not above it, and "above" sent people looking in the wrong place.
  if (query.trim() === '') return `Type a ${subject} in the search box to see matches`;
  if (resultCount === 0) return `No matches for that ${subject}`;
  return 'Choose from the results';
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
): Promise<{
  options: FixChoiceOption[];
  editMetaField?: FeatureReviewEditMetaField;
  requiredFieldsByTransitionId?: Record<string, TransitionRequiredField[]>;
}> {
  if (kind === 'fixVersion') {
    return { options: await fetchFeatureReviewFixVersions(readProjectKeyFromIssueKey(issueKey)) };
  }
  if (kind === 'transition') {
    const transitions = await fetchFeatureReviewTransitions(issueKey);
    return {
      options: transitions.map((transition) => ({ label: transition.name, value: transition.id })),
      requiredFieldsByTransitionId: Object.fromEntries(
        transitions.map((transition) => [transition.id, transition.requiredFields]),
      ),
    };
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
export function buildLinkSearchJql(query: string, isFeatureLink: boolean, projectKey: string): string {
  const trimmedQuery = query.trim();
  const issueTypeClause = isFeatureLink ? 'issuetype in (Feature, Epic) AND ' : '';
  // A FEATURE never lives in the team's own project — that separation is the whole reason a Feature
  // Link field exists. Constraining the search to the issue's project meant a Feature search could
  // never match anything, whatever was typed. A parent link IS same-project, so it keeps the clause.
  const projectClause = projectKey && !isFeatureLink ? `project = ${projectKey} AND ` : '';
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
