// PrbTab.tsx — PRB-to-Jira issue generator tab for turning ServiceNow problems into paired Jira issues.

import { useState, type ChangeEvent } from 'react';

import { usePrbState } from '../hooks/usePrbState.ts';
import PrbWizard from './PrbWizard.tsx';
import styles from './PrbTab.module.css';

const TAB_TITLE = 'PRB Generator';
const TAB_SUBTITLE = 'Load a ServiceNow problem record, review the details, and create paired Jira issues.';
const LOAD_SECTION_TITLE = 'Load PRB';
const ISSUE_SECTION_TITLE = 'Create Jira Issues';
const ISSUE_PREVIEW_SECTION_TITLE = 'Issue Preview';
const EMPTY_ASSIGNEE_LABEL = 'Unassigned';
const EMPTY_INCIDENT_LABEL = 'No linked incident found';
const SUCCESS_SECTION_TITLE = 'Created Jira Issues';

type PrbMode = 'quick' | 'wizard';

type PrbHookResult = ReturnType<typeof usePrbState>;
type PrbStateData = PrbHookResult['state'];
type PrbActionSet = PrbHookResult['actions'];

interface DetailCardProps {
  state: PrbStateData;
}

interface IssueFormProps {
  state: PrbStateData;
  actions: PrbActionSet;
}

function renderAssignedUserName(state: PrbStateData): string {
  return state.prbData?.assignedTo?.name ?? EMPTY_ASSIGNEE_LABEL;
}

function renderIncidentNumber(state: PrbStateData): string {
  return state.prbData?.incidentNumber || EMPTY_INCIDENT_LABEL;
}

function PrbDetailCard({ state }: DetailCardProps) {
  if (!state.prbData) {
    return null;
  }

  return (
    <article className={styles.detailCard}>
      <div className={styles.detailGrid}>
        <div><span className={styles.detailLabel}>Number</span><p className={styles.detailValue}>{state.prbData.number}</p></div>
        <div><span className={styles.detailLabel}>Incident</span><p className={styles.detailValue}>{renderIncidentNumber(state)}</p></div>
        <div><span className={styles.detailLabel}>State</span><p className={styles.detailValue}>{state.prbData.state}</p></div>
        <div><span className={styles.detailLabel}>Severity</span><p className={styles.detailValue}>{state.prbData.severity}</p></div>
        <div><span className={styles.detailLabel}>Assigned To</span><p className={styles.detailValue}>{renderAssignedUserName(state)}</p></div>
      </div>
      <div className={styles.detailStack}>
        <div><span className={styles.detailLabel}>Short Description</span><p className={styles.detailValue}>{state.prbData.shortDescription}</p></div>
        <div><span className={styles.detailLabel}>Description</span><p className={styles.detailValue}>{state.prbData.description}</p></div>
      </div>
    </article>
  );
}

interface IssuePreviewCardProps {
  label: string;
  issueTypeName: string;
  summary: string;
  description: string;
}

/** Renders a read-only preview of the Jira fields that will be sent for a single issue. */
function IssuePreviewCard({ label, issueTypeName, summary, description }: IssuePreviewCardProps) {
  return (
    <div className={styles.detailCard}>
      <p className={styles.detailLabel}>{label}</p>
      <div className={styles.detailGrid}>
        <div>
          <span className={styles.detailLabel}>Issue Type</span>
          <p className={styles.detailValue}>{issueTypeName}</p>
        </div>
        <div>
          <span className={styles.detailLabel}>Summary</span>
          <p className={styles.detailValue}>{summary}</p>
        </div>
      </div>
      <div>
        <span className={styles.detailLabel}>Description</span>
        <p className={styles.detailValue}>{description}</p>
      </div>
    </div>
  );
}

function IssueCreationForm({ state, actions }: IssueFormProps) {
  if (!state.prbData) {
    return null;
  }

  function handleJiraProjectKeyChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setJiraProjectKey(event.target.value);
  }

  function handleIssueSummaryChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setPrimaryIssueSummary(event.target.value);
  }

  function handleIsPrimaryIssueDefectChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setIsPrimaryIssueDefect(event.target.checked);
  }

  function handleSlStorySummaryChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setSlStorySummary(event.target.value);
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{ISSUE_SECTION_TITLE}</h3></div>
        <div className={styles.sectionBody}>
          <label className={styles.fieldGroup}><span className={styles.fieldLabel}>Jira Project Key</span><input className={styles.input} onChange={handleJiraProjectKeyChange} value={state.jiraProjectKey} /></label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Issue Summary</span>
            <input className={styles.input} onChange={handleIssueSummaryChange} value={state.primaryIssueSummaryTemplate} />
          </label>
          <label className={styles.checkboxLabel}>
            <input checked={state.isPrimaryIssueDefect} onChange={handleIsPrimaryIssueDefectChange} type="checkbox" />
            <span>Create primary issue as Defect</span>
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>SL Story Summary</span>
            <input className={styles.input} onChange={handleSlStorySummaryChange} value={state.slStorySummaryTemplate} />
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} onClick={() => void actions.createJiraIssues()} type="button">Create Jira Issues</button>
            <button className={styles.secondaryButton} onClick={() => actions.reset()} type="button">Start Over</button>
          </div>
          {state.isCreatingIssues ? <p className={styles.loadingText}>Creating Jira issues...</p> : null}
          {state.createError ? <p className={styles.errorText} role="alert">{state.createError}</p> : null}
          {state.createdIssueKeys.length > 0 ? (
            <div className={styles.successPanel}>
              <h4 className={styles.successTitle}>{SUCCESS_SECTION_TITLE}</h4>
              <ul className={styles.successList}>{state.createdIssueKeys.map((issueKey) => <li key={issueKey}>{issueKey}</li>)}</ul>
            </div>
          ) : null}
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{ISSUE_PREVIEW_SECTION_TITLE}</h3></div>
        <div className={styles.sectionBody}>
          <IssuePreviewCard
            description={`${state.prbData.number}\n\n${state.prbData.description}`}
            issueTypeName={state.isPrimaryIssueDefect ? 'Defect' : 'Story'}
            label="Issue 1 — Primary"
            summary={state.primaryIssueSummaryTemplate}
          />
          <IssuePreviewCard
            description={`${state.prbData.number}\n\n${state.prbData.description}`}
            issueTypeName="Story"
            label="Issue 2 — SL Story"
            summary={state.slStorySummaryTemplate}
          />
        </div>
      </section>
    </>
  );
}

/**
 * Renders the PRB Generator so support teams can convert one ServiceNow problem record into coordinated Jira work items.
 */
export default function PrbTab() {
  const { state, actions } = usePrbState();
  const [mode, setMode] = useState<PrbMode>('quick');

  function handlePrbNumberChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setPrbNumber(event.target.value);
  }

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <h2 className={styles.tabTitle}>{TAB_TITLE}</h2>
        <p className={styles.tabSubtitle}>{TAB_SUBTITLE}</p>
        <div className={styles.buttonRow} role="tablist" aria-label="PRB mode">
          <button
            aria-pressed={mode === 'quick'}
            className={mode === 'quick' ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setMode('quick')}
            type="button"
          >
            Quick Create
          </button>
          <button
            aria-pressed={mode === 'wizard'}
            className={mode === 'wizard' ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setMode('wizard')}
            type="button"
          >
            Wizard
          </button>
        </div>
      </header>
      {mode === 'wizard' ? (
        <PrbWizard actions={actions} state={state} />
      ) : (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{LOAD_SECTION_TITLE}</h3></div>
            <div className={styles.sectionBody}>
              <label className={styles.fieldGroup}><span className={styles.fieldLabel}>PRB Number</span><input className={styles.input} onChange={handlePrbNumberChange} value={state.prbNumber} /></label>
              <div className={styles.buttonRow}><button className={styles.primaryButton} onClick={() => void actions.fetchPrb()} type="button">Load PRB</button></div>
              {state.isFetchingPrb ? <p className={styles.loadingText}>Loading PRB details...</p> : null}
              {state.fetchError ? <p className={styles.errorText} role="alert">{state.fetchError}</p> : null}
              {state.fetchWarning ? <p className={styles.warningText} role="status">{state.fetchWarning}</p> : null}
              <PrbDetailCard state={state} />
            </div>
          </section>
          <IssueCreationForm actions={actions} state={state} />
        </>
      )}
    </div>
  );
}
