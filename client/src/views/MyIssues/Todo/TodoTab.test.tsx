// TodoTab.test.tsx — Unit tests for the My Issues free-form to-do list tab.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { addTodoItem, toggleTodoItem, useTodoStore } from '../../../store/todoStore.ts';
import TodoTab from './TodoTab.tsx';

beforeEach(() => {
  window.localStorage.clear();
  useTodoStore.setState({ todoItems: [] });
});

describe('TodoTab', () => {
  it('shows the empty state with the F1 hint before any item exists', () => {
    render(<TodoTab />);

    expect(screen.getByText(/nothing on the list yet.*press F1 from anywhere/i)).toBeInTheDocument();
  });

  it('adds an item through the form and renders it unchecked at the top', async () => {
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.type(screen.getByLabelText(/new to-do item/i), 'Chase the ENFCT release notes');
    await user.click(screen.getByRole('button', { name: /add/i }));

    const itemCheckbox = screen.getByRole('checkbox', { name: /chase the enfct release notes/i });
    expect(itemCheckbox).not.toBeChecked();
    // The input clears so the next thought can be typed immediately.
    expect(screen.getByLabelText(/new to-do item/i)).toHaveValue('');
  });

  it('checks an item off and shows it as done', async () => {
    addTodoItem('Finish the sprint report');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('checkbox', { name: /finish the sprint report/i }));

    expect(screen.getByRole('checkbox', { name: /finish the sprint report/i })).toBeChecked();
    expect(useTodoStore.getState().todoItems[0].isDone).toBe(true);
  });

  it('edits an item inline and saves on Enter', async () => {
    addTodoItem('Old wording');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('button', { name: /edit "old wording"/i }));
    const editField = screen.getByLabelText(/edit to-do item/i);
    await user.clear(editField);
    await user.type(editField, 'New wording{Enter}');

    expect(useTodoStore.getState().todoItems[0].text).toBe('New wording');
    expect(screen.getByRole('checkbox', { name: /new wording/i })).toBeInTheDocument();
  });

  it('deletes a single item', async () => {
    addTodoItem('Disposable note');
    const user = userEvent.setup();
    render(<TodoTab />);

    await user.click(screen.getByRole('button', { name: /delete "disposable note"/i }));

    expect(useTodoStore.getState().todoItems).toHaveLength(0);
    expect(screen.queryByText('Disposable note')).not.toBeInTheDocument();
  });

  it('shows open/done counts and clears completed items in one action', async () => {
    const openItem = addTodoItem('still open');
    const doneItem = addTodoItem('already handled');
    toggleTodoItem(doneItem!.id);
    const user = userEvent.setup();
    render(<TodoTab />);

    expect(screen.getByText(/1 open · 1 done/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear completed/i }));

    expect(useTodoStore.getState().todoItems.map((item) => item.id)).toEqual([openItem!.id]);
    expect(screen.queryByText('already handled')).not.toBeInTheDocument();
  });

  it('keeps done items visible with a done marker instead of hiding them', () => {
    const doneItem = addTodoItem('checked but visible');
    toggleTodoItem(doneItem!.id);
    render(<TodoTab />);

    const itemRow = screen.getByRole('listitem');
    expect(within(itemRow).getByRole('checkbox')).toBeChecked();
    expect(within(itemRow).getByText('checked but visible')).toBeInTheDocument();
  });
});
