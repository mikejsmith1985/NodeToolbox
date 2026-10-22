// ScopeStep.tsx — Step 1 "What's in this change?": choose the Jira work by release or by search, then remove or add single issues.
//
// Every search is Toolbox's own (useCrgState fetchIssues / addIssues); the release list is Jira's own, so a release is
// picked, never typed. Adding one issue by key runs the same additive search with a one-issue query.

import { useEffect, useId, useRef, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { normaliseIssueKey } from '../../../views/SnowHub/chgFormula/changeIssueList.ts';
import ProjectKeyPicker from '../../shell/ProjectKeyPicker.tsx';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import StartFromCard from './StartFromCard.tsx';

interface JiraProjectOption {
  key: string;
  name: string;
}

/** A pending one-issue add: the query it runs, and what to put back afterwards. */
interface PendingIssueAdd {
  jql: string;
  previousFetchMode: 'project' | 'jql';
  previousJql: string;
  hasStarted: boolean;
}

/** Jira's own project list for the release picker; empty until it loads. */
function useJiraProjectOptions(): JiraProjectOption[] {
  const [projectOptions, setProjectOptions] = useState<JiraProjectOption[]>([]);
  useEffect(() => {
    let isCurrent = true;
    jiraGet<JiraProjectOption[]>('/rest/api/2/project')
      .then((projects) => { if (isCurrent) setProjectOptions(projects.map((project) => ({ key: project.key, name: project.name }))); })
      .catch(() => { if (isCurrent) setProjectOptions([]); });
    return () => { isCurrent = false; };
  }, []);
  return projectOptions;
}

/** Runs a one-issue additive search once the draft holds its query, then puts the user's own search back. */
function usePendingIssueAdd(crg: ChangeStepProps['crg']) {
  const pendingAddRef = useRef<PendingIssueAdd | null>(null);
  const { customJql, fetchMode, isFetchingIssues } = crg.state;
  const { addIssues, setFetchMode, setCustomJql } = crg.actions;
  useEffect(() => {
    const pendingAdd = pendingAddRef.current;
    if (!pendingAdd) return;
    if (!pendingAdd.hasStarted && customJql === pendingAdd.jql && fetchMode === 'jql') {
      pendingAddRef.current = { ...pendingAdd, hasStarted: true };
      void addIssues();
      return;
    }
    if (pendingAdd.hasStarted && !isFetchingIssues) {
      pendingAddRef.current = null;
      setFetchMode(pendingAdd.previousFetchMode);
      setCustomJql(pendingAdd.previousJql);
    }
  }, [customJql, fetchMode, isFetchingIssues, addIssues, setFetchMode, setCustomJql]);

  return (issueKey: string) => {
    const jql = `key = ${issueKey}`;
    pendingAddRef.current = { jql, previousFetchMode: fetchMode, previousJql: customJql, hasStarted: false };
    setFetchMode('jql');
    setCustomJql(jql);
  };
}

/** By release (project + release) or by search. */
function FindIssuesPanel({ crg, onSearched }: Pick<ChangeStepProps, 'crg'> & { onSearched: () => void }) {
  const projectOptions = useJiraProjectOptions();
  const projectId = useId();
  const versionId = useId();
  const searchId = useId();
  const { state, actions } = crg;
  const canSearch = state.fetchMode === 'jql' ? state.customJql.trim() !== '' : state.projectKey !== '' && state.fixVersion !== '';
  return (
    <div className={styles.card}>
      <div className={styles.choiceRow}>
        <button type="button" className={state.fetchMode === 'project' ? styles.choiceButtonSelected : styles.choiceButton} onClick={() => actions.setFetchMode('project')}>By release</button>
        <button type="button" className={state.fetchMode === 'jql' ? styles.choiceButtonSelected : styles.choiceButton} onClick={() => actions.setFetchMode('jql')}>By search</button>
      </div>
      {state.fetchMode === 'project' ? (
        <div className={styles.fieldRow}>
          <div className={styles.fieldGroup}>
            <ProjectKeyPicker id={projectId} projects={projectOptions} value={state.projectKey} isLoading={projectOptions.length === 0} onChoose={actions.setProjectKey} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor={versionId}>Release</label>
            <select id={versionId} className={styles.selectField} value={state.fixVersion} disabled={state.availableFixVersions.length === 0} onChange={(changeEvent) => actions.setFixVersion(changeEvent.target.value)}>
              <option value="">{state.availableFixVersions.length > 0 ? 'Choose…' : 'Choose a project first'}</option>
              {state.availableFixVersions.map((versionName) => <option key={versionName} value={versionName}>{versionName}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor={searchId}>Jira search</label>
          <textarea id={searchId} className={styles.textArea} value={state.customJql} placeholder="project = ABC AND labels = release-12" onChange={(changeEvent) => actions.setCustomJql(changeEvent.target.value)} />
        </div>
      )}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={!canSearch || state.isFetchingIssues} onClick={() => { onSearched(); void actions.fetchIssues(); }}>Find the issues</button>
      </div>
    </div>
  );
}

/** The found issues, each with a tick to keep or drop it. */
function IssueChecklist({ crg, hasSearched }: Pick<ChangeStepProps, 'crg'> & { hasSearched: boolean }) {
  const { state, actions } = crg;
  if (state.fetchedIssues.length === 0) {
    return hasSearched && !state.isFetchingIssues && !state.fetchError
      ? <p className={styles.noticeText}>That found no issues. Choose another release, or search instead.</p> : null;
  }
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{`${state.selectedIssueKeys.size} of ${state.fetchedIssues.length} issues chosen`}</h3>
      <ul className={styles.itemList}>
        {state.fetchedIssues.map((issue) => (
          <li key={issue.key}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={state.selectedIssueKeys.has(issue.key)} onChange={() => actions.toggleIssueSelection(issue.key)} />
              {`${issue.key} — ${issue.fields.summary}`}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One more issue, by its key. */
function AddIssueByKey({ onAdd, isBusy }: { onAdd: (issueKey: string) => void; isBusy: boolean }) {
  const keyFieldId = useId();
  const [typedKey, setTypedKey] = useState('');
  const [keyProblem, setKeyProblem] = useState('');
  function handleAdd() {
    const issueKey = normaliseIssueKey(typedKey);
    if (!issueKey) { setKeyProblem('That does not look like a Jira key, such as ABC-123.'); return; }
    setKeyProblem('');
    setTypedKey('');
    onAdd(issueKey);
  }
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={keyFieldId}>Add one more issue by its key</label>
      <div className={styles.buttonRow}>
        <input id={keyFieldId} className={styles.inputField} value={typedKey} placeholder="ABC-123" onChange={(changeEvent) => setTypedKey(changeEvent.target.value)} />
        <button type="button" className={styles.secondaryButton} disabled={isBusy || typedKey.trim() === ''} onClick={handleAdd}>Add</button>
      </div>
      {keyProblem ? <p className={styles.errorText}>{keyProblem}</p> : null}
    </div>
  );
}

/** Step 1: the Jira work this change delivers. */
export default function ScopeStep({ crg, session, updateSession }: ChangeStepProps) {
  const [hasSearched, setHasSearched] = useState(false);
  const addIssueByKey = usePendingIssueAdd(crg);
  const isModify = session.mode === 'modify';
  return (
    <div>
      <p className={styles.stepIntro}>
        {isModify ? 'Add any Jira issue this change now also covers. If nothing changed, skip this step.' : 'Choose the Jira work this change delivers.'}
      </p>
      {isModify ? null : <StartFromCard crg={crg} updateSession={updateSession} />}
      {isModify ? null : <FindIssuesPanel crg={crg} onSearched={() => setHasSearched(true)} />}
      {crg.state.isFetchingIssues ? <p className={styles.hint} role="status">Looking in Jira…</p> : null}
      {crg.state.fetchError ? <p className={styles.errorText}>{crg.state.fetchError}</p> : null}
      {crg.state.fetchNotice ? <p className={styles.hint}>{crg.state.fetchNotice}</p> : null}
      <IssueChecklist crg={crg} hasSearched={hasSearched} />
      <AddIssueByKey onAdd={addIssueByKey} isBusy={crg.state.isFetchingIssues} />
    </div>
  );
}
