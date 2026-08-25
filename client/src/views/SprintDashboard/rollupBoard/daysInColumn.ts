// daysInColumn.ts — How long a card has been sitting where it is.
//
// A board tells you where work IS and says nothing about how long it has been there, so a card
// stuck for three weeks looks exactly like one that moved this morning. That is the single most
// useful thing a standup can read off a board, and it was the one thing missing.
//
// A column here is a STATUS AND SUB-STATUS pair, so the moment a card entered its column is the
// later of the last change into that status and the last change into that sub-status. Taking only
// the status would report a card as ancient the moment it was moved between two columns that share
// one status — which is most of this team's board.
//
// Pure: it reads a changelog it is handed and counts days against a day it is handed. No clock, no
// fetch, so the arithmetic that decides whether a card looks stale is testable without either.

/** One changelog entry, reduced to what an entry-time lookup reads. */
export interface ColumnChangeHistory {
  created?: string;
  items?: Array<{ field?: string; fieldId?: string; toString?: string | null }>;
}

/** Jira names the status field this way in a changelog, whatever the API calls it elsewhere. */
const STATUS_CHANGE_FIELD = 'status';

const MILLISECONDS_PER_DAY = 86_400_000;

/** Whether one changelog item moved an issue INTO a named value of a named field. */
function isMoveInto(
  item: NonNullable<ColumnChangeHistory['items']>[number],
  fieldNames: readonly string[],
  targetValue: string,
): boolean {
  const changedField = (item.field ?? item.fieldId ?? '').trim().toLowerCase();
  const matchesField = fieldNames.some((fieldName) => changedField === fieldName.trim().toLowerCase());
  return matchesField && (item.toString ?? '').trim() === targetValue.trim();
}

/** The most recent moment an issue moved into a named value of a named field. */
function readLastMoveInto(
  changeHistories: readonly ColumnChangeHistory[],
  fieldNames: readonly string[],
  targetValue: string | null,
): string | null {
  if (targetValue === null || targetValue.trim() === '') {
    return null;
  }

  const entryTimes = changeHistories
    .filter((history) => (history.items ?? []).some((item) => isMoveInto(item, fieldNames, targetValue)))
    .map((history) => history.created ?? '')
    .filter((createdIso) => createdIso !== '')
    .sort();

  return entryTimes[entryTimes.length - 1] ?? null;
}

/** Everything the entry-time lookup needs about one card and its instance. */
export interface ColumnEntryInput {
  changeHistories: readonly ColumnChangeHistory[];
  statusName: string;
  subStatusValue: string | null;
  /** The instance's sub-status field NAMES, as they appear in a changelog. */
  subStatusFieldNames: readonly string[];
  /** When the issue was created — the answer for work that has never moved. */
  createdIso: string | null;
}

/**
 * When a card entered the column it is in now.
 *
 * The LATER of its last move into this status and its last move into this sub-status, because the
 * column is the pair. A card moved from "Working · Dev" to "Working · Code Review" has entered a new
 * column without its status changing at all, and reporting it by status alone would age it from
 * whenever it first started being worked on.
 *
 * Falls back to the creation date, which is the honest answer for work that has never moved: it has
 * been in this column since it existed. Returns null only when even that is unknown, so the caller
 * can show nothing rather than a zero that claims it just arrived.
 */
export function readColumnEntryIso(input: ColumnEntryInput): string | null {
  const statusEntryIso = readLastMoveInto(input.changeHistories, [STATUS_CHANGE_FIELD], input.statusName);
  const subStatusEntryIso = readLastMoveInto(
    input.changeHistories,
    input.subStatusFieldNames,
    input.subStatusValue,
  );

  const candidateIsos = [statusEntryIso, subStatusEntryIso]
    .filter((entryIso): entryIso is string => entryIso !== null)
    .sort();
  const latestEntryIso = candidateIsos[candidateIsos.length - 1] ?? null;

  return latestEntryIso ?? (input.createdIso === null || input.createdIso === '' ? null : input.createdIso);
}

/**
 * Whole days between an entry moment and now.
 *
 * Calendar days, not working days: a card that has sat over a weekend has sat over a weekend, and
 * anybody looking at a board to find stuck work means elapsed time. The forecast's working-day
 * arithmetic answers a different question — how much runway is left — and mixing the two here would
 * make a card look fresher than the room feels.
 *
 * Floored, so a card that moved four hours ago reads 0 rather than rounding up to a day it has not
 * yet spent. Never negative: a clock skew must not produce a card that arrives tomorrow.
 */
export function countDaysInColumn(columnEntryIso: string | null, nowIso: string): number | null {
  if (columnEntryIso === null) {
    return null;
  }

  const enteredMs = new Date(columnEntryIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(enteredMs) || !Number.isFinite(nowMs)) {
    return null;
  }

  return Math.max(0, Math.floor((nowMs - enteredMs) / MILLISECONDS_PER_DAY));
}
