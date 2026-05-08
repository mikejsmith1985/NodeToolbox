// BoardPicker.test.tsx — Unit tests for the BoardPicker component.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraBoard } from '../../types/jira.ts';
import BoardPicker from './BoardPicker.tsx';

function buildMockBoard(boardId: number, boardName: string, boardType: 'scrum' | 'kanban' = 'scrum'): JiraBoard {
  return { id: boardId, name: boardName, type: boardType, projectKey: 'TBX' };
}

const MOCK_BOARDS: JiraBoard[] = [
  buildMockBoard(1, 'Team Alpha Sprint Board'),
  buildMockBoard(2, 'Team Beta Sprint Board'),
  buildMockBoard(3, 'Team Alpha Kanban Board', 'kanban'),
];

describe('BoardPicker', () => {
  const onSelectBoard = vi.fn();
  const onSearchChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a search input', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    expect(screen.getByPlaceholderText(/search boards/i)).toBeInTheDocument();
  });

  it('renders all boards when search query is empty', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    expect(screen.getByText('Team Alpha Sprint Board')).toBeInTheDocument();
    expect(screen.getByText('Team Beta Sprint Board')).toBeInTheDocument();
    expect(screen.getByText('Team Alpha Kanban Board')).toBeInTheDocument();
  });

  it('shows a loading indicator when isLoading is true', () => {
    render(
      <BoardPicker
        boards={[]}
        isLoading={true}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    expect(screen.getByText(/loading boards/i)).toBeInTheDocument();
  });

  it('calls onSearchChange when the search input changes', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search boards/i), {
      target: { value: 'Alpha' },
    });

    expect(onSearchChange).toHaveBeenCalledWith('Alpha');
  });

  it('calls onSelectBoard with the board id when a board button is clicked', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    fireEvent.click(screen.getByText('Team Beta Sprint Board'));

    expect(onSelectBoard).toHaveBeenCalledWith(2);
  });

  it('marks the selected board with an aria-pressed attribute', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={1}
      />,
    );

    const selectedButton = screen.getByText('Team Alpha Sprint Board').closest('button');
    expect(selectedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a no-results message when no boards match the search query', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery="zzznomatch"
        selectedBoardId={null}
      />,
    );

    expect(screen.getByText(/no boards match/i)).toBeInTheDocument();
  });

  it('displays the board type badge for each board', () => {
    render(
      <BoardPicker
        boards={MOCK_BOARDS}
        isLoading={false}
        onSearchChange={onSearchChange}
        onSelectBoard={onSelectBoard}
        searchQuery=""
        selectedBoardId={null}
      />,
    );

    // The kanban board should show a "kanban" badge.
    expect(screen.getAllByText('kanban').length).toBeGreaterThan(0);
  });
});
