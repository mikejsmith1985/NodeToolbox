// PriorityBadge.tsx — Priority rendered with the conventional direction glyph + temperature.

import { resolvePriorityMeta } from './issueMetaVocabulary.ts';
import styles from './IssueMeta.module.css';

export interface PriorityBadgeProps {
  priorityName: string;
}

/** Renders a priority badge: direction glyph + priority name, toned by severity. */
export function PriorityBadge({ priorityName }: PriorityBadgeProps) {
  const priorityMeta = resolvePriorityMeta(priorityName);
  return (
    <span className={styles.badge} data-tone={priorityMeta.tone}>
      <span aria-hidden="true">{priorityMeta.directionGlyph}</span> {priorityName}
    </span>
  );
}
