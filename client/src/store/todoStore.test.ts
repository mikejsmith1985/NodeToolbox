// todoStore.test.ts — Unit tests for the personal to-do list store and its persistence.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addTodoItem,
  clearCompletedTodoItems,
  DONE_RETENTION_DAYS,
  moveTodoItem,
  purgeStaleDoneItems,
  reloadTodoItemsFromStorage,
  removeTodoItem,
  TODO_ITEMS_STORAGE_KEY,
  toggleTodoItem,
  updateTodoItemText,
  useTodoStore,
} from './todoStore.ts';

/** Fixed clock so age-based purge tests never depend on the wall clock. */
const FIXED_NOW_MS = Date.parse('2026-07-21T12:00:00.000Z');
const MILLISECONDS_PER_DAY = 86_400_000;

beforeEach(() => {
  window.localStorage.clear();
  useTodoStore.setState({ todoItems: [] });
});

describe('todoStore', () => {
  it('adds a trimmed item and persists it to localStorage', () => {
    const addedItem = addTodoItem('  Follow up with the PO about PI 26.4  ');

    expect(addedItem?.text).toBe('Follow up with the PO about PI 26.4');
    expect(addedItem?.isDone).toBe(false);
    expect(useTodoStore.getState().todoItems).toHaveLength(1);

    const persistedItems = JSON.parse(window.localStorage.getItem(TODO_ITEMS_STORAGE_KEY) ?? '[]');
    expect(persistedItems).toHaveLength(1);
    expect(persistedItems[0].text).toBe('Follow up with the PO about PI 26.4');
  });

  it('ignores blank input instead of creating an empty item', () => {
    expect(addTodoItem('   ')).toBeNull();
    expect(useTodoStore.getState().todoItems).toHaveLength(0);
  });

  it('adds new items into the To Do column by default', () => {
    const addedItem = addTodoItem('Draft the release notes');

    expect(addedItem?.status).toBe('todo');
    expect(addedItem?.isDone).toBe(false);
  });

  it('moves an item across columns, stamping completion only when it reaches Done', () => {
    const addedItem = addTodoItem('Wire up the webhook');

    moveTodoItem(addedItem!.id, 'inProgress');
    const inProgressItem = useTodoStore.getState().todoItems[0];
    expect(inProgressItem.status).toBe('inProgress');
    expect(inProgressItem.isDone).toBe(false);
    expect(inProgressItem.completedAtIso).toBeNull();

    moveTodoItem(addedItem!.id, 'done');
    const doneItem = useTodoStore.getState().todoItems[0];
    expect(doneItem.status).toBe('done');
    expect(doneItem.isDone).toBe(true);
    expect(doneItem.completedAtIso).not.toBeNull();

    moveTodoItem(addedItem!.id, 'todo');
    const reopenedItem = useTodoStore.getState().todoItems[0];
    expect(reopenedItem.status).toBe('todo');
    expect(reopenedItem.completedAtIso).toBeNull();
  });

  it('migrates legacy items without a status field from their isDone flag', () => {
    window.localStorage.setItem(
      TODO_ITEMS_STORAGE_KEY,
      JSON.stringify([
        { id: 'legacy-done', text: 'old done', isDone: true, createdAtIso: '2026-07-01T00:00:00.000Z', completedAtIso: '2026-07-02T00:00:00.000Z' },
        { id: 'legacy-open', text: 'old open', isDone: false, createdAtIso: '2026-07-01T00:00:00.000Z', completedAtIso: null },
      ]),
    );

    reloadTodoItemsFromStorage();

    const [doneItem, openItem] = useTodoStore.getState().todoItems;
    expect(doneItem.status).toBe('done');
    expect(openItem.status).toBe('todo');
  });

  it('purges Done items completed more than two weeks ago, keeping recent done and open work', () => {
    const staleCompletedIso = new Date(FIXED_NOW_MS - (DONE_RETENTION_DAYS + 1) * MILLISECONDS_PER_DAY).toISOString();
    const recentCompletedIso = new Date(FIXED_NOW_MS - MILLISECONDS_PER_DAY).toISOString();
    window.localStorage.setItem(
      TODO_ITEMS_STORAGE_KEY,
      JSON.stringify([
        { id: 'stale', text: 'finished long ago', status: 'done', isDone: true, createdAtIso: staleCompletedIso, completedAtIso: staleCompletedIso },
        { id: 'recent', text: 'just finished', status: 'done', isDone: true, createdAtIso: recentCompletedIso, completedAtIso: recentCompletedIso },
        { id: 'open', text: 'still going', status: 'inProgress', isDone: false, createdAtIso: staleCompletedIso, completedAtIso: null },
      ]),
    );
    reloadTodoItemsFromStorage();

    purgeStaleDoneItems(FIXED_NOW_MS);

    const remainingIds = useTodoStore.getState().todoItems.map((item) => item.id);
    expect(remainingIds).toEqual(['recent', 'open']);
  });

  it('newest item is listed first so fresh thoughts are immediately visible', () => {
    addTodoItem('first');
    addTodoItem('second');

    expect(useTodoStore.getState().todoItems.map((item) => item.text)).toEqual(['second', 'first']);
  });

  it('toggles an item done and back, stamping and clearing the completion time', () => {
    const addedItem = addTodoItem('Ship it');

    toggleTodoItem(addedItem!.id);
    const doneItem = useTodoStore.getState().todoItems[0];
    expect(doneItem.isDone).toBe(true);
    expect(doneItem.completedAtIso).not.toBeNull();

    toggleTodoItem(addedItem!.id);
    const reopenedItem = useTodoStore.getState().todoItems[0];
    expect(reopenedItem.isDone).toBe(false);
    expect(reopenedItem.completedAtIso).toBeNull();
  });

  it('updates an item text (trimmed) and removes the item when the new text is blank', () => {
    const addedItem = addTodoItem('Old text');

    updateTodoItemText(addedItem!.id, '  New text  ');
    expect(useTodoStore.getState().todoItems[0].text).toBe('New text');

    updateTodoItemText(addedItem!.id, '   ');
    expect(useTodoStore.getState().todoItems).toHaveLength(0);
  });

  it('removes a single item and clears only completed items in bulk', () => {
    const keepItem = addTodoItem('keep me');
    const doneItem = addTodoItem('done soon');
    const removedItem = addTodoItem('remove me');

    removeTodoItem(removedItem!.id);
    toggleTodoItem(doneItem!.id);
    clearCompletedTodoItems();

    const remainingItems = useTodoStore.getState().todoItems;
    expect(remainingItems).toHaveLength(1);
    expect(remainingItems[0].id).toBe(keepItem!.id);
  });

  it('reloads persisted items from localStorage and drops malformed entries', () => {
    window.localStorage.setItem(
      TODO_ITEMS_STORAGE_KEY,
      JSON.stringify([
        { id: 'a1', text: 'Persisted task', isDone: true, createdAtIso: '2026-07-01T00:00:00.000Z', completedAtIso: '2026-07-02T00:00:00.000Z' },
        { text: 'missing id — malformed' },
        'not an object',
      ]),
    );

    reloadTodoItemsFromStorage();

    const loadedItems = useTodoStore.getState().todoItems;
    expect(loadedItems).toHaveLength(1);
    expect(loadedItems[0].text).toBe('Persisted task');
    expect(loadedItems[0].isDone).toBe(true);
  });

  it('survives corrupt storage without throwing', () => {
    window.localStorage.setItem(TODO_ITEMS_STORAGE_KEY, '{not json');

    expect(() => reloadTodoItemsFromStorage()).not.toThrow();
    expect(useTodoStore.getState().todoItems).toEqual([]);
  });
});
