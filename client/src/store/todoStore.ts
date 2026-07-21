// todoStore.ts — Shared reactive store for the personal free-form to-do list.
//
// The list is managed on the My Issues "To-Do" tab (a three-column Kanban board) and fed from
// anywhere via the global F1 quick-add popup, so the items live in one app-wide store
// (aiAssistStore precedent). Items persist to localStorage so the list survives restarts — they
// are personal notes, never Jira data, and deliberately have no server side.

import { create } from 'zustand';

/** localStorage key holding the serialized to-do items. */
export const TODO_ITEMS_STORAGE_KEY = 'tbxTodoItems';

/** The three Kanban columns, left-to-right, that every item lives in exactly one of. */
export const TODO_STATUSES = ['todo', 'inProgress', 'done'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * How long a completed item lingers in the Done column before it is auto-cleared.
 * Retention is per-item and rolling: a card disappears two weeks after IT was completed, so a
 * freshly finished card is never swept away with older ones.
 */
export const DONE_RETENTION_DAYS = 14;
const MILLISECONDS_PER_DAY = 86_400_000;

/** One free-form to-do entry. */
export interface TodoItem {
  id: string;
  text: string;
  /** Which Kanban column the item sits in — the source of truth for its state. */
  status: TodoStatus;
  /** Convenience mirror of `status === 'done'`, kept in sync so older callers keep working. */
  isDone: boolean;
  createdAtIso: string;
  /** Stamped when the item first reaches Done; null while it is still open. */
  completedAtIso: string | null;
}

interface TodoStoreState {
  /** Newest first — a freshly captured thought should be immediately visible at the top. */
  todoItems: TodoItem[];
}

/** Returns true when a candidate string is one of the three known Kanban columns. */
function isTodoStatus(candidateStatus: unknown): candidateStatus is TodoStatus {
  return candidateStatus === 'todo' || candidateStatus === 'inProgress' || candidateStatus === 'done';
}

/** Returns true when a parsed storage entry has the fields every historical TodoItem carried. */
function isValidStoredTodoItem(candidateValue: unknown): candidateValue is TodoItem {
  if (candidateValue === null || typeof candidateValue !== 'object') return false;
  const candidateItem = candidateValue as Partial<TodoItem>;
  return typeof candidateItem.id === 'string'
    && typeof candidateItem.text === 'string'
    && typeof candidateItem.isDone === 'boolean'
    && typeof candidateItem.createdAtIso === 'string';
}

/**
 * Resolves an item's column, tolerating items saved before the Kanban board existed.
 * Older entries have no `status` field, so their binary `isDone` flag decides the column.
 */
function resolveStoredStatus(storedItem: TodoItem): TodoStatus {
  const candidateStatus = (storedItem as { status?: unknown }).status;
  if (isTodoStatus(candidateStatus)) return candidateStatus;
  return storedItem.isDone ? 'done' : 'todo';
}

/** Safely reads the persisted items; corrupt or malformed storage yields an empty list. */
function readStoredTodoItems(): TodoItem[] {
  try {
    const rawStoredValue = window.localStorage.getItem(TODO_ITEMS_STORAGE_KEY);
    if (!rawStoredValue) return [];
    const parsedValue: unknown = JSON.parse(rawStoredValue);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue.filter(isValidStoredTodoItem).map((storedItem) => {
      const resolvedStatus = resolveStoredStatus(storedItem);
      return {
        ...storedItem,
        status: resolvedStatus,
        isDone: resolvedStatus === 'done',
        completedAtIso: storedItem.completedAtIso ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** Persists the current items; storage failures (private browsing) never break the in-memory list. */
function writeStoredTodoItems(todoItems: TodoItem[]): void {
  try {
    window.localStorage.setItem(TODO_ITEMS_STORAGE_KEY, JSON.stringify(todoItems));
  } catch {
    // In-memory state stays authoritative when storage is unavailable.
  }
}

/** Applies a list transformation to the store and mirrors the result into localStorage. */
function mutateTodoItems(applyChange: (currentItems: TodoItem[]) => TodoItem[]): void {
  const nextItems = applyChange(useTodoStore.getState().todoItems);
  writeStoredTodoItems(nextItems);
  useTodoStore.setState({ todoItems: nextItems });
}

/**
 * Global store for the personal to-do list.
 * Read it from any component; write it through the exported action functions below.
 */
export const useTodoStore = create<TodoStoreState>(() => ({
  todoItems: readStoredTodoItems(),
}));

/**
 * Adds a new item to the top of the To Do column and persists it.
 * Blank input is ignored and returns null so callers can keep their popup open quietly.
 */
export function addTodoItem(itemText: string): TodoItem | null {
  const trimmedText = itemText.trim();
  if (trimmedText === '') return null;

  const newItem: TodoItem = {
    id: crypto.randomUUID(),
    text: trimmedText,
    status: 'todo',
    isDone: false,
    createdAtIso: new Date().toISOString(),
    completedAtIso: null,
  };
  mutateTodoItems((currentItems) => [newItem, ...currentItems]);
  return newItem;
}

/**
 * Moves one item into a different Kanban column.
 * Reaching Done stamps the completion time (only on the first arrival); leaving Done clears it,
 * because a re-opened item should age from scratch if it is finished again later.
 */
export function moveTodoItem(itemId: string, nextStatus: TodoStatus): void {
  mutateTodoItems((currentItems) =>
    currentItems.map((currentItem) => {
      if (currentItem.id !== itemId) return currentItem;
      const isNowDone = nextStatus === 'done';
      return {
        ...currentItem,
        status: nextStatus,
        isDone: isNowDone,
        completedAtIso: isNowDone ? currentItem.completedAtIso ?? new Date().toISOString() : null,
      };
    }),
  );
}

/** Flips an item between the To Do and Done columns — the check-off shortcut used by simple callers. */
export function toggleTodoItem(itemId: string): void {
  const targetItem = useTodoStore.getState().todoItems.find((currentItem) => currentItem.id === itemId);
  if (!targetItem) return;
  moveTodoItem(itemId, targetItem.status === 'done' ? 'todo' : 'done');
}

/** Rewrites an item's text (trimmed); blank text removes the item — an emptied note is a deletion. */
export function updateTodoItemText(itemId: string, nextText: string): void {
  const trimmedText = nextText.trim();
  if (trimmedText === '') {
    removeTodoItem(itemId);
    return;
  }
  mutateTodoItems((currentItems) =>
    currentItems.map((currentItem) =>
      currentItem.id === itemId ? { ...currentItem, text: trimmedText } : currentItem,
    ),
  );
}

/** Deletes one item permanently. */
export function removeTodoItem(itemId: string): void {
  mutateTodoItems((currentItems) => currentItems.filter((currentItem) => currentItem.id !== itemId));
}

/** Deletes every item in the Done column in one action, keeping the open work. */
export function clearCompletedTodoItems(): void {
  mutateTodoItems((currentItems) => currentItems.filter((currentItem) => !currentItem.isDone));
}

/**
 * Removes Done items that were completed more than DONE_RETENTION_DAYS ago, so the board's Done
 * column empties itself on a rolling two-week basis. Time is injectable for deterministic tests.
 * A done item without a completion stamp (legacy data) is kept — it has no age to measure.
 */
export function purgeStaleDoneItems(nowMs: number = Date.now()): void {
  const cutoffMs = nowMs - DONE_RETENTION_DAYS * MILLISECONDS_PER_DAY;
  mutateTodoItems((currentItems) =>
    currentItems.filter((currentItem) => {
      if (currentItem.status !== 'done' || currentItem.completedAtIso === null) return true;
      return new Date(currentItem.completedAtIso).getTime() > cutoffMs;
    }),
  );
}

/** Re-reads the persisted list (used at startup and by tests); corrupt storage yields an empty list. */
export function reloadTodoItemsFromStorage(): void {
  useTodoStore.setState({ todoItems: readStoredTodoItems() });
}
