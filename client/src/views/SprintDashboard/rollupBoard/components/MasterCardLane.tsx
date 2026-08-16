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

import { buildJiraBrowseUrl } from '../../../../utils/jiraBrowseUrl.ts';
import { useConnectionStore } from '../../../../store/connectionStore.ts';
import { buildDropTargetId } from '../cardDropRouting.ts';
import {
  resolveCellPlaceholder,
  shouldHideDraggedEntry,
  type DropPreview,
  type PlaceholderPlacement,
} from '../dropPlaceholder.ts';
import styles from '../RollupBoardTab.module.css';
import { isColumnCollapsed, type ColumnTrackStyle } from '../columnTrackLayout.ts';
import { SubLane } from './SubLane.tsx';
import { BoardContextMenu, type BoardMenuAction } from './BoardContextMenu.tsx';
import { FlagIcon } from './BoardIcons.tsx';
import { describeProgressDisagreement, describeTwoFigures } from '../familyProgress.ts';
import { buildLaneProgressBar, buildLaneVitalTiles, type LaneProgressBar, type LaneVitalTile } from '../laneVitals.ts';
import type { BoardMembershipReason } from '../boardMembershipReason.ts';
import type { FamilyProgress } from '../rollupBoardTypes.ts';
import type { CardDetail } from '../cardDetail.ts';
import type { LaneCellEntry, RenderedColumn, RenderedLane, RollupBoardItem } from '../rollupBoardTypes.ts';
import { ChildCard } from './ChildCard.tsx';
import { ParentContainer, type ParentContainerProps } from './ParentContainer.tsx';

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

/** The gap's slot inside one named container, or null when the gap is not that container's to draw. */
function readContainerPlaceholderIndex(
  dropPreview: DropPreview | null,
  cellId: string,
  containers: readonly { parentKey: string; items: readonly { key: string }[] }[],
  parentKey: string,
): number | null {
  const placement = resolveCellPlaceholder(dropPreview, cellId, [], containers.map((container) => ({
    parentKey: container.parentKey,
    itemKeys: container.items.map((containerItem) => containerItem.key),
  })));
  return placement?.target === 'container' && placement.parentKey === parentKey ? placement.index : null;
}

/** One thing to draw in a cell: the entries the layout produced, plus the gap the drag opens. */
type CellRenderEntry = LaneCellEntry | { kind: 'placeholder' };

/**
 * The cell's contents with the dragged card lifted out and the empty box dropped in.
 *
 * Built here rather than in the layout because it is about the drag in progress, which the board's
 * data has no opinion about — the layout describes where cards ARE, this describes where one is going.
 */
function buildCellRenderList(
  entries: readonly LaneCellEntry[],
  placement: PlaceholderPlacement | null,
  draggedItemKey: string | null,
): CellRenderEntry[] {
  const visible: CellRenderEntry[] = entries.filter((entry) => !(entry.kind === 'item'
    && shouldHideDraggedEntry(draggedItemKey, entry.item.key)));
  if (placement === null || placement.target !== 'cell') return visible;

  visible.splice(placement.index, 0, { kind: 'placeholder' });
  return visible;
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
  /** Why this lane is on the board at all — shown when there is no work to make that obvious. */
  membershipReason?: BoardMembershipReason | null;
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
  /** Extra context per issue, present only while a column is focused. */
  cardDetailByIssueKey?: Record<string, CardDetail>;
  /** The grid tracks, computed ONCE for the whole board so the header and cells cannot diverge. */
  columnTracks: ColumnTrackStyle;
  /** Both progress figures. Null when this Feature has no clones, which is the normal case. */
  familyProgress?: FamilyProgress | null;
  onToggleSubLaneCollapsed?: (cloneFeatureKey: string) => void;
  /** Records that one issue is contained in another. Absent leaves the card's menu unoffered. */
  onNestInto?: (issueKey: string, containerIssueKey: string) => void;
  /** Raises or clears Jira's impediment flag on a card. */
  onToggleFlag?: (issueKey: string, shouldBeFlagged: boolean) => void;
  onSetChecklistState?: ParentContainerProps['onSetChecklistState'];
  onOpenChecklistParent?: ParentContainerProps['onOpenChecklistParent'];
  pendingChecklistCardId?: string | null;
  errorMessageByChecklistCardId?: Record<string, string>;
  errorDetailByChecklistCardId?: Record<string, string>;
  checklistWriteBlockedReason?: string | null;
  /**
   * Columns narrowed to a strip, by id.
   *
   * The cells have to know as well as the header did. Narrowing only the HEADER left every lane still
   * rendering its cards into a 40px track, so the column got narrower and its contents were crushed
   * rather than put away — which is worse than not collapsing it at all.
   */
  collapsedColumnIds?: readonly string[];
  /** The card currently in the air, so the cell it came from does not also show its old slot. */
  draggedItemKey?: string | null;
  /** Where the gap is open, or null when nothing is being dragged. */
  dropPreview?: DropPreview | null;
}

/** One labelled figure in the header — a caption above a value, as on the Team Capacity panel. */
function LaneVitalTileView({ tile }: { tile: LaneVitalTile }) {
  const toneClassName = tile.tone === 'missing'
    ? styles.laneTileValueMissing
    : tile.tone === 'alert' ? styles.laneTileValueAlert : '';

  return (
    <div className={styles.laneTile}>
      <span className={styles.laneTileLabel}>{tile.label}</span>
      <span className={`${styles.laneTileValue} ${toneClassName}`.trim()}>{tile.value}</span>
    </div>
  );
}

/**
 * The Feature's progress as ONE bar carrying both figures.
 *
 * Two stacked tracks said "two metrics"; they are two views of the same one — how much of this
 * Feature is done, counting the dev team's work alone or the whole family's. One track with two tones
 * says that, and gives a lane back a row of vertical space it was spending to say it twice.
 *
 * Both fills are anchored left and overlaid rather than stacked end to end, because the family figure
 * can be LOWER than the dev figure — that is the whole point of showing it — and segments laid one
 * after the other would then have to run backwards. Overlaid, whichever is larger simply shows past
 * the other, and the legend names both.
 */
function ProgressVital({ bar, sentenceForm }: { bar: LaneProgressBar; sentenceForm: string | null }) {
  if (bar.devPercent === null) {
    return <span className={styles.laneVitalMissing}>{bar.emptyLabel}</span>;
  }

  const hasFamilyFigure = bar.familyPercent !== null;

  // The sentence the bar replaced is kept as the hover and screen-reader text: a bar is quicker to
  // scan, but a proportion drawn as a shape is not readable by everyone or in every setting.
  return (
    <div className={styles.laneProgress} title={sentenceForm ?? undefined}>
      <div className={styles.laneProgressTrack}>
        {hasFamilyFigure && (
          <div
            className={`${styles.laneProgressFill} ${styles.laneProgressFillFamily}`}
            style={{ width: `${Math.min(bar.familyPercent ?? 0, 100)}%` }}
          />
        )}
        <div
          className={styles.laneProgressFill}
          style={{ width: `${Math.min(bar.devPercent, 100)}%` }}
        />
      </div>

      {/* Colour is never the only signal: each figure is named beside its own swatch. */}
      <div className={styles.laneProgressLegend}>
        <span className={styles.laneProgressLegendEntry}>
          <span className={styles.laneProgressSwatch} />
          {hasFamilyFigure ? 'Dev' : 'Complete'} <strong>{bar.devPercent}%</strong>
          {bar.devDetail !== null && <span className={styles.laneProgressDetail}>{bar.devDetail}</span>}
        </span>

        {hasFamilyFigure && (
          <span className={styles.laneProgressLegendEntry}>
            <span className={`${styles.laneProgressSwatch} ${styles.laneProgressSwatchFamily}`} />
            Whole Feature <strong>{bar.familyPercent}%</strong>
            {bar.familyDetail !== null && (
              <span className={styles.laneProgressDetail}>{bar.familyDetail}</span>
            )}
          </span>
        )}
      </div>
    </div>
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
  membershipReason = null,
  laneRank,
  onRankChange,
  onSendToTop,
  onSendToBottom,
  onAddWork,
  onOpenIssue,
  onSelectFamily,
  cardDetailByIssueKey,
  columnTracks,
  familyProgress = null,
  onToggleSubLaneCollapsed,
  onNestInto,
  onToggleFlag,
  onSetChecklistState,
  onOpenChecklistParent,
  pendingChecklistCardId = null,
  errorMessageByChecklistCardId,
  errorDetailByChecklistCardId,
  checklistWriteBlockedReason = null,
  collapsedColumnIds = [],
  draggedItemKey = null,
  dropPreview = null,
}: MasterCardLaneProps) {
  const { vitals, featureKey, isSynthetic, isFeatureUnreadable, hasNoWorkYet } = lane.masterCard;
  const headerClassName = isSynthetic
    ? `${styles.laneHeader} ${styles.laneHeaderSynthetic}`
    : styles.laneHeader;

  // The lane's own drag lives on its header grip, so dragging a CARD inside the lane never picks up
  // the whole lane by accident.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: featureKey });

  // Both are built from the vitals, which are computed BEFORE any filter runs — so the bar and the
  // tiles always describe the whole Feature even while the cards beneath them are narrowed.
  const progressBar = buildLaneProgressBar(vitals, familyProgress);
  const vitalTiles = buildLaneVitalTiles(vitals, {
    matchedItemCount: lane.matchedItemCount,
    totalItemCount: lane.totalItemCount,
    hasActiveFilters,
  });

  // Where the actions menu was opened, or null when it is closed.
  const [menuPosition, setMenuPosition] = useState<{ xPx: number; yPx: number } | null>(null);

  // Built from whatever the board actually offered this lane, so a read-only board gets no menu at
  // all rather than a menu of nothing.
  const laneActions: BoardMenuAction[] = [
    ...(onAddWork && !isSynthetic
      ? [{ id: 'add-work', label: 'Add work…', onSelect: () => onAddWork(featureKey, vitals.summary) }]
      : []),
    ...(onSendToTop ? [{ id: 'send-top', label: 'Send to top', onSelect: () => onSendToTop(featureKey) }] : []),
    ...(onSendToBottom
      ? [{ id: 'send-bottom', label: 'Send to bottom', onSelect: () => onSendToBottom(featureKey) }]
      : []),
  ];

  // Held while the viewer is mid-edit; null means "show the lane's real rank".
  const [rankDraft, setRankDraft] = useState<string | null>(null);
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? '');

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
      {/* Right-click anywhere on the header, which is what was asked for. The ⋯ button is the same
          menu by another route, because an action reachable only by right-click is unreachable to
          anyone navigating by keyboard or on a touch screen. */}
      <header
        className={headerClassName}
        onContextMenu={(contextEvent) => {
          if (laneActions.length === 0) return;
          contextEvent.preventDefault();
          setMenuPosition({ xPx: contextEvent.clientX, yPx: contextEvent.clientY });
        }}
      >
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

        {/* The key opens the Feature in Jira. The click is stopped from reaching the header beneath
            it, which would otherwise collapse the lane on the way to the new tab, and from the drag
            sensor, which would treat the press as the start of a lane drag. "No Feature" is not a
            real issue, so it stays plain text. */}
        {isSynthetic
          ? <span className={styles.laneKey}>{vitals.key}</span>
          : (
            <a
              className={`${styles.laneKey} ${styles.laneKeyLink}`}
              href={buildJiraBrowseUrl(vitals.key, jiraBaseUrl)}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
              rel="noreferrer"
              target="_blank"
              title={`Open ${vitals.key} in Jira`}
            >
              {vitals.key}
            </a>
          )}
        <span className={styles.laneSummary}>{vitals.summary}</span>
        {vitals.isFlagged && <span className={styles.laneFlag}><FlagIcon /> Flagged</span>}

        {/* One button where there were three. The actions live in the menu — see BoardContextMenu for
            why they are no longer on screen at all times. */}
        {laneActions.length > 0 && (
          <button
            aria-haspopup="menu"
            aria-label={`Actions for ${vitals.key}`}
            className={`${styles.actionButton} ${styles.laneMenuButton}`}
            onClick={(clickEvent) => setMenuPosition({ xPx: clickEvent.clientX, yPx: clickEvent.clientY })}
            onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
            type="button"
          >
            ⋯
          </button>
        )}
      </header>

      <BoardContextMenu
        actions={laneActions}
        ownerKey={featureKey}
        onClose={() => setMenuPosition(null)}
        position={menuPosition}
      />

      {/* The vital signs, laid out the way the Team Capacity panel lays out its own: a bar for the
          thing that is a proportion, labelled tiles for the things that are quantities. As one run-on
          sentence in small grey type they were all present and none of them stood out. */}
      <div className={styles.laneMetrics}>
        <ProgressVital
          bar={progressBar}
          sentenceForm={familyProgress?.family ? describeTwoFigures(familyProgress) : null}
        />
        <div className={styles.laneTiles}>
          {vitalTiles.map((tile) => <LaneVitalTileView key={tile.id} tile={tile} />)}
        </div>
      </div>

      <div className={styles.laneNotices}>
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

        {/* The two figures themselves are the two progress tracks above; only the DISAGREEMENT still
            needs words, because "dev has finished and the Feature has not" is a conclusion rather
            than a number. */}
        {familyProgress?.hasDisagreement && (
          <span className={styles.familyProgressDisagreement}>
            {describeProgressDisagreement(familyProgress)}
          </span>
        )}

        {hasNoWorkYet && (
          <span className={styles.laneVitalMissing}>
            No work rolls up to this Feature yet — it is committed to the PI with nothing underneath
          </span>
        )}

        {/* An empty lane is the one that provokes "why is this even here?", because there is no work
            to justify it. The board knew the answer all along and never said it. */}
        {membershipReason !== null && (
          <span className={styles.laneMembership} title={membershipReason.howToRemove}>
            {membershipReason.summary}
          </span>
        )}

      </div>

      {!lane.isCollapsed && (
        <div
          className={styles.laneCells}
          style={{
            gridTemplateColumns: columnTracks.gridTemplateColumns,
            minWidth: columnTracks.minWidth,
          }}
        >
          {columns.map((column) => {
            const cell = lane.cellsByColumnId[column.id];

            // A narrowed column keeps its cell — it is still somewhere a card can be dropped — but
            // shows a COUNT instead of the cards. The count matters: a collapsed column that simply
            // went blank would hide this Feature's work in it, and the board's one rule is that work
            // is never hidden without being counted.
            if (isColumnCollapsed(collapsedColumnIds, column.id)) {
              // Checklist cards count here too. They are drawn only inside containers, so a column
              // holding nothing BUT checklist items counted zero and went blank — which is precisely
              // the hiding this count exists to prevent, and it is where every checklist item lands
              // until the team maps the states.
              const collapsedItemCount = (cell?.looseItems.length ?? 0)
                + (cell?.containers ?? []).reduce((total, container) =>
                  total + container.items.length + (container.checklistCards ?? []).length, 0);
              return (
                <LaneCellDropZone columnId={column.id} featureKey={featureKey} key={column.id}>
                  {collapsedItemCount > 0 && (
                    <span
                      className={styles.laneCellCollapsedCount}
                      title={`${collapsedItemCount} in ${column.name} — open the column to see them`}
                    >
                      {collapsedItemCount}
                    </span>
                  )}
                </LaneCellDropZone>
              );
            }

            return (
              <LaneCellDropZone columnId={column.id} featureKey={featureKey} key={column.id}>
                {/* ONE ordered list, containers and loose cards interleaved. Drawing all containers
                    and then all loose cards fixed their relative order in the markup, so a column
                    holding one of each could not be reordered by any drag. */}
                {buildCellRenderList(cell?.entries ?? [], resolveCellPlaceholder(
                  dropPreview,
                  buildDropTargetId(featureKey, column.id),
                  (cell?.entries ?? []).map((entry) => ({
                    itemKey: entry.kind === 'item' ? entry.item.key : null,
                  })),
                  (cell?.containers ?? []).map((container) => ({
                    parentKey: container.parentKey,
                    itemKeys: container.items.map((containerItem) => containerItem.key),
                  })),
                ), draggedItemKey).map((entry) => (entry.kind === 'placeholder' ? (
                  <div className={styles.dropPlaceholder} key="drop-placeholder">Move here</div>
                ) : entry.kind === 'container' ? (
                  <ParentContainer
                    cardDetailByIssueKey={cardDetailByIssueKey}
                    shouldShowStatus={column.isUnmappedColumn}
                    container={entry.container}
                    draggedItemKey={draggedItemKey}
                    placeholderIndex={readContainerPlaceholderIndex(
                      dropPreview, buildDropTargetId(featureKey, column.id),
                      cell?.containers ?? [], entry.container.parentKey,
                    )}
                    onNestInto={onNestInto}
                    onToggleFlag={onToggleFlag}
                    onSetChecklistState={onSetChecklistState}
                    onOpenChecklistParent={onOpenChecklistParent}
                    pendingChecklistCardId={pendingChecklistCardId}
                    errorMessageByChecklistCardId={errorMessageByChecklistCardId}
                    errorDetailByChecklistCardId={errorDetailByChecklistCardId}
                    checklistWriteBlockedReason={checklistWriteBlockedReason}
                    errorMessageByIssueKey={errorMessageByIssueKey}
                    highlightedFamilyKey={highlightedFamilyKey}
                    key={`container-${entry.container.parentKey}`}
                    onOpenIssue={onOpenIssue}
                    onSelectFamily={onSelectFamily}
                    pendingIssueKey={pendingIssueKey}
                  />
                ) : (
                  <ChildCard
                    containerCandidates={(cell?.looseItems ?? []).map((candidate) => ({
                      key: candidate.key, summary: candidate.summary,
                    }))}
                    onNestInto={onNestInto}
                    onToggleFlag={onToggleFlag}
                    detail={cardDetailByIssueKey?.[entry.item.key] ?? null}
                    shouldShowStatus={column.isUnmappedColumn}
                    errorMessage={errorMessageByIssueKey?.[entry.item.key] ?? null}
                    isHighlighted={highlightedFamilyKey !== null
                      && (highlightedFamilyKey === entry.item.key || highlightedFamilyKey === entry.item.parentKey)}
                    isPending={pendingIssueKey === entry.item.key}
                    item={entry.item}
                    key={entry.item.key}
                    onOpen={onOpenIssue}
                    onSelectFamily={onSelectFamily}
                  />
                )))}
              </LaneCellDropZone>
            );
          })}
        </div>
      )}

      {/* Each discipline's copy of this Feature, under the dev work it duplicates. */}
      {!lane.isCollapsed && lane.subLanes.map((subLane) => (
        <SubLane
          collapsedColumnIds={collapsedColumnIds}
          columnTracks={columnTracks}
          columns={columns}
          key={subLane.cloneFeatureKey}
          onOpenIssue={onOpenIssue}
          onToggleCollapsed={(cloneFeatureKey) => onToggleSubLaneCollapsed?.(cloneFeatureKey)}
          subLane={subLane}
        />
      ))}

    </section>
  );
}
