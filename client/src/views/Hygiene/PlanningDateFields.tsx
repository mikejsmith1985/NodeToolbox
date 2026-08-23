// PlanningDateFields.tsx — The three planning dates, shown together and editable in place.
//
// Every date flag on this page is about Target Start, Due or Target End, and the card showed one of
// them. Deciding whether a flagged date was actually wrong meant opening the issue in Jira to see the
// other two — on the screen whose entire job is to let somebody fix it here.
//
// Each date writes through `saveFeatureReviewSimpleField`, the same helper the inline Fix controls
// use, so an edit made here and an edit made there are literally the same Jira request.

import { useEffect, useState } from 'react';

import { saveFeatureReviewSimpleField } from '../SprintDashboard/featureReviewFixes.ts';
import { readIssuePlanningDates, type IssuePlanningDate } from './issuePlanningDates.ts';
import type { HygieneFieldConfig, JiraIssue } from './checks/hygieneChecks.ts';
import styles from './HygieneView.module.css';

/** How the write went. `idle` covers both "untouched" and "settled", which need no distinction. */
type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'failed'; message: string };

export interface PlanningDateFieldsProps {
  issue: JiraIssue;
  fieldConfig: HygieneFieldConfig;
  /** Called after a successful write so the page can rescan and drop the flag it just cleared. */
  onDateSaved: (issueKey: string) => void;
}

/** One date: its label, its current value, and an input that writes it. */
function PlanningDateField({ issue, planningDate, onDateSaved }: {
  issue: JiraIssue;
  planningDate: IssuePlanningDate;
  onDateSaved: (issueKey: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(planningDate.value ?? '');
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  // A rescan replaces the issue, and the draft has to follow it or the field keeps showing the value
  // from before the last save — which reads as the write having failed.
  useEffect(() => {
    setDraftValue(planningDate.value ?? '');
  }, [planningDate.value]);

  async function saveDate(nextValue: string): Promise<void> {
    if (planningDate.fieldId === null || nextValue === (planningDate.value ?? '')) {
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      await saveFeatureReviewSimpleField(issue.key, planningDate.fieldId, nextValue);
      setSaveState({ status: 'saved' });
      onDateSaved(issue.key);
    } catch (saveError) {
      // The draft is deliberately LEFT as typed. Reverting it would throw away what somebody meant
      // to write at the moment they most need to see it, and the field is the only record of it.
      setSaveState({
        status: 'failed',
        message: saveError instanceof Error ? saveError.message : 'Could not save this date.',
      });
    }
  }

  if (planningDate.fieldId === null) {
    return (
      <div className={styles.planningDate}>
        <span className={styles.planningDateLabel}>{planningDate.label}</span>
        {/* Named, not hidden: a card showing two of three dates looks complete. This says why. */}
        <span className={styles.planningDateUnconfigured} title="No Jira field is configured for this date.">
          not configured
        </span>
      </div>
    );
  }

  return (
    <div className={styles.planningDate}>
      <span className={styles.planningDateLabel}>{planningDate.label}</span>
      <input
        aria-label={`${planningDate.label} for ${issue.key}`}
        className={planningDate.value === null ? styles.planningDateInputEmpty : styles.planningDateInput}
        disabled={saveState.status === 'saving'}
        onBlur={(blurEvent) => void saveDate(blurEvent.target.value)}
        onChange={(changeEvent) => setDraftValue(changeEvent.target.value)}
        type="date"
        value={draftValue}
      />
      {saveState.status === 'saving' && <span className={styles.planningDateNote}>saving…</span>}
      {saveState.status === 'saved' && <span className={styles.planningDateSaved}>✓</span>}
      {saveState.status === 'failed' && (
        <span className={styles.planningDateError} role="alert" title={saveState.message}>⚠ {saveState.message}</span>
      )}
    </div>
  );
}

/**
 * Renders Target Start, Due and Target End side by side, each editable.
 *
 * Saved on BLUR rather than behind a button. A date input's value is only ever a whole date, so
 * there is no half-finished state a button would be protecting against — and three dates behind
 * three buttons is six clicks to fix one issue's timeline.
 */
export function PlanningDateFields({ issue, fieldConfig, onDateSaved }: PlanningDateFieldsProps) {
  const planningDates = readIssuePlanningDates(issue, fieldConfig);

  return (
    <div className={styles.planningDates} data-testid="planning-dates">
      {planningDates.map((planningDate) => (
        <PlanningDateField
          issue={issue}
          key={planningDate.id}
          onDateSaved={onDateSaved}
          planningDate={planningDate}
        />
      ))}
    </div>
  );
}
