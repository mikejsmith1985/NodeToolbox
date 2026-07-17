// index.tsx — App-wide F1 quick-add popup for the personal to-do list.
//
// Mounted once at the app root (AiAssistUnlockGate precedent) so F1 captures a to-do from ANY
// screen without leaving it. preventDefault() suppresses the browser's built-in F1 Help while
// the app has focus. The popup stays open after each add — capture several thoughts in a row,
// then Escape (or Close) returns to whatever was being done. The full list lives on the
// My Issues → To-Do tab, one click away via the "Open list" link.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { addTodoItem } from '../../store/todoStore.ts';
import styles from './TodoQuickAdd.module.css';

/** The hotkey that opens the quick-add popup from anywhere in the app. */
const QUICK_ADD_HOTKEY = 'F1';
const DIALOG_LABEL = 'Add to-do item';
const INPUT_LABEL = 'To-do item';
const LIST_ROUTE = '/my-issues?tab=todo';
// The "Added ✓" confirmation lingers briefly so rapid entries still feel acknowledged.
const CONFIRMATION_TIMEOUT_MS = 2_000;

/** Renders nothing until F1 opens the quick-add popup; owns the app-wide capture flow. */
export function TodoQuickAddGate(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  const [itemText, setItemText] = useState('');
  const [hasJustAdded, setHasJustAdded] = useState(false);
  const confirmationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent): void {
      if (keyboardEvent.key !== QUICK_ADD_HOTKEY) {
        return;
      }
      // Suppress the browser's F1 Help page; the app owns the key while it has focus.
      keyboardEvent.preventDefault();
      setIsPopupVisible(true);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => () => {
    if (confirmationTimeoutRef.current !== null) {
      window.clearTimeout(confirmationTimeoutRef.current);
    }
  }, []);

  function handleClose(): void {
    setIsPopupVisible(false);
    setItemText('');
    setHasJustAdded(false);
  }

  function handleAdd(): void {
    const addedItem = addTodoItem(itemText);
    if (!addedItem) {
      return;
    }
    setItemText('');
    setHasJustAdded(true);
    if (confirmationTimeoutRef.current !== null) {
      window.clearTimeout(confirmationTimeoutRef.current);
    }
    confirmationTimeoutRef.current = window.setTimeout(() => setHasJustAdded(false), CONFIRMATION_TIMEOUT_MS);
  }

  if (!isPopupVisible) {
    return null;
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={DIALOG_LABEL}>
      <div className={styles.modal}>
        <h2 className={styles.title}>📝 Add to-do</h2>
        <label className={styles.label}>
          {INPUT_LABEL}
          <input
            autoFocus
            className={styles.input}
            placeholder="What needs doing?"
            type="text"
            value={itemText}
            onChange={(changeEvent) => {
              setItemText(changeEvent.target.value);
              setHasJustAdded(false);
            }}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === 'Enter') handleAdd();
              if (keyboardEvent.key === 'Escape') handleClose();
            }}
          />
        </label>
        <p className={styles.hint} role="status">
          {hasJustAdded ? 'Added ✓ — type the next one or press Escape to close.' : 'Enter adds · Escape closes.'}
        </p>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={itemText.trim() === ''} type="button" onClick={handleAdd}>
            Add item
          </button>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              handleClose();
              navigate(LIST_ROUTE);
            }}
          >
            Open list
          </button>
          <button className={styles.secondary} type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
