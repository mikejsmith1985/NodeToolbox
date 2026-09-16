// PrbRequiredFields.tsx — Pickers for the fields Jira's create screen requires of the PRB issues,
// shown beside the create button before anything is posted.
//
// Renders through the shared transition control, so a required create field and a required
// transition field are collected by the same inputs and can never drift apart (GH #384).

import { TransitionRequiredFields } from '../../../components/TransitionRequiredFields/index.tsx';
import type { TransitionFieldSelection, TransitionRequiredField } from '../../SprintDashboard/featureReviewFixes.ts';
import { describeRequiredFieldNeeds, mergeRequiredFields } from '../prb/prbRequiredFields.ts';
import styles from '../tabs/PrbTab.module.css';

const NEEDS_MORE_PREFIX = 'Jira will not create these issues without more —';

export interface PrbRequiredFieldsProps {
  /** What each issue type's create screen still needs, keyed by the issue type name. */
  requiredFieldsByIssueType: Record<string, readonly TransitionRequiredField[]>;
  selectionByFieldId: Record<string, TransitionFieldSelection>;
  isDisabled?: boolean;
  onSelectionChange: (fieldId: string, selection: TransitionFieldSelection) => void;
}

/** Names which issue type needs which field, then offers one picker per distinct field. Renders nothing when nothing is needed. */
export function PrbRequiredFields({
  requiredFieldsByIssueType,
  selectionByFieldId,
  isDisabled = false,
  onSelectionChange,
}: PrbRequiredFieldsProps) {
  const mergedRequiredFields = mergeRequiredFields(requiredFieldsByIssueType);
  if (mergedRequiredFields.length === 0) {
    return null;
  }

  return (
    <div className={styles.fieldGroup}>
      <p className={styles.warningText}>{`${NEEDS_MORE_PREFIX} ${describeRequiredFieldNeeds(requiredFieldsByIssueType)}`}</p>
      <TransitionRequiredFields
        isDisabled={isDisabled}
        onSelectionChange={onSelectionChange}
        requiredFields={mergedRequiredFields}
        selectionByFieldId={selectionByFieldId}
      />
    </div>
  );
}
