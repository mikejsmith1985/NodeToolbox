// SubtaskPromotionPanel.tsx — Admin Hub tool that promotes Jira sub-tasks into Stories linked back to
// their old parent with a "contained within" link.
//
// Jira has no API that changes an issue's type, so a promotion is create-Story → link-to-parent →
// optionally retire the sub-task. Those are three separate Jira calls with no transaction across them,
// which is why this panel previews everything first, reports each step of each row independently, and
// keeps retiring the originals behind its own explicit button. A row that half-succeeds says so rather
// than being rolled back, because silently deleting a Story that was created but not linked would lose
// work that a person can otherwise finish by hand.

import React, { useState } from 'react';

import {
  createIssue,
  createIssueLink,
  getProjectIssueTypes,
  jiraDelete,
  jiraGet,
  jiraPost,
} from '../../services/jiraApi.ts';
import type { CreateMetaIssueType, JiraIssue } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';
import {
  DEFAULT_CONTAINMENT_PHRASE,
  buildContainmentLinkInput,
  buildPromotionPlan,
  buildStoryCreatePayload,
  findTransitionToStatus,
  resolveContainmentLinkDirection,
  type ContainmentLinkDirection,
  type JiraIssueLinkType,
  type JiraTransition,
  type SubtaskPromotionPlan,
} from './subtaskStoryPromotion.ts';

// ── Named constants ──

/** Fields the preview and the create payload both need. */
const SUBTASK_SEARCH_FIELDS = 'summary,status,parent,assignee,priority,labels,description,project';
/** A ceiling that keeps a mistyped JQL from sweeping a whole project into a bulk create. */
const MAX_SUBTASKS_PER_RUN = 200;

/** What happened to one sub-task, step by step, so a partial failure is legible. */
interface PromotionOutcome {
  subtaskKey: string;
  createdStoryKey: string | null;
  wasLinked: boolean;
  statusNote: string;
  errorMessage: string | null;
}

/** Reads a message off an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Renders the resolved link direction so the operator can see the sentence before it is written. */
function LinkDirectionNotice({ direction }: { direction: ContainmentLinkDirection | null }): React.ReactElement {
  if (!direction) {
    return (
      <p className={styles.sectionErrorText}>
        This Jira has no “{DEFAULT_CONTAINMENT_PHRASE}” link type. Nothing can be promoted until one exists.
      </p>
    );
  }
  return (
    <p className={styles.panelStatusLine}>
      Each new Story will read <strong>“{direction.storySeesPhrase}”</strong> its old parent,
      using the <strong>{direction.linkTypeName}</strong> link type.
    </p>
  );
}

/** The preview table: every sub-task that matched, and why any of them cannot run. */
function PromotionPreviewTable({
  plan, outcomeByKey,
}: { plan: SubtaskPromotionPlan; outcomeByKey: Record<string, PromotionOutcome> }): React.ReactElement {
  return (
    <table className={styles.installationsTable}>
      <thead>
        <tr>
          <th>Sub-task</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Parent</th><th>Result</th>
        </tr>
      </thead>
      <tbody>
        {plan.rows.map((row) => {
          const outcome = outcomeByKey[row.subtaskKey];
          return (
            <tr key={row.subtaskKey}>
              <td>{row.subtaskKey}</td>
              <td>{row.summary}</td>
              <td>{row.statusName}</td>
              <td>{row.assigneeDisplayName ?? '—'}</td>
              <td>{row.parentKey ?? '—'}</td>
              <td>
                {row.blockingReasons.length > 0 && (
                  <span className={styles.sectionErrorText}>{row.blockingReasons.join('; ')}</span>
                )}
                {outcome?.errorMessage && <span className={styles.sectionErrorText}>{outcome.errorMessage}</span>}
                {outcome?.createdStoryKey && (
                  <span>
                    ✓ {outcome.createdStoryKey}
                    {outcome.wasLinked ? ' · linked' : ' · NOT LINKED'}
                    {outcome.statusNote ? ` · ${outcome.statusNote}` : ''}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The Admin Hub sub-task → Story promotion panel. */
export function SubtaskPromotionPanel(): React.ReactElement {
  const [jqlText, setJqlText] = useState('issuetype = Sub-task AND project = ');
  const [subtaskIssues, setSubtaskIssues] = useState<JiraIssue[]>([]);
  const [linkDirection, setLinkDirection] = useState<ContainmentLinkDirection | null>(null);
  const [issueTypeOptions, setIssueTypeOptions] = useState<CreateMetaIssueType[]>([]);
  const [selectedIssueTypeId, setSelectedIssueTypeId] = useState('');
  const [shouldMatchStatus, setShouldMatchStatus] = useState(true);
  const [outcomeByKey, setOutcomeByKey] = useState<Record<string, PromotionOutcome>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const plan = buildPromotionPlan(subtaskIssues, linkDirection);
  const hasPromoted = Object.keys(outcomeByKey).length > 0;
  const retirableKeys = Object.values(outcomeByKey)
    .filter((outcome) => outcome.createdStoryKey !== null && outcome.wasLinked)
    .map((outcome) => outcome.subtaskKey);

  /** Loads the sub-tasks, the instance's link types, and the target project's issue types together. */
  async function handlePreview(): Promise<void> {
    setIsBusy(true);
    setStatusMessage('Loading…');
    setOutcomeByKey({});
    try {
      const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}`
        + `&fields=${encodeURIComponent(SUBTASK_SEARCH_FIELDS)}&maxResults=${MAX_SUBTASKS_PER_RUN}`;
      const searchResult = await jiraGet<{ issues?: JiraIssue[]; total?: number }>(searchPath);
      const foundIssues = searchResult.issues ?? [];

      const linkTypeResult = await jiraGet<{ issueLinkTypes?: JiraIssueLinkType[] }>('/rest/api/2/issueLinkType');
      setLinkDirection(resolveContainmentLinkDirection(linkTypeResult.issueLinkTypes ?? []));

      const firstProjectKey = String(foundIssues[0]?.key ?? '').split('-')[0];
      if (firstProjectKey) {
        const issueTypes = await getProjectIssueTypes(firstProjectKey);
        const creatableTypes = (issueTypes.values ?? []).filter((issueType) => !issueType.subtask);
        setIssueTypeOptions(creatableTypes);
        setSelectedIssueTypeId(
          creatableTypes.find((issueType) => /^story$/i.test(issueType.name ?? ''))?.id ?? '',
        );
      }

      setSubtaskIssues(foundIssues);
      setStatusMessage(
        `${foundIssues.length} sub-tasks matched`
        + ((searchResult.total ?? 0) > foundIssues.length
          ? ` (of ${searchResult.total} — only the first ${MAX_SUBTASKS_PER_RUN} are shown; narrow the JQL)`
          : ''),
      );
    } catch (error) {
      setStatusMessage(`Failed: ${toMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  /** Moves the new Story onto the sub-task's status where a single transition can reach it. */
  async function applyMatchingStatus(newStoryKey: string, targetStatusName: string): Promise<string> {
    if (!shouldMatchStatus || !targetStatusName) return '';
    const transitionsResult = await jiraGet<{ transitions?: JiraTransition[] }>(
      `/rest/api/2/issue/${encodeURIComponent(newStoryKey)}/transitions`,
    );
    const matchingTransition = findTransitionToStatus(transitionsResult.transitions ?? [], targetStatusName);
    if (!matchingTransition) return `status left at default (no transition to “${targetStatusName}”)`;

    await jiraPost(`/rest/api/2/issue/${encodeURIComponent(newStoryKey)}/transitions`, {
      transition: { id: matchingTransition.id },
    });
    return `status set to ${targetStatusName}`;
  }

  /** Creates the Story, links it to the old parent, and optionally matches the original status. */
  async function promoteOneSubtask(subtaskIssue: JiraIssue, parentKey: string): Promise<PromotionOutcome> {
    const outcome: PromotionOutcome = {
      subtaskKey: subtaskIssue.key, createdStoryKey: null, wasLinked: false, statusNote: '', errorMessage: null,
    };

    try {
      const createPayload = buildStoryCreatePayload(subtaskIssue, parentKey, {
        storyIssueTypeId: selectedIssueTypeId,
      });
      const createdStory = await createIssue(createPayload);
      outcome.createdStoryKey = createdStory.key;

      // Create and link are separate Jira calls with no transaction between them, so a link failure is
      // recorded against a Story that genuinely exists rather than pretending the row never ran.
      await createIssueLink(buildContainmentLinkInput(linkDirection!, createdStory.key, parentKey));
      outcome.wasLinked = true;

      const statusName = (subtaskIssue.fields as unknown as { status?: { name?: string } }).status?.name ?? '';
      outcome.statusNote = await applyMatchingStatus(createdStory.key, statusName);
    } catch (error) {
      outcome.errorMessage = toMessage(error);
    }
    return outcome;
  }

  /** Runs the promotion for every row the preview marked as ready. */
  async function handlePromote(): Promise<void> {
    setIsBusy(true);
    setStatusMessage('Promoting…');
    const collectedOutcomes: Record<string, PromotionOutcome> = {};

    for (const row of plan.rows) {
      if (row.blockingReasons.length > 0) continue;
      const subtaskIssue = subtaskIssues.find((issue) => issue.key === row.subtaskKey)!;
      collectedOutcomes[row.subtaskKey] = await promoteOneSubtask(subtaskIssue, row.parentKey!);
      setOutcomeByKey({ ...collectedOutcomes });
    }

    const successCount = Object.values(collectedOutcomes).filter((outcome) => outcome.wasLinked).length;
    setStatusMessage(`${successCount} of ${plan.promotableCount} promoted and linked.`);
    setIsBusy(false);
  }

  /** Deletes only the sub-tasks whose replacement Story exists AND is linked to the parent. */
  async function handleRetireOriginals(): Promise<void> {
    setIsBusy(true);
    setStatusMessage('Deleting the original sub-tasks…');
    let deletedCount = 0;

    for (const subtaskKey of retirableKeys) {
      try {
        await jiraDelete(`/rest/api/2/issue/${encodeURIComponent(subtaskKey)}`);
        deletedCount += 1;
      } catch (error) {
        setStatusMessage(`Stopped after ${deletedCount}: ${toMessage(error)}`);
        setIsBusy(false);
        return;
      }
    }

    setStatusMessage(`${deletedCount} original sub-tasks deleted.`);
    setIsBusy(false);
  }

  return (
    <div className={styles.panelCard} data-testid="subtask-promotion-panel">
      <h3 className={styles.sectionTitle}>Promote sub-tasks to Stories</h3>
      <p className={styles.adminDescription}>
        Jira cannot change an issue&apos;s type through its API, so each sub-task is recreated as a Story
        and linked back to its old parent. Nothing is created until you press Promote, and the original
        sub-tasks are only deleted by the separate button that appears afterwards.
      </p>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel} htmlFor="subtask-promotion-jql">
          JQL selecting the sub-tasks to promote
        </label>
        <input
          className={styles.inputField}
          id="subtask-promotion-jql"
          onChange={(changeEvent) => setJqlText(changeEvent.target.value)}
          placeholder="issuetype = Sub-task AND project = ENCUC AND creator = currentUser()"
          value={jqlText}
        />
        <div className={styles.actionRow}>
          <button className={styles.actionButton} disabled={isBusy} onClick={() => void handlePreview()} type="button">
            Preview
          </button>
        </div>
      </div>

      {subtaskIssues.length > 0 && (
        <div className={styles.panelSection}>
          <LinkDirectionNotice direction={linkDirection} />

          <label className={styles.fieldLabel} htmlFor="subtask-promotion-type">Create each one as</label>
          <select
            className={styles.inputField}
            id="subtask-promotion-type"
            onChange={(changeEvent) => setSelectedIssueTypeId(changeEvent.target.value)}
            value={selectedIssueTypeId}
          >
            <option value="">Choose an issue type…</option>
            {issueTypeOptions.map((issueType) => (
              <option key={issueType.id} value={issueType.id}>{issueType.name}</option>
            ))}
          </select>

          <label className={styles.flagRow}>
            <input
              checked={shouldMatchStatus}
              onChange={(changeEvent) => setShouldMatchStatus(changeEvent.target.checked)}
              type="checkbox"
            />
            Move each new Story to the sub-task&apos;s status where a transition allows it
          </label>

          <PromotionPreviewTable outcomeByKey={outcomeByKey} plan={plan} />

          <p className={styles.confirmationText}>
            {plan.promotableCount} ready to promote{plan.blockedCount > 0 ? `, ${plan.blockedCount} blocked` : ''}.
          </p>
          <div className={styles.actionRow}>
            <button
              className={styles.actionButton}
              disabled={isBusy || plan.promotableCount === 0 || !selectedIssueTypeId || !linkDirection}
              onClick={() => void handlePromote()}
              type="button"
            >
              Promote {plan.promotableCount} sub-tasks
            </button>
          </div>
        </div>
      )}

      {hasPromoted && retirableKeys.length > 0 && (
        <div className={styles.panelSection}>
          <p className={styles.confirmationText}>
            {retirableKeys.length} original sub-tasks now have a linked Story. Deleting them is permanent —
            Jira has no undo for a deleted issue.
          </p>
          <button
            className={styles.dangerButton}
            disabled={isBusy}
            onClick={() => void handleRetireOriginals()}
            type="button"
          >
            Delete the {retirableKeys.length} original sub-tasks
          </button>
        </div>
      )}

      {statusMessage && <p className={styles.panelStatusLine}>{statusMessage}</p>}
    </div>
  );
}
