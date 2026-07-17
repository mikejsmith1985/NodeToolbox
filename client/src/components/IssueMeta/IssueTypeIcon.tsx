// IssueTypeIcon.tsx — Issue type rendered as a recognizable colored icon + name.

import { resolveIssueTypeMeta } from './issueMetaVocabulary.ts';
import styles from './IssueMeta.module.css';

export interface IssueTypeIconProps {
  issueTypeName: string;
  /** When false, the name is aria-only (icon-dense layouts); the fact is never lost to assistive tech. */
  showLabel?: boolean;
}

/** Renders an issue-type chip: icon + name (or icon with an accessible label). */
export function IssueTypeIcon({ issueTypeName, showLabel = true }: IssueTypeIconProps) {
  const typeMeta = resolveIssueTypeMeta(issueTypeName);
  if (!showLabel) {
    return (
      <span aria-label={issueTypeName} className={styles.badge} data-tone={typeMeta.tone} title={issueTypeName}>
        {typeMeta.icon}
      </span>
    );
  }
  return (
    <span className={styles.badge} data-tone={typeMeta.tone}>
      <span aria-hidden="true">{typeMeta.icon}</span> {issueTypeName}
    </span>
  );
}
