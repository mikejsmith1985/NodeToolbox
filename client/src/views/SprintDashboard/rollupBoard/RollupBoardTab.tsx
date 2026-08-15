// RollupBoardTab.tsx — The Feature Roll-Up Board: the team's Jira board, arranged by what it delivers.
//
// Every issue on the team's selected board appears in the swimlane of the Feature it delivers, in the
// column matching its own status. Work that cannot be traced to a Feature is collected in a "No
// Feature" lane and counted — an unquantified hygiene backlog never gets fixed.
//
// The board never hides anything: an issue whose state no column claims goes to Unmapped, and if any
// part of the data could not be read the board says which part, rather than quietly looking smaller
// than the team's real workload.

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import IssueDetailPanel from '../../../components/IssueDetailPanel/index.tsx';
import type { JiraIssue } from '../../../types/jira.ts';
import { loadConfiguredFeatureLinkFieldId } from '../../../utils/featureLink.ts';
import { createIssue, createIssueLink, getProjectIssueTypes, jiraGet, jiraPut } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueType } from '../../../types/jira.ts';
import { buildJqlFieldReference, loadHygieneFieldConfig, readConfiguredPiFieldId } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  fetchFeatureReviewEditMeta,
  fetchFeatureReviewTransitions,
  getStoryPointsCandidateFieldIds,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewTransition,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../featureReviewFixes.ts';
import { computeBoardScrollerMaxHeight, readDocumentTop } from './boardViewportFit.ts';
import {
  applyBoardOrder,
  describeOrderDifference,
  previewBoardOrderPull,
  publishBoardOrder,
  type OrderPullPreview,
} from './boardOrderSync.ts';
import { buildColumnTracks, toggleColumnCollapsed } from './columnTrackLayout.ts';
import { findFlagFieldInCatalog, setIssueFlag } from './issueFlagWrite.ts';
import { type DropPreview } from './dropPlaceholder.ts';
import {
  buildChecklistCards,
  parseChecklistCardId,
  parseChecklistDragId,
  resolveChecklistStateForColumn,
  type ChecklistCard,
} from './checklistCards.ts';
import type { ChecklistItemState } from './checklistItems.ts';
import { saveChecklistItemState } from './checklistWrite.ts';
import { selectColumnMapping } from './selectColumnMapping.ts';
import { buildJiraBrowseUrl } from '../../../utils/jiraBrowseUrl.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { buildRenderedColumns, resolveColumnIdForItem } from './boardColumns.ts';
import { describeMissingSubLanes, describeUnconfiguredClones } from './cloneFamily.ts';
import { classifyCloneFamilies, discoverDisciplineWork } from './disciplineDiscovery.ts';
import { fetchCloneFeatures, fetchDisciplineWork, PARENT_LINK_FIELD_ID } from './rollupBoardFetch.ts';
import { buildSubLanes, readSubLaneItemLists } from './subLaneLayout.ts';
import { computeFamilyProgress } from './familyProgress.ts';
import {
  describeStatusPair,
  describeUnmappedBoardShare,
  describeUnmappedStatusGroup,
  summarizeUnmappedStatuses,
} from './unmappedStatusSummary.ts';
import { EMPTY_QUICK_FILTER_STATE, hasActiveFilters } from './boardFilters.ts';
import { buildBoardLayout } from './boardLayout.ts';
import {
  clearManualOrder,
  hasManualOrder,
  loadBoardPreferences,
  moveCardBeside,
  moveLaneBefore,
  moveLaneToEnd,
  moveLaneToRank,
  saveBoardPreferences,
  setAllLanesCollapsed,
  toggleLaneCollapsed,
} from './boardPreferencesStore.ts';
import { loadTeamVocabulary, markVocabularySynced, saveTeamVocabulary } from './boardVocabularyStore.ts';
import { previewBoardVocabularyPull, publishBoardVocabulary, type VocabularyPullPreview } from './boardVocabularySync.ts';
import {
  buildDropTargetId,
  parseCardTargetId,
  parseDropTargetId,
  readPointerY,
  resolveCardDrop,
  resolveCardDropZone,
} from './cardDropRouting.ts';
import { loadColumnOptionSources, type ColumnOptionSources } from './columnOptionSources.ts';
import { executeStatusMove, type ExecuteStatusMoveInput } from './statusMoveWriter.ts';
import { resolveBoardItems } from './featureRollup.ts';
import { buildFeatureWithoutWorkCard, buildMasterCards, orderLanesLikePiReview } from './masterCards.ts';
import {
  fetchCardDetails,
  fetchCarryOverScope,
  fetchCarryOverScopeFromPiReview,
  fetchFeaturesInPi,
  fetchRollupBoardIssues,
  fetchSprintPiReconciliation,
  fetchTeamIssuesForFeatures,
} from './rollupBoardFetch.ts';
import {
  buildBoardVisibilityPayload,
  buildNewWorkPayload,
  describeCreationOutcome,
} from './createWorkForFeature.ts';
import { buildFeatureFieldUpdateFields, resolvePiFieldUpdateValue } from '../piFeatureRemap.ts';
import {
  buildContainmentLinkInput,
  resolveContainmentLinkDirection,
  type JiraIssueLinkType,
} from '../../AdminHub/subtaskStoryPromotion.ts';
import { describeJiraFailure } from '../../AdminHub/subtaskStoryPromotion.ts';
import { sumUnplannedStoryPoints } from './emptyFeatureScan.ts';
import { buildCardDetailIndex, type CardDetail } from './cardDetail.ts';
import { listChecklistFieldIds } from './checklistItems.ts';
import { selectDetailIssueKeys, selectFamilyKey, selectVisibleColumns, toggleColumnFocus } from './columnFocus.ts';
import {
  describeEmptyFeatureMembership,
  describeGuessedLaneCount,
  describeWorkingLaneMembership,
  type BoardMembershipReason,
} from './boardMembershipReason.ts';
import {
  COLUMN_DENSITY_LABELS,
  DEFAULT_COLUMN_DENSITY,
  describeColumnFit,
  measureBoardWidth,
  readColumnMinWidth,
  type ColumnDensity,
} from './columnDensity.ts';
import {
  diagnoseMoveBlock,
  matchEditMetaFieldsByName,
  type MoveBlockDiagnosis,
} from './moveBlockDiagnosis.ts';
import { MoveBlockedDialog } from './components/MoveBlockedDialog.tsx';
import { ChecklistDiagnosticsPanel } from './components/ChecklistDiagnosticsPanel.tsx';
import { useAdminStore } from '../../../store/adminStore.ts';
import { canShowBoardDiagnostics, useDiagnosticsStore } from '../../../store/diagnosticsStore.ts';
import { CardTransitionsPanel } from './components/CardTransitionsPanel.tsx';
import { buildCardTransitionOptions, type CardTransitionOption } from './cardTransitions.ts';
import { findPiReviewPageForPi } from './carryOverMarks.ts';
import {
  EMPTY_CARRY_OVER_SCOPE,
  describeCarryOverScope,
  mergeScopedIssueKeys,
  type CarryOverScope,
} from './carryOverScope.ts';
import {
  readFeatureKeysFromTeamIssues,
  selectTeamOwnedEmptyFeatures,
  type TeamOwnedEmptyFeature,
} from './teamFeatureOwnership.ts';
import { useStandupRosterStore } from '../hooks/useStandupRosterStore.ts';
import { describeReconciliation, type SprintPiReconciliation } from '../sprintPiReconciliation.ts';
import {
  clearTeamFeatureScope,
  hasTeamOwnFeatureScope,
  loadTeamFeatureScope,
  saveTeamFeatureScope,
} from './boardScopeStore.ts';
import { applyFeatureScope, type FeatureScopeSettings } from './featureScope.ts';
import { AddWorkDialog } from './components/AddWorkDialog.tsx';
import { BoardNotices, type BoardNotice } from './components/BoardNotices.tsx';
import { BoardColumnHeaderRow } from './components/BoardColumnHeaderRow.tsx';
import { ColumnVocabularyEditor } from './components/ColumnVocabularyEditor.tsx';
import { FeatureScopePanel } from './components/FeatureScopePanel.tsx';
import { ChildCard } from './components/ChildCard.tsx';
import { MasterCardLane } from './components/MasterCardLane.tsx';
import { PlacementTroubleshooter } from './components/PlacementTroubleshooter.tsx';
import { QuickFilterBar } from './components/QuickFilterBar.tsx';
import styles from './RollupBoardTab.module.css';
import {
  EXPECTED_BOARD_ISSUE_CEILING,
  NO_FEATURE_KEY,
  UNMAPPED_COLUMN_ID,
  type CloneClassification,
  type FamilyProgress,
  type SubLane,
  type BoardPreferences,
  type MasterCard,
  type QuickFilterState,
  type FeatureReadFailure,
  type RollupBoardItem,
  type RollupBoardScope,
} from './rollupBoardTypes.ts';

/**
 * Said when no Jira board is selected — as a NOTICE, never as an empty state.
 *
 * This board does not read a Jira board's saved filter, and has not since an early version swept it
 * and dragged in the whole backlog. A Kanban board shows all open work and a Scrum board shows the
 * active sprint; this board shows whatever the Team Dashboard's Sprint / PI / Fix Version selector
 * holds. Seeing the data in a way Jira will not is the entire point of it, so mirroring a Jira board
 * would defeat the purpose rather than serve it.
 *
 * The selection is used here for exactly one thing: reading the sprint list, to check that the team's
 * sprints and its PI agree. Its absence therefore costs that one check and nothing else — which is
 * reported as the small gap it is, rather than as a reason to show no board at all.
 */
const NO_BOARD_SELECTED_NOTICE =
  'No Jira board is selected for this team, so the sprint-versus-PI check is not running. Everything '
  + 'else works as normal: this board takes its scope from the Sprint / PI / Fix Version selector, not '
  + 'from a Jira board. Select one in the Settings tab to add that check.';

/** A team this board could copy a column setup from. */
export interface CopyableTeam {
  id: string;
  name: string;
}

export interface RollupBoardTabProps {
  /** The board this team already selected; null means none is chosen yet. */
  boardId: number | null;
  /**
   * The issues the Team Dashboard has already scoped by Sprint / Fix Version / PI.
   *
   * Taking the dashboard's set rather than re-querying the board is what keeps this tab showing the
   * same work as every other one. Sweeping the board directly returns its whole saved filter,
   * backlog included, which ignores the sprint and the PI entirely.
   */
  scopedIssues: readonly JiraIssue[];
  /** What the dashboard is currently scoped to, so the board can say what it is mirroring. */
  scopeDescription?: string;
  /** Scopes the shared column vocabulary and this viewer's personal preferences. */
  teamProfileId: string;
  /** The team's shared ART workspace, when they have one. Without it the vocabulary stays local. */
  sharedWorkspaceDatabaseId?: string;
  /** Other teams on this machine, so a finished column setup can be reused instead of rebuilt. */
  copyableTeams?: readonly CopyableTeam[];
  /**
   * The dashboard's current scope mode and PI label.
   *
   * Only needed for the PI reconciliation check: when the scope is a PI, work sitting in that PI's
   * sprints with an empty PI field is missing from every PI-scoped tab at once, and the board is the
   * place that can notice.
   */
  scopeMode?: string;
  selectedPiValue?: string;
  /** Every PI this instance offers, so carry-over is chosen from a list rather than typed. */
  availablePiValues?: readonly string[];
  /** The team's configured PI Review pages, so carry-over can read the ticks already recorded there. */
  piReviewPages?: readonly { piName: string; pageUrl: string }[];
  /** The Jira project new work is created in — the project this team's board issues live in. */
  projectKey?: string;
}

const EMPTY_OPTION_SOURCES: ColumnOptionSources = {
  statusNames: [],
  subStatusValues: [],
  isSubStatusUnavailable: true,
};

/** Where the ART workspace settings live — the same store the hygiene field config reads. */
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

/** The dashboard's PI scope mode. Only in this mode can a blank PI field hide work from the board. */
const DASHBOARD_PI_SCOPE_MODE = 'pi';

/**
 * Reads the team's shared Confluence workspace id.
 *
 * Absent simply means this team has not set one up: the vocabulary still works, it just stays on
 * this machine, and the editor says so rather than offering a Publish button that cannot work.
 */
function readSharedWorkspaceDatabaseId(): string {
  try {
    const artSettings = JSON.parse(window.localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as {
      sharedArtDatabaseId?: string;
    };
    return artSettings.sharedArtDatabaseId?.trim() ?? '';
  } catch {
    return '';
  }
}

/** A move Jira paused because its transition screen demands answers first. */
interface BlockedMove {
  issueKey: string;
  /** Set when Jira named its fields up front; null when it only complained after the attempt. */
  transitionId: string | null;
  /** The fields the dialog can collect — from the transition screen, or matched from edit metadata. */
  requiredFields: TransitionRequiredField[];
  targetColumnName: string;
  /** What went wrong, said in words the person who dragged the card would use. */
  diagnosis: MoveBlockDiagnosis;
  /** Everything needed to try the same move again once the missing fields are answered. */
  retryInput: ExecuteStatusMoveInput;
}

/**
 * Writes the fields Jira said were missing, straight onto the issue.
 *
 * Used only for the refusal Jira raises AFTER the attempt, where there is no transition screen to
 * carry the answers — the fields are simply absent on the issue and have to be set the ordinary way
 * before the same move can be made again.
 */
async function writeMissingFields(
  issueKey: string,
  requiredFields: readonly TransitionRequiredField[],
  selectionByFieldId: Record<string, TransitionFieldSelection>,
): Promise<void> {
  for (const requiredField of requiredFields) {
    const selection = selectionByFieldId[requiredField.fieldId] ?? {};

    if (requiredField.schemaType === 'string') {
      if (selection.text !== undefined && selection.text.trim() !== '') {
        await saveFeatureReviewSimpleField(issueKey, requiredField.fieldId, selection.text);
      }
      continue;
    }

    if (selection.optionId !== undefined && selection.optionId !== '') {
      // The allowed values come back with the field, so the option can be resolved without a second
      // read of edit metadata the board has already paid for.
      await saveFeatureReviewOptionField(issueKey, requiredField.fieldId, selection.optionId, {
        allowedValues: requiredField.allowedValues,
        name: requiredField.name,
      });
    }
  }
}

/** What the board managed to load, and what it could not. */
interface RollupBoardLoadState {
  isLoading: boolean;
  loadError: string | null;
  masterCards: MasterCard[];
  allItems: RollupBoardItem[];
  incompleteReasons: string[];
  isOversized: boolean;
  hasSubStatusField: boolean;
  /** Issues held back because their Feature is in another project and only loosely linked. */
  hiddenIssueCount: number;
  /** Which issues were held back, so a vanished card can be identified rather than hunted for. */
  hiddenIssueKeys: string[];
  /** Out-of-project Features reached by the Feature Link field — named whether shown or hidden. */
  featureLinkedOutOfProjectKeys: string[];
  /** Out-of-project Features reached only by an issue link. */
  issueLinkedOutOfProjectKeys: string[];
  /** Every Feature the board touches BEFORE scoping, so the scope panel can offer every project. */
  allReferencedFeatureKeys: string[];
  /** Referenced Features that could not be read, each with the reason Jira gave for it. */
  featureReadFailures: FeatureReadFailure[];
}

const EMPTY_LOAD_STATE: RollupBoardLoadState = {
  isLoading: false,
  loadError: null,
  masterCards: [],
  allItems: [],
  incompleteReasons: [],
  featureReadFailures: [],
  isOversized: false,
  hasSubStatusField: true,
  hiddenIssueCount: 0,
  hiddenIssueKeys: [],
  featureLinkedOutOfProjectKeys: [],
  issueLinkedOutOfProjectKeys: [],
  allReferencedFeatureKeys: [],
};

/**
 * Keeps the board's scroll region exactly as tall as the room left beneath the chrome above it.
 *
 * This is what makes the sticky column headers hold. If the region is even slightly too tall the
 * PAGE gains a scrollbar, and scrolling the page carries the whole board — headers included — up
 * behind the tab strip, which is how they came to be half hidden. The height was previously a fixed
 * guess at the chrome's height, which was wrong at any text size but the default.
 *
 * Re-measured on resize and on the app's text-size changes, both of which move where the board starts.
 */
function useBoardScrollerMaxHeight(): [React.RefObject<HTMLDivElement | null>, number | null, number] {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [maxHeightPx, setMaxHeightPx] = useState<number | null>(null);
  // Where a swimlane header must stop, so it pins UNDER the column headers rather than behind them.
  // Measured, because the row's height depends on the text size and on how many Jira states each
  // column names.
  const [columnHeaderHeightPx, setColumnHeaderHeightPx] = useState(0);

  useEffect(() => {
    function measure(): void {
      const scrollerElement = scrollerRef.current;
      if (scrollerElement === null) return;

      setMaxHeightPx(computeBoardScrollerMaxHeight({
        scrollerDocumentTopPx: readDocumentTop(
          scrollerElement.getBoundingClientRect().top,
          window.scrollY,
        ),
        viewportHeightPx: window.innerHeight,
      }));

      const columnHeaderRow = scrollerElement.querySelector('[data-testid="rollup-column-header-row"]');
      setColumnHeaderHeightPx(Math.round(columnHeaderRow?.getBoundingClientRect().height ?? 0));
    }

    measure();
    window.addEventListener('resize', measure);

    // The toolbar above the board wraps onto a second line at the larger text sizes, which moves the
    // board down without any window resize happening — so its own size is watched too.
    const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (sizeObserver !== null && scrollerRef.current?.parentElement) {
      sizeObserver.observe(scrollerRef.current.parentElement);
      // The scroller too, because the column header row changes height inside it — when a column is
      // focused, when the vocabulary changes — without the shell around it moving at all.
      sizeObserver.observe(scrollerRef.current);
    }

    return () => {
      window.removeEventListener('resize', measure);
      sizeObserver?.disconnect();
    };
  }, []);

  return [scrollerRef, maxHeightPx, columnHeaderHeightPx];
}

/** Renders the roll-up board for the team's currently selected Jira board. */
export default function RollupBoardTab({
  boardId,
  scopedIssues,
  scopeDescription,
  teamProfileId,
  sharedWorkspaceDatabaseId = readSharedWorkspaceDatabaseId(),
  copyableTeams = [],
  scopeMode,
  selectedPiValue,
  availablePiValues = [],
  piReviewPages = [],
  projectKey = '',
}: RollupBoardTabProps) {
  const [boardScrollerRef, boardScrollerMaxHeightPx, columnHeaderHeightPx] = useBoardScrollerMaxHeight();
  // The key of whatever is currently being dragged, so the overlay knows what to draw. Null at rest.
  const [draggedItemKey, setDraggedItemKey] = useState<string | null>(null);
  // Whichever field this instance keeps Jira's impediment flag in, discovered on load.
  const [flagFieldId, setFlagFieldId] = useState('');
  // Every checklist-ish field this instance has. Kept because ticking an item off may have to write to
  // a DIFFERENT one from the field it was read out of — the app's own dump is readable, never writable.
  const [checklistFieldIds, setChecklistFieldIds] = useState<string[]>([]);
  const [pendingChecklistCardId, setPendingChecklistCardId] = useState<string | null>(null);
  const [errorMessageByChecklistCardId, setErrorMessageByChecklistCardId] = useState<Record<string, string>>({});
  // Where the gap is currently open. Recomputed as the pointer moves, cleared when the drag ends.
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? '');
  const [isSharingOrder, setIsSharingOrder] = useState(false);
  const [orderShareMessage, setOrderShareMessage] = useState<string | null>(null);
  const [orderPullPreview, setOrderPullPreview] = useState<OrderPullPreview | null>(null);
  const [loadState, setLoadState] = useState<RollupBoardLoadState>(EMPTY_LOAD_STATE);
  const [filters, setFilters] = useState<QuickFilterState>(EMPTY_QUICK_FILTER_STATE);
  const [preferences, setPreferences] = useState<BoardPreferences>(() =>
    loadBoardPreferences(teamProfileId, boardId ?? 0));
  const [highlightedFamilyKey, setHighlightedFamilyKey] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState(() => loadTeamVocabulary(teamProfileId));
  const [optionSources, setOptionSources] = useState<ColumnOptionSources>(EMPTY_OPTION_SOURCES);
  const [pullPreview, setPullPreview] = useState<VocabularyPullPreview | null>(null);
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [isTroubleshooting, setIsTroubleshooting] = useState(false);
  /**
   * The column opened to the full board width, or null for the normal board.
   *
   * Deliberately not persisted: focusing a status is something you do for a minute to look at one
   * thing, not a setting. Coming back tomorrow to a board showing one column would read as broken.
   */
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  /** How tightly columns pack. Persisted with the other board preferences — it is a lasting choice. */
  const columnDensity = preferences.columnDensity ?? DEFAULT_COLUMN_DENSITY;
  const columnMinWidth = readColumnMinWidth(columnDensity);
  /** The room the board has to draw in, so the density control can say whether everything fits. */
  const [boardWidth, setBoardWidth] = useState(() =>
    (typeof window === 'undefined' ? 0 : window.innerWidth));
  const [cardDetailByIssueKey, setCardDetailByIssueKey] = useState<Record<string, CardDetail>>({});
  const [pendingIssueKey, setPendingIssueKey] = useState<string | null>(null);
  const [errorMessageByIssueKey, setErrorMessageByIssueKey] = useState<Record<string, string>>({});
  const [subStatusFieldId, setSubStatusFieldId] = useState('');
  const [blockedMove, setBlockedMove] = useState<BlockedMove | null>(null);
  const [transitionSelections, setTransitionSelections] = useState<Record<string, TransitionFieldSelection>>({});
  const [featureScope, setFeatureScope] = useState<FeatureScopeSettings>(() => loadTeamFeatureScope(teamProfileId));
  const [hasOwnScope, setHasOwnScope] = useState(() => hasTeamOwnFeatureScope(teamProfileId));
  const [carryOverScope, setCarryOverScope] = useState<CarryOverScope>(EMPTY_CARRY_OVER_SCOPE);
  const [sprintPiGap, setSprintPiGap] = useState<SprintPiReconciliation | null>(null);
  const [featuresWithoutWork, setFeaturesWithoutWork] = useState<TeamOwnedEmptyFeature[]>([]);
  /** What each dev Feature's clones turned out to be, keyed by the dev Feature. */
  const [cloneFamilies, setCloneFamilies] = useState<Record<string, CloneClassification[]>>({});
  const [cloneFeatureIssuesByKey, setCloneFeatureIssuesByKey] = useState<Map<string, JiraIssue>>(new Map());
  const [disciplineItemsByCloneKey, setDisciplineItemsByCloneKey] = useState<Map<string, RollupBoardItem[]>>(new Map());
  /** Linkages Jira refused, per clone — so an unaskable question never reads as an empty answer. */
  const [disciplineFailuresByCloneKey, setDisciplineFailuresByCloneKey] = useState<Map<string, string[]>>(new Map());
  const [featureIssuesWithoutWork, setFeatureIssuesWithoutWork] = useState<Map<string, JiraIssue>>(new Map());
  /** Bumped per empty-Feature scan so a slow earlier run cannot overwrite a newer one. */
  const emptyFeatureScanToken = useRef(0);
  const rosterMembers = useStandupRosterStore((rosterState) => rosterState.rosterMembers);
  const [addWorkFeature, setAddWorkFeature] = useState<{ key: string; summary: string } | null>(null);
  const [creatableIssueTypes, setCreatableIssueTypes] = useState<CreateMetaIssueType[]>([]);
  const [isCreatingWork, setIsCreatingWork] = useState(false);
  const [createWorkError, setCreateWorkError] = useState<string | null>(null);
  const [createWorkOutcome, setCreateWorkOutcome] = useState<string | null>(null);
  const [openIssueKey, setOpenIssueKey] = useState<string | null>(null);
  const [openIssueEditMeta, setOpenIssueEditMeta] = useState<Awaited<ReturnType<typeof fetchFeatureReviewEditMeta>> | null>(null);
  /** Where the open card can go, read from Jira for that one issue only. */
  const [openIssueTransitions, setOpenIssueTransitions] = useState<CardTransitionOption[]>([]);
  const [isReadingTransitions, setIsReadingTransitions] = useState(false);
  const [pendingTransitionId, setPendingTransitionId] = useState<string | null>(null);

  const isAdminUnlocked = useAdminStore((store) => store.isAdminUnlocked);
  const isBoardDiagnosticsEnabled = useDiagnosticsStore((store) => store.isBoardDiagnosticsEnabled);

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const renderedColumns = useMemo(() => buildRenderedColumns(vocabulary), [vocabulary]);

  // Deliberately NOT gated on a Jira board being selected. The scope comes from the dashboard's own
  // Sprint / PI / Fix Version selector, so a team with no board chosen still has work to show.
  const loadBoard = useCallback(async (): Promise<void> => {
    setLoadState((previousState) => ({ ...previousState, isLoading: true, loadError: null }));

    try {
      const fieldConfig = await loadHygieneFieldConfig();
      const [discoveredSubStatusFieldId = ''] = fieldConfig.subStatusFieldIds ?? [];
      // The Smart Checklist field belongs to a third-party app and its id differs between instances,
      // so it is discovered rather than assumed. Not finding one simply means no checklists are drawn.
      // One catalogue read serves both discoveries. The flag's id is NOT the default on this
      // instance, which broke reading and writing it at once — see findFlagFieldInCatalog.
      const fieldCatalog = await jiraGet<{ id?: string; name?: string; schema?: { custom?: string } }[]>(
        '/rest/api/2/field',
      ).catch(() => []);
      const discoveredChecklistFieldIds = listChecklistFieldIds(fieldCatalog);
      setChecklistFieldIds(discoveredChecklistFieldIds);
      const discoveredFlagFieldId = findFlagFieldInCatalog(fieldCatalog) ?? '';
      setFlagFieldId(discoveredFlagFieldId);
      const storyPointsFieldIds = getStoryPointsCandidateFieldIds();
      const scope: RollupBoardScope = {
        boardId: boardId ?? 0,
        teamProfileId,
        featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
        subStatusFieldId: discoveredSubStatusFieldId,
        storyPointsFieldIds,
        checklistFieldIds: discoveredChecklistFieldIds,
        flagFieldId: discoveredFlagFieldId,
      };

      const issueSet = await fetchRollupBoardIssues(
        scope,
        mergeScopedIssueKeys(scopedIssues.map((issue) => issue.key), carryOverScope.issueKeys),
      );
      // The same project list the scope filter applies below, handed to the resolver FIRST so a defect
      // is never routed to a Feature that the filter will then remove it from the board for.
      const trackedProjectKeys = new Set(
        featureScope.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase()).filter(Boolean),
      );
      const boardItems = resolveBoardItems(issueSet, scope, {
        resolveColumnId: (statusName, subStatusValue) =>
          resolveColumnIdForItem(statusName, subStatusValue, vocabulary, discoveredSubStatusFieldId !== ''),
        isFeatureInScope: (featureKey) => trackedProjectKeys.size === 0
          || trackedProjectKeys.has(featureKey.split('-')[0].trim().toUpperCase()),
      });

      // Narrow to the Features this team tracks BEFORE building lanes, so a Feature nobody here owns
      // never becomes a lane in the first place.
      const scopedResult = applyFeatureScope(boardItems, featureScope);

      setSubStatusFieldId(discoveredSubStatusFieldId);
      setLoadState({
        isLoading: false,
        loadError: null,
        masterCards: buildMasterCards(scopedResult.items, issueSet.featureIssues, storyPointsFieldIds),
        allItems: scopedResult.items,
        incompleteReasons: issueSet.load.failures.map((failure) => failure.detail),
        featureReadFailures: issueSet.featureReadFailures,
        isOversized: issueSet.load.isOversized,
        hasSubStatusField: discoveredSubStatusFieldId !== '',
        hiddenIssueCount: scopedResult.hiddenIssueCount,
        hiddenIssueKeys: scopedResult.hiddenIssueKeys,
        featureLinkedOutOfProjectKeys: scopedResult.featureLinkedOutOfProjectKeys,
        issueLinkedOutOfProjectKeys: scopedResult.issueLinkedOutOfProjectKeys,
        // Collected BEFORE scoping: a project that has been excluded must still be offerable.
        allReferencedFeatureKeys: [...new Set(
          boardItems.map((item) => item.featureKey).filter((featureKey): featureKey is string => featureKey !== null),
        )],
      });

      // Loaded after the board so the editor offers real Jira values rather than free text; a
      // failure here costs the mapping pickers, not the board.
      setOptionSources(await loadColumnOptionSources(scopedResult.items, discoveredSubStatusFieldId)
        .catch(() => EMPTY_OPTION_SOURCES));
    } catch (error: unknown) {
      setLoadState({ ...EMPTY_LOAD_STATE, loadError: String(error) });
    }
  }, [boardId, teamProfileId, vocabulary, featureScope, scopedIssues, carryOverScope]);

  // Runs before the board's own load consumes it: last PI's unfinished Features keep their original PI
  // in Jira, so their work can only be reached by asking for it deliberately.
  useEffect(() => {
    if (featureScope.carryOverSource === 'none') {
      setCarryOverScope(EMPTY_CARRY_OVER_SCOPE);
      return;
    }

    let isMounted = true;
    const carryOverFetchScope: RollupBoardScope = {
      boardId: boardId ?? 0,
      teamProfileId,
      featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
      subStatusFieldId,
      storyPointsFieldIds: getStoryPointsCandidateFieldIds(),
    };

    const featureLinkReference = buildJqlFieldReference(loadConfiguredFeatureLinkFieldId());
    // Reading the PI Review ticks is exact; deriving from status is close but also catches Features
    // that were abandoned rather than carried. The team chooses which they want.
    const carryOverLoad = featureScope.carryOverSource === 'pi-review'
      ? fetchCarryOverScopeFromPiReview(
        findPiReviewPageForPi(piReviewPages, selectedPiValue ?? '') ?? '',
        selectedPiValue ?? '',
        featureLinkReference,
      )
      : fetchCarryOverScope(
        featureScope.featureProjectKeys,
        featureScope.carryOverPiValue,
        buildJqlFieldReference(readConfiguredPiFieldId()),
        featureLinkReference,
        carryOverFetchScope,
      );

    void carryOverLoad.then((loadedScope) => { if (isMounted) setCarryOverScope(loadedScope); });

    return () => { isMounted = false; };
  }, [featureScope, boardId, teamProfileId, subStatusFieldId, piReviewPages, selectedPiValue]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  /**
   * Finds each Feature's clones and reads the other disciplines' work.
   *
   * Discovery itself costs NOTHING: `issuelinks` is already part of every board fetch, so the clone
   * keys are in hand before this runs. Only the disciplines' own work is new traffic, and none of it
   * happens at all until a team configures a discipline.
   */
  useEffect(() => {
    const disciplines = featureScope.disciplineProjects;
    if (disciplines.length === 0) {
      setCloneFamilies({});
      setCloneFeatureIssuesByKey(new Map());
      setDisciplineItemsByCloneKey(new Map());
      setDisciplineFailuresByCloneKey(new Map());
      return;
    }

    // Classification is pure and instant — the clone links are already in hand — so it is applied
    // before anything is awaited, and a board with no discipline clones costs no request at all.
    const classificationsByFeatureKey = classifyCloneFamilies(
      loadState.masterCards, featureScope.featureProjectKeys, disciplines,
    );
    setCloneFamilies(classificationsByFeatureKey);

    let isMounted = true;
    void discoverDisciplineWork({
      classificationsByFeatureKey,
      disciplines,
      scope: {
        teamProfileId,
        boardId: boardId ?? 0,
        featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
        subStatusFieldId,
        storyPointsFieldIds: getStoryPointsCandidateFieldIds(),
      },
      vocabulary,
      hasSubStatusField: subStatusFieldId !== '',
      fallbackLinkFieldIds: [PARENT_LINK_FIELD_ID],
      readers: { readCloneFeatures: fetchCloneFeatures, readDisciplineWork: fetchDisciplineWork },
    }).then((discovered) => {
      if (!isMounted) return;
      setCloneFeatureIssuesByKey(discovered.cloneFeatureIssuesByKey);
      setDisciplineItemsByCloneKey(discovered.itemsByCloneFeatureKey);
      setDisciplineFailuresByCloneKey(discovered.failuresByCloneFeatureKey);
    });

    return () => { isMounted = false; };
  }, [loadState.masterCards, featureScope.disciplineProjects, featureScope.featureProjectKeys, boardId, subStatusFieldId, vocabulary, teamProfileId]);


  useEffect(() => {
    const handleResize = (): void => setBoardWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Read the extra context only for the focused column's cards, and only while one is focused: a
  // description and comment thread for every issue on a twelve-column board is a large payload for
  // something nobody is looking at.
  useEffect(() => {
    if (focusedColumnId === null) {
      setCardDetailByIssueKey({});
      return;
    }

    const focusedIssueKeys = selectDetailIssueKeys(loadState.allItems, focusedColumnId);
    if (focusedIssueKeys.length === 0) return;

    let isMounted = true;
    void fetchCardDetails(focusedIssueKeys).then((detailedIssues) => {
      if (isMounted) setCardDetailByIssueKey(buildCardDetailIndex(detailedIssues));
    });
    return () => { isMounted = false; };
  }, [focusedColumnId, loadState.allItems]);

  // Runs alongside the board, not inside it: the reconciliation is a second opinion on the scope, and a
  // slow or failed hygiene query must never hold up the work the team came here to look at.
  useEffect(() => {
    const isPiScoped = scopeMode === DASHBOARD_PI_SCOPE_MODE && Boolean(selectedPiValue);
    if (boardId === null || !isPiScoped) {
      setSprintPiGap(null);
      return;
    }

    let isMounted = true;
    void fetchSprintPiReconciliation(
      boardId, selectedPiValue!, buildJqlFieldReference(readConfiguredPiFieldId()),
    ).then((reconciliation) => {
      if (isMounted) setSprintPiGap(reconciliation);
    });

    return () => { isMounted = false; };
  }, [boardId, scopeMode, selectedPiValue]);

  // Asked top-down, unlike every other query here: a Feature nobody has broken down has no work to be
  // found from, so it can only be discovered by asking about Features directly. It is then narrowed to
  // the team, because a PI holds every team's Features and an unnarrowed list ran to 77 rows.
  useEffect(() => {
    const isPiScoped = scopeMode === DASHBOARD_PI_SCOPE_MODE && Boolean(selectedPiValue);
    // With nothing in scope EVERY Feature trivially has no work under it, so the answer would be the
    // team's whole PI rendered as empty lanes — which reads as a broken board rather than as a board
    // with nothing selected. The scope's own empty state says it better.
    const hasWorkInScope = scopedIssues.length > 0;
    if (!isPiScoped || !hasWorkInScope || featureScope.featureProjectKeys.length === 0) {
      setFeaturesWithoutWork([]);
      return;
    }

    let isMounted = true;
    // Guards against an EARLIER scan finishing last and overwriting a newer answer. Without it a run
    // that started before the board's work had loaded — when every Feature looks unbroken-down —
    // could win, and a Feature that already has a lane would gain a second, empty one.
    emptyFeatureScanToken.current += 1;
    const scanToken = emptyFeatureScanToken.current;
    const isCurrentScan = (): boolean => isMounted && emptyFeatureScanToken.current === scanToken;

    const storyPointsFieldIds = getStoryPointsCandidateFieldIds();
    const featureLinkFieldId = loadConfiguredFeatureLinkFieldId();
    const scanScope: RollupBoardScope = {
      boardId: boardId ?? 0,
      teamProfileId,
      featureLinkFieldId,
      subStatusFieldId,
      storyPointsFieldIds,
    };

    async function scanForUnbrokenFeatures(): Promise<void> {
      const piFeatures = await fetchFeaturesInPi(
        featureScope.featureProjectKeys,
        selectedPiValue!,
        buildJqlFieldReference(readConfiguredPiFieldId()),
        scanScope,
        featureScope.teamFeatureLabel,
      );
      if (!isCurrentScan() || piFeatures.length === 0) return;

      // The third ownership test: any Feature a team-project issue points at is one the team is
      // demonstrably working on, whoever it happens to be assigned to.
      const teamIssues = await fetchTeamIssuesForFeatures(
        projectKey, piFeatures.map((feature) => feature.key), featureLinkFieldId,
      );

      const productOwnerQueryValues = rosterMembers
        .filter((rosterMember) => rosterMember.roleCapabilities?.canProductOwner === true)
        .map((rosterMember) => rosterMember.assigneeQueryValue);

      if (!isCurrentScan()) return;
      setFeatureIssuesWithoutWork(new Map(piFeatures.map((feature) => [feature.key, feature])));
      setFeaturesWithoutWork(selectTeamOwnedEmptyFeatures(piFeatures, {
        teamFeatureLabel: featureScope.teamFeatureLabel,
        excludedFeatureLabels: featureScope.excludedFeatureLabels,
        productOwnerQueryValues,
        featureKeysWithTeamChildren: readFeatureKeysFromTeamIssues(teamIssues, featureLinkFieldId),
        featureKeysWithWork: loadState.masterCards.map((masterCard) => masterCard.featureKey),
        storyPointsFieldIds,
      }));
    }

    void scanForUnbrokenFeatures();
    return () => { isMounted = false; };
  }, [boardId, scopeMode, selectedPiValue, featureScope, teamProfileId, subStatusFieldId,
    loadState.masterCards, projectKey, rosterMembers, scopedIssues]);

  /** Opens the add-work form for one Feature, loading the project's own issue types first. */
  const openAddWork = useCallback(async (featureKey: string, featureSummary: string): Promise<void> => {
    setCreateWorkError(null);
    setCreateWorkOutcome(null);
    setAddWorkFeature({ key: featureKey, summary: featureSummary });
    try {
      const issueTypes = await getProjectIssueTypes(projectKey);
      // Sub-task types are excluded: a sub-task needs a parent, which this form does not ask for.
      setCreatableIssueTypes((issueTypes.values ?? []).filter((issueType) => !issueType.subtask));
    } catch {
      setCreatableIssueTypes([]);
      setCreateWorkError('This project’s issue types could not be read.');
    }
  }, [projectKey]);

  /**
   * Creates the issue, then applies the two fields that make it visible on this board.
   *
   * The steps are separate because a custom field Jira refuses would otherwise fail the whole create
   * and lose what the person typed. A half-success is reported as exactly that.
   */
  const createWorkForFeature = useCallback(async (issueTypeId: string, summary: string): Promise<void> => {
    if (addWorkFeature === null) return;
    setIsCreatingWork(true);
    setCreateWorkError(null);

    try {
      const created = await createIssue(buildNewWorkPayload({ projectKey, issueTypeId, summary }));

      // The PI value is shaped by the same writer the PI closeout remap uses, read from the new
      // issue's own edit metadata — this instance stores PI as a select, and a bare string is refused.
      const editMeta = await jiraGet<{ fields?: Record<string, unknown> }>(
        `/rest/api/2/issue/${encodeURIComponent(created.key)}/editmeta`,
      ).catch(() => ({ fields: {} as Record<string, unknown> }));
      const piFieldId = scopeMode === DASHBOARD_PI_SCOPE_MODE ? readConfiguredPiFieldId() : '';

      const visibilityPayload = buildBoardVisibilityPayload(
        {
          featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
          featureKey: addWorkFeature.key,
          piFieldId,
          piValue: selectedPiValue ?? '',
        },
        (piValue) => resolvePiFieldUpdateValue(
          (editMeta.fields ?? {})[piFieldId] as Parameters<typeof resolvePiFieldUpdateValue>[0],
          piValue,
        ),
        buildFeatureFieldUpdateFields,
      );

      let wasMadeVisible = false;
      let visibilityError: string | null = null;
      if (visibilityPayload === null) {
        visibilityError = 'this project does not offer those fields';
      } else {
        try {
          await jiraPut(`/rest/api/2/issue/${encodeURIComponent(created.key)}`, visibilityPayload);
          wasMadeVisible = true;
        } catch (error: unknown) {
          visibilityError = String(error);
        }
      }

      setCreateWorkOutcome(describeCreationOutcome(created.key, wasMadeVisible, visibilityError));
      setAddWorkFeature(null);
      await loadBoard();
    } catch (error: unknown) {
      setCreateWorkError(String(error));
    } finally {
      setIsCreatingWork(false);
    }
  }, [addWorkFeature, projectKey, scopeMode, selectedPiValue, loadBoard]);

  /**
   * The lanes the board draws: the ones work rolls up to, followed by the Features the team owns and
   * has not broken down. Appended last so the board still opens on real work.
   */
  const laneMasterCards = useMemo(() => orderLanesLikePiReview([
    ...loadState.masterCards,
    ...featuresWithoutWork.map((feature) => buildFeatureWithoutWorkCard(
      feature.featureKey,
      featureIssuesWithoutWork.get(feature.featureKey) ?? null,
      getStoryPointsCandidateFieldIds(),
    )),
  ]), [loadState.masterCards, featuresWithoutWork, featureIssuesWithoutWork]);

  /**
   * Re-points an issue's Feature Link at the Feature whose lane it was dropped in.
   *
   * Dropping into the No Feature lane clears the link instead of setting one, which is the same
   * gesture meaning "this does not belong to a Feature" — a legitimate answer, and the only way to
   * undo a mis-drop without leaving the board.
   */
  const applyFeatureRelink = useCallback(async (
    item: RollupBoardItem,
    targetFeatureKey: string,
  ): Promise<void> => {
    setCardMessage(item.key, null);
    setPendingIssueKey(item.key);
    try {
      const featureLinkFieldId = loadConfiguredFeatureLinkFieldId();
      const isClearingFeature = targetFeatureKey === NO_FEATURE_KEY;
      await jiraPut(`/rest/api/2/issue/${encodeURIComponent(item.key)}`, {
        fields: isClearingFeature
          ? { [featureLinkFieldId]: null }
          : buildFeatureFieldUpdateFields(featureLinkFieldId, targetFeatureKey),
      });
      await loadBoard();
    } catch (error: unknown) {
      setCardMessage(item.key, describeJiraFailure(String(error)));
    } finally {
      setPendingIssueKey(null);
    }
  }, [loadBoard]);

  /**
   * Records that one issue is contained within another, which is what makes the board nest it.
   *
   * The link type and its direction are resolved from this Jira's own catalogue rather than assumed:
   * "contained within" is one half of a pair, and putting the card on the wrong side would say the
   * dragged issue CONTAINS the one it was dropped onto — backwards, and tedious to unpick.
   */
  const applyContainment = useCallback(async (
    item: RollupBoardItem,
    containerIssueKey: string,
  ): Promise<void> => {
    setCardMessage(item.key, null);
    setPendingIssueKey(item.key);
    try {
      const linkTypes = await jiraGet<{ issueLinkTypes?: JiraIssueLinkType[] }>('/rest/api/2/issueLinkType');
      const direction = resolveContainmentLinkDirection(linkTypes.issueLinkTypes ?? []);
      if (direction === null) {
        setCardMessage(item.key, 'This Jira has no "contained within" link type, so nothing was written.');
        return;
      }

      await createIssueLink(buildContainmentLinkInput(direction, item.key, containerIssueKey));
      await loadBoard();
    } catch (error: unknown) {
      setCardMessage(item.key, describeJiraFailure(String(error)));
    } finally {
      setPendingIssueKey(null);
    }
  }, [loadBoard]);

  /**
   * Everything the board wants to say, gathered in one place.
   *
   * Each of these earned its own box once, and together they buried the board. Collected here they
   * keep their exact wording — nothing is softened, and nothing is dropped — while costing one line
   * until somebody asks for the detail.
   */
  /**
   * The states sitting in Unmapped, grouped so one missing mapping reads as one line.
   *
   * Computed from every loaded item rather than the filtered layout: a quick filter narrows what you
   * are looking at, but it does not change which states the team has forgotten to claim.
   */
  const unmappedStatusGroups = useMemo(
    () => summarizeUnmappedStatuses(loadState.allItems, UNMAPPED_COLUMN_ID, renderedColumns),
    [loadState.allItems, renderedColumns],
  );

  /**
   * Why each Feature with no work is on this board.
   *
   * Only the empty ones: a lane carrying work explains itself, and repeating the reason under every
   * lane would be the notices panel's old mistake in a new place.
   */
  const membershipReasonByFeatureKey = useMemo(() => {
    const reasonByFeatureKey: Record<string, BoardMembershipReason> = {};
    for (const feature of featuresWithoutWork) {
      reasonByFeatureKey[feature.featureKey] = describeEmptyFeatureMembership(
        feature.ownershipReason,
        featureScope.teamFeatureLabel ?? '',
      );
    }
    return reasonByFeatureKey;
  }, [featuresWithoutWork, featureScope.teamFeatureLabel]);

  /**
   * Answers "why IS this on my board?" from what is already loaded.
   *
   * Handles both things a user might type: a Feature key, whose lane is explained by its work or by
   * whichever ownership test admitted it; and a work item's key, whose presence is explained by the
   * lane it rolls up to.
   */
  const explainLanePresence = useCallback((issueKey: string): BoardMembershipReason | null => {
    const wantedKey = issueKey.trim().toUpperCase();

    const emptyLaneReason = membershipReasonByFeatureKey[wantedKey];
    if (emptyLaneReason) return emptyLaneReason;

    const issuesUnderFeature = loadState.allItems.filter((item) => item.featureKey === wantedKey);
    if (issuesUnderFeature.length > 0) return describeWorkingLaneMembership(issuesUnderFeature.length);

    const matchedItem = loadState.allItems.find((item) => item.key === wantedKey);
    if (matchedItem) {
      return {
        summary: matchedItem.featureKey === null
          ? 'It is in your board\'s scope but rolls up to no Feature, so it sits in the "No Feature" lane.'
          : `It is in your board's scope and rolls up to ${matchedItem.featureKey}.`,
        howToRemove: 'If it should not be in scope at all, the board filter or the PI on the issue is'
          + ' what put it there.',
        isGuess: false,
      };
    }

    return null;
  }, [membershipReasonByFeatureKey, loadState.allItems]);

  const boardNotices = useMemo<BoardNotice[]>(() => {
    const notices: BoardNotice[] = [];

    if (unmappedStatusGroups.length > 0) {
      const unmappedIssueCount = unmappedStatusGroups.reduce((total, group) => total + group.issueCount, 0);
      const stateWord = unmappedStatusGroups.length === 1 ? 'state' : 'states';
      notices.push({
        id: 'unmapped-states',
        tone: 'warning',
        summary: `${unmappedIssueCount} issues sit in Unmapped across ${unmappedStatusGroups.length} ${stateWord}`
          + ' that no column claims:',
        detail: (
          <ul>
            {unmappedStatusGroups.map((group) => (
              <li key={describeStatusPair(group.statusName, group.subStatusValue)}>
                {describeUnmappedStatusGroup(group)}
              </li>
            ))}
          </ul>
        ),
      });
    }

    if (loadState.incompleteReasons.length > 0) {
      notices.push({
        id: 'incomplete',
        tone: 'warning',
        summary: 'Part of this board could not be read, so it is showing less than the team actually has:',
        detail: <ul>{loadState.incompleteReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>,
      });
    }

    if (loadState.isOversized) {
      notices.push({
        id: 'oversized',
        tone: 'info',
        summary: `This board holds more than ${EXPECTED_BOARD_ISSUE_CEILING} issues. Everything is shown`
          + ' — nothing has been dropped — but the board may feel slower than usual.',
      });
    }

    if (loadState.hiddenIssueCount > 0) {
      const hiddenList = loadState.hiddenIssueKeys.length > 0
        ? ` Hidden: ${loadState.hiddenIssueKeys.slice(0, 12).join(', ')}`
          + (loadState.hiddenIssueKeys.length > 12 ? ` and ${loadState.hiddenIssueKeys.length - 12} more` : '')
          + '.'
        : '';
      notices.push({
        id: 'hidden-by-scope',
        tone: 'warning',
        summary: `${loadState.hiddenIssueCount} ${loadState.hiddenIssueCount === 1 ? 'issue is' : 'issues are'}`
          + ` hidden because ${loadState.hiddenIssueCount === 1 ? 'its Feature is' : 'their Features are'}`
          + ' outside this team’s projects. Open Board setup to widen the projects or show them'
          + ` anyway.${hiddenList}`,
      });
    }

    if (loadState.featureLinkedOutOfProjectKeys.length > 0) {
      notices.push({
        id: 'feature-linked-out-of-project',
        tone: 'warning',
        summary: `${loadState.featureLinkedOutOfProjectKeys.length}`
          + ` ${loadState.featureLinkedOutOfProjectKeys.length === 1 ? 'Feature is' : 'Features are'} linked by the`
          + ' Feature Link field but sit outside this team’s projects:'
          + ` ${loadState.featureLinkedOutOfProjectKeys.join(', ')}. That is usually worth correcting in Jira.`,
      });
    }

    if (sprintPiGap !== null && sprintPiGap.mismatches.length > 0) {
      notices.push({
        id: 'sprint-pi-gap',
        tone: 'warning',
        summary: `${describeReconciliation(sprintPiGap)} Set the PI field on`
          + ` ${sprintPiGap.mismatches.length === 1 ? 'it' : 'them'} in Jira and refresh.`,
      });
    }

    // Stated as the one small gap it is. The board used to refuse to render at all without a Jira
    // board, which was disproportionate: it does not read a Jira board's filter, and never did.
    if (boardId === null) {
      notices.push({ id: 'no-board-selected', tone: 'info', summary: NO_BOARD_SELECTED_NOTICE });
    }

    // Unmapped is the board's honesty valve and it works — but a quarter of the board landing in the
    // twelfth column, off the right-hand edge, is a configuration failure nobody was being told about.
    const unmappedShareNotice = describeUnmappedBoardShare(
      loadState.allItems.filter((item) => item.columnId === UNMAPPED_COLUMN_ID).length,
      loadState.allItems.length,
    );
    if (unmappedShareNotice !== '') {
      notices.push({ id: 'unmapped-share', tone: 'warning', summary: unmappedShareNotice });
    }

    if (carryOverScope.featureKeys.length > 0) {
      notices.push({
        id: 'carry-over',
        tone: 'info',
        summary: `↩ ${describeCarryOverScope(carryOverScope)}`,
      });
    }

    const unconfiguredNotice = describeUnconfiguredClones(Object.values(cloneFamilies).flat());
    if (unconfiguredNotice !== '') {
      notices.push({ id: 'unconfigured-clones', tone: 'info', summary: unconfiguredNotice });
    }

    const guessedLaneKeys = Object.entries(membershipReasonByFeatureKey)
      .filter(([, reason]) => reason.isGuess)
      .map(([featureKey]) => featureKey);
    if (guessedLaneKeys.length > 0) {
      notices.push({
        id: 'guessed-lanes',
        tone: 'info',
        summary: describeGuessedLaneCount(guessedLaneKeys.length),
        detail: (
          <ul>
            {guessedLaneKeys.map((featureKey) => (
              <li key={featureKey}>
                {featureKey} — {membershipReasonByFeatureKey[featureKey].summary}
              </li>
            ))}
          </ul>
        ),
      });
    }

    if (featuresWithoutWork.length > 0) {
      const unplannedPoints = sumUnplannedStoryPoints(featuresWithoutWork);
      notices.push({
        id: 'features-without-work',
        tone: 'warning',
        summary: `${featuresWithoutWork.length}`
          + ` ${featuresWithoutWork.length === 1 ? 'Feature this team owns has' : 'Features this team own have'}`
          + ` no work under ${featuresWithoutWork.length === 1 ? 'it' : 'them'}`
          + (unplannedPoints > 0 ? ` — ${unplannedPoints} story points with nothing planned` : '')
          + `. ${featuresWithoutWork.length === 1 ? 'Its lane is' : 'Their lanes are'} at the end of the board.`,
      });
    }

    if (loadState.featureReadFailures.length > 0) {
      notices.push({
        id: 'feature-read-failures',
        tone: 'warning',
        summary: `${loadState.featureReadFailures.length}`
          + ` ${loadState.featureReadFailures.length === 1 ? 'Feature' : 'Features'} could not be read:`,
        detail: (
          <ul>
            {loadState.featureReadFailures.map((failure) => (
              <li key={failure.featureKey}>{failure.detail}</li>
            ))}
          </ul>
        ),
      });
    }

    if (!loadState.hasSubStatusField) {
      notices.push({
        id: 'no-sub-status',
        tone: 'info',
        summary: 'This Jira instance has no sub-status field, so columns can only match on status. The'
          + ' board is less precise than it would otherwise be.',
      });
    }

    return notices;
  }, [loadState, sprintPiGap, carryOverScope, featuresWithoutWork, unmappedStatusGroups, membershipReasonByFeatureKey, cloneFamilies]);

  /**
   * The columns the board draws: all of them, or just the focused one.
   *
   * Narrowing here rather than anywhere deeper means everything else is untouched — the quick filters
   * still select which cards appear, and each lane's figures still describe the WHOLE Feature, because
   * both are computed before items are distributed into columns.
   */
  const visibleColumns = useMemo(
    () => selectVisibleColumns(renderedColumns, focusedColumnId),
    [renderedColumns, focusedColumnId],
  );

  /** Each Feature's discipline bands, in the dev team's own columns. */
  const subLanesByFeatureKey = useMemo(() => {
    const byFeatureKey: Record<string, SubLane[]> = {};
    for (const [featureKey, classifications] of Object.entries(cloneFamilies)) {
      const subLanes = buildSubLanes({
        classifications,
        cloneFeatureIssuesByKey,
        itemsByCloneFeatureKey: disciplineItemsByCloneKey,
        lookupFailuresByCloneFeatureKey: disciplineFailuresByCloneKey,
        columns: visibleColumns,
        filters,
        preferences,
        disciplineProjects: featureScope.disciplineProjects,
      });
      if (subLanes.length > 0) byFeatureKey[featureKey] = subLanes;
    }
    return byFeatureKey;
  }, [cloneFamilies, cloneFeatureIssuesByKey, disciplineItemsByCloneKey, disciplineFailuresByCloneKey, visibleColumns, filters, preferences, featureScope.disciplineProjects]);

  /**
   * Why no discipline bands appeared.
   *
   * Kept apart from the other notices because it has to COUNT the bands, and so cannot be worked out
   * until they have been built. Four different causes used to look identical on screen — nothing at
   * all — which made "QE has not broken its work down" indistinguishable from "the board was never
   * told what QE's project is".
   */
  const subLaneNotices = useMemo<BoardNotice[]>(() => {
    const summary = describeMissingSubLanes({
      disciplineCount: featureScope.disciplineProjects.length,
      featuresRead: loadState.masterCards.filter((masterCard) =>
        !masterCard.isSynthetic && masterCard.featureIssue !== null).length,
      classifications: Object.values(cloneFamilies).flat(),
      subLaneCount: Object.values(subLanesByFeatureKey).flat().length,
    });
    return summary === '' ? [] : [{ id: 'missing-sub-lanes', tone: 'info', summary }];
  }, [featureScope.disciplineProjects, loadState.masterCards, cloneFamilies, subLanesByFeatureKey]);

  /** Dev and whole-Feature progress, per lane. Absent for a Feature with no clones. */
  const familyProgressByFeatureKey = useMemo(() => {
    const byFeatureKey: Record<string, FamilyProgress> = {};
    for (const masterCard of laneMasterCards) {
      const subLanes = subLanesByFeatureKey[masterCard.featureKey] ?? [];
      if (subLanes.length === 0) continue;
      byFeatureKey[masterCard.featureKey] = computeFamilyProgress(
        masterCard.items,
        readSubLaneItemLists(subLanes),
      );
    }
    return byFeatureKey;
  }, [laneMasterCards, subLanesByFeatureKey]);

  /**
   * Every Smart Checklist item on the board, as cards, grouped by lane.
   *
   * Built from the SAME items the issue cards come from, so a checklist item and the issue that owns
   * it can never be drawn from two different reads of Jira.
   */
  const checklistCardsByFeatureKey = useMemo(() => {
    const cardsByFeatureKey: Record<string, ChecklistCard[]> = {};
    for (const checklistCard of buildChecklistCards(loadState.allItems, vocabulary.checklistColumnMapping)) {
      const laneKey = checklistCard.featureKey ?? NO_FEATURE_KEY;
      cardsByFeatureKey[laneKey] = [...(cardsByFeatureKey[laneKey] ?? []), checklistCard];
    }
    return cardsByFeatureKey;
  }, [loadState.allItems, vocabulary.checklistColumnMapping]);

  const layout = useMemo(
    () => buildBoardLayout({
      masterCards: laneMasterCards,
      columns: visibleColumns,
      filters,
      preferences,
      subLanesByFeatureKey,
      checklistCardsByFeatureKey,
    }),
    [laneMasterCards, visibleColumns, filters, preferences, subLanesByFeatureKey, checklistCardsByFeatureKey],
  );

  /**
   * The grid tracks, computed once for the WHOLE board.
   *
   * The header row and every lane's cells are handed this same object, so they cannot line up
   * differently. Previously all three derived their own template from the same inputs and were
   * expected to agree — safe while the calculation was a single repeat(), not once a column can be
   * narrowed on its own.
   */
  const columnTracks = useMemo(
    () => buildColumnTracks(layout.columns, new Set(preferences.collapsedColumnIds ?? []), columnMinWidth),
    [layout.columns, preferences.collapsedColumnIds, columnMinWidth],
  );

  /** Persists a preference change immediately — a lane the viewer moved should stay moved. */
  const applyPreferences = useCallback((nextPreferences: BoardPreferences): void => {
    saveBoardPreferences(nextPreferences);
    setPreferences(nextPreferences);
  }, []);

  /**
   * Prefers a card over the column cell it sits inside.
   *
   * The default detection picks whichever target overlaps most, and a cell always contains the card
   * — so dropping a card onto another card resolved to the cell, which reads as "same column, no
   * change" and made vertical sorting look broken. The pointer is the honest signal here.
   */
  const detectCollisions = useCallback<CollisionDetection>((collisionArgs) => {
    const pointerCollisions = pointerWithin(collisionArgs);
    const draggedId = String(collisionArgs.active.id);
    const isDraggingLane = allFeatureKeysRef.current.includes(draggedId);

    if (!isDraggingLane) {
      const cardCollision = pointerCollisions.find((collision) => {
        const targetIssueKey = parseCardTargetId(String(collision.id));
        return targetIssueKey !== null && targetIssueKey !== draggedId;
      });
      if (cardCollision) return [cardCollision];
    }

    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(collisionArgs);
  }, []);

  // Only a CARD gets a preview: a lane's own drag already moves the whole swimlane, which is its own
  // preview, and a lane key never matches an issue key so this simply yields null for one.
  const draggedItem = useMemo(
    () => loadState.allItems.find((item) => item.key === draggedItemKey) ?? null,
    [loadState.allItems, draggedItemKey],
  );


  /**
   * Reads the gap's position from a drag in progress.
   *
   * The same pointer arithmetic the DROP uses, so what the gap promises and what the drop does cannot
   * disagree — which would be worse than no preview at all.
   */
  const readDropPreview = useCallback((dragMoveEvent: DragMoveEvent): DropPreview | null => {
    const overId = dragMoveEvent.over ? String(dragMoveEvent.over.id) : null;
    const pointerY = readPointerY(dragMoveEvent.activatorEvent, dragMoveEvent.delta.y);
    const overRect = dragMoveEvent.over?.rect ?? null;
    if (overId === null || pointerY === null || overRect === null) return null;

    // Over a CARD: the gap goes above or below that card.
    const overIssueKey = parseCardTargetId(overId);
    if (overIssueKey !== null) {
      const overItem = loadState.allItems.find((item) => item.key === overIssueKey);
      if (!overItem) return null;
      return {
        cellId: buildDropTargetId(overItem.featureKey ?? NO_FEATURE_KEY, overItem.columnId),
        anchorKey: overIssueKey,
        edge: resolveCardDropZone(pointerY, overRect.top, overRect.height) === 'before' ? 'before' : 'after',
      };
    }

    // Over the COLUMN itself: one end of it or the other.
    return {
      cellId: overId,
      anchorKey: null,
      edge: pointerY < overRect.top + overRect.height / 2 ? 'before' : 'after',
    };
  }, [loadState.allItems]);

  /** Publishes this board's order for the team. Never fires on a drag — always an explicit choice. */
  async function handlePublishOrder(): Promise<void> {
    setIsSharingOrder(true);
    setOrderShareMessage(null);
    try {
      await publishBoardOrder(sharedWorkspaceDatabaseId, preferences);
      setOrderShareMessage('Shared. Everyone on this team can now pull the same order.');
    } catch (shareError: unknown) {
      // Named rather than swallowed: a share that silently failed is a team believing they agree.
      setOrderShareMessage(`Could not share the order: ${String(shareError)}`);
    } finally {
      setIsSharingOrder(false);
    }
  }

  /** Reads the team's published order and shows what accepting it would change. Changes nothing. */
  async function handlePreviewOrderPull(): Promise<void> {
    setOrderShareMessage(null);
    try {
      setOrderPullPreview(await previewBoardOrderPull(sharedWorkspaceDatabaseId, preferences));
    } catch (pullError: unknown) {
      setOrderShareMessage(`Could not read the team's order: ${String(pullError)}`);
    }
  }

  const allFeatureKeys = useMemo(
    () => layout.lanes.map((lane) => lane.masterCard.featureKey),
    [layout.lanes],
  );

  // Read inside the collision detector, which must not be rebuilt on every lane change.
  const allFeatureKeysRef = useRef<string[]>([]);
  useEffect(() => {
    allFeatureKeysRef.current = allFeatureKeys;
  }, [allFeatureKeys]);

  /** Records a per-card message, so a refused or failed move is never a silent no-op. */
  const setCardMessage = useCallback((issueKey: string, message: string | null): void => {
    setErrorMessageByIssueKey((previousMessages) => {
      const nextMessages = { ...previousMessages };
      if (message === null) delete nextMessages[issueKey];
      else nextMessages[issueKey] = message;
      return nextMessages;
    });
  }, []);

  /** The same, for a checklist card — its failures belong on it, not in a toast that scrolls away. */
  const setChecklistCardMessage = useCallback((checklistCardId: string, message: string | null): void => {
    setErrorMessageByChecklistCardId((previousMessages) => {
      const nextMessages = { ...previousMessages };
      if (message === null) delete nextMessages[checklistCardId];
      else nextMessages[checklistCardId] = message;
      return nextMessages;
    });
  }, []);

  /**
   * Opens the move-blocked dialog, working out first whether anything can be fixed from it.
   *
   * When Jira only complained AFTER the attempt it names its fields in prose, so the issue's own edit
   * metadata is read to turn those names into real, editable fields. That read is what makes a
   * "Story Points is required" refusal arrive with a story-points dropdown instead of an instruction,
   * and reading the ISSUE's metadata rather than a fixed list is what makes it work on an instance
   * whose story-points field is not the standard one.
   */
  const openMoveBlockedDialog = useCallback(async (input: {
    moveInput: ExecuteStatusMoveInput;
    targetColumnName: string;
    issueSummary: string;
    transitionId: string | null;
    screenRequiredFields: TransitionRequiredField[];
    errorText: string;
    reachableStatusNames: readonly string[];
  }): Promise<void> => {
    const diagnosis = diagnoseMoveBlock({
      issueKey: input.moveInput.issueKey,
      issueSummary: input.issueSummary,
      targetColumnName: input.targetColumnName,
      currentStatusName: input.moveInput.currentStatusName,
      screenRequiredFields: input.screenRequiredFields,
      errorText: input.errorText,
      reachableStatusNames: input.reachableStatusNames,
    });

    // Only worth a round trip when Jira named fields it wants; a dead-end workflow has nothing to fix.
    const fieldsToCollect = input.screenRequiredFields.length > 0
      ? input.screenRequiredFields
      : matchEditMetaFieldsByName(
        diagnosis.requiredFieldNames.length > 0
          ? await fetchFeatureReviewEditMeta(input.moveInput.issueKey).catch(() => null)
          : null,
        diagnosis.requiredFieldNames,
      );

    setTransitionSelections({});
    setBlockedMove({
      issueKey: input.moveInput.issueKey,
      transitionId: input.transitionId,
      requiredFields: fieldsToCollect,
      targetColumnName: input.targetColumnName,
      diagnosis,
      retryInput: input.moveInput,
    });
  }, []);

  /**
   * Applies a dropped card's new status, then reloads so the board shows Jira's truth.
   *
   * A partial write is deliberately NOT reverted: the status really did change, so putting the card
   * back would draw a state Jira does not hold.
   */
  /**
   * A checklist card dropped into a column: the column names a state, and that state is written.
   *
   * Answered BEFORE the issue drop rules, and separately from them, because almost none of those
   * rules apply. A checklist item cannot change which Feature it delivers (it belongs to its parent),
   * cannot contain another card, and has no status of its own beyond these three — so routing it
   * through the issue path would mean disabling most of that path for one case.
   */
  const handleChecklistCardDrop = useCallback(async (
    checklistCardId: string,
    dropTargetId: string | null,
  ): Promise<void> => {
    const cardParts = parseChecklistCardId(checklistCardId);
    const dropTarget = dropTargetId === null ? null : parseDropTargetId(dropTargetId);
    if (cardParts === null || dropTarget === null) return;

    const nextState = resolveChecklistStateForColumn(
      vocabulary.checklistColumnMapping,
      dropTarget.columnId,
    );
    if (nextState === null) {
      // A real attempt at something the board cannot do, so it says so rather than silently
      // snapping the card back and leaving the person to guess why.
      setChecklistCardMessage(
        checklistCardId,
        'That column does not stand for a checklist state. Set one in Board setup → Where checklist items go.',
      );
      return;
    }

    const parentItem = loadState.allItems.find((item) => item.key === cardParts.parentKey);
    if (!parentItem) return;
    // Dropped where it already is: not a non-event to refuse, just nothing to write.
    const currentItem = parentItem.checklistItems.find((item) => item.id === cardParts.itemId);
    if (currentItem?.state === nextState) return;

    setChecklistCardMessage(checklistCardId, null);
    setPendingChecklistCardId(checklistCardId);
    try {
      const result = await saveChecklistItemState({
        issueKey: cardParts.parentKey,
        items: parentItem.checklistItems,
        itemId: cardParts.itemId,
        nextState,
        candidateFieldIds: checklistFieldIds,
        readableFieldId: parentItem.checklistFieldId ?? null,
      });
      if (!result.isWritten) {
        setChecklistCardMessage(checklistCardId, result.message);
        return;
      }
      await loadBoard();
    } finally {
      setPendingChecklistCardId(null);
    }
  }, [vocabulary.checklistColumnMapping, loadState.allItems, checklistFieldIds, loadBoard]);

  const handleCardDrop = useCallback(async (dragEndEvent: DragEndEvent): Promise<void> => {
    // A checklist card is not an issue and none of the rules below fit it, so it is answered first.
    const checklistCardId = parseChecklistDragId(String(dragEndEvent.active.id));
    if (checklistCardId !== null) {
      await handleChecklistCardDrop(
        checklistCardId,
        dragEndEvent.over ? String(dragEndEvent.over.id) : null,
      );
      return;
    }

    // Measured from the POINTER, never from the dragged card's rectangle: a tall card's centre is a
    // long way from where the person believes they are dropping, which is what made this unusable.
    const pointerY = readPointerY(dragEndEvent.activatorEvent, dragEndEvent.delta.y);
    const targetRect = dragEndEvent.over?.rect ?? null;
    const cardDropZone = pointerY !== null && targetRect
      ? resolveCardDropZone(pointerY, targetRect.top, targetRect.height)
      : undefined;
    // The same reading applied to a COLUMN CELL rather than a card: which half of the column the
    // pointer was in when it let go.
    const cellDropEdge = pointerY !== null && targetRect
      ? (pointerY < targetRect.top + targetRect.height / 2 ? 'top' as const : 'bottom' as const)
      : undefined;

    const decision = resolveCardDrop({
      draggedItemKey: String(dragEndEvent.active.id),
      dropTargetId: dragEndEvent.over ? String(dragEndEvent.over.id) : null,
      itemsByKey: new Map(loadState.allItems.map((item) => [item.key, item])),
      columnsById: new Map(renderedColumns.map((column) => [column.id, column])),
      cardDropZone,
      cellDropEdge,
    });

    if (decision.kind === 'ignore') return;
    if (decision.kind === 'refused') {
      setCardMessage(String(dragEndEvent.active.id), decision.reason);
      return;
    }

    // Sequencing work inside a column is a view preference, not a state change: nothing is written
    // to Jira, exactly as with lane order.
    if (decision.kind === 'reorder' || decision.kind === 'reorder-edge') {
      const laneKey = decision.item.featureKey ?? NO_FEATURE_KEY;
      const displayedIssueKeys = loadState.allItems
        .filter((item) => (item.featureKey ?? NO_FEATURE_KEY) === laneKey && item.columnId === decision.item.columnId)
        .map((item) => item.key);

      // Dropped on the column itself: the caller resolves which card that means, because the cell
      // knows nothing about its own order. Top means before whichever card is currently first — and
      // that is the whole point, since the space above the first card is not a card to land on.
      // Bottom names no card at all, which the mover reads as "append".
      const remainingKeys = displayedIssueKeys.filter((issueKey) => issueKey !== decision.item.key);
      const targetIssueKey = decision.kind === 'reorder'
        ? decision.targetIssueKey
        : (decision.edge === 'top' ? (remainingKeys[0] ?? decision.item.key) : '');

      applyPreferences(moveCardBeside(
        preferences,
        laneKey,
        decision.item.columnId,
        decision.item.key,
        targetIssueKey,
        displayedIssueKeys,
        // Dropped on a card: which half of it. Dropped on the column: the top edge means before the
        // first card, and the bottom names no card at all, which appends.
        decision.kind === 'reorder' ? decision.edge : 'before',
      ));
      return;
    }

    // Dropped in another Feature's lane: the drag says which Feature this work now delivers.
    if (decision.kind === 'relink') {
      await applyFeatureRelink(decision.item, decision.targetFeatureKey);
      return;
    }

    // Dropped on the body of another card: record containment, which the board then draws as nesting.
    if (decision.kind === 'nest') {
      await applyContainment(decision.item, decision.containerIssueKey);
      return;
    }

    setCardMessage(decision.item.key, null);
    setPendingIssueKey(decision.item.key);
    try {
      // A column may claim SEVERAL Jira states — "Accepted/Done" claims both — and the drop used to
      // write whichever was listed first, always. Fine for one claim, wrong for two: a Done issue
      // dropped into its own column was sent to Accepted, and where the workflow has no such step the
      // move failed in Jira's words rather than the board's.
      //
      // The transition list is read only when there is genuinely something to choose between, so an
      // ordinary single-claim column still costs no extra request.
      const reachableStatusNames = decision.targetColumn.mappings.length > 1
        ? (await fetchFeatureReviewTransitions(decision.item.key).catch(() => []))
          .map((transition) => transition.to?.name ?? '')
          .filter(Boolean)
        : [];

      const mappingChoice = selectColumnMapping(
        decision.targetColumn.mappings,
        decision.item.statusName,
        reachableStatusNames,
        decision.targetColumn.name,
      );
      if (mappingChoice.kind === 'refused') {
        setCardMessage(decision.item.key, mappingChoice.reason);
        return;
      }

      const moveInput: ExecuteStatusMoveInput = {
        issueKey: decision.item.key,
        currentStatusName: decision.item.statusName,
        currentSubStatusValue: decision.item.subStatusValue,
        targetMapping: mappingChoice.mapping,
        subStatusFieldId,
      };
      const outcome = await executeStatusMove(moveInput);

      if (outcome.status === 'needs-fields') {
        // Jira will not accept the move until its screen fields are answered, so collect them here
        // rather than sending the user to Jira for something we can ask on the spot.
        await openMoveBlockedDialog({
          moveInput,
          targetColumnName: decision.targetColumn.name,
          issueSummary: decision.item.summary,
          transitionId: outcome.transitionId,
          screenRequiredFields: outcome.requiredFields,
          errorText: '',
          reachableStatusNames: [],
        });
      }

      // A refusal or an outright failure used to leave nothing but Jira's own words on the card. Both
      // now open the dialog, because both are moments where the user needs to be told what to do next.
      if (outcome.status === 'refused' || outcome.status === 'failed') {
        await openMoveBlockedDialog({
          moveInput,
          targetColumnName: decision.targetColumn.name,
          issueSummary: decision.item.summary,
          transitionId: null,
          screenRequiredFields: [],
          errorText: outcome.message,
          reachableStatusNames: outcome.status === 'refused' ? outcome.reachableStatusNames : [],
        });
      }

      if (outcome.message !== null && outcome.status !== 'refused' && outcome.status !== 'failed') {
        setCardMessage(decision.item.key, outcome.message);
      }
      // Reloading settles every card at Jira's actual state — including a half-applied one.
      if (outcome.status === 'applied' || outcome.status === 'partially-applied') {
        await loadBoard();
      }
    } finally {
      setPendingIssueKey(null);
    }
  }, [loadState.allItems, renderedColumns, subStatusFieldId, setCardMessage, loadBoard, preferences, applyPreferences]);

  /**
   * Routes a drag to the right handler.
   *
   * A card drop names a lane AND a column; a lane drop names only a Feature. The separator in the
   * drop-target id tells them apart, which keeps one drag context serving both gestures.
   */
  const handleBoardDragEnd = useCallback(async (dragEndEvent: DragEndEvent): Promise<void> => {
    const dropTargetId = dragEndEvent.over ? String(dragEndEvent.over.id) : null;
    const draggedId = String(dragEndEvent.active.id);

    const isLaneReorder = dropTargetId !== null
      && !dropTargetId.includes('::')
      && allFeatureKeys.includes(draggedId);

    if (isLaneReorder) {
      applyPreferences(moveLaneBefore(preferences, draggedId, dropTargetId, allFeatureKeys));
      return;
    }
    await handleCardDrop(dragEndEvent);
  }, [allFeatureKeys, preferences, applyPreferences, handleCardDrop]);

  /** Saves a vocabulary edit locally; sharing it with the team is a separate, deliberate action. */
  const handleVocabularyChange = useCallback((nextVocabulary: typeof vocabulary): void => {
    setVocabulary(saveTeamVocabulary(nextVocabulary, new Date().toISOString()));
  }, []);

  /**
   * Opens — or closes — one card's detail, asking Jira which of its fields this person may edit.
   *
   * When editmeta cannot be read the panel still opens read-only, because showing an editor that
   * would fail on save is worse than showing none.
   */
  const handleOpenIssue = useCallback(async (issueKey: string): Promise<void> => {
    // Clicking the OPEN card closes it again. The same click that opened it is where the hand already
    // is, which beats hunting for a Close button that may have been scrolled past by the panel itself.
    if (openIssueKey === issueKey) {
      setOpenIssueKey(null);
      setOpenIssueEditMeta(null);
      setOpenIssueTransitions([]);
      // The family highlight goes with it. It is a companion to the open card — "here is the rest of
      // this work" — so leaving a ring on the board after the card it belonged to has closed marks a
      // relationship nobody is looking at any more.
      setHighlightedFamilyKey(null);
      return;
    }

    setOpenIssueKey(issueKey);
    setOpenIssueTransitions([]);
    setIsReadingTransitions(true);
    setOpenIssueEditMeta(await fetchFeatureReviewEditMeta(issueKey).catch(() => null));

    // One issue, one read — which is why this lives on the OPEN card rather than on every card in a
    // column. Jira has no batch transitions endpoint, so a whole column would be a request per card.
    try {
      const openedItem = loadState.allItems.find((item) => item.key === issueKey) ?? null;
      const transitions = await fetchFeatureReviewTransitions(issueKey);
      setOpenIssueTransitions(buildCardTransitionOptions(
        transitions,
        openedItem?.subStatusValue ?? null,
        vocabulary,
        renderedColumns,
        subStatusFieldId !== '',
      ));
    } catch {
      // A failed read is reported as "no moves offered" rather than as a broken panel: the user's
      // next step is the same either way, and inventing destinations would be worse than saying none.
      setOpenIssueTransitions([]);
    } finally {
      setIsReadingTransitions(false);
    }
  }, [openIssueKey, loadState.allItems, vocabulary, renderedColumns, subStatusFieldId]);

  // Escape closes the open card, which is the gesture everybody already tries on a panel like this.
  useEffect(() => {
    if (openIssueKey === null) return;
    const closeOnEscape = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key === 'Escape') void handleOpenIssue(openIssueKey);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [openIssueKey, handleOpenIssue]);

  /**
   * Applies a transition chosen from the open card.
   *
   * A transition whose screen demands fields is handed to the same dialog a refused drag uses, so
   * being asked for Story Points looks and behaves identically however the move was started.
   */
  /**
   * Raises or clears Jira's impediment flag on one card.
   *
   * Editmeta is read at the moment of the write rather than up front. Asking for every card on the
   * board would be one request per card for an action taken a handful of times a sprint — and the
   * answer is only actionable at the point somebody presses it, where the failure path already
   * exists: the card says why, in place, exactly as a refused status move does.
   */
  const handleToggleFlag = useCallback(async (issueKey: string, shouldBeFlagged: boolean): Promise<void> => {
    setCardMessage(issueKey, null);
    setPendingIssueKey(issueKey);
    try {
      await setIssueFlag(issueKey, shouldBeFlagged, await fetchFeatureReviewEditMeta(issueKey), flagFieldId);
      await loadBoard();
    } catch (flagError: unknown) {
      setCardMessage(issueKey, describeJiraFailure(String(flagError)));
    } finally {
      setPendingIssueKey(null);
    }
  }, [setCardMessage, loadBoard, flagFieldId]);

  /**
   * Ticks one Smart Checklist line to its next state and writes it back.
   *
   * Reloads rather than patching the card in place, for the same reason the flag does: the checklist
   * is a text field a third-party app also owns, so the only trustworthy picture of what it now says
   * is the one Jira gives back.
   */
  const handleToggleChecklistItem = useCallback(async (
    issueKey: string,
    checklistItemId: string,
    nextState: ChecklistItemState,
  ): Promise<void> => {
    const item = loadState.allItems.find((candidate) => candidate.key === issueKey);
    if (!item) return;

    setCardMessage(issueKey, null);
    setPendingIssueKey(issueKey);
    try {
      const result = await saveChecklistItemState({
        issueKey,
        items: item.checklistItems,
        itemId: checklistItemId,
        nextState,
        candidateFieldIds: checklistFieldIds,
        readableFieldId: item.checklistFieldId ?? null,
      });
      if (!result.isWritten) {
        setCardMessage(issueKey, result.message);
        return;
      }
      await loadBoard();
    } finally {
      setPendingIssueKey(null);
    }
  }, [loadState.allItems, setCardMessage, loadBoard, checklistFieldIds]);

  const handleApplyTransition = useCallback(async (option: CardTransitionOption): Promise<void> => {
    if (openIssueKey === null) return;

    const movedItem = loadState.allItems.find((item) => item.key === openIssueKey) ?? null;
    setPendingTransitionId(option.transitionId);
    try {
      if (option.requiredFieldNames.length > 0) {
        await openMoveBlockedDialog({
          moveInput: {
            issueKey: openIssueKey,
            currentStatusName: movedItem?.statusName ?? '',
            currentSubStatusValue: movedItem?.subStatusValue ?? null,
            targetMapping: { jiraStatusName: option.toStatusName, subStatusValue: null },
            subStatusFieldId,
          },
          targetColumnName: option.landsInColumnName ?? option.toStatusName,
          issueSummary: movedItem?.summary ?? '',
          transitionId: option.transitionId,
          screenRequiredFields: option.requiredFields,
          errorText: '',
          reachableStatusNames: [],
        });
        return;
      }

      await saveFeatureReviewTransition(openIssueKey, option.transitionId);
      await loadBoard();
    } catch (error: unknown) {
      setCardMessage(openIssueKey, describeJiraFailure(String(error)));
    } finally {
      setPendingTransitionId(null);
    }
  }, [openIssueKey, loadState.allItems, subStatusFieldId, openMoveBlockedDialog, loadBoard, setCardMessage]);


  /** The issue currently open, taken from the board's own loaded set rather than re-fetched. */
  const openIssue = useMemo(
    () => loadState.allItems.find((item) => item.key === openIssueKey)?.issue ?? null,
    [loadState.allItems, openIssueKey],
  );

  /**
   * Completes a move Jira refused, now that the missing answers have been given.
   *
   * Two shapes, because Jira refuses in two ways. When it named its fields UP FRONT the answers ride
   * along with the transition itself, which is one atomic request. When it only complained AFTER the
   * attempt there is no transition waiting on them — the fields are simply missing on the issue — so
   * they are written first and the original move is then made again exactly as it was.
   */
  const handleSubmitBlockedMove = useCallback(async (): Promise<void> => {
    if (blockedMove === null) return;
    setPendingIssueKey(blockedMove.issueKey);
    try {
      if (blockedMove.transitionId !== null) {
        await saveFeatureReviewTransition(
          blockedMove.issueKey,
          blockedMove.transitionId,
          buildTransitionFieldsPayload(blockedMove.requiredFields, transitionSelections),
        );
      } else {
        await writeMissingFields(blockedMove.issueKey, blockedMove.requiredFields, transitionSelections);
        const retryOutcome = await executeStatusMove(blockedMove.retryInput);
        // Saying the fields were saved matters even when the move still fails — otherwise the user
        // cannot tell whether their answers were kept and would enter them a second time.
        if (retryOutcome.status !== 'applied') {
          setCardMessage(blockedMove.issueKey, `The fields were saved, but the move still failed: ${retryOutcome.message}`);
        }
      }
      setBlockedMove(null);
      await loadBoard();
    } catch (error: unknown) {
      setCardMessage(blockedMove.issueKey, describeJiraFailure(String(error)));
      setBlockedMove(null);
    } finally {
      setPendingIssueKey(null);
    }
  }, [blockedMove, transitionSelections, setCardMessage, loadBoard]);

  return (
    <div className={styles.boardShell}>
      {/* The open card's detail, as a shelf over the right of the board.

          It began at the top of the page, then moved to the end of its swimlane, then to a dock along
          the bottom — and the dock over-corrected. HEIGHT is what this board is short of: the dock
          left the columns a thin strip, and nobody needs to see all twelve columns at the moment they
          are working on one story. So it takes width, which is the axis that can be spared while a
          story is open, and it COVERS the board rather than compressing it — the board is exactly as
          it was the moment this closes.

          Escape closes it, as does its own button, as does clicking the card again. */}
      {openIssue !== null && (
        <section
          aria-label={`Details for ${openIssue.key}`}
          className={styles.detailShelf}
          data-testid="rollup-issue-detail"
        >
          <div className={styles.detailShelfBar}>
            <span className={styles.detailShelfTitle}>{openIssue.key}</span>
            <a
              className={styles.detailShelfLink}
              href={buildJiraBrowseUrl(openIssue.key, jiraBaseUrl)}
              rel="noreferrer"
              target="_blank"
            >
              Open in Jira
            </a>
            <button
              className={styles.actionButton}
              onClick={() => void handleOpenIssue(openIssue.key)}
              type="button"
            >
              Close
            </button>
          </div>
          <div className={styles.detailShelfBody}>
            {/* Editing delegates entirely to the shared editors: the board adds no write path of its
                own, so a field it cannot safely write stays read-only here as everywhere.

                What it CAN do is offer a field that is EMPTY. Jira's own shelf shows only fields that
                already hold a value, so setting a missing fix version means opening the issue in a new
                tab and hunting for the Edit screen. These editors key off the issue's editmeta — "is
                this field settable" — which says nothing about whether it currently holds anything, so
                an empty field is offered exactly like a full one. */}
            <CardTransitionsPanel
              isLoading={isReadingTransitions}
              onApply={(option) => void handleApplyTransition(option)}
              options={openIssueTransitions}
              pendingTransitionId={pendingTransitionId}
            />
            <IssueDetailPanel
              fieldEditing={openIssueEditMeta
                ? { editMeta: openIssueEditMeta, onFieldSaved: () => void loadBoard() }
                : undefined}
              isEmbedded
              issue={openIssue}
              onIssueUpdated={() => void loadBoard()}
            />
          </div>
        </section>
      )}

      {/* The scroll region starts HERE, above the board's own toolbar, so that toolbar, the notices
          and the filter bar all scroll away and give their height back to the cards. Previously they
          sat above the scroller and permanently cost ~200px of a screen that at the larger text sizes
          had none to spare — which is why a lane could only show three cards.

          Everything inside that is not part of the column grid is pinned with `left: 0`, so scrolling
          sideways through the columns does not drag the toolbar off the screen with it. */}
      <div
        className={styles.boardScroller}
        ref={boardScrollerRef}
        style={{
          ...(boardScrollerMaxHeightPx === null ? {} : { maxHeight: `${boardScrollerMaxHeightPx}px` }),
          // Read by .laneHeader, so a swimlane's identity pins just below the column headers instead
          // of scrolling away — on a board of twenty Features a tall lane otherwise leaves you
          // looking at cards with no idea which Feature they belong to.
          '--rollup-column-header-height': `${columnHeaderHeightPx}px`,
        } as React.CSSProperties}
      >
      <div className={styles.boardChrome}>
      <div className={styles.boardActions}>
        <button className={styles.actionButton} onClick={() => void loadBoard()} type="button">Refresh</button>
        <button
          className={styles.actionButton}
          onClick={() => applyPreferences(setAllLanesCollapsed(preferences, allFeatureKeys, false))}
          type="button"
        >
          Expand all
        </button>
        <button
          className={styles.actionButton}
          onClick={() => applyPreferences(setAllLanesCollapsed(preferences, allFeatureKeys, true))}
          type="button"
        >
          Collapse all
        </button>
        <button className={styles.actionButton} onClick={() => setIsEditingColumns(!isEditingColumns)} type="button">
          {isEditingColumns ? 'Hide board setup' : 'Board setup'}
        </button>
        {/* Stays on the toolbar rather than moving into Board setup, because it answers a problem people
            hit on their FIRST look — too many columns for the screen — and the reflex fix for that is
            the browser's zoom control, which shrinks the whole app instead. Discoverability beats
            tidiness here.
            But it is offered only while the columns actually overflow. On a board that already fits, a
            width control is a setting nobody needs, sitting beside Refresh, which everybody presses. */}
        {measureBoardWidth(renderedColumns.length, columnDensity) > boardWidth && (
        <label className={styles.densityControl} title={describeColumnFit(renderedColumns.length, columnDensity, boardWidth)}>
          Column width
          <select
            aria-label="Column width"
            onChange={(changeEvent) =>
              applyPreferences({ ...preferences, columnDensity: changeEvent.target.value as ColumnDensity })}
            value={columnDensity}
          >
            {(Object.keys(COLUMN_DENSITY_LABELS) as ColumnDensity[]).map((density) => (
              <option key={density} value={density}>{COLUMN_DENSITY_LABELS[density]}</option>
            ))}
          </select>
        </label>
        )}
        {/* Its own control, not buried in Board setup: this is what somebody reaches for when the board
            is already behaving oddly, and hiding it behind a settings panel made it unfindable. */}
        <button
          className={styles.actionButton}
          onClick={() => setIsTroubleshooting(!isTroubleshooting)}
          title="Ask why a particular issue is not appearing on this board"
          type="button"
        >
          {isTroubleshooting ? 'Hide troubleshooter' : "Why is an issue missing?"}
        </button>
        {/* Beside Reset order, because they are the same subject: what order this board is in, and
            whose order that is. Offered only where there is a shared workspace to publish into. */}
        {sharedWorkspaceDatabaseId !== '' && hasManualOrder(preferences) && (
          <button
            className={styles.actionButton}
            disabled={isSharingOrder}
            onClick={() => void handlePublishOrder()}
            title="Publish this order so the rest of the team sees the same priorities"
            type="button"
          >
            {isSharingOrder ? 'Sharing…' : 'Share this order'}
          </button>
        )}
        {sharedWorkspaceDatabaseId !== '' && (
          <button
            className={styles.actionButton}
            onClick={() => void handlePreviewOrderPull()}
            title="See what the team's published order would change, before accepting it"
            type="button"
          >
            Get the team&apos;s order
          </button>
        )}

        {/* Manual order is sticky by design — a lane sent to the top stays there across sessions — so
            there has to be a way back that is not "drag every lane". Offered only when there is
            something to undo. */}
        {hasManualOrder(preferences) && (
          <button
            className={styles.actionButton}
            onClick={() => applyPreferences(clearManualOrder(preferences))}
            title="Return to Feature key order — the same order the PI Review page uses"
            type="button"
          >
            Reset order
          </button>
        )}
        <span className={styles.boardStatusLine}>
          {loadState.isLoading
            ? 'Loading — this board is not showing everything yet.'
            : `${layout.lanes.length} Feature lanes · ${scopedIssues.length} issues in scope`}
          {scopeDescription ? ` · ${scopeDescription}` : ''}
        </span>
      </div>

      {orderShareMessage !== null && (
        <p className={styles.boardStatusLine} data-testid="rollup-order-share-status">{orderShareMessage}</p>
      )}

      {/* Preview and accept, exactly as the column vocabulary does it: an order that changed under
          you without being shown is worse than having no shared order at all. */}
      {orderPullPreview !== null && (
        <div className={styles.panelCard} data-testid="rollup-order-pull-preview" role="region">
          {orderPullPreview.remote === null && (
            <p className={styles.fieldLabel}>Nobody has published this team&apos;s board order yet.</p>
          )}
          {orderPullPreview.remote !== null && !orderPullPreview.hasDifferences && (
            <p className={styles.fieldLabel}>Your board is already in the team&apos;s order.</p>
          )}
          {orderPullPreview.remote !== null && orderPullPreview.hasDifferences && (
            <>
              <p className={styles.fieldLabel}>Accepting the team&apos;s order would:</p>
              <ul>
                {orderPullPreview.differences.map((difference) => (
                  <li className={styles.fieldLabel} key={JSON.stringify(difference)}>
                    {describeOrderDifference(difference)}
                  </li>
                ))}
              </ul>
              <p className={styles.fieldLabel}>
                Which lanes you have collapsed is your own view and is left exactly as it is.
              </p>
              <button
                className={styles.actionButton}
                onClick={() => {
                  applyPreferences(applyBoardOrder(preferences, orderPullPreview.remote!));
                  setOrderPullPreview(null);
                  setOrderShareMessage('This board is now in the team\'s order.');
                }}
                type="button"
              >
                Accept the team&apos;s order
              </button>
            </>
          )}
          <button className={styles.actionButton} onClick={() => setOrderPullPreview(null)} type="button">
            Close
          </button>
        </div>
      )}

      {/* A load failure is not a notice — it means there is no board — so it stays on its own. */}
      {loadState.loadError !== null && (
        <p className={styles.boardWarning}>Could not load the board: {loadState.loadError}</p>
      )}

      {/* Everything else the board wants to say, in ONE collapsible box. Nine stacked boxes pushed the
          board itself off the screen, and buried whatever was rendered among them — which is how the
          add-work dialog came to look like a button that did nothing. */}
      <BoardNotices notices={[...boardNotices, ...subLaneNotices]} />

      {/* Below the notices, never among them, so it is always the first thing under the header. */}
      {addWorkFeature !== null && (
        <AddWorkDialog
          errorMessage={createWorkError}
          featureKey={addWorkFeature.key}
          featureSummary={addWorkFeature.summary}
          isSaving={isCreatingWork}
          issueTypes={creatableIssueTypes}
          onCancel={() => setAddWorkFeature(null)}
          onCreate={(issueTypeId, summary) => void createWorkForFeature(issueTypeId, summary)}
          piValue={scopeMode === DASHBOARD_PI_SCOPE_MODE ? (selectedPiValue ?? '') : ''}
        />
      )}

      {createWorkOutcome !== null && (
        <p className={styles.boardStatusLine} data-testid="rollup-create-outcome">{createWorkOutcome}</p>
      )}

      {isEditingColumns && (
        <FeatureScopePanel
          hasOwnScope={hasOwnScope}
          featureLinkedOutOfProjectKeys={loadState.featureLinkedOutOfProjectKeys}
          hiddenIssueCount={loadState.hiddenIssueCount}
          issueLinkedOutOfProjectKeys={loadState.issueLinkedOutOfProjectKeys}
          onResetScope={() => {
            clearTeamFeatureScope(teamProfileId);
            setHasOwnScope(false);
            setFeatureScope(loadTeamFeatureScope(teamProfileId));
          }}
          onScopeChange={(nextScope) => {
            saveTeamFeatureScope(teamProfileId, nextScope);
            setHasOwnScope(true);
            setFeatureScope(nextScope);
          }}
          scope={featureScope}
          allFeatureKeys={loadState.allReferencedFeatureKeys}
          availablePiValues={availablePiValues}
        />
      )}

      {isTroubleshooting && (
        <PlacementTroubleshooter
          explainLanePresence={explainLanePresence}
          carryOverPiValue={featureScope.carryOverPiValue}
          featureLinkFieldId={loadConfiguredFeatureLinkFieldId()}
          featureProjectKeys={featureScope.featureProjectKeys}
          piFieldId={readConfiguredPiFieldId()}
          selectedPiValue={selectedPiValue ?? ''}
          teamFeatureLabel={featureScope.teamFeatureLabel}
        />
      )}

      {/* Two gates, both deliberate: Admin Hub unlocked AND diagnostics explicitly switched on there.
          Unlocking alone must not put raw Jira field ids on somebody's board. */}
      {isEditingColumns && canShowBoardDiagnostics(isAdminUnlocked, isBoardDiagnosticsEnabled) && (
        <ChecklistDiagnosticsPanel />
      )}

      {isEditingColumns && (
        <ColumnVocabularyEditor
          allItems={loadState.allItems}
          canShare={Boolean(sharedWorkspaceDatabaseId)}
          onAcceptPull={(remoteVocabulary) => {
            setVocabulary(markVocabularySynced(
              saveTeamVocabulary(remoteVocabulary, new Date().toISOString()),
              new Date().toISOString(),
            ));
            setPullPreview(null);
          }}
          onCancelPull={() => setPullPreview(null)}
          onPreviewPull={() => {
            if (!sharedWorkspaceDatabaseId) return;
            void previewBoardVocabularyPull(sharedWorkspaceDatabaseId, vocabulary).then(setPullPreview);
          }}
          onPublish={() => {
            if (!sharedWorkspaceDatabaseId) return;
            void publishBoardVocabulary(sharedWorkspaceDatabaseId, vocabulary)
              .then(() => setVocabulary(markVocabularySynced(vocabulary, new Date().toISOString())));
          }}
          copyableTeams={copyableTeams.filter((team) => team.id !== teamProfileId)}
          onCopyFromTeam={(sourceTeamProfileId) => {
            const sourceVocabulary = loadTeamVocabulary(sourceTeamProfileId);
            handleVocabularyChange({ ...sourceVocabulary, teamProfileId, lastSyncedAt: null });
          }}
          onVocabularyChange={handleVocabularyChange}
          optionSources={optionSources}
          pullPreview={pullPreview}
          vocabulary={vocabulary}
        />
      )}

      {blockedMove !== null && (
        <MoveBlockedDialog
          canSubmit={areTransitionSelectionsComplete(blockedMove.requiredFields, transitionSelections)}
          diagnosis={blockedMove.diagnosis}
          fixableFields={blockedMove.requiredFields}
          isSaving={pendingIssueKey === blockedMove.issueKey}
          onDismiss={() => setBlockedMove(null)}
          onOpenIssue={() => {
            const issueKeyToOpen = blockedMove.issueKey;
            setBlockedMove(null);
            void handleOpenIssue(issueKeyToOpen);
          }}
          onSelectionChange={(fieldId, selection) =>
            setTransitionSelections((previousSelections) => ({ ...previousSelections, [fieldId]: selection }))}
          onSubmit={() => void handleSubmitBlockedMove()}
          selectionByFieldId={transitionSelections}
        />
      )}

      <QuickFilterBar
        allItems={loadState.allItems}
        filters={filters}
        onFiltersChange={setFilters}
        scopeDescription={scopeDescription}
      />
      </div>

        <BoardColumnHeaderRow
          collapsedColumnIds={preferences.collapsedColumnIds ?? []}
          columnTracks={columnTracks}
          columns={layout.columns}
          focusedColumnId={focusedColumnId}
          onToggleCollapsed={(columnId) => applyPreferences({
            ...preferences,
            collapsedColumnIds: toggleColumnCollapsed(preferences.collapsedColumnIds, columnId),
          })}
          onToggleFocus={(columnId) =>
            setFocusedColumnId((currentFocus) => toggleColumnFocus(currentFocus, columnId))}
          issueCountByColumnId={loadState.allItems.reduce<Record<string, number>>((counts, item) => {
            counts[item.columnId] = (counts[item.columnId] ?? 0) + 1;
            return counts;
          }, {})}
          onReorderColumns={(orderedColumnIds) => handleVocabularyChange({
            ...vocabulary,
            columns: vocabulary.columns.map((column) => ({
              ...column,
              order: orderedColumnIds.indexOf(column.id),
            })).filter((column) => column.order >= 0),
          })}
        />

        {/* Cards and lanes are dragged in one context, and the drop-target id says which happened:
            a lane's sortable id is its Feature key, a column cell's carries the "::" separator. */}
        <DndContext
          collisionDetection={detectCollisions}
          // Re-measured continuously while a drag is in progress. Without this the drop targets are
          // measured once, and the board is a scroll container whose lanes collapse and expand — so
          // by the time a card is carried three columns across, the rectangles it is being tested
          // against describe where the cells USED to be, and the card lands in the wrong one.
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragCancel={() => { setDraggedItemKey(null); setDropPreview(null); }}
          onDragEnd={(dragEndEvent) => {
            setDraggedItemKey(null);
            setDropPreview(null);
            void handleBoardDragEnd(dragEndEvent);
          }}
          // Live, as the pointer moves: the gap has to open where the card would land RIGHT NOW, or
          // it is telling you about somewhere you have already left.
          onDragMove={(dragMoveEvent) => setDropPreview(readDropPreview(dragMoveEvent))}
          onDragStart={(dragStartEvent) => setDraggedItemKey(String(dragStartEvent.active.id))}
          sensors={dragSensors}
        >
          {/* The card that follows the pointer, in a layer of its own. Without it dnd-kit moves the
              original element, which lives in a cell inside a scrolling board — so the card was
              CLIPPED the moment it left its own column.

              Portalled to the body ON PURPOSE. Rendered in place it sits inside the board, which
              scrolls horizontally, and its position picked that scroll offset up: the card appeared a
              column or two to the RIGHT of the pointer while the pointer was still what decided where
              it landed. Out here there is no scrolled ancestor to inherit from.

              No width is set either. It takes the size of the card actually lifted, so what you are
              carrying is what you picked up rather than a guess at the column's minimum width. */}
          {createPortal(
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
              {draggedItem === null ? null : (
                <div className={styles.dragPreview}>
                  <ChildCard item={draggedItem} />
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
          <SortableContext items={allFeatureKeys} strategy={verticalListSortingStrategy}>
            {layout.lanes.map((lane, laneIndex) => (
            <MasterCardLane
              cardDetailByIssueKey={cardDetailByIssueKey}
              columnTracks={columnTracks}
              columns={layout.columns}
              errorMessageByIssueKey={errorMessageByIssueKey}
              collapsedColumnIds={preferences.collapsedColumnIds ?? []}
              pendingChecklistCardId={pendingChecklistCardId}
              errorMessageByChecklistCardId={errorMessageByChecklistCardId}
              draggedItemKey={draggedItemKey}
              dropPreview={dropPreview}
              onToggleFlag={(issueKey, shouldBeFlagged) => void handleToggleFlag(issueKey, shouldBeFlagged)}
              onSetChecklistState={(checklistCard, nextState) =>
                void handleToggleChecklistItem(checklistCard.parentKey, checklistCard.itemId, nextState)}
              onNestInto={(issueKey, containerIssueKey) => {
                const item = loadState.allItems.find((candidate) => candidate.key === issueKey);
                if (item) void applyContainment(item, containerIssueKey);
              }}
              hasActiveFilters={hasActiveFilters(filters)}
              highlightedFamilyKey={highlightedFamilyKey}
              key={lane.masterCard.featureKey}
              featureReadFailureDetail={loadState.featureReadFailures
                .find((failure) => failure.featureKey === lane.masterCard.featureKey)?.detail ?? null}
              lane={lane}
              laneRank={laneIndex + 1}
              familyProgress={familyProgressByFeatureKey[lane.masterCard.featureKey] ?? null}
              onToggleSubLaneCollapsed={(cloneFeatureKey) =>
                applyPreferences(toggleLaneCollapsed(preferences, cloneFeatureKey))}
              membershipReason={membershipReasonByFeatureKey[lane.masterCard.featureKey] ?? null}
              onRankChange={(laneFeatureKey, nextRank) =>
                applyPreferences(moveLaneToRank(preferences, laneFeatureKey, nextRank, allFeatureKeys))}
              onAddWork={projectKey !== ''
                ? (laneFeatureKey, laneSummary) => void openAddWork(laneFeatureKey, laneSummary)
                : undefined}
              onOpenIssue={(issueKey) => void handleOpenIssue(issueKey)}
              onSelectFamily={(item) => setHighlightedFamilyKey(selectFamilyKey(item))}
              onSendToBottom={(featureKey) =>
                applyPreferences(moveLaneToEnd(preferences, featureKey, allFeatureKeys, 'bottom'))}
              onSendToTop={(featureKey) =>
                applyPreferences(moveLaneToEnd(preferences, featureKey, allFeatureKeys, 'top'))}
              onToggleCollapsed={(featureKey) => applyPreferences(toggleLaneCollapsed(preferences, featureKey))}
              pendingIssueKey={pendingIssueKey}
            />
            ))}
          </SortableContext>
        </DndContext>

        {!loadState.isLoading && layout.lanes.length === 0 && loadState.loadError === null && (
          <p className={styles.boardEmptyState}>
            This board has no issues on it right now — nothing has been filtered out.
          </p>
        )}
      </div>
    </div>
  );
}
