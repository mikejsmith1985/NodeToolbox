// TodoTab.tsx — The free-form personal checklist (backed by todoStore), rendered as a section
// of the My Issues "Today" dashboard so the whole day lives on one screen.

import { useState } from 'react';

import {
  addTodoItem,
  clearCompletedTodoItems,
  removeTodoItem,
  toggleTodoItem,
  updateTodoItemText,
  useTodoStore,
} from '../../../store/todoStore.ts';
import styles from './TodoTab.module.css';

const VIEW_HEADING = 'To-Do';
const VIEW_SUBHEADING = 'Your free-form personal checklist — press F1 on any screen to add an item.';
const EMPTY_STATE_MESSAGE = 'Nothing on the list yet. Type below, or press F1 from anywhere in the app.';
const ADD_INPUT_LABEL = 'New to-do item';
const ADD_BUTTON_LABEL = 'Add';
const CLEAR_COMPLETED_LABEL = 'Clear completed';

/** Renders the full to-do list with add, inline edit, check-off, delete, and clear-completed. */
export default function TodoTab() {
  const todoItems = useTodoStore((storeState) => storeState.todoItems);
  const [newItemText, setNewItemText] = useState('');
  // Only one item edits at a time; its draft text lives here until Enter/blur commits it.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const openCount = todoItems.filter((todoItem) => !todoItem.isDone).length;
  const doneCount = todoItems.length - openCount;

  function handleAddItem() {
    const addedItem = addTodoItem(newItemText);
    if (addedItem) {
      setNewItemText('');
    }
  }

  function handleCommitEdit() {
    if (editingItemId !== null) {
      updateTodoItemText(editingItemId, editingText);
    }
    setEditingItemId(null);
    setEditingText('');
  }

  return (
    <div className={styles.todoTab}>
      <header>
        {/* h3: this renders as a SECTION of the Today dashboard, under its h2 "Today" heading. */}
        <h3 className={styles.heading}>{VIEW_HEADING}</h3>
        <p className={styles.subheading}>{VIEW_SUBHEADING}</p>
      </header>

      <form
        className={styles.addForm}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          handleAddItem();
        }}
      >
        <input
          aria-label={ADD_INPUT_LABEL}
          className={styles.addInput}
          placeholder="What needs doing?"
          type="text"
          value={newItemText}
          onChange={(changeEvent) => setNewItemText(changeEvent.target.value)}
        />
        <button className={styles.addButton} disabled={newItemText.trim() === ''} type="submit">
          {ADD_BUTTON_LABEL}
        </button>
      </form>

      {todoItems.length === 0 ? (
        <p className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</p>
      ) : (
        <>
          <ul className={styles.itemList}>
            {todoItems.map((todoItem) => (
              <li className={styles.itemRow} key={todoItem.id}>
                <input
                  aria-label={todoItem.text}
                  checked={todoItem.isDone}
                  className={styles.itemCheckbox}
                  type="checkbox"
                  onChange={() => toggleTodoItem(todoItem.id)}
                />
                {editingItemId === todoItem.id ? (
                  <input
                    autoFocus
                    aria-label="Edit to-do item"
                    className={styles.editInput}
                    type="text"
                    value={editingText}
                    onBlur={handleCommitEdit}
                    onChange={(changeEvent) => setEditingText(changeEvent.target.value)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === 'Enter') handleCommitEdit();
                      if (keyboardEvent.key === 'Escape') {
                        setEditingItemId(null);
                        setEditingText('');
                      }
                    }}
                  />
                ) : (
                  <span className={todoItem.isDone ? styles.itemTextDone : styles.itemText}>
                    {todoItem.text}
                  </span>
                )}
                <div className={styles.itemActions}>
                  <button
                    aria-label={`Edit "${todoItem.text}"`}
                    className={styles.itemActionButton}
                    title="Edit"
                    type="button"
                    onClick={() => {
                      setEditingItemId(todoItem.id);
                      setEditingText(todoItem.text);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    aria-label={`Delete "${todoItem.text}"`}
                    className={styles.itemActionButton}
                    title="Delete"
                    type="button"
                    onClick={() => removeTodoItem(todoItem.id)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <footer className={styles.listFooter}>
            <span className={styles.countSummary}>{`${openCount} open · ${doneCount} done`}</span>
            {doneCount > 0 && (
              <button className={styles.clearCompletedButton} type="button" onClick={clearCompletedTodoItems}>
                {CLEAR_COMPLETED_LABEL}
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
