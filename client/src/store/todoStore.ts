// todoStore.ts — Shared reactive store for the personal free-form to-do list.
//
// The list is managed on the My Issues "To-Do" tab and fed from anywhere via the global F1
// quick-add popup, so the items live in one app-wide store (aiAssistStore precedent). Items
// persist to localStorage so the list survives restarts — they are personal notes, never
// Jira data, and deliberately have no server side.

import { create } from 'zustand';

/** localStorage key holding the serialized to-do items. */
export const TODO_ITEMS_STORAGE_KEY = 'tbxTodoItems';

/** One free-form to-do entry. */
export interface TodoItem {
  id: string;
  text: string;
  isDone: boolean;
  createdAtIso: string;
  /** Stamped when the item is checked off; null while it is still open. */
  completedAtIso: string | null;
}

interface TodoStoreState {
  /** Newest first — a freshly captured thought should be immediately visible at the top. */
  todoItems: TodoItem[];
}

/** Returns true when a parsed storage entry has the full TodoItem shape. */
function isValidStoredTodoItem(candidateValue: unknown): candidateValue is TodoItem {
  if (candidateValue === null || typeof candidateValue !== 'object') return false;
  const candidateItem = candidateValue as Partial<TodoItem>;
  return typeof candidateItem.id === 'string'
    && typeof candidateItem.text === 'string'
    && typeof candidateItem.isDone === 'boolean'
    && typeof candidateItem.createdAtIso === 'string';
}

/** Safely reads the persisted items; corrupt or malformed storage yields an empty list. */
function readStoredTodoItems(): TodoItem[] {
  try {
    const rawStoredValue = window.localStorage.getItem(TODO_ITEMS_STORAGE_KEY);
    if (!rawStoredValue) return [];
    const parsedValue: unknown = JSON.parse(rawStoredValue);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .filter(isValidStoredTodoItem)
      .map((storedItem) => ({ ...storedItem, completedAtIso: storedItem.completedAtIso ?? null }));
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
 * Adds a new open item to the top of the list and persists it.
 * Blank input is ignored and returns null so callers can keep their popup open quietly.
 */
export function addTodoItem(itemText: string): TodoItem | null {
  const trimmedText = itemText.trim();
  if (trimmedText === '') return null;

  const newItem: TodoItem = {
    id: crypto.randomUUID(),
    text: trimmedText,
    isDone: false,
    createdAtIso: new Date().toISOString(),
    completedAtIso: null,
  };
  mutateTodoItems((currentItems) => [newItem, ...currentItems]);
  return newItem;
}

/** Flips an item between open and done, stamping or clearing its completion time. */
export function toggleTodoItem(itemId: string): void {
  mutateTodoItems((currentItems) =>
    currentItems.map((currentItem) =>
      currentItem.id === itemId
        ? {
            ...currentItem,
            isDone: !currentItem.isDone,
            completedAtIso: currentItem.isDone ? null : new Date().toISOString(),
          }
        : currentItem,
    ),
  );
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

/** Deletes every completed item in one action, keeping the open work. */
export function clearCompletedTodoItems(): void {
  mutateTodoItems((currentItems) => currentItems.filter((currentItem) => !currentItem.isDone));
}

/** Re-reads the persisted list (used at startup and by tests); corrupt storage yields an empty list. */
export function reloadTodoItemsFromStorage(): void {
  useTodoStore.setState({ todoItems: readStoredTodoItems() });
}
