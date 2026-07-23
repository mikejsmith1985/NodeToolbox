// issueFlowHistory.ts — Reads an issue's changelog into a record of WHO held it, and from when.
//
// The Personal Workflow report has its own reader, and it deliberately collapses every assignee
// change to a boolean: "was this the person I am measuring?". That collapse is why it can tell you
// how long someone held an issue but never who had it the rest of the time — the identity is thrown
// away before the engine ever sees it.
//
// This reader keeps the identity. It is additive: the existing boolean reader is untouched, because
// the person-centric report still needs exactly what it produces.
//
// The Unassigned holder is deliberately a VALUE rather than an absence. An issue sitting in nobody's
// queue is usually the single largest delay on it; representing that as "no holder" would let the
// span be dropped or merged into the next person's, which would hide the delay and flatter whoever
// picked the issue up.

/** A person who held an issue — or, explicitly, nobody. */
export interface IssueHolder {
  /** The machine id Jira used (username or account id), or null when nobody held it. */
  holderId: string | null;
  /** Display name, or the literal "Unassigned". Never blank. */
  holderName: string;
}

/** A dated hand-off: from this instant, the issue was held by this holder. */
export interface IssueHolderTransition {
  atIso: string;
  holder: IssueHolder;
}

/** Who held the issue at creation, plus every subsequent hand-off in chronological order. */
export interface IssueHolderHistory {
  initialHolder: IssueHolder;
  holderTransitions: IssueHolderTransition[];
}

/** The explicit "nobody holds this" holder — a real value so queue time can never be silently lost. */
export const UNASSIGNED_HOLDER: IssueHolder = { holderId: null, holderName: 'Unassigned' };

/** A dated status change, in the same shape the flow engine consumes. */
export interface IssueStatusTransition {
  atIso: string;
  toStatusId: string;
}

/** The issue's status at creation, plus every subsequent status change in chronological order. */
export interface IssueStatusHistory {
  initialStatusId: string | null;
  statusTransitions: IssueStatusTransition[];
}

/** The shape of the raw Jira issue this reader consumes; deliberately loose, as Jira omits fields freely. */
interface RawFlowIssue {
  key?: string;
  fields?: {
    summary?: string;
    created?: string | null;
    status?: { id?: string } | null;
    assignee?: { displayName?: string; name?: string; key?: string; accountId?: string } | null;
  } & Record<string, unknown> | null;
  changelog?: { histories?: ReadonlyArray<RawFlowHistory> } | null;
}

interface RawFlowHistory {
  created?: string;
  items?: ReadonlyArray<Record<string, unknown>>;
}

/** Reads a changelog value as text, since Jira types these fields inconsistently across versions. */
function readAsText(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Builds a holder from a changelog side (its machine id and display name).
 *
 * With no machine id, the side means "nobody" — which is the Unassigned holder, not a gap. Where
 * Jira supplies an id but no name, the id is shown: a visible identifier beats a blank cell.
 */
function toHolder(machineValue: unknown, displayValue: unknown): IssueHolder {
  const holderId = readAsText(machineValue);
  if (holderId === null) return UNASSIGNED_HOLDER;
  return { holderId, holderName: readAsText(displayValue) ?? holderId };
}

/** Returns histories that carry a genuinely parseable timestamp, oldest first. */
function readSortedHistories(issue: RawFlowIssue): Array<RawFlowHistory & { created: string }> {
  return (issue.changelog?.histories ?? [])
    .filter((history): history is RawFlowHistory & { created: string } =>
      typeof history.created === 'string' && !Number.isNaN(Date.parse(history.created)))
    .slice()
    .sort((first, second) => Date.parse(first.created) - Date.parse(second.created));
}

/**
 * Reconstructs who held the issue over its life.
 *
 * The starting holder is read from the FIRST hand-off's `from` side rather than from the issue's
 * current assignee: the current field says who has it now, which for a reassigned issue would credit
 * the present holder with time they never had. The current assignee is used only when the issue was
 * never reassigned, in which case it is the same person throughout.
 */
export function readIssueHolderHistory(issue: RawFlowIssue): IssueHolderHistory {
  const holderTransitions: IssueHolderTransition[] = [];
  let firstAssigneeItem: Record<string, unknown> | null = null;

  for (const history of readSortedHistories(issue)) {
    for (const item of history.items ?? []) {
      if (item.field !== 'assignee') continue;
      if (firstAssigneeItem === null) firstAssigneeItem = item;
      holderTransitions.push({ atIso: history.created, holder: toHolder(item.to, item.toString) });
    }
  }

  return { initialHolder: resolveInitialHolder(firstAssigneeItem, issue), holderTransitions };
}

/**
 * Reconstructs what status the issue was in over its life.
 *
 * The starting status comes from the first status change's `from` side for the same reason the
 * starting holder does: the current status field describes now, not creation.
 */
export function readIssueStatusHistory(issue: RawFlowIssue): IssueStatusHistory {
  const statusTransitions: IssueStatusTransition[] = [];
  let initialStatusId: string | null = null;
  let hasStatusChange = false;

  for (const history of readSortedHistories(issue)) {
    for (const item of history.items ?? []) {
      if (item.field !== 'status') continue;
      if (!hasStatusChange) {
        initialStatusId = readAsText(item.from);
        hasStatusChange = true;
      }
      const toStatusId = readAsText(item.to);
      if (toStatusId !== null) statusTransitions.push({ atIso: history.created, toStatusId });
    }
  }

  // Never moved: it is still in the status it was created in.
  if (!hasStatusChange) initialStatusId = issue.fields?.status?.id ?? null;
  return { initialStatusId, statusTransitions };
}

/** Determines who held the issue at creation — see `readIssueHolderHistory` for why the order matters. */
function resolveInitialHolder(
  firstAssigneeItem: Record<string, unknown> | null,
  issue: RawFlowIssue,
): IssueHolder {
  if (firstAssigneeItem !== null) {
    return toHolder(firstAssigneeItem.from, firstAssigneeItem.fromString);
  }

  const currentAssignee = issue.fields?.assignee ?? null;
  if (currentAssignee === null) return UNASSIGNED_HOLDER;
  const currentMachineId = currentAssignee.name ?? currentAssignee.key ?? currentAssignee.accountId;
  return toHolder(currentMachineId, currentAssignee.displayName);
}
