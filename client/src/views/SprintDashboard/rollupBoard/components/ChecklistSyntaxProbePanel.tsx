// ChecklistSyntaxProbePanel.tsx — Finds out what this Jira's checklist accepts, by trying it.
//
// Built after four rounds of guessing the syntax and being wrong four times, each time in the same
// expensive way: the write succeeded, Jira returned 204, and the checklist had not moved. Nothing
// visible distinguishes a form the app honours from one it stores as literal text, so the only honest
// way to know is to write one and read it back.
//
// It changes a real checklist item and puts it back. That is stated plainly before it runs, because a
// tool that quietly edits somebody's data to learn something is not a tool anybody should trust.

import { useState } from 'react';

import {
  parseChecklistItems,
  type ChecklistItem,
} from '../checklistItems.ts';
import {
  runChecklistSyntaxProbe,
  type ChecklistSyntaxProbeResult,
} from '../checklistSyntax.ts';
import { describeChecklistState } from '../checklistWrite.ts';
import { jiraGet } from '../../../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../../featureReviewFixes.ts';
import styles from '../RollupBoardTab.module.css';

export interface ChecklistSyntaxProbePanelProps {
  /** The field the board writes checklists through — the one whose syntax matters. */
  writeFieldId: string;
  /** Records what the probe found, so nobody has to discover it twice. */
  onFormsDiscovered: (formIdByState: Partial<Record<string, string>>) => void;
}

/** Reads one issue's checklist field back, as the board parses it. */
async function readChecklistField(issueKey: string, fieldId: string): Promise<{
  items: ChecklistItem[];
  rawText: string;
}> {
  const issue = await jiraGet<{ fields?: Record<string, unknown> }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(fieldId)}`,
  );
  const rawValue = (issue.fields ?? {})[fieldId];
  return {
    items: parseChecklistItems(rawValue),
    rawText: typeof rawValue === 'string' ? rawValue : '',
  };
}

/** Lets somebody settle the checklist syntax by experiment instead of by argument. */
export function ChecklistSyntaxProbePanel({
  writeFieldId,
  onFormsDiscovered,
}: ChecklistSyntaxProbePanelProps): React.JSX.Element {
  const [issueKeyInput, setIssueKeyInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [probeResult, setProbeResult] = useState<ChecklistSyntaxProbeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function runProbe(): Promise<void> {
    const issueKey = issueKeyInput.trim().toUpperCase();
    if (issueKey === '' || writeFieldId === '') return;

    setIsRunning(true);
    setErrorMessage(null);
    setProbeResult(null);
    try {
      const { items, rawText } = await readChecklistField(issueKey, writeFieldId);
      if (items.length === 0) {
        setErrorMessage(`${issueKey} has no checklist items in ${writeFieldId}, so there is nothing `
          + 'to experiment on. Pick an issue with a checklist.');
        return;
      }

      const result = await runChecklistSyntaxProbe(
        items,
        items[0].text,
        {
          writeChecklistText: (nextText) =>
            saveFeatureReviewSimpleField(issueKey, writeFieldId, nextText),
          readChecklistItems: async () => (await readChecklistField(issueKey, writeFieldId)).items,
        },
        rawText,
      );
      setProbeResult(result);
      if (Object.keys(result.formIdByState).length > 0) onFormsDiscovered(result.formIdByState);
    } catch (probeError: unknown) {
      setErrorMessage(String(probeError));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className={styles.panelCard} data-testid="rollup-checklist-syntax-probe">
      <h4 className={styles.sectionTitle}>Find out what this checklist accepts</h4>
      <p className={styles.fieldLabel}>
        Writes each way a checklist line can express a status to one item, reads back what the app made
        of it, and records the ones that worked. <strong>It changes a real checklist item and puts it
        back when it finishes</strong> — use an issue you do not mind touching.
      </p>

      <div className={styles.editorRow}>
        <input
          aria-label="Issue key to experiment on"
          className={styles.inputField}
          disabled={isRunning}
          onChange={(changeEvent) => setIssueKeyInput(changeEvent.target.value)}
          placeholder="e.g. ENCUC-2311"
          value={issueKeyInput}
        />
        <button
          className={styles.actionButton}
          disabled={isRunning || issueKeyInput.trim() === '' || writeFieldId === ''}
          onClick={() => void runProbe()}
          type="button"
        >
          {isRunning ? 'Trying each form…' : 'Run the experiment'}
        </button>
      </div>

      {writeFieldId === '' && (
        <p className={styles.fieldLabel}>
          Name the field to write through first — the syntax is a property of that field.
        </p>
      )}

      {errorMessage !== null && <p className={styles.editorError}>{errorMessage}</p>}

      {probeResult !== null && (
        <>
          {!probeResult.isRestored && (
            <p className={styles.editorError}>{probeResult.errorMessage}</p>
          )}

          <ul className={styles.editorDiff}>
            {probeResult.results.map((result) => (
              <li key={result.formId}>
                <code>{result.label}</code>
                {' → '}
                {result.resultingState === null
                  ? `no reading (${result.errorMessage ?? 'unknown'})`
                  : describeChecklistState(result.resultingState)}
              </li>
            ))}
          </ul>

          <p className={styles.fieldLabel}>
            {Object.keys(probeResult.formIdByState).length === 0
              ? 'No form produced a readable status. This checklist cannot be written from here at all.'
              : `Recorded. The board will now write ${Object.entries(probeResult.formIdByState)
                .map(([state, formId]) => `${describeChecklistState(state as never)} as "${formId}"`)
                .join(', ')}.`}
          </p>

          {/* Said out loud: a state no form produced is one this instance genuinely cannot express,
              and knowing that is worth as much as knowing the ones that work. */}
          <p className={styles.fieldLabel}>
            Any status missing from that list has no text form here and can only be set in Jira.
          </p>
        </>
      )}
    </div>
  );
}
