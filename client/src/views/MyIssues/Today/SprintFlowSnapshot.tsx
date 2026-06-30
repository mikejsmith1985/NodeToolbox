// SprintFlowSnapshot.tsx — Informational sprint-flow panel for the "Today" dashboard.
//
// Unlike the category cards, this panel is purely informational: it never offers a check-off
// control. It shows how the team's work is distributed across the To Do / In Progress / Done
// status zones and how many days remain in the active sprint, with a link to the full Sprint
// Dashboard for deeper analysis.

import { Link } from 'react-router-dom';

import type { JiraSprint } from '../../../types/jira.ts';
import type { JiraIssue as HygieneJiraIssue } from '../../Hygiene/checks/hygieneChecks.ts';
import styles from './SprintFlowSnapshot.module.css';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SPRINT_DASHBOARD_PATH = '/sprint-dashboard';

// The three Jira status-category keys mapped to the human-readable WIP zones we display.
const STATUS_ZONES: { key: string; label: string }[] = [
  { key: 'new', label: 'To Do' },
  { key: 'indeterminate', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export interface SprintFlowSnapshotProps {
  sprintIssues: HygieneJiraIssue[];
  sprintInfo: JiraSprint | null;
}

/** Counts how many issues sit in each status zone, keyed by Jira status-category key. */
function countIssuesByZone(sprintIssues: HygieneJiraIssue[]): Record<string, number> {
  const countsByZone: Record<string, number> = { new: 0, indeterminate: 0, done: 0 };
  for (const sprintIssue of sprintIssues) {
    const statusCategoryKey = sprintIssue.fields.status?.statusCategory?.key ?? '';
    if (statusCategoryKey in countsByZone) {
      countsByZone[statusCategoryKey] += 1;
    }
  }
  return countsByZone;
}

/** Returns whole days left until the sprint end date, or null when there is no active sprint. */
function calculateSprintDaysRemaining(sprintInfo: JiraSprint | null): number | null {
  if (!sprintInfo?.endDate) {
    return null;
  }
  const endTimestamp = new Date(sprintInfo.endDate).getTime();
  if (!Number.isFinite(endTimestamp)) {
    return null;
  }
  return Math.max(0, Math.ceil((endTimestamp - Date.now()) / MILLISECONDS_PER_DAY));
}

/** Renders the read-only sprint-flow snapshot (WIP distribution + days remaining). */
export default function SprintFlowSnapshot({ sprintIssues, sprintInfo }: SprintFlowSnapshotProps) {
  const countsByZone = countIssuesByZone(sprintIssues);
  const sprintDaysRemaining = calculateSprintDaysRemaining(sprintInfo);

  return (
    <section className={styles.snapshot} aria-label="Sprint flow snapshot">
      <div className={styles.snapshotHeader}>
        <h3 className={styles.snapshotTitle}>Sprint flow</h3>
        <Link className={styles.snapshotLink} to={SPRINT_DASHBOARD_PATH}>
          Open Sprint Dashboard
        </Link>
      </div>

      <dl className={styles.zoneList}>
        {STATUS_ZONES.map((statusZone) => (
          <div className={styles.zone} key={statusZone.key}>
            <dt className={styles.zoneLabel}>{statusZone.label}</dt>
            <dd className={styles.zoneCount}>{countsByZone[statusZone.key]}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.daysRemaining}>
        {sprintDaysRemaining === null
          ? 'No active sprint'
          : `${sprintDaysRemaining} day${sprintDaysRemaining === 1 ? '' : 's'} remaining`}
      </p>
    </section>
  );
}
