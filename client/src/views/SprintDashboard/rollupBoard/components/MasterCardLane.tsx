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
import styles from '../RollupBoardTab.module.css';
import type { ColumnTrackStyle } from '../columnTrackLayout.ts';
import { SubLane } from './SubLane.tsx';
import { BoardContextMenu, type BoardMenuAction } from './BoardContextMenu.tsx';
import { describeProgressDisagreement, describeTwoFigures } from '../familyProgress.ts';
import { buildLaneProgressBar, buildLaneVitalTiles, type LaneProgressBar, type LaneVitalTile } from '../laneVitals.ts';
import type { BoardMembershipReason } from '../boardMembershipReason.ts';
import type { FamilyProgress } from '../rollupBoardTypes.ts';
import type { CardDetail } from '../cardDetail.ts';
import type { RenderedColumn, RenderedLane, RollupBoardItem } from '../rollupBoardTypes.ts';
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
  /** The open issue's detail panel, rendered inside THIS lane when the issue belongs to it. */
  inlineDetail?: React.ReactNode;
  /** Both progress figures. Null when this Feature has no clones, which is the normal case. */
  familyProgress?: FamilyProgress | null;
  onToggleSubLaneCollapsed?: (cloneFeatureKey: string) => void;
  /** Records that one issue is contained in another. Absent leaves the card's menu unoffered. */
  onNestInto?: (issueKey: string, containerIssueKey: string) => void;
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

/** One filled bar with the figure and its workings beside it, so the number can be checked. */
function ProgressTrack({
  percent, detail, label, isFamily,
}: { percent: number; detail: string | null; label: string; isFamily: boolean }) {
  return (
    <div className={styles.laneProgressRow}>
      <span className={styles.laneProgressLabel}>{label}</span>
      <div className={styles.laneProgressTrack}>
        <div
          className={isFamily ? `${styles.laneProgressFill} ${styles.laneProgressFillFamily}` : styles.laneProgressFill}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={styles.laneProgressFigure}>{percent}%</span>
      {detail !== null && <span className={styles.laneProgressDetail}>{detail}</span>}
    </div>
  );
}

/**
 * Renders the Feature's progress as a bar rather than a sentence.
 *
 * Dev and family are drawn as separate tracks rather than stacked in one, because the family figure
 * can be LOWER than the dev figure — that is the whole point of showing it — and two figures sharing
 * a track would then read as one of them having gone backwards.
 */
function ProgressVital({ bar, sentenceForm }: { bar: LaneProgressBar; sentenceForm: string | null }) {
  if (bar.devPercent === null) {
    return <span className={styles.laneVitalMissing}>{bar.emptyLabel}</span>;
  }

  // The sentence the bars replaced is kept as the hover and screen-reader text: bars are quicker to
  // scan, but a proportion drawn as a shape is not readable by everyone or in every setting.
  return (
    <div className={styles.laneProgress} title={sentenceForm ?? undefined}>
      <ProgressTrack
        detail={bar.devDetail}
        isFamily={false}
        label={bar.familyPercent === null ? 'Complete' : 'Dev'}
        percent={bar.devPercent}
      />
      {bar.familyPercent !== null && (
        <ProgressTrack detail={bar.familyDetail} isFamily label="Whole Feature" percent={bar.familyPercent} />
      )}
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
  inlineDetail,
  familyProgress = null,
  onToggleSubLaneCollapsed,
  onNestInto,
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
        {vitals.isFlagged && <span className={styles.laneFlag}>⚑ Flagged</span>}

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
            return (
              <LaneCellDropZone columnId={column.id} featureKey={featureKey} key={column.id}>
                {cell?.containers.map((container) => (
                  <ParentContainer
                    cardDetailByIssueKey={cardDetailByIssueKey}
                    shouldShowStatus={column.isUnmappedColumn}
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
                    containerCandidates={cell.looseItems.map((candidate) => ({
                      key: candidate.key, summary: candidate.summary,
                    }))}
                    onNestInto={onNestInto}
                    detail={cardDetailByIssueKey?.[item.key] ?? null}
                    shouldShowStatus={column.isUnmappedColumn}
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

      {/* Each discipline's copy of this Feature, under the dev work it duplicates. */}
      {!lane.isCollapsed && lane.subLanes.map((subLane) => (
        <SubLane
          columnTracks={columnTracks}
          columns={columns}
          key={subLane.cloneFeatureKey}
          onOpenIssue={onOpenIssue}
          onToggleCollapsed={(cloneFeatureKey) => onToggleSubLaneCollapsed?.(cloneFeatureKey)}
          subLane={subLane}
        />
      ))}

      {/* The open card's detail belongs HERE, under the lane it was clicked in. It used to render at
          the very top of the page, which meant opening a card four lanes down was a scroll up to read
          it and a scroll back to find where you were. */}
      {inlineDetail !== undefined && inlineDetail !== null && (
        <div className={styles.laneInlineDetail}>{inlineDetail}</div>
      )}
    </section>
  );
}
