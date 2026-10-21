// PrbSteps.tsx — The five screens of "Turn a problem into Jira work". Each draws state it is handed and calls back;
// none keeps state of its own, so Back never loses an entry.

import type { FormEvent, ReactNode } from 'react';

import type { JiraProject } from '../../types/jira.ts';
import shellStyles from '../shell/WizardShell.module.css';
import type { PrbCreateFailure, PrbCreateProgress, PrbCreateResult } from './prbJiraCreate.ts';
import { MISSING_DESCRIPTION_TEXT, PRB_JIRA_ROLES, PRB_ROLE_NAMES, type PrbJiraDraft, type PrbJiraRole } from './prbJiraPlan.ts';
import type { EpicSearchResult, PrbSearchResult } from './prbLookups.ts';
import styles from './PrbWizard.module.css';
import type { ExistingWorkCheck, LoadedList, PrbDraftEdit } from './usePrbWizardState.ts';

// ── Shared pieces ──

/** A link that opens one Jira issue in a new tab. */
function JiraKeyLink({ jiraUrl, issueKey }: { jiraUrl: string; issueKey: string }) {
  return <a href={`${jiraUrl}/browse/${encodeURIComponent(issueKey)}`} target="_blank" rel="noreferrer">{issueKey}</a>;
}

/** The one line under a list that says what the read is doing, or why it is empty. */
function ListStatus({ list, emptyText, failedText }: { list: LoadedList<unknown>; emptyText: string; failedText: string }) {
  if (list.status === 'loading') return <p className={shellStyles.hint} role="status">Searching…</p>;
  if (list.status === 'failed') return <p className={shellStyles.hint} role="alert">{failedText}</p>;
  if (list.status === 'ready' && list.items.length === 0) return <p className={shellStyles.hint}>{emptyText}</p>;
  return null;
}

interface SearchBoxProps {
  inputId: string;
  label: string;
  searchText: string;
  onSearchTextChange: (searchText: string) => void;
  onSearch: (searchText: string) => void;
}

/** A labelled search box whose Enter key and Search button do the same thing. */
function SearchBox({ inputId, label, searchText, onSearchTextChange, onSearch }: SearchBoxProps) {
  function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    onSearch(searchText);
  }
  return (
    <form onSubmit={handleSubmit}>
      <label className={shellStyles.fieldLabel} htmlFor={inputId}>{label}</label>
      <div className={styles.searchRow}>
        <input id={inputId} className={shellStyles.inputField} value={searchText} onChange={(changeEvent) => onSearchTextChange(changeEvent.target.value)} />
        <button type="submit" className={shellStyles.secondaryButton}>Search</button>
      </div>
    </form>
  );
}

interface PickListProps<Item> {
  label: string;
  items: Item[];
  readKey: (item: Item) => string;
  readText: (item: Item) => ReactNode;
  chosenKey: string | undefined;
  onChoose: (item: Item) => void;
}

/** Search results as large buttons; the chosen one stays pressed. */
function PickList<Item>({ label, items, readKey, readText, chosenKey, onChoose }: PickListProps<Item>) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.pickList} aria-label={label}>
      {items.map((item) => (
        <li key={readKey(item)}>
          <button type="button" className={styles.pickButton} aria-pressed={readKey(item) === chosenKey} onClick={() => onChoose(item)}>
            {readText(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Step 1: find ──

/** What the find screen needs. */
export interface PrbFindStepProps {
  searchText: string;
  problemSearch: LoadedList<PrbSearchResult>;
  chosenProblem: PrbSearchResult | null;
  onSearchTextChange: (searchText: string) => void;
  onSearch: (searchText: string) => void;
  onChoose: (problem: PrbSearchResult) => void;
}

/** Step 1: search ServiceNow problems by number or words, and choose one. */
export function PrbFindStep(props: PrbFindStepProps) {
  return (
    <div className={shellStyles.card}>
      <SearchBox inputId="prb-search" label="Problem number or words" searchText={props.searchText} onSearchTextChange={props.onSearchTextChange} onSearch={props.onSearch} />
      <ListStatus list={props.problemSearch} emptyText="No problems match. Try other words." failedText="ServiceNow could not be searched. Check the connection and search again." />
      <PickList
        label="Problems found"
        items={props.problemSearch.items}
        readKey={(problem) => problem.number}
        readText={(problem) => `${problem.number} — ${problem.shortDescription} (${problem.stateLabel})`}
        chosenKey={props.chosenProblem?.number}
        onChoose={props.onChoose}
      />
    </div>
  );
}

// ── Step 2: confirm ──

/** What the confirm screen needs. */
export interface PrbConfirmStepProps {
  problem: PrbSearchResult;
  existingWork: ExistingWorkCheck;
  isNewSetConfirmed: boolean;
  jiraUrl: string;
  onConfirmNewSet: (isConfirmed: boolean) => void;
  onRetryCheck: () => void;
}

function ExistingWorkList({ progress, jiraUrl }: { progress: PrbCreateProgress; jiraUrl: string }) {
  return (
    <ul className={styles.resultList} aria-label="Work already in Jira">
      {PRB_JIRA_ROLES.filter((role) => progress.createdKeys[role]).map((role) => (
        <li key={role}>{PRB_ROLE_NAMES[role]}: <JiraKeyLink jiraUrl={jiraUrl} issueKey={progress.createdKeys[role] as string} /></li>
      ))}
    </ul>
  );
}

function ExistingWorkPanel(props: PrbConfirmStepProps) {
  const { existingWork } = props;
  if (existingWork.status === 'checking' || existingWork.status === 'idle') return <p className={shellStyles.hint} role="status">Checking Jira for work already made…</p>;
  if (existingWork.status === 'failed') {
    return (
      <div className={styles.attention} role="alert">
        <p>Jira could not be checked for work already made for this problem.</p>
        <p>If the Jira tab was closed, press <strong>Connect Jira again</strong> at the top first, then Try again.</p>
        <button type="button" className={shellStyles.secondaryButton} onClick={props.onRetryCheck}>Try again</button>
      </div>
    );
  }
  if (!Object.values(existingWork.progress.createdKeys).some(Boolean)) return <p className={shellStyles.hint}>Jira has no work for this problem yet.</p>;
  return (
    <div className={styles.attention}>
      <p>Jira already has work for this problem. Next fills in only what is missing.</p>
      <ExistingWorkList progress={existingWork.progress} jiraUrl={props.jiraUrl} />
      <label className={styles.checkboxLine}>
        <input type="checkbox" checked={props.isNewSetConfirmed} onChange={(changeEvent) => props.onConfirmNewSet(changeEvent.target.checked)} />
        <span>Make a brand-new set anyway — this makes a second Defect for the same problem</span>
      </label>
    </div>
  );
}

/** Step 2: the problem's full detail, and any Jira work already made for it. */
export function PrbConfirmStep(props: PrbConfirmStepProps) {
  const { problem } = props;
  return (
    <div className={shellStyles.card}>
      <dl className={styles.detailList}>
        <dt>Number</dt><dd>{problem.number}</dd>
        <dt>Short description</dt><dd>{problem.shortDescription}</dd>
        <dt>State</dt><dd>{problem.stateLabel}</dd>
        <dt>Description</dt><dd>{problem.description.trim() || 'No description'}</dd>
      </dl>
      <ExistingWorkPanel {...props} />
    </div>
  );
}

// ── Step 3: place ──

/** What the place screen needs. */
export interface PrbPlaceStepProps {
  projectList: LoadedList<JiraProject>;
  projectKey: string;
  epicSearchText: string;
  epicSearch: LoadedList<EpicSearchResult>;
  chosenEpic: EpicSearchResult | null;
  onChooseProject: (projectKey: string) => void;
  onRetryProjects: () => void;
  onEpicSearchTextChange: (searchText: string) => void;
  onEpicSearch: (searchText: string) => void;
  onChooseEpic: (epic: EpicSearchResult) => void;
}

function ProjectPicker(props: PrbPlaceStepProps) {
  if (props.projectList.status === 'failed') {
    return (
      <div className={styles.attention} role="alert">
        <p>Jira&apos;s project list could not be read.</p>
        <button type="button" className={shellStyles.secondaryButton} onClick={props.onRetryProjects}>Try again</button>
      </div>
    );
  }
  const isLoading = props.projectList.status !== 'ready';
  return (
    <>
      <label className={shellStyles.fieldLabel} htmlFor="prb-project">Jira project</label>
      <select id="prb-project" className={shellStyles.inputField} value={props.projectKey} disabled={isLoading} onChange={(changeEvent) => props.onChooseProject(changeEvent.target.value)}>
        <option value="" disabled>{isLoading ? 'Loading projects…' : '— Choose a project —'}</option>
        {props.projectList.items.map((project) => <option key={project.key} value={project.key}>{`${project.name} (${project.key})`}</option>)}
      </select>
    </>
  );
}

/** Step 3: the one Jira project all three items go in, and the Epic they all sit on. */
export function PrbPlaceStep(props: PrbPlaceStepProps) {
  return (
    <div className={shellStyles.card}>
      <ProjectPicker {...props} />
      <SearchBox inputId="prb-epic-search" label="Search for the Epic (words or its key)" searchText={props.epicSearchText} onSearchTextChange={props.onEpicSearchTextChange} onSearch={props.onEpicSearch} />
      <ListStatus list={props.epicSearch} emptyText="No open Epics match. Try other words." failedText="Jira could not be searched. Check the connection and search again." />
      <PickList
        label="Epics found"
        items={props.epicSearch.items}
        readKey={(epic) => epic.key}
        readText={(epic) => `${epic.key} — ${epic.summary} (${epic.statusName})`}
        chosenKey={props.chosenEpic?.key}
        onChoose={props.onChooseEpic}
      />
      {props.chosenEpic ? <p className={shellStyles.hint}>{`Chosen Epic: ${props.chosenEpic.key} — ${props.chosenEpic.summary}`}</p> : null}
    </div>
  );
}

// ── Step 4: drafts ──

/** What the drafts screen needs. */
export interface PrbDraftsStepProps {
  drafts: PrbJiraDraft[];
  onEdit: (role: PrbJiraRole, edit: PrbDraftEdit) => void;
}

function DraftCard({ draft, onEdit }: { draft: PrbJiraDraft; onEdit: PrbDraftsStepProps['onEdit'] }) {
  const isGapStillOpen = draft.isSourceDescriptionMissing && draft.description.includes(MISSING_DESCRIPTION_TEXT);
  return (
    <div className={shellStyles.card}>
      <h3 className={shellStyles.cardTitle}>{`${PRB_ROLE_NAMES[draft.role]} (${draft.issueTypeName})`}</h3>
      <label className={shellStyles.fieldLabel} htmlFor={`prb-${draft.role}-summary`}>Summary</label>
      <input id={`prb-${draft.role}-summary`} className={shellStyles.inputField} value={draft.summary} onChange={(changeEvent) => onEdit(draft.role, { summary: changeEvent.target.value })} />
      <label className={shellStyles.fieldLabel} htmlFor={`prb-${draft.role}-description`}>Description</label>
      <textarea id={`prb-${draft.role}-description`} className={`${shellStyles.inputField} ${styles.textArea}`} value={draft.description} onChange={(changeEvent) => onEdit(draft.role, { description: changeEvent.target.value })} />
      {isGapStillOpen ? <p className={styles.attention}>The problem has no description — replace the highlighted line with what you know.</p> : null}
    </div>
  );
}

/** Step 4: the three ready-to-create items, each editable; what is shown is what gets created. */
export function PrbDraftsStep({ drafts, onEdit }: PrbDraftsStepProps) {
  const firstDraft = drafts[0];
  return (
    <div>
      {firstDraft ? <p className={shellStyles.hint}>{`All three go in ${firstDraft.projectKey} on Epic ${firstDraft.epicKey}. Both stories are linked to the Defect.`}</p> : null}
      {drafts.map((draft) => <DraftCard key={draft.role} draft={draft} onEdit={onEdit} />)}
    </div>
  );
}

// ── Step 5: result ──

/** What the result screen needs. */
export interface PrbResultStepProps {
  isCreating: boolean;
  createResult: PrbCreateResult | null;
  jiraUrl: string;
  onRetry: () => void;
}

function describeFailure(failure: PrbCreateFailure): string {
  const roleName = PRB_ROLE_NAMES[failure.role];
  if (failure.stage === 'link') return `${roleName} was made but not linked to the Defect — ${failure.message}`;
  return `${roleName} was not created — ${failure.message}`;
}

function ResultItem({ role, result, jiraUrl }: { role: PrbJiraRole; result: PrbCreateResult; jiraUrl: string }) {
  const issueKey = result.progress.createdKeys[role];
  const failures = result.failures.filter((failure) => failure.role === role);
  return (
    <li className={styles.resultItem} data-outcome={issueKey && failures.length === 0 ? 'done' : 'failed'}>
      {issueKey ? <>{`${PRB_ROLE_NAMES[role]}: `}<JiraKeyLink jiraUrl={jiraUrl} issueKey={issueKey} /></> : PRB_ROLE_NAMES[role]}
      {failures.map((failure) => <p key={failure.stage} className={shellStyles.hint}>{describeFailure(failure)}</p>)}
    </li>
  );
}

/** Step 5: the three keys as links, or exactly what failed with "Retry the rest". */
export function PrbResultStep({ isCreating, createResult, jiraUrl, onRetry }: PrbResultStepProps) {
  if (isCreating || !createResult) return <p className={shellStyles.hint} role="status">Creating the items in Jira…</p>;
  return (
    <div className={shellStyles.card}>
      <p className={shellStyles.connectionLine}>
        {createResult.isComplete ? 'All three items are in Jira, on the Epic, and both stories are linked to the Defect.' : 'Some of the work did not finish.'}
      </p>
      <ul className={styles.resultList} aria-label="What was made">
        {PRB_JIRA_ROLES.map((role) => <ResultItem key={role} role={role} result={createResult} jiraUrl={jiraUrl} />)}
      </ul>
      {createResult.isComplete ? null : <button type="button" className={shellStyles.primaryButton} onClick={onRetry}>Retry the rest</button>}
    </div>
  );
}
