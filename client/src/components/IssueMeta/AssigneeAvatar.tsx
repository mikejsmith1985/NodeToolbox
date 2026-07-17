// AssigneeAvatar.tsx — Assignee identity: initials avatar + the FULL display name.

import { buildAssigneeInitials } from './issueMetaVocabulary.ts';
import styles from './IssueMeta.module.css';

const UNASSIGNED_LABEL = 'Unassigned';

export interface AssigneeAvatarProps {
  displayName: string | null | undefined;
}

/**
 * Renders the assignee with an initials circle and the complete display name — never truncated
 * (standing rule: "Lastname, Firstname (CTR)" instances lose the person to first-token shortening).
 */
export function AssigneeAvatar({ displayName }: AssigneeAvatarProps) {
  const trimmedDisplayName = displayName?.trim() ?? '';
  if (trimmedDisplayName === '') {
    return (
      <span className={styles.assignee} data-tone="neutral">
        <span aria-hidden="true" className={styles.avatarCircleUnassigned}>—</span>
        <span className={styles.assigneeName}>{UNASSIGNED_LABEL}</span>
      </span>
    );
  }

  return (
    <span className={styles.assignee}>
      <span aria-hidden="true" className={styles.avatarCircle}>{buildAssigneeInitials(trimmedDisplayName)}</span>
      <span className={styles.assigneeName}>{trimmedDisplayName}</span>
    </span>
  );
}
