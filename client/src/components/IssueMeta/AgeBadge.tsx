// AgeBadge.tsx — Issue age with a graded heat tone derived from the team's stale threshold.

import { resolveAgeTone } from './issueMetaVocabulary.ts';
import styles from './IssueMeta.module.css';

export interface AgeBadgeProps {
  ageDays: number;
  staleDaysThreshold: number;
}

/** Renders "{N}d" toned comfortable / warning / overdue against the configured threshold. */
export function AgeBadge({ ageDays, staleDaysThreshold }: AgeBadgeProps) {
  const ageTone = resolveAgeTone(ageDays, staleDaysThreshold);
  return (
    <span className={styles.badge} data-tone={ageTone} title={`Last update ${ageDays} days ago`}>
      {ageDays}d
    </span>
  );
}
