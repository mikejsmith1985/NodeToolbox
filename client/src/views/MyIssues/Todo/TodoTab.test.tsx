// TodoTab.test.tsx — Unit tests for the My Issues personal to-do Kanban board.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { addTodoItem, moveTodoItem, useTodoStore } from '../../../store/todoStore.ts';
import TodoTab from './TodoTab.tsx';

/** Returns the droppable column region so assertions can be scoped to one column. */
function column(name: RegExp) {
  return within(screen.getByRole('region', { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  useTodoStore.setState({ todoItems: [] });
});

describe('TodoTab', () => {
  it('shows the empty-board hint with the F1 tip before any item exists', () => {
    render(<TodoTab />);

    expect(screen.getByText(/nothing on the board yet.*press F1 from anywhere/i)).toBeInTheDocument();
  });

  it('renders the three Kanban columns', () => {
    render(<TodoTab />);

    expect(screen.getByRole('region', { name: /^to do$/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /in progress/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^done$/i })).toBeInTheDocument();
  });

  it('adds an item through the form and places it in the To Do column', async () => {
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.type(screen.getByLabelText(/new to-do item/i), 'Chase the ENFCT release notes');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(column(/^to do$/i).getByText('Chase the ENFCT release notes')).toBeInTheDocument();
    // The input clears so the next thought can be typed immediately.
    expect(screen.getByLabelText(/new to-do item/i)).toHaveValue('');
  });

  it('moves a card forward through the columns with the move buttons', async () => {
    addTodoItem('Finish the sprint report');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('button', { name: /move "finish the sprint report" to in progress/i }));
    expect(column(/in progress/i).getByText('Finish the sprint report')).toBeInTheDocument();
    expect(useTodoStore.getState().todoItems[0].status).toBe('inProgress');

    await user.click(screen.getByRole('button', { name: /move "finish the sprint report" to done/i }));
    expect(column(/^done$/i).getByText('Finish the sprint report')).toBeInTheDocument();
    expect(useTodoStore.getState().todoItems[0].isDone).toBe(true);
  });

  it('edits a card inline and saves on Enter', async () => {
    addTodoItem('Old wording');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('button', { name: /edit "old wording"/i }));
    const editField = screen.getByLabelText(/edit to-do item/i);
    await user.clear(editField);
    await user.type(editField, 'New wording{Enter}');

    expect(useTodoStore.getState().todoItems[0].text).toBe('New wording');
    expect(screen.getByText('New wording')).toBeInTheDocument();
  });

  it('deletes a single card', async () => {
    addTodoItem('Disposable note');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('button', { name: /delete "disposable note"/i }));

    expect(useTodoStore.getState().todoItems).toHaveLength(0);
    expect(screen.queryByText('Disposable note')).not.toBeInTheDocument();
  });

  it('counts items per column and clears the whole Done column in one action', async () => {
    const openItem = addTodoItem('still open');
    const doneItem = addTodoItem('already handled');
    moveTodoItem(doneItem!.id, 'done');
    const user = userEvent.setup();
    render(<TodoTab />);

    expect(column(/^to do$/i).getByText(/to do \(1\)/i)).toBeInTheDocument();
    expect(column(/^done$/i).getByText(/done \(1\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear all/i }));

    expect(useTodoStore.getState().todoItems.map((item) => item.id)).toEqual([openItem!.id]);
    expect(screen.queryByText('already handled')).not.toBeInTheDocument();
  });
});
