// StatusChip.tsx — Status name rendered as a chip colored by its Jira status category.

import { resolveStatusTone } from './issueMetaVocabulary.ts';
import styles from './IssueMeta.module.css';

export interface StatusChipProps {
  statusName: string;
  statusCategoryKey?: string;
}

/** Renders a status chip: category tone + the status name (text always present). */
export function StatusChip({ statusName, statusCategoryKey }: StatusChipProps) {
  const chipTone = resolveStatusTone(statusCategoryKey);
  return (
    <span className={styles.chip} data-tone={chipTone}>
      {statusName}
    </span>
  );
}
