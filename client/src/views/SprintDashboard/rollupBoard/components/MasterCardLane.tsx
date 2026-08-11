// MasterCardLane.tsx — One Feature, rendered as a full-width swimlane.
//
// The header carries the Feature's vital signs so a collapsed board is still a readable portfolio
// view: what each Feature is, how far it has got, whether it is flagged or blocked. The numbers in
// that header always describe the WHOLE Feature — applying a filter narrows the cards below without
// ever changing what the Feature is worth.

import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { buildDropTargetId } from '../cardDropRouting.ts';
import styles from '../RollupBoardTab.module.css';
import type { RenderedColumn, RenderedLane, RollupBoardItem } from '../rollupBoardTypes.ts';
import { buildColumnGridTemplate } from './BoardColumnHeaderRow.tsx';
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

  return (
    <section
      className={styles.lane}
      data-testid={`rollup-lane-${featureKey}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className={headerClassName}>
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
        {isFeatureUnreadable && (
          <span className={styles.laneVitalMissing}>Feature details could not be read</span>
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
        <div className={styles.laneCells} style={{ gridTemplateColumns: buildColumnGridTemplate(columns.length) }}>
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
