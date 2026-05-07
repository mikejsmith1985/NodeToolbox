// PrbTab.tsx — PRB-to-Jira issue generator tab for turning ServiceNow problems into paired Jira issues.

import { useState, type ChangeEvent } from 'react';

import { usePrbState } from '../hooks/usePrbState.ts';
import PrbWizard from './PrbWizard.tsx';
import styles from './PrbTab.module.css';

const TAB_TITLE = 'PRB Generator';
const TAB_SUBTITLE = 'Load a ServiceNow problem record, review the details, and create paired Jira issues.';
const LOAD_SECTION_TITLE = 'Load PRB';
const ISSUE_SECTION_TITLE = 'Create Jira Issues';
const EMPTY_ASSIGNEE_LABEL = 'Unassigned';
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

function PrbDetailCard({ state }: DetailCardProps) {
  if (!state.prbData) {
    return null;
  }

  return (
    <article className={styles.detailCard}>
      <div className={styles.detailGrid}>
        <div><span className={styles.detailLabel}>Number</span><p className={styles.detailValue}>{state.prbData.number}</p></div>
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

function IssueCreationForm({ state, actions }: IssueFormProps) {
  if (!state.prbData) {
    return null;
  }

  function handleJiraProjectKeyChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setJiraProjectKey(event.target.value);
  }

  function handleDefectSummaryChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setDefectSummary(event.target.value);
  }

  function handleStorySummaryChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setStorySummary(event.target.value);
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>{ISSUE_SECTION_TITLE}</h3></div>
      <div className={styles.sectionBody}>
        <label className={styles.fieldGroup}><span className={styles.fieldLabel}>Jira Project Key</span><input className={styles.input} onChange={handleJiraProjectKeyChange} value={state.jiraProjectKey} /></label>
        <label className={styles.fieldGroup}><span className={styles.fieldLabel}>Defect Summary</span><input className={styles.input} onChange={handleDefectSummaryChange} value={state.defectSummaryTemplate} /></label>
        <label className={styles.fieldGroup}><span className={styles.fieldLabel}>Story Summary</span><input className={styles.input} onChange={handleStorySummaryChange} value={state.storySummaryTemplate} /></label>
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
              <PrbDetailCard state={state} />
            </div>
          </section>
          <IssueCreationForm actions={actions} state={state} />
        </>
      )}
    </div>
  );
}
