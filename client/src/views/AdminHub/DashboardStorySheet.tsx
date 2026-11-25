// DashboardStorySheet.tsx — The Enrollment dashboard's build sheet: each question, its gadget, settings and live counts.
//
// Rich Filters has no public API, so the dashboard is built by hand. This sheet is the order to build it in, top to
// bottom as an SM or RTE will read it, with each step's clause counts beside it so the numbers can be checked.

import React from 'react';

import styles from './AdminHubView.module.css';
import { DASHBOARD_CONTROLLER, buildDashboardStory, listMissingClauses, type ReadySupply } from './dashboardStory.ts';

/** The question whose step carries the weeks-of-supply verdict. */
const READY_STEP_QUESTION = 'Is there enough Ready to Work?';
/** Verdict icons, so the supply reads at a glance with the words beside them. */
const SUPPLY_ICON = { thin: '⚠️', healthy: '✅', deep: 'ℹ️', unknown: '❔' } as const;

/** Props: each clause's live count by name (null when Jira refused it), and the supply verdict once counted. */
interface DashboardStorySheetProps {
  clauseCounts: ReadonlyMap<string, number | null>;
  readySupply: ReadySupply | null;
}

/** The numbered build sheet; a step whose clauses this Jira cannot build says so rather than showing a blank. */
export function DashboardStorySheet({ clauseCounts, readySupply }: DashboardStorySheetProps): React.ReactElement {
  const availableClauseNames = new Set(clauseCounts.keys());
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel}>Build the dashboard — top to bottom, the story an SM or RTE reads</label>
      <p className={styles.panelStatusLine}>
        <strong>0 · Filters for everything below</strong> — {DASHBOARD_CONTROLLER.gadget}: {DASHBOARD_CONTROLLER.settings}
      </p>
      {buildDashboardStory().map((section) => {
        const missingClauses = listMissingClauses(section, availableClauseNames);
        const presentClauses = section.clauseNames.filter((clauseName) => availableClauseNames.has(clauseName));
        return (
          <div key={section.step} className={styles.panelSection}>
            <strong>{`${section.step} · ${section.question}`}</strong>
            <p className={styles.panelStatusLine}>{section.whyItMatters}</p>
            <p className={styles.panelStatusLine}><em>{section.gadget}</em> — {section.settings}</p>
            <ul>
              {presentClauses.map((clauseName) => (
                <li key={clauseName}>{`${clauseName}: ${clauseCounts.get(clauseName) ?? '⚠️ rejected'}`}</li>
              ))}
            </ul>
            {missingClauses.length > 0 && (
              <p className={styles.panelStatusLine}>{`⚠️ Not available on this Jira: ${missingClauses.join(', ')}`}</p>
            )}
            {section.question === READY_STEP_QUESTION && readySupply && (
              <p className={styles.panelStatusLine}>{`${SUPPLY_ICON[readySupply.verdict]} ${readySupply.message}`}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
