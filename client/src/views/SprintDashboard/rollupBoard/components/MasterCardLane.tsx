// MasterCardLane.tsx — One Feature, rendered as a full-width swimlane.
//
// The header carries the Feature's vital signs so a collapsed board is still a readable portfolio
// view: what each Feature is, how far it has got, whether it is flagged or blocked. The numbers in
// that header always describe the WHOLE Feature — applying a filter narrows the cards below without
// ever changing what the Feature is worth.

import { useState } from 'react';

import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { buildDropTargetId } from '../cardDropRouting.ts';
import styles from '../RollupBoardTab.module.css';
import type { RenderedColumn, RenderedLane, RollupBoardItem } from '../rollupBoardTypes.ts';
import { buildColumnGridTemplate, buildColumnRowMinWidth } from './BoardColumnHeaderRow.tsx';
import { ChildCard } from './ChildCard.tsx';
import { ParentContainer } from './ParentContainer.tsx';

const COLLAPSED_ICON = '▶';
const EXPANDED_ICON = '▼';

/** One column's cell within a lane, and the place a dragged card can be dropped. */
function LaneCellDropZone({
  featureKey,
  columnId,
  children,
}: {
  featureKey: string;
  columnId: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: buildDropTargetId(featureKey, columnId) });

  return (
    <div
      className={isOver ? `${styles.laneCell} ${styles.laneCellDropTarget}` : styles.laneCell}
      data-testid={`rollup-cell-${featureKey}-${columnId}`}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
}

export interface MasterCardLaneProps {
  lane: RenderedLane;
  columns: readonly RenderedColumn[];
  /** True when any quick filter is active, so the lane can say its card counts are narrowed. */
  hasActiveFilters: boolean;
  highlightedFamilyKey?: string | null;
  /** The card whose status change is still in flight, shown as pending rather than as settled. */
  pendingIssueKey?: string | null;
  /** Per-card failure reasons, shown in place so a rejected move is never silent. */
  errorMessageByIssueKey?: Record<string, string>;
  onToggleCollapsed: (featureKey: string) => void;
  /** Why this Feature could not be read, when the board managed to establish a reason. */
  featureReadFailureDetail?: string | null;
  /** This lane's position on the board, counting from 1. */
  laneRank?: number;
  /** Moves this lane to a rank the viewer typed. Absent hides the rank box. */
  onRankChange?: (featureKey: string, nextRank: number) => void;
  onSendToTop?: (featureKey: string) => void;
  onSendToBottom?: (featureKey: string) => void;
  /** Opens the add-work form for this Feature. Absent when the board cannot create issues. */
  onAddWork?: (featureKey: string, featureSummary: string) => void;
  onOpenIssue?: (issueKey: string) => void;
  onSelectFamily?: (item: RollupBoardItem) => void;
}

/** Renders the Feature's progress with the basis it was worked out on, so it can be checked. */
function ProgressVital({ lane }: { lane: RenderedLane }) {
  const { progress } = lane.masterCard.vitals;
  if (progress.percentComplete === null) {
    return <span className={styles.laneVitalMissing}>no work to measure yet</span>;
  }

  const basisLabel = progress.basis === 'story-points' ? 'story points' : 'issue count';
  return (
    <span className={styles.laneVital}>
      {progress.percentComplete}% complete
      {' '}({progress.completedUnits} of {progress.totalUnits} by {basisLabel})
    </span>
  );
}

/** Renders one Feature swimlane: vitals in the header, cards beneath when expanded. */
export function MasterCardLane({
  lane,
  columns,
  hasActiveFilters,
  highlightedFamilyKey = null,
  pendingIssueKey = null,
  errorMessageByIssueKey,
  onToggleCollapsed,
  featureReadFailureDetail = null,
  laneRank,
  onRankChange,
  onSendToTop,
  onSendToBottom,
  onAddWork,
  onOpenIssue,
  onSelectFamily,
}: MasterCardLaneProps) {
  const { vitals, featureKey, isSynthetic, isFeatureUnreadable, hasNoWorkYet } = lane.masterCard;
  const headerClassName = isSynthetic
    ? `${styles.laneHeader} ${styles.laneHeaderSynthetic}`
    : styles.laneHeader;

  // The lane's own drag lives on its header grip, so dragging a CARD inside the lane never picks up
  // the whole lane by accident.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: featureKey });

  // Held while the viewer is mid-edit; null means "show the lane's real rank".
  const [rankDraft, setRankDraft] = useState<string | null>(null);

  /** Applies a typed rank, ignoring anything that is not a number and restoring the real one. */
  function commitRank(typedValue: string): void {
    const typedRank = Number(typedValue.trim());
    setRankDraft(null);
    if (!Number.isFinite(typedRank) || typedValue.trim() === '') return;
    if (typedRank === laneRank) return;
    onRankChange?.(featureKey, typedRank);
  }

  return (
    <section
      className={styles.lane}
      data-testid={`rollup-lane-${featureKey}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className={headerClassName}>
        {/* Sits with the grip because it does the same job by another means: dragging is quicker for
            a short hop, typing a number is quicker across a long board. Committed on blur or Enter
            rather than per keystroke, so typing "12" does not first move the lane to rank 1. */}
        {laneRank !== undefined && onRankChange && (
          <input
            aria-label={`Rank of ${vitals.key}`}
            className={styles.laneRankInput}
            inputMode="numeric"
            onBlur={(blurEvent) => commitRank(blurEvent.target.value)}
            onChange={(changeEvent) => setRankDraft(changeEvent.target.value)}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === 'Enter') keyboardEvent.currentTarget.blur();
              // Escape abandons the edit and puts the lane's real rank back in the box.
              if (keyboardEvent.key === 'Escape') {
                setRankDraft(null);
                keyboardEvent.currentTarget.blur();
              }
            }}
            // Never let a keystroke start a drag, or typing would pick the lane up.
            onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
            type="text"
            value={rankDraft ?? String(laneRank)}
          />
        )}
        <span
          className={styles.laneGrip}
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag ${vitals.key} to reorder it`}
        >
          ⠿
        </span>
        <button
          aria-expanded={!lane.isCollapsed}
          aria-label={`${lane.isCollapsed ? 'Expand' : 'Collapse'} ${vitals.key}`}
          className={styles.laneToggle}
          onClick={() => onToggleCollapsed(featureKey)}
          type="button"
        >
          {lane.isCollapsed ? COLLAPSED_ICON : EXPANDED_ICON}
        </button>

        <span className={styles.laneKey}>{vitals.key}</span>
        <span className={styles.laneSummary}>{vitals.summary}</span>

        {vitals.statusName !== null && <span className={styles.laneVital}>{vitals.statusName}</span>}
        <ProgressVital lane={lane} />
        <span className={styles.laneVital}>
          {vitals.dependencyCount} {vitals.dependencyCount === 1 ? 'dependency' : 'dependencies'}
        </span>
        {vitals.isFlagged && <span className={styles.laneFlag}>⚑ Flagged</span>}
        {vitals.storyPoints === null
          ? <span className={styles.laneVitalMissing}>no estimate</span>
          : <span className={styles.laneVital}>{vitals.storyPoints} pts</span>}
        {vitals.priorityName === null
          ? <span className={styles.laneVitalMissing}>no priority</span>
          : <span className={styles.laneVital}>{vitals.priorityName}</span>}

        <span className={styles.laneVital}>
          {hasActiveFilters
            ? `${lane.matchedItemCount} of ${lane.totalItemCount} match`
            : `${lane.totalItemCount} items`}
        </span>

        {isSynthetic && (
          <span className={styles.laneVital}>
            — hygiene: none of these roll up to a Feature, so they need linking in Jira
          </span>
        )}
        {/* The reason belongs here, beside the lane that raises the question — a banner elsewhere is
            easy to miss, and "could not be read" on its own leaves nowhere to go. */}
        {isFeatureUnreadable && (
          <span className={styles.laneVitalMissing}>
            {featureReadFailureDetail
              ?? 'Feature details could not be read, and asking Jira about it directly produced no reason either.'}
          </span>
        )}

        {hasNoWorkYet && (
          <span className={styles.laneVitalMissing}>
            No work rolls up to this Feature yet — it is committed to the PI with nothing underneath
          </span>
        )}

        {/* Sits with Send to top / bottom because it is the same kind of action: something you do TO a
            lane. Offered on every lane, not just empty ones — a Feature usually needs more stories
            after the first few land. */}
        {onAddWork && !isSynthetic && (
          <button className={styles.actionButton} onClick={() => onAddWork(featureKey, vitals.summary)} type="button">
            Add work
          </button>
        )}

        {onSendToTop && (
          <button className={styles.actionButton} onClick={() => onSendToTop(featureKey)} type="button">
            Send to top
          </button>
        )}
        {onSendToBottom && (
          <button className={styles.actionButton} onClick={() => onSendToBottom(featureKey)} type="button">
            Send to bottom
          </button>
        )}
      </header>

      {!lane.isCollapsed && (
        <div
          className={styles.laneCells}
          style={{
            gridTemplateColumns: buildColumnGridTemplate(columns.length),
            minWidth: buildColumnRowMinWidth(columns.length),
          }}
        >
          {columns.map((column) => {
            const cell = lane.cellsByColumnId[column.id];
            return (
              <LaneCellDropZone columnId={column.id} featureKey={featureKey} key={column.id}>
                {cell?.containers.map((container) => (
                  <ParentContainer
                    container={container}
                    errorMessageByIssueKey={errorMessageByIssueKey}
                    highlightedFamilyKey={highlightedFamilyKey}
                    key={container.parentKey}
                    onOpenIssue={onOpenIssue}
                    onSelectFamily={onSelectFamily}
                    pendingIssueKey={pendingIssueKey}
                  />
                ))}
                {cell?.looseItems.map((item) => (
                  <ChildCard
                    errorMessage={errorMessageByIssueKey?.[item.key] ?? null}
                    isHighlighted={highlightedFamilyKey === item.key || highlightedFamilyKey === item.parentKey}
                    isPending={pendingIssueKey === item.key}
                    item={item}
                    key={item.key}
                    onOpen={onOpenIssue}
                    onSelectFamily={onSelectFamily}
                  />
                ))}
              </LaneCellDropZone>
            );
          })}
        </div>
      )}
    </section>
  );
}
