// BoardPicker.tsx — Searchable board selection widget for the Sprint Dashboard settings panel.
//
// Renders a text-search input followed by a scrollable list of board buttons.
// When the user clicks a board, `onSelectBoard` is called with the board's numeric id.
// The search filters boards by name (case-insensitive).
// Corresponds to the board picker in the legacy sdRenderBoardSelect helper (07-sprint-dashboard.js lines 107–115).

import type { JiraBoard } from '../../types/jira.ts';
import styles from './BoardPicker.module.css';

// ── Props ──

interface BoardPickerProps {
  boards: JiraBoard[];
  selectedBoardId: number | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectBoard: (boardId: number) => void;
  isLoading: boolean;
}

// ── Helper ──

/** Filters the board list by the current search query (case-insensitive name match). */
function filterBoards(boards: JiraBoard[], searchQuery: string): JiraBoard[] {
  if (!searchQuery.trim()) return boards;
  const lowerQuery = searchQuery.toLowerCase();
  return boards.filter((board) => board.name.toLowerCase().includes(lowerQuery));
}

// ── Component ──

/**
 * Searchable list of Jira boards.
 * Calls `onSelectBoard(boardId)` when the user picks one and `onSearchChange(text)`
 * as the user types in the filter input.
 */
export default function BoardPicker({
  boards,
  selectedBoardId,
  searchQuery,
  onSearchChange,
  onSelectBoard,
  isLoading,
}: BoardPickerProps) {
  const filteredBoards = filterBoards(boards, searchQuery);

  return (
    <div className={styles.boardPickerContainer}>
      <p className={styles.boardPickerLabel}>Board</p>
      <input
        className={styles.searchInput}
        onChange={(changeEvent) => onSearchChange(changeEvent.target.value)}
        placeholder="Search boards…"
        type="text"
        value={searchQuery}
      />

      {isLoading && <p className={styles.loadingText}>Loading boards…</p>}

      {!isLoading && filteredBoards.length === 0 && (
        <p className={styles.noResultsText}>No boards match your search.</p>
      )}

      {!isLoading && filteredBoards.length > 0 && (
        <div className={styles.boardList}>
          {filteredBoards.map((board) => {
            const isSelectedBoard = board.id === selectedBoardId;
            const buttonClassName = isSelectedBoard
              ? `${styles.boardButton} ${styles.boardButtonSelected}`
              : styles.boardButton;

            return (
              <button
                aria-pressed={isSelectedBoard}
                className={buttonClassName}
                key={board.id}
                onClick={() => onSelectBoard(board.id)}
                type="button"
              >
                <span>{board.name}</span>
                <span className={styles.boardTypeBadge}>{board.type}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
