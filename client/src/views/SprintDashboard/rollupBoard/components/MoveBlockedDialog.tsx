// MoveBlockedDialog.tsx — What the board says when Jira refuses to move a card.
//
// A refused drag used to leave a line of red text on the card reading `Error: 400 {"errors":
// {"customfield_10002":"Story Points is required."}}`. That is Jira talking to whoever wrote the
// workflow, not to the person who just dragged something — and being a line on a card, it was also
// easy to drag past without noticing the move never happened.
//
// This is a proper dialog instead: it names the issue and where it was going, says in plain words what
// stopped it, and — where the missing answer is something the board can honestly collect — puts that
// field right here, so "Story Points is required" arrives WITH a story-points dropdown rather than an
// instruction to go and find one. When the refusal is not fixable from a form (the workflow has no such
// step at all), it says so and names where the issue can actually go, instead of offering a hopeful
// form that would fail the same way twice.

import { TransitionRequiredFields } from '../../../../components/TransitionRequiredFields/index.tsx';
import type { TransitionFieldSelection, TransitionRequiredField } from '../../featureReviewFixes.ts';
import type { MoveBlockDiagnosis } from '../moveBlockDiagnosis.ts';
import styles from '../RollupBoardTab.module.css';

export interface MoveBlockedDialogProps {
  diagnosis: MoveBlockDiagnosis;
  /** The fields the board can collect here. Empty when nothing is fixable from this dialog. */
  fixableFields: readonly TransitionRequiredField[];
  selectionByFieldId: Record<string, TransitionFieldSelection>;
  isSaving: boolean;
  /** Set when every fixable field has an answer; the retry button waits for it. */
  canSubmit: boolean;
  onSelectionChange: (fieldId: string, selection: TransitionFieldSelection) => void;
  onSubmit: () => void;
  onOpenIssue: () => void;
  onDismiss: () => void;
}

/** The dialog shown when a card move is refused, with the fix inline wherever one is possible. */
export function MoveBlockedDialog({
  diagnosis,
  fixableFields,
  selectionByFieldId,
  isSaving,
  canSubmit,
  onSelectionChange,
  onSubmit,
  onOpenIssue,
  onDismiss,
}: MoveBlockedDialogProps) {
  const hasFixableFields = fixableFields.length > 0;

  return (
    <div
      aria-modal="true"
      className={styles.dialogOverlay}
      data-testid="rollup-move-blocked-dialog"
      role="dialog"
    >
      <div className={styles.dialogCard}>
        <h3 className={styles.dialogHeadline}>{diagnosis.headline}</h3>
        <p className={styles.dialogExplanation}>{diagnosis.explanation}</p>

        {diagnosis.whatToDo.length > 0 && (
          <ul className={styles.dialogSteps}>
            {diagnosis.whatToDo.map((step) => <li key={step}>{step}</li>)}
          </ul>
        )}

        {hasFixableFields && (
          <TransitionRequiredFields
            isDisabled={isSaving}
            onSelectionChange={onSelectionChange}
            requiredFields={fixableFields}
            selectionByFieldId={selectionByFieldId}
          />
        )}

        {/* Named separately from the fields above: a field Jira wants that the board cannot render is
            not a gap in this dialog, it is a trip to Jira, and saying which is which saves that trip
            being discovered by a second failed attempt. */}
        {!hasFixableFields && diagnosis.requiredFieldNames.length > 0 && (
          <p className={styles.dialogExplanation}>
            {diagnosis.requiredFieldNames.join(', ')} cannot be edited from the board — open the issue
            in Jira to set {diagnosis.requiredFieldNames.length === 1 ? 'it' : 'them'}.
          </p>
        )}

        <div className={styles.editorRow}>
          {hasFixableFields && (
            <button
              className={styles.actionButton}
              disabled={!canSubmit || isSaving}
              onClick={onSubmit}
              type="button"
            >
              {isSaving ? 'Saving…' : 'Save and move the card'}
            </button>
          )}
          <button className={styles.actionButton} onClick={onOpenIssue} type="button">
            Open the issue here
          </button>
          <button className={styles.actionButton} onClick={onDismiss} type="button">
            Leave it where it is
          </button>
        </div>
      </div>
    </div>
  );
}
