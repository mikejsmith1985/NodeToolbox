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
import { compareVocabularies, type VocabularyDifference, type VocabularyPullPreview } from '../boardVocabularySync.ts';
import type { ColumnOptionSources } from '../columnOptionSources.ts';
import styles from '../RollupBoardTab.module.css';
import type { BoardColumn, BoardVocabulary } from '../rollupBoardTypes.ts';

const ANY_VALUE = '';
const NEVER_SYNCED_LABEL = 'never shared with the team';

export interface ColumnVocabularyEditorProps {
  vocabulary: BoardVocabulary;
  optionSources: ColumnOptionSources;
  /** Absent when this team has no shared ART workspace, which makes sharing impossible but not the board. */
  canShare: boolean;
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
  canShare,
  pullPreview = null,
  onVocabularyChange,
  onPublish,
  onPreviewPull,
  onAcceptPull,
  onCancelPull,
}: ColumnVocabularyEditorProps) {
  const [pendingColumnName, setPendingColumnName] = useState('');
  const validation = validateVocabulary(vocabulary);

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
        { id: buildColumnId(vocabulary.columns), name: pendingColumnName.trim(), order: vocabulary.columns.length, mapping: null },
      ],
    });
    setPendingColumnName('');
  }

  /** Moves a column one place left or right, renumbering so the order stays contiguous. */
  function handleMoveColumn(columnId: string, offset: number): void {
    const sortedColumns = [...vocabulary.columns].sort((left, right) => left.order - right.order);
    const currentIndex = sortedColumns.findIndex((column) => column.id === columnId);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sortedColumns.length) return;

    const [movedColumn] = sortedColumns.splice(currentIndex, 1);
    sortedColumns.splice(targetIndex, 0, movedColumn);
    onVocabularyChange({
      ...vocabulary,
      columns: sortedColumns.map((column, columnIndex) => ({ ...column, order: columnIndex })),
    });
  }

  /** Updates one half of a column's Jira mapping, keeping the other half. */
  function handleMappingChange(column: BoardColumn, changes: { jiraStatusName?: string; subStatusValue?: string | null }): void {
    const nextStatusName = changes.jiraStatusName ?? column.mapping?.jiraStatusName ?? '';
    if (nextStatusName === '') {
      updateColumn(column.id, { mapping: null });
      return;
    }
    updateColumn(column.id, {
      mapping: {
        jiraStatusName: nextStatusName,
        subStatusValue: changes.subStatusValue !== undefined ? changes.subStatusValue : column.mapping?.subStatusValue ?? null,
      },
    });
  }

  return (
    <section className={styles.panelCard} data-testid="rollup-vocabulary-editor">
      <h3 className={styles.sectionTitle}>Board columns</h3>

      <p className={styles.fieldLabel}>
        These columns are the team&apos;s, not yours alone. Last shared: {vocabulary.lastSyncedAt ?? NEVER_SYNCED_LABEL}.
      </p>

      {optionSources.isSubStatusUnavailable && (
        <p className={styles.fieldLabel}>
          No sub-status values are available on this board, so columns can only be mapped to a status.
        </p>
      )}

      {[...vocabulary.columns].sort((left, right) => left.order - right.order).map((column) => (
        <div className={styles.editorRow} key={column.id}>
          <input
            aria-label={`Name of column ${column.id}`}
            className={styles.inputField}
            onChange={(changeEvent) => updateColumn(column.id, { name: changeEvent.target.value })}
            value={column.name}
          />

          <select
            aria-label={`Jira status for ${column.name}`}
            className={styles.inputField}
            onChange={(changeEvent) => handleMappingChange(column, { jiraStatusName: changeEvent.target.value })}
            value={column.mapping?.jiraStatusName ?? ANY_VALUE}
          >
            <option value={ANY_VALUE}>Not mapped yet</option>
            {optionSources.statusNames.map((statusName) => (
              <option key={statusName} value={statusName}>{statusName}</option>
            ))}
          </select>

          <select
            aria-label={`Sub-status for ${column.name}`}
            className={styles.inputField}
            disabled={optionSources.isSubStatusUnavailable}
            onChange={(changeEvent) => handleMappingChange(column, { subStatusValue: changeEvent.target.value || null })}
            value={column.mapping?.subStatusValue ?? ANY_VALUE}
          >
            <option value={ANY_VALUE}>Any sub-status</option>
            {optionSources.subStatusValues.map((subStatusValue) => (
              <option key={subStatusValue} value={subStatusValue}>{subStatusValue}</option>
            ))}
          </select>

          <button aria-label={`Move ${column.name} left`} className={styles.actionButton} onClick={() => handleMoveColumn(column.id, -1)} type="button">←</button>
          <button aria-label={`Move ${column.name} right`} className={styles.actionButton} onClick={() => handleMoveColumn(column.id, 1)} type="button">→</button>
          <button
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
                Publish to the team
              </button>
              <button className={styles.actionButton} onClick={onPreviewPull} type="button">
                Pull the team&apos;s columns
              </button>
            </>
          )
          : (
            <span className={styles.fieldLabel}>
              This team has no shared ART workspace configured, so these columns stay on this machine.
            </span>
          )}
      </div>

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
    </section>
  );
}
