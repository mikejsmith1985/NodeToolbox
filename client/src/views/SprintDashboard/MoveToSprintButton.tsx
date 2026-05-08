// MoveToSprintButton.tsx — Inline "Move to Sprint" action for issue cards.
//
// Renders a small trigger button. On click it opens a dropdown that lists all active/future
// sprints except the issue's current sprint. Selecting one calls `onMoveToSprint` and then
// removes the issue from the visible list via the hook (the hook filters sprintIssues after success).
// Corresponds to sdOverviewOpenSprintDropdown / sdMoveIssueSprint (07-sprint-dashboard.js lines 254–308).

import { useState } from 'react';

import type { JiraSprint } from '../../types/jira.ts';
import styles from './MoveToSprintButton.module.css';

// ── Local state types ──

type MoveStatus = 'idle' | 'moving' | 'error';

// ── Props ──

interface MoveToSprintButtonProps {
  issueKey: string;
  currentSprintId: number | null;
  availableSprints: JiraSprint[];
  isLoadingAvailableSprints: boolean;
  /** Called the first time the dropdown is opened so the parent can lazily fetch sprints. */
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
}

// ── Helper ──

/** Returns sprints other than the issue's current sprint so the dropdown has relevant choices. */
function filterOtherSprints(sprints: JiraSprint[], currentSprintId: number | null): JiraSprint[] {
  if (currentSprintId === null) return sprints;
  return sprints.filter((sprint) => sprint.id !== currentSprintId);
}

// ── Component ──

/**
 * Inline move-to-sprint dropdown for a single issue.
 * The parent is responsible for loading `availableSprints` when `onFetchSprints` fires.
 */
export default function MoveToSprintButton({
  issueKey,
  currentSprintId,
  availableSprints,
  isLoadingAvailableSprints,
  onFetchSprints,
  onMoveToSprint,
}: MoveToSprintButtonProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [moveStatus, setMoveStatus] = useState<MoveStatus>('idle');
  const [moveErrorMessage, setMoveErrorMessage] = useState<string | null>(null);

  function handleOpenDropdown() {
    setIsDropdownOpen(true);
    // Trigger lazy-fetch only once; the parent ignores duplicates when already loaded.
    onFetchSprints();
  }

  async function handleSelectSprint(targetSprintId: number) {
    setMoveStatus('moving');
    setMoveErrorMessage(null);
    try {
      await onMoveToSprint(issueKey, targetSprintId);
      // The parent hook removes the issue from sprintIssues so this component unmounts.
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Move failed';
      setMoveErrorMessage(errorMessage);
      setMoveStatus('error');
    }
  }

  const otherSprints = filterOtherSprints(availableSprints, currentSprintId);

  return (
    <div className={styles.moveWrapper}>
      {!isDropdownOpen && (
        <button className={styles.triggerButton} onClick={handleOpenDropdown} type="button">
          ↗ Move to sprint
        </button>
      )}

      {isDropdownOpen && (
        <div className={styles.dropdown}>
          {isLoadingAvailableSprints && <p className={styles.feedbackText}>Loading…</p>}

          {!isLoadingAvailableSprints && otherSprints.length === 0 && (
            <p className={styles.feedbackText}>No other sprints available.</p>
          )}

          {!isLoadingAvailableSprints &&
            otherSprints.map((sprint) => (
              <button
                className={styles.sprintOptionButton}
                disabled={moveStatus === 'moving'}
                key={sprint.id}
                onClick={() => handleSelectSprint(sprint.id)}
                type="button"
              >
                {sprint.name}
                <span className={styles.stateBadge}>
                  {sprint.state === 'future' ? '(future)' : '(active)'}
                </span>
              </button>
            ))}

          {moveStatus === 'error' && moveErrorMessage && (
            <p className={styles.errorText}>❌ {moveErrorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
