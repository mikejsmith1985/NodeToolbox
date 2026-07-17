// TodoQuickAddGate.test.tsx — Unit tests for the app-wide F1 quick-add to-do popup.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTodoStore } from '../../store/todoStore.ts';
import { TodoQuickAddGate } from './index.tsx';

function renderGate() {
  return render(
    <MemoryRouter>
      <TodoQuickAddGate />
    </MemoryRouter>,
  );
}

/** Fires the F1 keydown on window, returning whether the browser default (Help) was suppressed. */
function pressF1(): boolean {
  const keyboardEvent = new KeyboardEvent('keydown', { key: 'F1', cancelable: true });
  fireEvent(window, keyboardEvent);
  return keyboardEvent.defaultPrevented;
}

beforeEach(() => {
  window.localStorage.clear();
  useTodoStore.setState({ todoItems: [] });
});

describe('TodoQuickAddGate', () => {
  it('renders nothing until F1 is pressed', () => {
    renderGate();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the quick-add popup on F1 and suppresses the browser Help default', () => {
    renderGate();

    const wasDefaultPrevented = pressF1();

    expect(wasDefaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: /add to-do item/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^to-do item$/i)).toHaveFocus();
  });

  it('adds the typed item on Enter and stays open (cleared) for rapid entry', async () => {
    const user = userEvent.setup();
    renderGate();
    pressF1();

    await user.type(screen.getByLabelText(/^to-do item$/i), 'Ping infra about the cert{Enter}');

    expect(useTodoStore.getState().todoItems.map((item) => item.text)).toEqual(['Ping infra about the cert']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^to-do item$/i)).toHaveValue('');
    expect(screen.getByText(/added/i)).toBeInTheDocument();
  });

  it('does not add a blank item on Enter', async () => {
    const user = userEvent.setup();
    renderGate();
    pressF1();

    await user.type(screen.getByLabelText(/^to-do item$/i), '   {Enter}');

    expect(useTodoStore.getState().todoItems).toHaveLength(0);
  });

  it('closes on Escape without adding anything', async () => {
    const user = userEvent.setup();
    renderGate();
    pressF1();

    await user.type(screen.getByLabelText(/^to-do item$/i), 'draft thought');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useTodoStore.getState().todoItems).toHaveLength(0);
  });

  it('pressing F1 while the popup is open keeps a single popup (no double-open)', () => {
    renderGate();
    pressF1();
    pressF1();

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
