// UnmappedStatusAssistant.tsx — Finds the statuses nobody has claimed, and puts them somewhere.
//
// Mapping columns by hand means guessing which Jira states exist; anything missed lands in Unmapped
// and looks like it fell out of the board. The board already knows exactly which states are sitting
// there, so it lists them with their counts and lets each be dropped into whichever column the team
// actually wants it in — the same way a Jira board column holds several statuses at once.

import { useState } from 'react';

import type { ObservedBoardState } from '../columnOptionSources.ts';
import styles from '../RollupBoardTab.module.css';
import type { BoardColumn } from '../rollupBoardTypes.ts';

const NO_COLUMN_CHOSEN = '';

export interface UnmappedStatusAssistantProps {
  /** The states currently landing in Unmapped, commonest first. */
  unmappedStates: readonly ObservedBoardState[];
  columns: readonly BoardColumn[];
  /** Adds this Jira state to an existing column's list of claimed states. */
  onAssignToColumn: (columnId: string, state: ObservedBoardState) => void;
  /** Creates a new column that claims this state, named after it to start with. */
  onCreateColumnFor: (state: ObservedBoardState) => void;
}

/** Describes one Jira state the way the team would say it out loud. */
function describeState(state: ObservedBoardState): string {
  return state.subStatusValue ? `${state.jiraStatusName} / ${state.subStatusValue}` : state.jiraStatusName;
}

/** Renders the unclaimed states with a one-step way to place each of them. */
export function UnmappedStatusAssistant({
  unmappedStates,
  columns,
  onAssignToColumn,
  onCreateColumnFor,
}: UnmappedStatusAssistantProps) {
  const [chosenColumnIdByState, setChosenColumnIdByState] = useState<Record<string, string>>({});

  if (unmappedStates.length === 0) {
    return (
      <p className={styles.fieldLabel} data-testid="rollup-unmapped-assistant">
        Every status on this board belongs to a column — nothing is sitting in Unmapped.
      </p>
    );
  }

  return (
    <div className={styles.panelCard} data-testid="rollup-unmapped-assistant">
      <h4 className={styles.sectionTitle}>Statuses no column claims yet</h4>
      <p className={styles.fieldLabel}>
        These are in <strong>Unmapped</strong> right now. Put each one in the column you want it to appear in —
        a column can claim as many statuses as you like, exactly as a Jira board column does.
      </p>

      {unmappedStates.map((state) => {
        const stateKey = describeState(state);
        return (
          <div className={styles.editorRow} key={stateKey}>
            <span className={styles.fieldLabel}>
              <strong>{stateKey}</strong> — {state.issueCount} {state.issueCount === 1 ? 'issue' : 'issues'}
            </span>

            <select
              aria-label={`Column for ${stateKey}`}
              className={styles.inputField}
              onChange={(changeEvent) =>
                setChosenColumnIdByState({ ...chosenColumnIdByState, [stateKey]: changeEvent.target.value })}
              value={chosenColumnIdByState[stateKey] ?? NO_COLUMN_CHOSEN}
            >
              <option value={NO_COLUMN_CHOSEN}>Choose a column…</option>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>{column.name}</option>
              ))}
            </select>

            <button
              className={styles.actionButton}
              disabled={!chosenColumnIdByState[stateKey]}
              onClick={() => onAssignToColumn(chosenColumnIdByState[stateKey], state)}
              type="button"
            >
              Add to column
            </button>

            <button className={styles.actionButton} onClick={() => onCreateColumnFor(state)} type="button">
              New column for this
            </button>
          </div>
        );
      })}
    </div>
  );
}
