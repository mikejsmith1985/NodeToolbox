// SlQeContainerFixPanel.tsx — One-time Admin Hub clean-up for issue #508.
//
// A batch of SL/QE test stories were linked to their DEV story with the "Container" link pointing the
// wrong way, and many carry bad Description / Acceptance Criteria. This panel previews, then applies,
// the fix: it flips each link so the dev story is the container, clones the dev's Description + AC onto
// the test story, labels it "msreview" and assigns it — or, where the dev work is already done, cancels
// the test story instead. It reads each issue's LIVE status before deciding, previews everything, and
// changes nothing until Apply is pressed.

import React, { useState } from 'react';

import {
  jiraGet, jiraPut, jiraPost, jiraDelete, createIssueLink, searchUsers,
} from '../../services/jiraApi.ts';
import {
  FIELD_MAPPING_ENTRIES, readFieldMappingOverrides, resolveFieldMapping,
} from '../../services/jiraFieldMapping.ts';
import type { JiraField, JiraUser } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';
import { describeJiraFailure, type JiraTransition } from './subtaskStoryPromotion.ts';
import {
  WORK_LIST, REVIEW_LABEL, DESCRIPTION_FIELD_ID, CANCEL_REASON_DEFAULT,
  bucketForStatus, decideAction, resolveContainerLinkType, planLinkFlip,
  findTransitionMatching, describeAction,
  type ContainerLinkType, type IssueLinkShape, type PlanRow, type StoryAction, type WorkListEntry,
} from './slQeContainerFix.ts';

// ── Named constants ──

/** The display name the reviewed stories are handed to for distribution. */
const ASSIGNEE_SEARCH = 'Belew';
/** Every word that must appear in the resolved assignee's display name. */
const ASSIGNEE_MUST_INCLUDE = ['belew', 'dennis'];
/** The fields a test story needs for planning and for the before-write re-read. */
const STORY_FIELDS = ['summary', 'status', 'issuelinks', 'labels'];

/** The runtime pieces discovered once per run: how to flip links, clone AC, and who to assign. */
interface RunContext {
  linkType: ContainerLinkType;
  acFieldId: string | null;
  assignee: JiraUser | null;
}

/** Everything a dry run produced, held so Apply reuses the same discovery. */
interface Preview {
  context: RunContext;
  rows: PlanRow[];
  warnings: string[];
}

/** Reads a human-actionable message off an unknown thrown value. */
function toMessage(error: unknown): string {
  return describeJiraFailure(error instanceof Error ? error.message : String(error));
}

/** Resolves the Acceptance Criteria field id by name, reusing the shared field-mapping logic. */
function resolveAcFieldId(availableFields: readonly JiraField[]): string | null {
  const entry = FIELD_MAPPING_ENTRIES.find((candidate) => candidate.settingsKey === 'acFieldId');
  if (!entry) return null;
  const resolution = resolveFieldMapping(entry, availableFields, readFieldMappingOverrides(window.localStorage));
  return resolution.effectiveFieldId || null;
}

/** Picks the assignee whose display name contains every required word, else the first match. */
function pickAssignee(candidates: readonly JiraUser[]): JiraUser | null {
  const exact = candidates.find((user) => {
    const display = String(user.displayName || user.name || '').toLowerCase();
    return ASSIGNEE_MUST_INCLUDE.every((part) => display.includes(part));
  });
  return exact || candidates[0] || null;
}

/** Discovers the link type, AC field, and assignee needed before any story is touched. */
async function buildRunContext(): Promise<{ context: RunContext; warnings: string[] }> {
  const warnings: string[] = [];
  const linkTypes = await jiraGet<{ issueLinkTypes?: ContainerLinkType[] }>('/rest/api/2/issueLinkType');
  const linkType = resolveContainerLinkType(linkTypes.issueLinkTypes ?? []);
  if (!linkType) throw new Error('This Jira has no "Container" issue link type — cannot flip links.');

  const fields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const acFieldId = resolveAcFieldId(fields);
  if (!acFieldId) warnings.push('Acceptance Criteria field not found — Description will still clone, AC will be skipped.');

  const candidates = await searchUsers(ASSIGNEE_SEARCH).catch(() => [] as JiraUser[]);
  const assignee = pickAssignee(candidates);
  if (!assignee) warnings.push(`Assignee "${ASSIGNEE_SEARCH}" not found — stories will be labelled but not reassigned.`);

  return { context: { linkType, acFieldId, assignee }, warnings };
}

/** The minimal Jira issue shape this panel reads. */
interface StoryIssue { fields: { summary?: string; status?: { name?: string }; issuelinks?: IssueLinkShape[]; labels?: string[] } }

/** Reads the live status name of a dev story. */
async function fetchDevStatus(devKey: string): Promise<string> {
  const issue = await jiraGet<{ fields: { status?: { name?: string } } }>(
    `/rest/api/2/issue/${encodeURIComponent(devKey)}?fields=status`,
  );
  return issue.fields.status?.name || '(unknown)';
}

/** Builds one preview row for a work-list entry from its live statuses. */
async function planOneRow(entry: WorkListEntry): Promise<PlanRow> {
  if (entry.skip) {
    return { storyKey: entry.story, action: 'skip', devSummary: '—', note: 'already cancelled in Jira' };
  }
  const story = await jiraGet<StoryIssue>(
    `/rest/api/2/issue/${encodeURIComponent(entry.story)}?fields=${STORY_FIELDS.join(',')}`,
  );
  const storyStatus = story.fields.status?.name || '(unknown)';
  if (bucketForStatus(storyStatus) === 'done') {
    return { storyKey: entry.story, action: 'skip', devSummary: '—', note: `story is "${storyStatus}" — untouched` };
  }
  const devStatuses: string[] = [];
  for (const devKey of entry.devs) devStatuses.push(`${devKey}=${await fetchDevStatus(devKey)}`);
  const action = decideAction(devStatuses.map((pair) => pair.split('=')[1]));
  return { storyKey: entry.story, action, devSummary: devStatuses.join(', '), note: `story: ${storyStatus}` };
}

// ── Apply helpers (one per side effect, so each stays small and testable by eye) ──

/** Flips the container link(s) for one story so each dev story becomes its container. */
async function applyLinkFlip(entry: WorkListEntry, story: StoryIssue, linkType: ContainerLinkType, log: (line: string) => void) {
  for (const devKey of entry.devs) {
    const plan = planLinkFlip(entry.story, devKey, story.fields.issuelinks ?? [], linkType);
    for (const linkId of plan.deleteLinkIds) {
      await jiraDelete(`/rest/api/2/issueLink/${encodeURIComponent(linkId)}`);
      log(`   deleted old ${linkType.name} link ${linkId}`);
    }
    await createIssueLink(plan.createPayload);
    log(`   linked ${devKey} as container of ${entry.story}`);
  }
}

/** Copies Description + Acceptance Criteria from the primary dev story onto the test story. */
async function applyClone(entry: WorkListEntry, acFieldId: string | null, log: (line: string) => void) {
  const devKey = entry.devs[0];
  const fieldList = acFieldId ? `${DESCRIPTION_FIELD_ID},${acFieldId}` : DESCRIPTION_FIELD_ID;
  const dev = await jiraGet<{ fields: Record<string, unknown> }>(
    `/rest/api/2/issue/${encodeURIComponent(devKey)}?fields=${fieldList}`,
  );
  const fields: Record<string, unknown> = { description: dev.fields.description ?? '' };
  if (acFieldId) fields[acFieldId] = dev.fields[acFieldId] ?? null;
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(entry.story)}`, { fields });
  log(`   cloned Description${acFieldId ? ' + AC' : ''} from ${devKey}`);
}

/** Adds the review label (never replacing existing labels) and assigns the story. */
async function applyLabelAndAssign(entry: WorkListEntry, story: StoryIssue, assignee: JiraUser | null, log: (line: string) => void) {
  const update: Record<string, unknown[]> = {};
  if (!(story.fields.labels ?? []).includes(REVIEW_LABEL)) update.labels = [{ add: REVIEW_LABEL }];
  if (assignee) {
    const value = assignee.name ? { name: assignee.name } : { accountId: assignee.accountId };
    update.assignee = [{ set: value }];
  }
  if (Object.keys(update).length === 0) return;
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(entry.story)}`, { update });
  log(`   label "${REVIEW_LABEL}"${assignee ? ` · assigned ${assignee.displayName || assignee.name}` : ''}`);
}

/** Performs a transition whose target status matches a pattern, filling any required reason field. */
async function applyTransition(storyKey: string, pattern: RegExp, log: (line: string) => void) {
  type TransitionWithFields = JiraTransition & {
    fields?: Record<string, { required?: boolean; name?: string; allowedValues?: Array<{ id?: string; value?: string }> }>;
  };
  const response = await jiraGet<{ transitions?: TransitionWithFields[] }>(
    `/rest/api/2/issue/${encodeURIComponent(storyKey)}/transitions?expand=transitions.fields`,
  );
  const available = response.transitions ?? [];
  const match = findTransitionMatching(available, pattern);
  if (!match) throw new Error(`no transition matching ${pattern} on ${storyKey}`);
  const transition = available.find((candidate) => candidate.id === match.id) as TransitionWithFields;
  const requiredFields: Record<string, unknown> = {};
  for (const [fieldId, meta] of Object.entries(transition.fields ?? {})) {
    if (!meta.required) continue;
    const firstAllowed = meta.allowedValues?.[0];
    requiredFields[fieldId] = firstAllowed
      ? (firstAllowed.id ? { id: firstAllowed.id } : { value: firstAllowed.value })
      : CANCEL_REASON_DEFAULT;
  }
  const body: Record<string, unknown> = { transition: { id: transition.id } };
  if (Object.keys(requiredFields).length > 0) body.fields = requiredFields;
  await jiraPost(`/rest/api/2/issue/${encodeURIComponent(storyKey)}/transitions`, body);
  log(`   transition "${transition.name}" → ${transition.to?.name}`);
}

/** Runs the full fix for one story, re-reading its live state immediately before acting. */
async function applyOneStory(entry: WorkListEntry, context: RunContext, log: (line: string) => void): Promise<StoryAction | 'skip'> {
  if (entry.skip) { log(`${entry.story}: skip (already cancelled)`); return 'skip'; }
  const story = await jiraGet<StoryIssue>(
    `/rest/api/2/issue/${encodeURIComponent(entry.story)}?fields=${STORY_FIELDS.join(',')}`,
  );
  if (bucketForStatus(story.fields.status?.name || '') === 'done') {
    log(`${entry.story}: skip (already "${story.fields.status?.name}")`); return 'skip';
  }
  const devStatuses: string[] = [];
  for (const devKey of entry.devs) devStatuses.push(await fetchDevStatus(devKey));
  const action = decideAction(devStatuses);
  log(`${entry.story}: ${action}`);
  if (action === 'cancel') { await applyTransition(entry.story, /cancel/i, log); return action; }
  await applyLinkFlip(entry, story, context.linkType, log);
  await applyClone(entry, context.acFieldId, log);
  if (action === 'ready-to-work') await applyTransition(entry.story, /ready to work/i, log);
  await applyLabelAndAssign(entry, story, context.assignee, log);
  return action;
}

// ── The panel ──

/** Admin Hub panel driving the one-time #508 SL/QE container-link remediation. */
export function SlQeContainerFixPanel(): React.ReactElement {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [onlyKey, setOnlyKey] = useState('');
  const [status, setStatus] = useState('');

  const selectedEntries = (): readonly WorkListEntry[] => {
    const trimmed = onlyKey.trim().toUpperCase();
    return trimmed ? WORK_LIST.filter((entry) => entry.story === trimmed) : WORK_LIST;
  };

  const runDryRun = async () => {
    setIsBusy(true); setStatus('Reading live statuses…'); setLog([]); setPreview(null);
    try {
      const { context, warnings } = await buildRunContext();
      const rows: PlanRow[] = [];
      for (const entry of selectedEntries()) rows.push(await planOneRow(entry));
      setPreview({ context, rows, warnings });
      setStatus('Dry run complete — nothing was changed.');
    } catch (error) {
      setStatus(`Dry run failed: ${toMessage(error)}`);
    } finally { setIsBusy(false); }
  };

  const runApply = async () => {
    if (!preview) return;
    const confirmed = window.confirm('Apply the fix to Jira now? This flips links, clones fields, cancels, labels and reassigns the listed stories.');
    if (!confirmed) return;
    setIsBusy(true); setStatus('Applying…');
    const lines: string[] = [];
    const log = (line: string) => { lines.push(line); setLog([...lines]); };
    try {
      for (const entry of selectedEntries()) {
        try { await applyOneStory(entry, preview.context, log); }
        catch (error) { log(`${entry.story}: ERROR — ${toMessage(error)}`); }
      }
      setStatus('Apply finished. Review the log below and spot-check in Jira.');
    } finally { setIsBusy(false); }
  };

  const tally = preview ? preview.rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.action] = (acc[row.action] || 0) + 1; return acc;
  }, {}) : {};

  return (
    <section className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>🔗 SL/QE Container Fix — #508 (one-time)</h3>
      <p className={styles.adminDescription}>
        Flips backwards Container links so the dev story is the container, clones its Description + Acceptance
        Criteria onto the test story, labels <strong>{REVIEW_LABEL}</strong> and assigns Belew, Dennis — or cancels
        the test story when its dev work is already done. Live statuses are re-read before every decision.
      </p>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Limit to one story (optional — for a pilot)</label>
        <input
          className={styles.inputField}
          placeholder="e.g. ENFCT-2032 — blank runs all"
          value={onlyKey}
          onChange={(event) => setOnlyKey(event.target.value)}
          disabled={isBusy}
        />
      </div>

      <div className={styles.panelSection}>
        <button className={styles.actionButton} onClick={runDryRun} disabled={isBusy} type="button">
          🔍 Dry run (preview)
        </button>
        <button className={styles.dangerButton} onClick={runApply} disabled={isBusy || !preview} type="button">
          ⚠️ Apply to Jira
        </button>
      </div>

      {status && <p className={styles.panelStatusLine}>{status}</p>}

      {preview && (
        <div className={styles.panelSection}>
          <p className={styles.panelStatusLine}>
            Container link: <strong>{preview.context.linkType.name}</strong> (outward “{preview.context.linkType.outward}”,
            inward “{preview.context.linkType.inward}”) · dev placed on the{' '}
            <strong>{preview.context.linkType.containerIsOutward ? 'outward' : 'inward'}</strong> side ·
            Assignee: <strong>{preview.context.assignee?.displayName || preview.context.assignee?.name || 'NOT FOUND'}</strong>
          </p>
          <p className={styles.panelStatusLine}>
            Plan: {Object.entries(tally).map(([action, count]) => `${count} ${action}`).join(' · ')}
          </p>
          {preview.warnings.map((warning) => (
            <p key={warning} className={styles.panelStatusLine}>⚠️ {warning}</p>
          ))}
          <table className={styles.rulesTable}>
            <thead>
              <tr><th>Story</th><th>Action</th><th>Dev (live status)</th><th>What happens</th></tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.storyKey}>
                  <td>{row.storyKey}</td>
                  <td>{row.action}</td>
                  <td>{row.devSummary}</td>
                  <td>{describeAction(row.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.length > 0 && (
        <div className={styles.panelSection}>
          <label className={styles.fieldLabel}>Apply log</label>
          <pre className={styles.diagnosticsResultPre}>{log.join('\n')}</pre>
        </div>
      )}
    </section>
  );
}
