// PiDeliveryMonitor.tsx — The monitoring surface for the PI Delivery Framework (spec 032, US5). Given the
// in-memory written plan it shows the deterministic baseline immediately, and on demand fetches the plan's
// Stories from Jira to compute live adherence signals (burn-up, commit-vs-complete, freshness) plus the
// explicit replan triggers. All signal maths lives in the tested piPlanMonitor engine; this component only
// fetches, normalizes, and renders — labelling which signals are precise vs approximate.

import { useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import type { DeliveryPlan } from './piPlan/piDeliveryEngine.ts';
import { computeMonitor } from './piPlan/piPlanMonitor.ts';
import type { MonitorResult } from './piPlan/piPlanTypes.ts';
import { planToWrittenSnapshot, summarizeLiveRows, deriveSubtaskSignals, parseSprintName, type LiveStoryRow, type SubtaskSignalInput } from './piPlan/piDeliveryMonitorData.ts';
import type { PiPlanningFactSheet } from './piPlan/piPlanTypes.ts';
import styles from './PiDeliveryPlanTab.module.css';

/** Jira's sprint custom field — raw greenhopper strings carrying the active sprint name (see Hygiene view). */
const SPRINT_FIELD_ID = 'customfield_10020';

interface PiDeliveryMonitorProps {
  plan: DeliveryPlan;
  factSheet: PiPlanningFactSheet;
  /** The Feature-link custom field id (cf[NNN]) — lets the live fetch find the plan's Stories. */
  featureLinkFieldId: string;
}

/** Today as YYYY-MM-DD for the injected monitoring clock. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Reads the latest comment timestamp from an issue, falling back to its updated time. */
function lastActivityOf(issue: JiraIssue): string {
  const comments = (issue.fields as unknown as { comment?: { comments?: { created?: string }[] } }).comment?.comments ?? [];
  const latest = comments.map((comment) => comment.created ?? '').filter(Boolean).sort().at(-1);
  return latest ?? (issue.fields as unknown as { updated?: string }).updated ?? todayIso();
}

/** Normalizes one fetched sub-task issue into the pure signal input the monitor adapter consumes. */
function toSubtaskSignal(subtask: JiraIssue): SubtaskSignalInput {
  return {
    summary: typeof subtask.fields?.summary === 'string' ? subtask.fields.summary : '',
    statusCategoryKey: subtask.fields?.status?.statusCategory?.key ?? 'new',
    updatedIso: (subtask.fields as unknown as { updated?: string }).updated ?? '',
  };
}

/** The monitoring panel: baseline from the plan, live signals + triggers on refresh. */
export default function PiDeliveryMonitor({ plan, factSheet, featureLinkFieldId }: PiDeliveryMonitorProps) {
  const written = useMemo(() => planToWrittenSnapshot(plan, factSheet), [plan, factSheet]);
  const [monitor, setMonitor] = useState<MonitorResult | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const plannedSprintBySummary = useMemo(
    () => new Map(plan.stories.map((story) => [story.summary, story.sprintName])),
    [plan.stories],
  );
  const pointsBySummary = useMemo(
    () => new Map(plan.stories.map((story) => [story.summary, story.sizePoints])),
    [plan.stories],
  );

  async function handleRefresh() {
    if (featureLinkFieldId.trim() === '') {
      setStatusMessage('Set the Feature-link field id (in Write settings) so the monitor can find the plan\'s Stories.');
      return;
    }
    setIsBusy(true);
    setStatusMessage('');
    try {
      const featureKeys = factSheet.features.map((feature) => feature.key);
      const fieldNumber = featureLinkFieldId.replace('customfield_', '');
      const jql = `cf[${fieldNumber}] in (${featureKeys.join(', ')}) AND issuetype in (Story, Defect)`;
      // Read the Story with its actual sprint (customfield_10020) alongside status + comments.
      const storyFields = `summary,status,comment,${SPRINT_FIELD_ID}`;
      const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(storyFields)}&maxResults=200`;
      const response = await jiraGet<{ issues?: JiraIssue[] }>(path);
      const issues = response.issues ?? [];

      // Precise sub-task read: fetch every child of the plan's Stories, grouped by parent, so aging and the
      // SL-queue are measured from the real sub-tasks rather than approximated from the Story's own state.
      const subtasksByParent = new Map<string, SubtaskSignalInput[]>();
      if (issues.length > 0) {
        const parentJql = `parent in (${issues.map((issue) => issue.key).join(', ')})`;
        const subtaskPath = `/rest/api/2/search?jql=${encodeURIComponent(parentJql)}&fields=${encodeURIComponent('summary,status,updated,parent')}&maxResults=500`;
        const subtaskResponse = await jiraGet<{ issues?: JiraIssue[] }>(subtaskPath);
        (subtaskResponse.issues ?? []).forEach((subtask) => {
          const parentKey = (subtask.fields as unknown as { parent?: { key?: string } }).parent?.key;
          if (!parentKey) return;
          const bucket = subtasksByParent.get(parentKey) ?? [];
          bucket.push(toSubtaskSignal(subtask));
          subtasksByParent.set(parentKey, bucket);
        });
      }

      const nowIso = todayIso();
      const rows: LiveStoryRow[] = issues.map((issue) => {
        const summary = typeof issue.fields?.summary === 'string' ? issue.fields.summary : issue.key;
        const isDone = issue.fields?.status?.statusCategory?.key === 'done';
        // Actual sprint from the Story's sprint field; fall back to the planned sprint when unset.
        const actualSprint = parseSprintName((issue.fields as unknown as Record<string, unknown>)[SPRINT_FIELD_ID])
          ?? plannedSprintBySummary.get(summary) ?? (written.sprints[0]?.name ?? '');
        const { agingDays, isSlQueued } = deriveSubtaskSignals(subtasksByParent.get(issue.key) ?? [], nowIso);
        return {
          storyKey: summary,
          sprintName: actualSprint,
          points: pointsBySummary.get(summary) ?? 0,
          isDone,
          isSlQueued,
          subtaskAgingDays: agingDays,
          lastActivityIso: lastActivityOf(issue),
        };
      });

      setMonitor(computeMonitor(written, summarizeLiveRows(rows, written), nowIso));
      setStatusMessage(`Live status refreshed from ${issues.length} Story(ies) and their sub-tasks.`);
    } catch (refreshError) {
      setStatusMessage(refreshError instanceof Error ? refreshError.message : 'Failed to refresh live status.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <h3 className={styles.sectionTitle}>4 · Monitor adherence (not re-plan)</h3>

      {/* Baseline — always available from the written plan. */}
      <p className={styles.statusLine}>Planned baseline:</p>
      <ul className={styles.notes}>
        {written.sprints.map((sprint) => (
          <li key={sprint.name}>{sprint.name}: {sprint.plannedPoints} planned pts · SL capacity {sprint.slCapacity}</li>
        ))}
      </ul>

      <button className={styles.actionButton} disabled={isBusy} onClick={() => void handleRefresh()} type="button">
        {isBusy ? 'Refreshing…' : 'Refresh live status'}
      </button>
      {statusMessage && <p className={styles.statusLine}>{statusMessage}</p>}

      {monitor && (
        <>
          <p className={styles.statusLine}>On-track signals:</p>
          <ul className={styles.notes}>
            {monitor.signals.map((signal, index) => (
              <li key={index} className={signal.isOnTrack ? styles.signalOnTrack : styles.signalOffTrack}>
                {signal.isOnTrack ? '✓' : '✗'} {signal.detail}
              </li>
            ))}
          </ul>
          {monitor.triggers.length > 0 ? (
            <>
              <p className={styles.statusLine}><strong>Replan triggers:</strong></p>
              <ul className={styles.notes}>
                {monitor.triggers.map((trigger, index) => (
                  <li key={index} className={styles.signalOffTrack}>⚠ {trigger.statement}</li>
                ))}
              </ul>
            </>
          ) : <p className={styles.statusLine}>No replan triggers — monitoring only.</p>}
          <p className={styles.statusLine}>
            All signals are read live: burn-up and commit-vs-complete from Story status, freshness from the last
            GitHub-intake comment, and sub-task aging + SL-queue depth from the Stories&apos; actual sub-tasks; slip is
            detected against each Story&apos;s real sprint field.
          </p>
        </>
      )}
    </section>
  );
}
