// todoStore.test.ts — Unit tests for the personal to-do list store and its persistence.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addTodoItem,
  clearCompletedTodoItems,
  reloadTodoItemsFromStorage,
  removeTodoItem,
  TODO_ITEMS_STORAGE_KEY,
  toggleTodoItem,
  updateTodoItemText,
  useTodoStore,
} from './todoStore.ts';

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
