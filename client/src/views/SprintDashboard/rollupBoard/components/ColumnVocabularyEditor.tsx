// ColumnVocabularyEditor.tsx — Where the team names its own columns and says what each one means.
//
// This is the feature's point of leverage: the enterprise workflow's status + sub-status pairs are
// precise but unreadable, so the team writes a name it actually uses and maps it to the pair it
// stands for. Every value on offer comes from Jira, so a mapping can never be saved that a card
// would later refuse to move into.
//
// Publishing and pulling are both explicit, and a pull shows what would change before it changes
// anything — replacing someone's columns without warning would recreate the confusion this removes.

import { useState } from 'react';

import { validateVocabulary } from '../boardColumns.ts';
import { suggestChecklistColumnMapping, type ChecklistColumnMapping } from '../checklistCards.ts';
import { compareVocabularies, type VocabularyDifference, type VocabularyPullPreview } from '../boardVocabularySync.ts';
import {
  collectObservedBoardStates,
  collectUnmappedBoardStates,
  countIssuesMatchingMappings,
  type ColumnOptionSources,
  type ObservedBoardState,
} from '../columnOptionSources.ts';
import { UNMAPPED_COLUMN_ID } from '../rollupBoardTypes.ts';
import { UnmappedStatusAssistant } from './UnmappedStatusAssistant.tsx';
import styles from '../RollupBoardTab.module.css';
import type { BoardColumn, BoardVocabulary, RollupBoardItem } from '../rollupBoardTypes.ts';

const NEVER_SYNCED_LABEL = 'never shared with the team';

export interface ColumnVocabularyEditorProps {
  vocabulary: BoardVocabulary;
  optionSources: ColumnOptionSources;
  /** Every issue on the board, so the editor can suggest real states and count live matches. */
  allItems: readonly RollupBoardItem[];
  /** Absent when this team has no shared ART workspace, which makes sharing impossible but not the board. */
  canShare: boolean;
  /** Other teams whose column setup could be reused here. */
  copyableTeams?: readonly { id: string; name: string }[];
  onCopyFromTeam?: (sourceTeamProfileId: string) => void;
  pullPreview?: VocabularyPullPreview | null;
  onVocabularyChange: (vocabulary: BoardVocabulary) => void;
  onPublish?: () => void;
  onPreviewPull?: () => void;
  onAcceptPull?: (remote: BoardVocabulary) => void;
  onCancelPull?: () => void;
}

/** Generates a column id that stays stable once assigned, so a rename is never read as a new column. */
function buildColumnId(existingColumns: readonly BoardColumn[]): string {
  const highestSuffix = existingColumns
    .map((column) => Number(/^col-(\d+)$/.exec(column.id)?.[1] ?? 0))
    .reduce((highest, suffix) => Math.max(highest, suffix), 0);
  return `col-${highestSuffix + 1}`;
}

/** Turns one difference into a sentence a person can decide on. */
function describeDifference(difference: VocabularyDifference): string {
  switch (difference.kind) {
    case 'column-added': return `Adds the column "${difference.name}"`;
    case 'column-removed': return `Removes your column "${difference.name}"`;
    case 'column-renamed': return `Renames "${difference.fromName}" to "${difference.toName}"`;
    case 'order-changed': return `Moves "${difference.name}" to position ${difference.toOrder + 1}`;
    default: return `Changes which Jira state "${difference.name}" means`;
  }
}

/** Renders the column list, its mapping controls, and the share actions. */
export function ColumnVocabularyEditor({
  vocabulary,
  optionSources,
  allItems,
  canShare,
  copyableTeams = [],
  onCopyFromTeam,
  pullPreview = null,
  onVocabularyChange,
  onPublish,
  onPreviewPull,
  onAcceptPull,
  onCancelPull,
}: ColumnVocabularyEditorProps) {
  const [pendingColumnName, setPendingColumnName] = useState('');
  const validation = validateVocabulary(vocabulary);
  const hasSubStatusField = !optionSources.isSubStatusUnavailable;

  /**
   * Builds a starting set of columns from the states the board is genuinely in.
   *
   * Naming a state you can see beats guessing which states exist, and every column produced this way
   * is guaranteed to catch at least one issue.
   */
  function handleSuggestColumns(): void {
    const observedStates = collectObservedBoardStates(allItems);
    onVocabularyChange({
      ...vocabulary,
      columns: observedStates.map((observedState, stateIndex) => ({
        id: `col-${stateIndex + 1}`,
        name: observedState.suggestedColumnName,
        order: stateIndex,
        mappings: [{
          jiraStatusName: observedState.jiraStatusName,
          subStatusValue: hasSubStatusField ? observedState.subStatusValue : null,
        }],
      })),
    });
  }

  /** Replaces one column, leaving the rest untouched. */
  function updateColumn(columnId: string, changes: Partial<BoardColumn>): void {
    onVocabularyChange({
      ...vocabulary,
      columns: vocabulary.columns.map((column) => (column.id === columnId ? { ...column, ...changes } : column)),
    });
  }

  function handleAddColumn(): void {
    if (pendingColumnName.trim() === '') return;
    onVocabularyChange({
      ...vocabulary,
      columns: [
        ...vocabulary.columns,
        { id: buildColumnId(vocabulary.columns), name: pendingColumnName.trim(), order: vocabulary.columns.length, mappings: [] },
      ],
    });
    setPendingColumnName('');
  }


  /** Adds one Jira state to a column's claim, ignoring a state it already holds. */
  function handleAddStateToColumn(columnId: string, state: ObservedBoardState): void {
    const targetColumn = vocabulary.columns.find((column) => column.id === columnId);
    if (!targetColumn) return;

    const nextMapping = {
      jiraStatusName: state.jiraStatusName,
      subStatusValue: hasSubStatusField ? state.subStatusValue : null,
    };
    const isAlreadyClaimed = targetColumn.mappings.some((mapping) =>
      mapping.jiraStatusName === nextMapping.jiraStatusName && mapping.subStatusValue === nextMapping.subStatusValue);
    if (isAlreadyClaimed) return;

    updateColumn(columnId, { mappings: [...targetColumn.mappings, nextMapping] });
  }

  /** Creates a column that claims one state, named after it so the team can rename it. */
  function handleCreateColumnForState(state: ObservedBoardState): void {
    onVocabularyChange({
      ...vocabulary,
      columns: [
        ...vocabulary.columns,
        {
          id: buildColumnId(vocabulary.columns),
          name: state.suggestedColumnName,
          order: vocabulary.columns.length,
          mappings: [{
            jiraStatusName: state.jiraStatusName,
            subStatusValue: hasSubStatusField ? state.subStatusValue : null,
          }],
        },
      ],
    });
  }

  return (
    <section className={styles.panelCard} data-testid="rollup-vocabulary-editor">
      <h3 className={styles.sectionTitle}>Board columns</h3>

      <p className={styles.fieldLabel}>
        Name each column the way your team talks about the work, then say which Jira state it stands for.
        These columns belong to the whole team — last shared: {vocabulary.lastSyncedAt ?? NEVER_SYNCED_LABEL}.
      </p>

      {/* Building the same columns twice is wasted effort — take another team's and adjust. */}
      {copyableTeams.length > 0 && (
        <div className={styles.editorRow}>
          <label className={styles.fieldLabel}>
            Copy columns from
            <select
              aria-label="Copy columns from another team"
              className={styles.inputField}
              onChange={(changeEvent) => {
                if (changeEvent.target.value) onCopyFromTeam?.(changeEvent.target.value);
              }}
              value=""
            >
              <option value="">Choose a team…</option>
              {copyableTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <span className={styles.fieldLabel}>
            Replaces the columns below with that team&apos;s, for you to adjust. Their board is not affected.
          </span>
        </div>
      )}

      {/* Far easier than guessing which state combinations exist: start from the ones that do. */}
      <div className={styles.editorRow}>
        <button className={styles.actionButton} onClick={handleSuggestColumns} type="button">
          Suggest columns from this board
        </button>
        <span className={styles.fieldLabel}>
          Builds a column for every state your issues are actually in ({collectObservedBoardStates(allItems).length}{' '}
          found) — then just rename them. This replaces the columns below.
        </span>
      </div>

      {optionSources.isSubStatusUnavailable && (
        <p className={styles.fieldLabel}>
          No sub-status values are available on this board, so columns can only be mapped to a status.
        </p>
      )}

      <UnmappedStatusAssistant
        columns={vocabulary.columns}
        onAssignToColumn={handleAddStateToColumn}
        onCreateColumnFor={handleCreateColumnForState}
        unmappedStates={collectUnmappedBoardStates(allItems, UNMAPPED_COLUMN_ID)}
      />

      {[...vocabulary.columns].sort((left, right) => left.order - right.order).map((column) => (
        <div className={styles.editorRow} key={column.id}>
          <input
            aria-label={`Name of column ${column.id}`}
            className={styles.inputField}
            onChange={(changeEvent) => updateColumn(column.id, { name: changeEvent.target.value })}
            value={column.name}
          />

          {/* A column claims MANY Jira states, like a Jira board column. */}
          <span className={styles.fieldLabel}>
            {column.mappings.length === 0
              ? 'no statuses yet'
              : column.mappings.map((mapping) => mapping.subStatusValue
                ? `${mapping.jiraStatusName} / ${mapping.subStatusValue}`
                : mapping.jiraStatusName).join(' · ')}
          </span>

          {column.mappings.map((mapping) => (
            <button
              className={styles.actionButton}
              key={`${mapping.jiraStatusName}:${mapping.subStatusValue ?? ''}`}
              onClick={() => updateColumn(column.id, {
                mappings: column.mappings.filter((existing) => existing !== mapping),
              })}
              type="button"
            >
              Remove {mapping.subStatusValue ?? mapping.jiraStatusName}
            </button>
          ))}

          {/* Live feedback: a mapping that catches nothing is almost always a mistake, and the only
              way to see that today is to close the editor and look at the board. */}
          <span className={countIssuesMatchingMappings(allItems, column.mappings, hasSubStatusField) === 0
            ? styles.laneVitalMissing
            : styles.fieldLabel}
          >
            {column.mappings.length === 0
              ? 'no statuses — holds nothing'
              : `${countIssuesMatchingMappings(allItems, column.mappings, hasSubStatusField)} issues here now`}
          </span>          <button
            className={styles.actionButton}
            onClick={() => onVocabularyChange({
              ...vocabulary,
              columns: vocabulary.columns.filter((remainingColumn) => remainingColumn.id !== column.id),
            })}
            type="button"
          >
            Remove {column.name}
          </button>
        </div>
      ))}

      <div className={styles.editorRow}>
        <input
          aria-label="New column name"
          className={styles.inputField}
          onChange={(changeEvent) => setPendingColumnName(changeEvent.target.value)}
          placeholder="e.g. Waiting on SL test"
          value={pendingColumnName}
        />
        <button className={styles.actionButton} onClick={handleAddColumn} type="button">Add column</button>
      </div>

      {/* A conflict is refused rather than tidied away — auto-deduplicating would quietly discard a
          column somebody deliberately created. */}
      {!validation.isValid && (
        <div className={styles.editorError} role="alert">
          {validation.errors.map((error) => <p key={`${error.kind}:${error.columnIds.join(',')}`}>{error.message}</p>)}
        </div>
      )}

      <div className={styles.editorRow}>
        {canShare
          ? (
            <>
              <button className={styles.actionButton} disabled={!validation.isValid} onClick={onPublish} type="button">
                Share my columns with the team
              </button>
              <button className={styles.actionButton} onClick={onPreviewPull} type="button">
                Get the team&apos;s columns
              </button>
            </>
          )
          : (
            <span className={styles.fieldLabel}>
              This team has no shared ART workspace configured, so these columns stay on this machine.
            </span>
          )}
      </div>

      {canShare && (
        <p className={styles.fieldLabel}>
          These two are for keeping <strong>one team&apos;s</strong> columns the same across everybody&apos;s machine,
          through the team&apos;s shared Confluence workspace. <strong>Share my columns with the team</strong> publishes
          what you see above; <strong>Get the team&apos;s columns</strong> fetches whatever was last published and shows
          you the differences before anything changes. Neither touches another team — to reuse a setup on a different
          team, use <strong>Copy columns from</strong> above.
        </p>
      )}

      {pullPreview !== null && (
        <div className={styles.panelCard} role="region">
          {pullPreview.remote === null && <p className={styles.fieldLabel}>Nobody has published this team&apos;s columns yet.</p>}
          {pullPreview.remote !== null && !pullPreview.hasDifferences && (
            <p className={styles.fieldLabel}>Your columns already match the team&apos;s.</p>
          )}
          {pullPreview.remote !== null && pullPreview.hasDifferences && (
            <>
              <p className={styles.fieldLabel}>Accepting would:</p>
              <ul className={styles.editorDiff}>
                {compareVocabularies(vocabulary, pullPreview.remote).map((difference) => (
                  <li key={describeDifference(difference)}>{describeDifference(difference)}</li>
                ))}
              </ul>
              <div className={styles.editorRow}>
                <button
                  className={styles.actionButton}
                  onClick={() => pullPreview.remote && onAcceptPull?.(pullPreview.remote)}
                  type="button"
                >
                  Accept the team&apos;s columns
                </button>
                <button className={styles.actionButton} onClick={onCancelPull} type="button">Keep mine</button>
              </div>
            </>
          )}
        </div>
      )}

      <ChecklistColumnMappingEditor onVocabularyChange={onVocabularyChange} vocabulary={vocabulary} />
    </section>
  );
}

/** The three states a Smart Checklist item can be in, and the wording the board uses for each. */
const CHECKLIST_STATE_ROWS: Array<{ key: keyof ChecklistColumnMapping; label: string }> = [
  { key: 'openColumnId', label: 'To do' },
  { key: 'inProgressColumnId', label: 'Working' },
  { key: 'doneColumnId', label: 'Done' },
];

/**
 * Where a checklist item goes, now that it is drawn as a card rather than a line.
 *
 * Three fixed states have to land somewhere among a team's own columns, and only the team knows
 * where. `Done` is usually obvious; `To do` and `Working` are not, which is exactly why this is asked
 * rather than assumed. Anything left unchosen shows in Unmapped — visibly unplaced, never quietly
 * filed somewhere plausible.
 */
function ChecklistColumnMappingEditor({
  vocabulary,
  onVocabularyChange,
}: {
  vocabulary: BoardVocabulary;
  onVocabularyChange: (vocabulary: BoardVocabulary) => void;
}): React.JSX.Element {
  const mapping = vocabulary.checklistColumnMapping
    ?? { openColumnId: '', inProgressColumnId: '', doneColumnId: '' };

  /** Only columns that claim a Jira status: the Unmapped column is a destination, not a choice. */
  const selectableColumns = vocabulary.columns.filter((column) => column.mappings.length > 0);

  return (
    <div className={styles.panelCard} data-testid="rollup-checklist-mapping">
      <h3 className={styles.sectionTitle}>Where checklist items go</h3>
      <p className={styles.fieldLabel}>
        Smart Checklist items are drawn as cards in the column of their own state, the same as any
        other work. They have three states; these are your columns.
      </p>

      {selectableColumns.length === 0 ? (
        <p className={styles.fieldLabel}>
          Build some columns above first — a column that claims no Jira status could not accept a
          card anyway.
        </p>
      ) : (
        <>
          {CHECKLIST_STATE_ROWS.map((stateRow) => (
            <label className={styles.editorRow} key={stateRow.key}>
              <span className={styles.fieldLabel}>{stateRow.label}</span>
              <select
                className={styles.inputField}
                onChange={(changeEvent) => onVocabularyChange({
                  ...vocabulary,
                  checklistColumnMapping: { ...mapping, [stateRow.key]: changeEvent.target.value },
                })}
                value={mapping[stateRow.key]}
              >
                <option value="">Unmapped — show it, do not place it</option>
                {selectableColumns.map((column) => (
                  <option key={column.id} value={column.id}>{column.name}</option>
                ))}
              </select>
            </label>
          ))}

          <button
            className={styles.actionButton}
            onClick={() => onVocabularyChange({
              ...vocabulary,
              checklistColumnMapping: suggestChecklistColumnMapping(vocabulary.columns),
            })}
            type="button"
          >
            Suggest from my columns
          </button>
        </>
      )}
    </div>
  );
}
