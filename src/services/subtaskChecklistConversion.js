// subtaskChecklistConversion.js — Turns Jira sub-tasks into Smart Checklist items on their parent.
//
// Jira ships a one-way door: Smart Checklist items can be promoted to sub-tasks, but nothing converts
// sub-tasks back into checklist items, and certainly not in bulk. This module is the pure half of that
// missing conversion — it decides WHAT text should end up on each parent, and never talks to Jira.
//
// Two rules shape everything here, because this feeds a bulk write against production Jira:
//   1. The parent's existing checklist is never overwritten, only added to. A team that already keeps a
//      checklist on the parent must not lose it because a sub-task sweep ran over the top of it.
//   2. Re-running must change nothing. Every line is matched before it is added, so a half-finished run
//      can simply be run again rather than doubling every item.

'use strict';

// ── Named constants ──

/** Status category Jira uses for "this work is finished", regardless of the status name on top of it. */
const DONE_STATUS_CATEGORY_KEY = 'done';
/** Status category Jira uses for work that has started but is not finished. */
const IN_PROGRESS_STATUS_CATEGORY_KEY = 'indeterminate';

/**
 * Smart Checklist markdown: an item's state lives in its checkbox marker.
 *
 * A checklist item carries the same three states a sub-task does, so a sub-task's state survives the
 * conversion as a real checklist state rather than as a note a human has to read.
 */
const DEFAULT_OPEN_ITEM_PREFIX = '- [ ] ';
const DEFAULT_IN_PROGRESS_ITEM_PREFIX = '- [>] ';
const DEFAULT_DONE_ITEM_PREFIX = '- [x] ';
const DEFAULT_HEADING_PREFIX = '# ';

/** Fields a sub-task can carry that a checklist item cannot represent, so the caller can warn about them. */
const LOSSY_FIELD_LABELS = {
  worklog: 'logged time',
  comment: 'comments',
  issuelinks: 'issue links',
  subtaskStoryPoints: 'story points',
};

// ── Field discovery ──

/**
 * Picks the custom fields that look like they hold Smart Checklist data.
 *
 * The checklist field belongs to a paid third-party app, so its id differs per Jira instance and cannot
 * be hard-coded. Rather than guess, the caller shows these candidates to a human to confirm.
 *
 * @param {Array<{id?: string, name?: string, custom?: boolean, schema?: {custom?: string}}>} fieldCatalog
 *        The response body of /rest/api/2/field.
 * @returns {Array<{id: string, name: string, schemaType: string}>} Candidates, most likely first.
 */
function findChecklistFieldCandidates(fieldCatalog) {
  const catalogEntries = Array.isArray(fieldCatalog) ? fieldCatalog : [];

  return catalogEntries
    .filter((field) => /checklist/i.test(String(field.name || '')) || /checklist/i.test(String(field.schema?.custom || '')))
    .map((field) => ({
      id: String(field.id || ''),
      name: String(field.name || ''),
      schemaType: String(field.schema?.custom || ''),
    }))
    .filter((candidate) => candidate.id !== '')
    // A field whose NAME says checklist is a stronger signal than one that merely comes from that app.
    .sort((firstCandidate, secondCandidate) => {
      const firstScore = /checklist/i.test(firstCandidate.name) ? 0 : 1;
      const secondScore = /checklist/i.test(secondCandidate.name) ? 0 : 1;
      return firstScore - secondScore;
    });
}

// ── Reading a sub-task ──

/** True when Jira considers this issue finished, read from the status CATEGORY not the status name. */
function isSubtaskDone(subtaskIssue) {
  const statusCategoryKey = subtaskIssue?.fields?.status?.statusCategory?.key;
  return String(statusCategoryKey || '').toLowerCase() === DONE_STATUS_CATEGORY_KEY;
}

/**
 * Chooses the checklist checkbox marker that matches the sub-task's state.
 *
 * The status CATEGORY is read rather than the status name, because a team's status names are theirs to
 * invent — "Ready for QA" and "In Dev" are both in-progress work, and only the category says so.
 */
function resolveChecklistItemPrefix(subtaskIssue, options = {}) {
  const {
    openItemPrefix = DEFAULT_OPEN_ITEM_PREFIX,
    inProgressItemPrefix = DEFAULT_IN_PROGRESS_ITEM_PREFIX,
    doneItemPrefix = DEFAULT_DONE_ITEM_PREFIX,
  } = options;

  const statusCategoryKey = String(subtaskIssue?.fields?.status?.statusCategory?.key || '').toLowerCase();
  if (statusCategoryKey === DONE_STATUS_CATEGORY_KEY) return doneItemPrefix;
  if (statusCategoryKey === IN_PROGRESS_STATUS_CATEGORY_KEY) return inProgressItemPrefix;
  return openItemPrefix;
}

/**
 * The user id Smart Checklist needs to assign an item, which is NOT the display name.
 *
 * This Jira is Data Center, where a person is identified by username — display names here read
 * "Lastname, Firstname (CTR)" and would never resolve to an account if used as a mention.
 */
function readAssigneeUserId(subtaskIssue) {
  const assignee = subtaskIssue?.fields?.assignee;
  if (!assignee) return null;
  const userId = assignee.name || assignee.key || assignee.accountId || '';
  return userId ? String(userId) : null;
}

/** The parent key a sub-task hangs from, or null when Jira returned it without one. */
function readParentKey(subtaskIssue) {
  const parentKey = subtaskIssue?.fields?.parent?.key;
  return parentKey ? String(parentKey) : null;
}

/**
 * Names everything on this sub-task that a checklist item cannot hold.
 *
 * Converting is one-way and lossy. Surfacing the loss BEFORE the write is the difference between an
 * informed decision and an unpleasant discovery.
 *
 * @returns {string[]} Human-readable labels, empty when the sub-task carries nothing but its summary.
 */
function describeLossyContent(subtaskIssue, storyPointsFieldIds = []) {
  const issueFields = subtaskIssue?.fields || {};
  const lossyLabels = [];

  if (Array.isArray(issueFields.worklog?.worklogs) && issueFields.worklog.worklogs.length > 0) {
    lossyLabels.push(LOSSY_FIELD_LABELS.worklog);
  }
  if (Array.isArray(issueFields.comment?.comments) && issueFields.comment.comments.length > 0) {
    lossyLabels.push(LOSSY_FIELD_LABELS.comment);
  }
  if (Array.isArray(issueFields.issuelinks) && issueFields.issuelinks.length > 0) {
    lossyLabels.push(LOSSY_FIELD_LABELS.issuelinks);
  }
  const hasStoryPoints = storyPointsFieldIds.some((fieldId) => {
    const pointValue = issueFields[fieldId];
    return typeof pointValue === 'number' && pointValue > 0;
  });
  if (hasStoryPoints) {
    lossyLabels.push(LOSSY_FIELD_LABELS.subtaskStoryPoints);
  }

  return lossyLabels;
}

// ── Rendering checklist text ──

/**
 * Renders one sub-task as a single Smart Checklist line.
 *
 * Three things survive the conversion as real checklist data rather than as prose: the state (in the
 * checkbox marker), the owner (as an `@userid` mention Smart Checklist resolves to that person), and the
 * sub-task key, so the item can still be traced back to the issue it came from once that issue is gone.
 *
 * The Jira status NAME is kept as a trailing note as well, because the checklist's three states cannot
 * express the difference between "In Dev" and "Ready for QA" and that distinction is worth keeping.
 */
function renderChecklistLine(subtaskIssue, options = {}) {
  const {
    shouldIncludeKey = true,
    shouldIncludeStatus = true,
    shouldIncludeAssignee = true,
  } = options;

  const linePrefix = resolveChecklistItemPrefix(subtaskIssue, options);
  const summaryText = String(subtaskIssue?.fields?.summary || '').replace(/\s+/g, ' ').trim();
  const keyText = shouldIncludeKey ? `${subtaskIssue.key} ` : '';

  const assigneeUserId = shouldIncludeAssignee ? readAssigneeUserId(subtaskIssue) : null;
  const assigneeText = assigneeUserId ? ` @${assigneeUserId}` : '';

  const statusName = subtaskIssue?.fields?.status?.name;
  const noteText = shouldIncludeStatus && statusName ? ` (${String(statusName)})` : '';

  return `${linePrefix}${keyText}${summaryText}${assigneeText}${noteText}`;
}

/**
 * Renders the whole block one parent gains: an optional heading plus one line per sub-task.
 *
 * Sub-tasks are rendered in ascending key order so a re-run produces byte-identical text.
 */
function renderChecklistBlock(subtaskIssues, options = {}) {
  const { headingText = 'Converted sub-tasks', headingPrefix = DEFAULT_HEADING_PREFIX } = options;

  const orderedSubtasks = [...subtaskIssues].sort((firstIssue, secondIssue) =>
    String(firstIssue.key).localeCompare(String(secondIssue.key), undefined, { numeric: true }));

  const itemLines = orderedSubtasks.map((subtaskIssue) => renderChecklistLine(subtaskIssue, options));
  const headingLine = headingText ? [`${headingPrefix}${headingText}`] : [];

  return [...headingLine, ...itemLines].join('\n');
}

// ── Merging without destroying ──

/** Strips the checkbox marker so an item can be matched whether or not it has since been ticked. */
function normalizeChecklistLineForMatching(checklistLine) {
  return String(checklistLine)
    .replace(/^\s*[-*+]?\s*\[[^\]]*\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Decides whether the parent's checklist already represents this sub-task.
 *
 * Matching prefers the sub-task KEY, because the summary may have been reworded on the checklist since
 * the conversion ran. Without a key in the line it falls back to the normalized summary text.
 */
function checklistContainsSubtask(existingChecklistText, subtaskIssue) {
  const existingLines = String(existingChecklistText || '').split(/\r?\n/);
  const subtaskKey = String(subtaskIssue?.key || '');
  const summaryFingerprint = normalizeChecklistLineForMatching(
    String(subtaskIssue?.fields?.summary || ''),
  );

  return existingLines.some((existingLine) => {
    if (subtaskKey && new RegExp(`\\b${subtaskKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(existingLine)) {
      return true;
    }
    if (!summaryFingerprint) return false;
    return normalizeChecklistLineForMatching(existingLine).startsWith(summaryFingerprint);
  });
}

/**
 * Produces the parent's new checklist text: everything it already had, plus only the sub-tasks it does
 * not already represent.
 *
 * Returns the unchanged original when every sub-task is already present, so callers can skip the write
 * entirely rather than issuing a no-op update.
 */
function mergeChecklistText(existingChecklistText, subtaskIssues, options = {}) {
  const existingText = String(existingChecklistText || '');
  const missingSubtasks = subtaskIssues.filter(
    (subtaskIssue) => !checklistContainsSubtask(existingText, subtaskIssue),
  );

  if (missingSubtasks.length === 0) {
    return { mergedText: existingText, addedSubtaskKeys: [], hasChanged: false };
  }

  // A heading is only worth adding the first time; a re-run that adds one late item should not repeat it.
  const headingText = existingText.includes(options.headingText ?? 'Converted sub-tasks')
    ? ''
    : (options.headingText ?? 'Converted sub-tasks');
  const newBlock = renderChecklistBlock(missingSubtasks, { ...options, headingText });
  const separator = existingText.trim() === '' ? '' : '\n';

  return {
    mergedText: `${existingText.replace(/\s+$/, '')}${separator}${newBlock}`,
    addedSubtaskKeys: missingSubtasks.map((subtaskIssue) => String(subtaskIssue.key)),
    hasChanged: true,
  };
}

// ── Building the plan ──

/** Buckets sub-tasks under the parent they belong to, dropping any Jira returned without a parent. */
function groupSubtasksByParent(subtaskIssues) {
  const subtasksByParentKey = new Map();
  const orphanedSubtaskKeys = [];

  for (const subtaskIssue of subtaskIssues) {
    const parentKey = readParentKey(subtaskIssue);
    if (!parentKey) {
      orphanedSubtaskKeys.push(String(subtaskIssue.key));
      continue;
    }
    const existingGroup = subtasksByParentKey.get(parentKey) || [];
    existingGroup.push(subtaskIssue);
    subtasksByParentKey.set(parentKey, existingGroup);
  }

  return { subtasksByParentKey, orphanedSubtaskKeys };
}

/**
 * Builds the complete conversion plan: for every parent, the exact text that would replace its checklist
 * field, which sub-tasks that text accounts for, and what converting them would throw away.
 *
 * This function performs NO writes and is the only thing the dry run needs — so what a human approves in
 * the preview is literally what gets sent.
 */
function buildConversionPlan(subtaskIssues, parentChecklistTextByKey, options = {}) {
  const { subtasksByParentKey, orphanedSubtaskKeys } = groupSubtasksByParent(subtaskIssues);
  const parentPlans = [];

  for (const [parentKey, groupedSubtasks] of [...subtasksByParentKey.entries()].sort()) {
    const existingChecklistText = parentChecklistTextByKey[parentKey] ?? '';
    const mergeResult = mergeChecklistText(existingChecklistText, groupedSubtasks, options);

    parentPlans.push({
      parentKey,
      previousChecklistText: existingChecklistText,
      nextChecklistText: mergeResult.mergedText,
      hasChanged: mergeResult.hasChanged,
      subtaskKeys: groupedSubtasks.map((subtaskIssue) => String(subtaskIssue.key)),
      addedSubtaskKeys: mergeResult.addedSubtaskKeys,
      lossWarnings: groupedSubtasks
        .map((subtaskIssue) => ({
          subtaskKey: String(subtaskIssue.key),
          losesContent: describeLossyContent(subtaskIssue, options.storyPointsFieldIds || []),
        }))
        .filter((warning) => warning.losesContent.length > 0),
    });
  }

  return {
    parentPlans,
    orphanedSubtaskKeys,
    totalSubtaskCount: subtaskIssues.length,
    changedParentCount: parentPlans.filter((parentPlan) => parentPlan.hasChanged).length,
  };
}

module.exports = {
  DONE_STATUS_CATEGORY_KEY,
  IN_PROGRESS_STATUS_CATEGORY_KEY,
  DEFAULT_OPEN_ITEM_PREFIX,
  DEFAULT_IN_PROGRESS_ITEM_PREFIX,
  DEFAULT_DONE_ITEM_PREFIX,
  DEFAULT_HEADING_PREFIX,
  findChecklistFieldCandidates,
  isSubtaskDone,
  resolveChecklistItemPrefix,
  readAssigneeUserId,
  readParentKey,
  describeLossyContent,
  renderChecklistLine,
  renderChecklistBlock,
  checklistContainsSubtask,
  mergeChecklistText,
  groupSubtasksByParent,
  buildConversionPlan,
};
