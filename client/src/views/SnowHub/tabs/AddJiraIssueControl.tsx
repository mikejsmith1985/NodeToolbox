// AddJiraIssueControl.tsx — Adds one Jira issue to an existing change from Modify, without rebuilding it.
//
// A late story used to mean hand-editing the description's issue list or "Start Over", which rebuilds every field.
// This reads the issue from Jira (so a typo'd or invisible key is caught before anything changes), then adds its
// line to the change's issue list and counts it — the save the owner already makes writes it to ServiceNow.

import { useState } from 'react';

import { fetchChangeJiraStories } from '../chgFormula/changeJiraStories.ts';
import { addIssueToChangeText, normaliseIssueKey, type ChangeIssueText } from '../chgFormula/changeIssueList.ts';
import styles from './CreateChgTab.module.css';

interface AddJiraIssueControlProps {
  /** The change's text as the form holds it now. */
  changeText: ChangeIssueText;
  /** Receives the text with the issue added; the form keeps it until the owner saves. */
  onApplyFields: (fields: ChangeIssueText) => void;
}

/** The outcome shown under the control: what happened, and whether it is good news. */
interface AddOutcome {
  message: string;
  isError: boolean;
}

/** A key box and an Add button that put one more Jira issue into the change's issue list. */
export function AddJiraIssueControl({ changeText, onApplyFields }: AddJiraIssueControlProps) {
  const [typedKey, setTypedKey] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [outcome, setOutcome] = useState<AddOutcome | null>(null);

  const handleAdd = async () => {
    const issueKey = normaliseIssueKey(typedKey);
    if (!issueKey) {
      setOutcome({ message: `"${typedKey.trim()}" is not a Jira key — it looks like ENCUC-123.`, isError: true });
      return;
    }
    setIsReading(true);
    const [issue] = await fetchChangeJiraStories([issueKey]).catch(() => []);
    setIsReading(false);
    if (!issue) {
      setOutcome({ message: `Jira has no issue ${issueKey} that you can see — check the key.`, isError: true });
      return;
    }
    const { fields, wasAlreadyListed } = addIssueToChangeText(changeText, { key: issue.key, summary: issue.fields.summary ?? '' });
    if (wasAlreadyListed) {
      setOutcome({ message: `The change already lists ${issue.key} — nothing to add.`, isError: false });
      return;
    }
    onApplyFields(fields);
    setTypedKey('');
    setOutcome({ message: `Added ${issue.key} — save the change to write it to ServiceNow.`, isError: false });
  };

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor="add-jira-issue-key">Jira issue to add</label>
      <div className={styles.cloneInputRow}>
        <input
          className={styles.input}
          id="add-jira-issue-key"
          onChange={(event) => setTypedKey(event.target.value)}
          placeholder="e.g. ENCUC-123"
          value={typedKey}
        />
        <button className={styles.secondaryButton} disabled={isReading || typedKey.trim() === ''} onClick={() => void handleAdd()} type="button">
          {isReading ? 'Reading Jira…' : 'Add issue to change'}
        </button>
      </div>
      {outcome ? (
        <p className={outcome.isError ? styles.errorText : styles.successText} role={outcome.isError ? 'alert' : 'status'}>
          {outcome.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The control as its own titled panel, styled like Modify's "Add Change Tasks" panel, so adding a late story is
 * as easy to find as adding a task — on Change Details and on Review & Save alike.
 */
export function AddJiraIssuePanel(props: AddJiraIssueControlProps) {
  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>Add Jira issues to this change</h4>
      <p className={styles.panelHint}>
        Adds the issue to the description&apos;s issue list and counts it in the justification and risk text. Save the
        change to write it to ServiceNow.
      </p>
      <AddJiraIssueControl {...props} />
    </div>
  );
}

