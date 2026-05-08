// BoardPillAndFilters.test.tsx — Tests for the Board Pill and Quick Filters component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { JiraBoardQuickFilter } from './myIssuesExtendedTypes.ts';
import BoardPillAndFilters from './BoardPillAndFilters.tsx';

const mockQuickFilters: JiraBoardQuickFilter[] = [
  { id: 1, name: 'My Issues', jql: 'assignee = currentUser()' },
  { id: 2, name: 'Unassigned', jql: 'assignee is EMPTY' },
  { id: 3, name: 'Blocking', jql: 'priority = Blocker' },
];

describe('BoardPillAndFilters', () => {
  it('renders the board name as a pill', () => {
    render(
      <BoardPillAndFilters
        activeQuickFilterIds={{}}
        boardName="Team Alpha Board"
        boardQuickFilters={[]}
        onClearBoard={vi.fn()}
        onToggleQuickFilter={vi.fn()}
      />,
    );

    expect(screen.getByText(/Team Alpha Board/i)).toBeInTheDocument();
  });

  it('renders quick filter chips', () => {
    render(
      <BoardPillAndFilters
        activeQuickFilterIds={{}}
        boardName="My Board"
        boardQuickFilters={mockQuickFilters}
        onClearBoard={vi.fn()}
        onToggleQuickFilter={vi.fn()}
      />,
    );

    expect(screen.getByText('My Issues')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
  });

  it('calls onToggleQuickFilter with the filter id when a chip is clicked', async () => {
    const user = userEvent.setup();
    const handleToggle = vi.fn();
    render(
      <BoardPillAndFilters
        activeQuickFilterIds={{}}
        boardName="My Board"
        boardQuickFilters={mockQuickFilters}
        onClearBoard={vi.fn()}
        onToggleQuickFilter={handleToggle}
      />,
    );

    await user.click(screen.getByText('My Issues'));

    expect(handleToggle).toHaveBeenCalledWith(1);
  });

  it('marks active quick filter chips visually', () => {
    render(
      <BoardPillAndFilters
        activeQuickFilterIds={{ 2: true }}
        boardName="My Board"
        boardQuickFilters={mockQuickFilters}
        onClearBoard={vi.fn()}
        onToggleQuickFilter={vi.fn()}
      />,
    );

    const activeChip = screen.getByText('Unassigned').closest('button');

    expect(activeChip).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onClearBoard when the × on the board pill is clicked', async () => {
    const user = userEvent.setup();
    const handleClear = vi.fn();
    render(
      <BoardPillAndFilters
        activeQuickFilterIds={{}}
        boardName="Sprint Board"
        boardQuickFilters={[]}
        onClearBoard={handleClear}
        onToggleQuickFilter={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /clear board/i }));

    expect(handleClear).toHaveBeenCalled();
  });

  it('shows nothing when boardName is null', () => {
    const { container } = render(
      <BoardPillAndFilters
        activeQuickFilterIds={{}}
        boardName={null}
        boardQuickFilters={[]}
        onClearBoard={vi.fn()}
        onToggleQuickFilter={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
