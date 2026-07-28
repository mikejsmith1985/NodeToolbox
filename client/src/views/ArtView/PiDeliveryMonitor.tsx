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
import { planToWrittenSnapshot, summarizeLiveRows, type LiveStoryRow } from './piPlan/piDeliveryMonitorData.ts';
import type { PiPlanningFactSheet } from './piPlan/piPlanTypes.ts';
import styles from './PiDeliveryPlanTab.module.css';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** Whole days between an ISO timestamp and now. */
function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / MILLISECONDS_PER_DAY));
}

/** Reads the latest comment timestamp from an issue, falling back to its updated time. */
function lastActivityOf(issue: JiraIssue): string {
  const comments = (issue.fields as unknown as { comment?: { comments?: { created?: string }[] } }).comment?.comments ?? [];
  const latest = comments.map((comment) => comment.created ?? '').filter(Boolean).sort().at(-1);
  return latest ?? (issue.fields as unknown as { updated?: string }).updated ?? todayIso();
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
      const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent('summary,status,updated,comment')}&maxResults=200`;
      const response = await jiraGet<{ issues?: JiraIssue[] }>(path);
      const issues = response.issues ?? [];

      // Normalize each fetched Story into a live row, matching the plan by summary. isDone is precise (status
      // category); freshness is precise (last comment). Aging/SL-queue are approximated from the story's own
      // state until the sub-task fields are wired — see the caveat rendered below.
      const rows: LiveStoryRow[] = issues.map((issue) => {
        const summary = typeof issue.fields?.summary === 'string' ? issue.fields.summary : issue.key;
        const isDone = issue.fields?.status?.statusCategory?.key === 'done';
        const lastActivityIso = lastActivityOf(issue);
        return {
          storyKey: summary,
          sprintName: plannedSprintBySummary.get(summary) ?? (written.sprints[0]?.name ?? ''),
          points: pointsBySummary.get(summary) ?? 0,
          isDone,
          isSlQueued: !isDone,                    // approximation: precise SL state needs the SL sub-task read
          subtaskAgingDays: isDone ? 0 : daysSince(lastActivityIso),
          lastActivityIso,
        };
      });

      setMonitor(computeMonitor(written, summarizeLiveRows(rows, written), todayIso()));
      setStatusMessage(`Live status refreshed from ${issues.length} Story(ies).`);
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
            Note: burn-up, commit-vs-complete, and freshness are read live; sub-task aging and SL-queue depth are
            approximated from Story state until the sub-task fields are wired.
          </p>
        </>
      )}
    </section>
  );
}
