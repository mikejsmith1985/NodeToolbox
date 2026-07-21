// TodoTab.tsx — The free-form personal checklist rendered as a three-column Kanban board
// (To Do · In Progress · Done), backed by todoStore, shown as a section of the My Issues "Today"
// dashboard so the whole day lives on one screen. Items move between columns by drag
// (@dnd-kit, the repo's sanctioned drag primitive) or by the per-card move buttons, which keep
// the board fully keyboard-accessible. The Done column auto-clears two weeks after completion.

import { useState } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';

import {
  addTodoItem,
  clearCompletedTodoItems,
  DONE_RETENTION_DAYS,
  moveTodoItem,
  removeTodoItem,
  updateTodoItemText,
  useTodoStore,
} from '../../../store/todoStore.ts';
import type { TodoItem, TodoStatus } from '../../../store/todoStore.ts';
import styles from './TodoTab.module.css';

const VIEW_HEADING = 'To-Do';
const VIEW_SUBHEADING = 'Your personal Kanban board — press F1 on any screen to capture an item.';
const EMPTY_STATE_MESSAGE = 'Nothing on the board yet. Type below, or press F1 from anywhere in the app.';
const ADD_INPUT_LABEL = 'New to-do item';
const ADD_BUTTON_LABEL = 'Add';
const CLEAR_COMPLETED_LABEL = 'Clear all';
const EMPTY_COLUMN_HINT = 'Drop items here';
const DONE_AUTOCLEAR_HINT = `Done clears automatically ${DONE_RETENTION_DAYS} days after completion.`;
// Only clicks that drag past this many pixels start a drag, so tapping the card buttons still works.
const DRAG_ACTIVATION_DISTANCE_PX = 5;

/** The three board columns in left-to-right order, each labelled for headers and move buttons. */
const BOARD_COLUMNS: ReadonlyArray<{ status: TodoStatus; label: string }> = [
  { status: 'todo', label: 'To Do' },
  { status: 'inProgress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
];
const STATUS_LABEL: Record<TodoStatus, string> = {
  todo: 'To Do',
  inProgress: 'In Progress',
  done: 'Done',
};

/** Returns the column immediately left of the given one, or null when already at the far left. */
function previousStatus(status: TodoStatus): TodoStatus | null {
  const columnIndex = BOARD_COLUMNS.findIndex((column) => column.status === status);
  return columnIndex > 0 ? BOARD_COLUMNS[columnIndex - 1].status : null;
}

/** Returns the column immediately right of the given one, or null when already at the far right. */
function nextStatus(status: TodoStatus): TodoStatus | null {
  const columnIndex = BOARD_COLUMNS.findIndex((column) => column.status === status);
  return columnIndex < BOARD_COLUMNS.length - 1 ? BOARD_COLUMNS[columnIndex + 1].status : null;
}

interface TodoCardProps {
  todoItem: TodoItem;
  isEditing: boolean;
  editingText: string;
  onBeginEdit: (todoItem: TodoItem) => void;
  onEditingTextChange: (nextText: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
}

/** One draggable card. The grip area carries the drag listeners so the action buttons stay clickable. */
function TodoCard({
  todoItem,
  isEditing,
  editingText,
  onBeginEdit,
  onEditingTextChange,
  onCommitEdit,
  onCancelEdit,
}: TodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: todoItem.id });
  const cardStyle: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
  };
  const gripProps = { ...attributes, ...listeners } as HTMLAttributes<HTMLDivElement>;
  const moveLeftTarget = previousStatus(todoItem.status);
  const moveRightTarget = nextStatus(todoItem.status);

  return (
    <li className={styles.card} ref={setNodeRef} style={cardStyle}>
      {isEditing ? (
        <input
          autoFocus
          aria-label="Edit to-do item"
          className={styles.editInput}
          type="text"
          value={editingText}
          onBlur={onCommitEdit}
          onChange={(changeEvent) => onEditingTextChange(changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key === 'Enter') onCommitEdit();
            if (keyboardEvent.key === 'Escape') onCancelEdit();
          }}
        />
      ) : (
        <div className={styles.cardGrip} {...gripProps}>
          <span className={todoItem.isDone ? styles.cardTextDone : styles.cardText}>{todoItem.text}</span>
        </div>
      )}

      <div className={styles.cardActions}>
        {moveLeftTarget && (
          <button
            aria-label={`Move "${todoItem.text}" to ${STATUS_LABEL[moveLeftTarget]}`}
            className={styles.cardActionButton}
            title={`Move to ${STATUS_LABEL[moveLeftTarget]}`}
            type="button"
            onClick={() => moveTodoItem(todoItem.id, moveLeftTarget)}
          >
            ◀
          </button>
        )}
        {moveRightTarget && (
          <button
            aria-label={`Move "${todoItem.text}" to ${STATUS_LABEL[moveRightTarget]}`}
            className={styles.cardActionButton}
            title={`Move to ${STATUS_LABEL[moveRightTarget]}`}
            type="button"
            onClick={() => moveTodoItem(todoItem.id, moveRightTarget)}
          >
            ▶
          </button>
        )}
        <button
          aria-label={`Edit "${todoItem.text}"`}
          className={styles.cardActionButton}
          title="Edit"
          type="button"
          onClick={() => onBeginEdit(todoItem)}
        >
          ✏️
        </button>
        <button
          aria-label={`Delete "${todoItem.text}"`}
          className={styles.cardActionButton}
          title="Delete"
          type="button"
          onClick={() => removeTodoItem(todoItem.id)}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

interface TodoColumnProps {
  status: TodoStatus;
  label: string;
  columnItems: TodoItem[];
  renderCard: (todoItem: TodoItem) => React.JSX.Element;
}

/** One droppable column with a counted header; the Done column also hosts the clear-all control. */
function TodoColumn({ status, label, columnItems, renderCard }: TodoColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isDoneColumn = status === 'done';

  return (
    <section
      aria-label={label}
      className={`${styles.column} ${isOver ? styles.columnOver : ''}`}
      ref={setNodeRef}
    >
      <header className={styles.columnHeader}>
        <span className={styles.columnTitle}>{`${label} (${columnItems.length})`}</span>
        {isDoneColumn && columnItems.length > 0 && (
          <button className={styles.clearButton} type="button" onClick={clearCompletedTodoItems}>
            {CLEAR_COMPLETED_LABEL}
          </button>
        )}
      </header>

      {columnItems.length === 0 ? (
        <p className={styles.columnEmpty}>{EMPTY_COLUMN_HINT}</p>
      ) : (
        <ul className={styles.cardList}>{columnItems.map((todoItem) => renderCard(todoItem))}</ul>
      )}

      {isDoneColumn && <p className={styles.autoClearHint}>{DONE_AUTOCLEAR_HINT}</p>}
    </section>
  );
}

/** Renders the Kanban board with add, drag-between-columns, move buttons, inline edit, and delete. */
export default function TodoTab() {
  const todoItems = useTodoStore((storeState) => storeState.todoItems);
  const [newItemText, setNewItemText] = useState('');
  // Only one card edits at a time; its draft text lives here until Enter/blur commits it.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  );

  function handleAddItem() {
    const addedItem = addTodoItem(newItemText);
    if (addedItem) {
      setNewItemText('');
    }
  }

  function handleBeginEdit(todoItem: TodoItem) {
    setEditingItemId(todoItem.id);
    setEditingText(todoItem.text);
  }

  function handleCommitEdit() {
    if (editingItemId !== null) {
      updateTodoItemText(editingItemId, editingText);
    }
    setEditingItemId(null);
    setEditingText('');
  }

  function handleCancelEdit() {
    setEditingItemId(null);
    setEditingText('');
  }

  // A drop onto a column whose id differs from the card's current column moves the card there.
  function handleDragEnd(dragEvent: DragEndEvent) {
    const droppedOnStatus = dragEvent.over?.id;
    if (typeof droppedOnStatus !== 'string') return;
    const draggedItem = todoItems.find((todoItem) => todoItem.id === dragEvent.active.id);
    if (draggedItem && draggedItem.status !== droppedOnStatus) {
      moveTodoItem(draggedItem.id, droppedOnStatus as TodoStatus);
    }
  }

  function renderCard(todoItem: TodoItem) {
    return (
      <TodoCard
        editingText={editingText}
        isEditing={editingItemId === todoItem.id}
        key={todoItem.id}
        todoItem={todoItem}
        onBeginEdit={handleBeginEdit}
        onCancelEdit={handleCancelEdit}
        onCommitEdit={handleCommitEdit}
        onEditingTextChange={setEditingText}
      />
    );
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

      {todoItems.length === 0 && <p className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</p>}

      <DndContext sensors={dragSensors} onDragEnd={handleDragEnd}>
        <div className={styles.board}>
          {BOARD_COLUMNS.map((column) => (
            <TodoColumn
              columnItems={todoItems.filter((todoItem) => todoItem.status === column.status)}
              key={column.status}
              label={column.label}
              renderCard={renderCard}
              status={column.status}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
