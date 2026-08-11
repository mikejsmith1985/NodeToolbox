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
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import IssueDetailPanel from '../../../components/IssueDetailPanel/index.tsx';
import { TransitionRequiredFields } from '../../../components/TransitionRequiredFields/index.tsx';
import type { JiraIssue } from '../../../types/jira.ts';
import { loadConfiguredFeatureLinkFieldId } from '../../../utils/featureLink.ts';
import { createIssue, getIssueTypeFields, getProjectIssueTypes, jiraPut } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueType } from '../../../types/jira.ts';
import { buildJqlFieldReference, loadHygieneFieldConfig, readConfiguredPiFieldId } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  fetchFeatureReviewEditMeta,
  getStoryPointsCandidateFieldIds,
  saveFeatureReviewTransition,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../featureReviewFixes.ts';
import { buildRenderedColumns, resolveColumnIdForItem } from './boardColumns.ts';
import { EMPTY_QUICK_FILTER_STATE, hasActiveFilters } from './boardFilters.ts';
import { buildBoardLayout } from './boardLayout.ts';
import {
  loadBoardPreferences,
  moveCardBefore,
  moveLaneBefore,
  moveLaneToEnd,
  saveBoardPreferences,
  setAllLanesCollapsed,
  toggleLaneCollapsed,
} from './boardPreferencesStore.ts';
import { loadTeamVocabulary, markVocabularySynced, saveTeamVocabulary } from './boardVocabularyStore.ts';
import { previewBoardVocabularyPull, publishBoardVocabulary, type VocabularyPullPreview } from './boardVocabularySync.ts';
import { parseCardTargetId, resolveCardDrop } from './cardDropRouting.ts';
import { loadColumnOptionSources, type ColumnOptionSources } from './columnOptionSources.ts';
import { executeStatusMove } from './statusMoveWriter.ts';
import { resolveBoardItems } from './featureRollup.ts';
import { buildMasterCards } from './masterCards.ts';
import { fetchFeaturesInPi, fetchRollupBoardIssues, fetchSprintPiReconciliation } from './rollupBoardFetch.ts';
import {
  buildBoardVisibilityPayload,
  buildNewWorkPayload,
  describeCreationOutcome,
  type CreateMetaFieldShape,
} from './createWorkForFeature.ts';
import {
  selectFeaturesWithoutWork,
  sumUnplannedStoryPoints,
  type FeatureWithoutWork,
} from './emptyFeatureScan.ts';
import { describeReconciliation, type SprintPiReconciliation } from '../sprintPiReconciliation.ts';
import {
  clearTeamFeatureScope,
  hasTeamOwnFeatureScope,
  loadTeamFeatureScope,
  saveTeamFeatureScope,
} from './boardScopeStore.ts';
import { applyFeatureScope, type FeatureScopeSettings } from './featureScope.ts';
import { AddWorkDialog } from './components/AddWorkDialog.tsx';
import { BoardColumnHeaderRow } from './components/BoardColumnHeaderRow.tsx';
import { ColumnVocabularyEditor } from './components/ColumnVocabularyEditor.tsx';
import { FeatureScopePanel } from './components/FeatureScopePanel.tsx';
import { MasterCardLane } from './components/MasterCardLane.tsx';
import { QuickFilterBar } from './components/QuickFilterBar.tsx';
import styles from './RollupBoardTab.module.css';
import {
  EXPECTED_BOARD_ISSUE_CEILING,
  NO_FEATURE_KEY,
  type BoardPreferences,
  type MasterCard,
  type QuickFilterState,
  type FeatureReadFailure,
  type RollupBoardItem,
  type RollupBoardScope,
} from './rollupBoardTypes.ts';

const NO_BOARD_MESSAGE =
  'No board is selected for this team yet. Choose one in the Settings tab — the Roll-Up Board reads '
  + 'whichever board the team already uses, rather than asking you to pick a second one.';

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
  transitionId: string;
  requiredFields: TransitionRequiredField[];
  targetColumnName: string;
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
  featureLinkedOutOfProjectKeys: [],
  issueLinkedOutOfProjectKeys: [],
  allReferencedFeatureKeys: [],
};

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
  projectKey = '',
}: RollupBoardTabProps) {
  const [loadState, setLoadState] = useState<RollupBoardLoadState>(EMPTY_LOAD_STATE);
  const [filters, setFilters] = useState<QuickFilterState>(EMPTY_QUICK_FILTER_STATE);
  const [preferences, setPreferences] = useState<BoardPreferences>(() =>
    loadBoardPreferences(teamProfileId, boardId ?? 0));
  const [highlightedFamilyKey, setHighlightedFamilyKey] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState(() => loadTeamVocabulary(teamProfileId));
  const [optionSources, setOptionSources] = useState<ColumnOptionSources>(EMPTY_OPTION_SOURCES);
  const [pullPreview, setPullPreview] = useState<VocabularyPullPreview | null>(null);
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [pendingIssueKey, setPendingIssueKey] = useState<string | null>(null);
  const [errorMessageByIssueKey, setErrorMessageByIssueKey] = useState<Record<string, string>>({});
  const [subStatusFieldId, setSubStatusFieldId] = useState('');
  const [blockedMove, setBlockedMove] = useState<BlockedMove | null>(null);
  const [transitionSelections, setTransitionSelections] = useState<Record<string, TransitionFieldSelection>>({});
  const [featureScope, setFeatureScope] = useState<FeatureScopeSettings>(() => loadTeamFeatureScope(teamProfileId));
  const [hasOwnScope, setHasOwnScope] = useState(() => hasTeamOwnFeatureScope(teamProfileId));
  const [sprintPiGap, setSprintPiGap] = useState<SprintPiReconciliation | null>(null);
  const [featuresWithoutWork, setFeaturesWithoutWork] = useState<FeatureWithoutWork[]>([]);
  const [addWorkFeature, setAddWorkFeature] = useState<{ key: string; summary: string } | null>(null);
  const [creatableIssueTypes, setCreatableIssueTypes] = useState<CreateMetaIssueType[]>([]);
  const [isCreatingWork, setIsCreatingWork] = useState(false);
  const [createWorkError, setCreateWorkError] = useState<string | null>(null);
  const [createWorkOutcome, setCreateWorkOutcome] = useState<string | null>(null);
  const [openIssueKey, setOpenIssueKey] = useState<string | null>(null);
  const [openIssueEditMeta, setOpenIssueEditMeta] = useState<Awaited<ReturnType<typeof fetchFeatureReviewEditMeta>> | null>(null);

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const renderedColumns = useMemo(() => buildRenderedColumns(vocabulary), [vocabulary]);

  const loadBoard = useCallback(async (): Promise<void> => {
    if (boardId === null) return;
    setLoadState((previousState) => ({ ...previousState, isLoading: true, loadError: null }));

    try {
      const fieldConfig = await loadHygieneFieldConfig();
      const [discoveredSubStatusFieldId = ''] = fieldConfig.subStatusFieldIds ?? [];
      const storyPointsFieldIds = getStoryPointsCandidateFieldIds();
      const scope: RollupBoardScope = {
        boardId,
        teamProfileId,
        featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
        subStatusFieldId: discoveredSubStatusFieldId,
        storyPointsFieldIds,
      };

      const issueSet = await fetchRollupBoardIssues(scope, scopedIssues.map((issue) => issue.key));
      const boardItems = resolveBoardItems(issueSet, scope, {
        resolveColumnId: (statusName, subStatusValue) =>
          resolveColumnIdForItem(statusName, subStatusValue, vocabulary, discoveredSubStatusFieldId !== ''),
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
  }, [boardId, teamProfileId, vocabulary, featureScope, scopedIssues]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

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
  // found from, so it can only be discovered by asking about Features directly.
  useEffect(() => {
    const isPiScoped = scopeMode === DASHBOARD_PI_SCOPE_MODE && Boolean(selectedPiValue);
    if (!isPiScoped || featureScope.featureProjectKeys.length === 0) {
      setFeaturesWithoutWork([]);
      return;
    }

    let isMounted = true;
    const scanScope: RollupBoardScope = {
      boardId: boardId ?? 0,
      teamProfileId,
      featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
      subStatusFieldId,
      storyPointsFieldIds: getStoryPointsCandidateFieldIds(),
    };

    void fetchFeaturesInPi(
      featureScope.featureProjectKeys,
      selectedPiValue!,
      buildJqlFieldReference(readConfiguredPiFieldId()),
      scanScope,
    ).then((piFeatures) => {
      if (!isMounted) return;
      setFeaturesWithoutWork(selectFeaturesWithoutWork(
        piFeatures,
        loadState.masterCards.map((masterCard) => masterCard.featureKey),
        getStoryPointsCandidateFieldIds(),
      ));
    });

    return () => { isMounted = false; };
  }, [boardId, scopeMode, selectedPiValue, featureScope, teamProfileId, subStatusFieldId, loadState.masterCards]);

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

      const fieldMeta = await getIssueTypeFields(projectKey, issueTypeId).catch(() => ({ values: [] }));
      const fieldShapesById: Record<string, CreateMetaFieldShape | undefined> = {};
      for (const field of fieldMeta.values ?? []) fieldShapesById[field.fieldId] = field;

      const visibilityPayload = buildBoardVisibilityPayload({
        featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
        featureKey: addWorkFeature.key,
        piFieldId: scopeMode === DASHBOARD_PI_SCOPE_MODE ? readConfiguredPiFieldId() : '',
        piValue: selectedPiValue ?? '',
      }, fieldShapesById);

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

  const layout = useMemo(
    () => buildBoardLayout({ masterCards: loadState.masterCards, columns: renderedColumns, filters, preferences }),
    [loadState.masterCards, renderedColumns, filters, preferences],
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

  /**
   * Applies a dropped card's new status, then reloads so the board shows Jira's truth.
   *
   * A partial write is deliberately NOT reverted: the status really did change, so putting the card
   * back would draw a state Jira does not hold.
   */
  const handleCardDrop = useCallback(async (dragEndEvent: DragEndEvent): Promise<void> => {
    const decision = resolveCardDrop({
      draggedItemKey: String(dragEndEvent.active.id),
      dropTargetId: dragEndEvent.over ? String(dragEndEvent.over.id) : null,
      itemsByKey: new Map(loadState.allItems.map((item) => [item.key, item])),
      columnsById: new Map(renderedColumns.map((column) => [column.id, column])),
    });

    if (decision.kind === 'ignore') return;
    if (decision.kind === 'refused') {
      setCardMessage(String(dragEndEvent.active.id), decision.reason);
      return;
    }

    // Sequencing work inside a column is a view preference, not a state change: nothing is written
    // to Jira, exactly as with lane order.
    if (decision.kind === 'reorder') {
      const laneKey = decision.item.featureKey ?? NO_FEATURE_KEY;
      const displayedIssueKeys = loadState.allItems
        .filter((item) => (item.featureKey ?? NO_FEATURE_KEY) === laneKey && item.columnId === decision.item.columnId)
        .map((item) => item.key);
      applyPreferences(moveCardBefore(
        preferences,
        laneKey,
        decision.item.columnId,
        decision.item.key,
        decision.targetIssueKey,
        displayedIssueKeys,
      ));
      return;
    }

    setCardMessage(decision.item.key, null);
    setPendingIssueKey(decision.item.key);
    try {
      const outcome = await executeStatusMove({
        issueKey: decision.item.key,
        currentStatusName: decision.item.statusName,
        currentSubStatusValue: decision.item.subStatusValue,
        // A column can claim several statuses; a drop writes the first one it claims.
        targetMapping: decision.targetColumn.mappings[0],
        subStatusFieldId,
      });

      if (outcome.status === 'needs-fields') {
        // Jira will not accept the move until its screen fields are answered, so collect them here
        // rather than sending the user to Jira for something we can ask on the spot.
        setBlockedMove({
          issueKey: decision.item.key,
          transitionId: outcome.transitionId,
          requiredFields: outcome.requiredFields,
          targetColumnName: decision.targetColumn.name,
        });
        setTransitionSelections({});
      }
      if (outcome.message !== null) {
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
   * Opens one card's detail, asking Jira which of its fields this person may edit.
   *
   * When editmeta cannot be read the panel still opens read-only, because showing an editor that
   * would fail on save is worse than showing none.
   */
  const handleOpenIssue = useCallback(async (issueKey: string): Promise<void> => {
    setOpenIssueKey(issueKey);
    setOpenIssueEditMeta(await fetchFeatureReviewEditMeta(issueKey).catch(() => null));
  }, []);

  /** The issue currently open, taken from the board's own loaded set rather than re-fetched. */
  const openIssue = useMemo(
    () => loadState.allItems.find((item) => item.key === openIssueKey)?.issue ?? null,
    [loadState.allItems, openIssueKey],
  );

  /** Completes a move that Jira paused, now that its screen fields have been answered. */
  const handleSubmitBlockedMove = useCallback(async (): Promise<void> => {
    if (blockedMove === null) return;
    setPendingIssueKey(blockedMove.issueKey);
    try {
      await saveFeatureReviewTransition(
        blockedMove.issueKey,
        blockedMove.transitionId,
        buildTransitionFieldsPayload(blockedMove.requiredFields, transitionSelections),
      );
      setCardMessage(blockedMove.issueKey, null);
      setBlockedMove(null);
      await loadBoard();
    } catch (error: unknown) {
      setCardMessage(blockedMove.issueKey, String(error));
    } finally {
      setPendingIssueKey(null);
    }
  }, [blockedMove, transitionSelections, setCardMessage, loadBoard]);

  if (boardId === null) {
    return <p className={styles.boardEmptyState}>{NO_BOARD_MESSAGE}</p>;
  }

  return (
    <div className={styles.boardShell}>
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
        <span className={styles.boardStatusLine}>
          {loadState.isLoading
            ? 'Loading — this board is not showing everything yet.'
            : `${layout.lanes.length} Feature lanes · ${scopedIssues.length} issues in scope`}
          {scopeDescription ? ` · ${scopeDescription}` : ''}
        </span>
      </div>

      {loadState.loadError !== null && (
        <p className={styles.boardWarning}>Could not load the board: {loadState.loadError}</p>
      )}

      {loadState.incompleteReasons.length > 0 && (
        <div className={styles.boardWarning}>
          <p>Part of this board could not be read, so it is showing less than the team actually has:</p>
          <ul>{loadState.incompleteReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      {loadState.isOversized && (
        <p className={styles.boardWarning}>
          This board holds more than {EXPECTED_BOARD_ISSUE_CEILING} issues. Everything is shown — nothing has been
          dropped — but the board may feel slower than usual.
        </p>
      )}

      {/* Anything the scope holds back is stated with the way to see it — the board never just
          looks smaller than the team's Jira board. */}
      {loadState.hiddenIssueCount > 0 && (
        <p className={styles.boardWarning}>
          {loadState.hiddenIssueCount} {loadState.hiddenIssueCount === 1 ? 'issue is' : 'issues are'} hidden because
          {' '}{loadState.hiddenIssueCount === 1 ? 'its Feature is' : 'their Features are'} outside this team&apos;s
          projects. Open <strong>Board setup</strong> to widen the projects or show them anyway.
        </p>
      )}

      {/* A Feature Link crossing projects is usually a mistake, so it is named even when its work is
          hidden: the lane stays off the board, but the fact does not go unnoticed. */}
      {loadState.featureLinkedOutOfProjectKeys.length > 0 && (
        <p className={styles.boardWarning}>
          ⚠ {loadState.featureLinkedOutOfProjectKeys.length}{' '}
          {loadState.featureLinkedOutOfProjectKeys.length === 1 ? 'Feature is' : 'Features are'} linked by the Feature
          Link field but sit outside this team&apos;s projects: {loadState.featureLinkedOutOfProjectKeys.join(', ')}.
          That is usually worth correcting in Jira.
        </p>
      )}

      {/* The PI query cannot see work whose PI field is blank, so sprint membership is checked as a
          second opinion. Without this the issue — and the whole Feature above it — simply is not there. */}
      {sprintPiGap !== null && sprintPiGap.mismatches.length > 0 && (
        <p className={styles.boardWarning} data-testid="rollup-sprint-pi-gap">
          ⚠ {describeReconciliation(sprintPiGap)} Set the PI field on{' '}
          {sprintPiGap.mismatches.length === 1 ? 'it' : 'them'} in Jira and refresh.
        </p>
      )}

      {/* The board's blind spot, stated: lanes are built from work upward, so a Feature nobody has
          broken down has no lane at all — which is exactly when somebody most needs to see it. */}
      {featuresWithoutWork.length > 0 && (
        <div className={styles.boardWarning} data-testid="rollup-features-without-work">
          ⚠ {featuresWithoutWork.length}{' '}
          {featuresWithoutWork.length === 1 ? 'Feature is' : 'Features are'} committed to this PI with no
          work under {featuresWithoutWork.length === 1 ? 'it' : 'them'}
          {sumUnplannedStoryPoints(featuresWithoutWork) > 0
            ? ` — ${sumUnplannedStoryPoints(featuresWithoutWork)} story points with nothing planned`
            : ''}:
          <ul>
            {featuresWithoutWork.map((feature) => (
              <li key={feature.featureKey}>
                <strong>{feature.featureKey}</strong> {feature.summary}
                {feature.statusName ? ` · ${feature.statusName}` : ''}
                {feature.storyPoints !== null ? ` · ${feature.storyPoints} pts` : ''}
                {feature.assigneeDisplayName ? ` · ${feature.assigneeDisplayName}` : ''}
                {projectKey !== '' && (
                  <button
                    className={styles.actionButton}
                    onClick={() => void openAddWork(feature.featureKey, feature.summary)}
                    type="button"
                  >
                    Add work
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {/* A Feature that simply "could not be read" leaves nowhere to go. Each one is asked about
          directly, so the lane's blank header comes with the reason Jira itself gave. */}
      {loadState.featureReadFailures.length > 0 && (
        <div className={styles.boardWarning} data-testid="rollup-feature-read-failures">
          ⚠ {loadState.featureReadFailures.length}{' '}
          {loadState.featureReadFailures.length === 1 ? 'Feature' : 'Features'} could not be read:
          <ul>
            {loadState.featureReadFailures.map((failure) => (
              <li key={failure.featureKey}>{failure.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {!loadState.hasSubStatusField && (
        <p className={styles.boardWarning}>
          This Jira instance has no sub-status field, so columns can only match on status. The board is less precise
          than it would otherwise be.
        </p>
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
        />
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
        <section aria-label="Answers Jira needs before this move" className={styles.panelCard}>
          <h3 className={styles.sectionTitle}>
            {blockedMove.issueKey} → {blockedMove.targetColumnName}
          </h3>
          <p className={styles.fieldLabel}>
            Jira needs a few answers before it will make this move. Anything it will not let us collect here is
            named below and has to be done in Jira.
          </p>
          <TransitionRequiredFields
            isDisabled={pendingIssueKey === blockedMove.issueKey}
            onSelectionChange={(fieldId, selection) =>
              setTransitionSelections((previousSelections) => ({ ...previousSelections, [fieldId]: selection }))}
            requiredFields={blockedMove.requiredFields}
            selectionByFieldId={transitionSelections}
          />
          <div className={styles.editorRow}>
            <button
              className={styles.actionButton}
              disabled={!areTransitionSelectionsComplete(blockedMove.requiredFields, transitionSelections)}
              onClick={() => void handleSubmitBlockedMove()}
              type="button"
            >
              Complete the move
            </button>
            <button className={styles.actionButton} onClick={() => setBlockedMove(null)} type="button">
              Cancel
            </button>
          </div>
        </section>
      )}

      {openIssue !== null && (
        <section aria-label={`Details for ${openIssue.key}`} data-testid="rollup-issue-detail">
          <button className={styles.actionButton} onClick={() => setOpenIssueKey(null)} type="button">
            Close {openIssue.key}
          </button>
          {/* Editing delegates entirely to the shared editors: the board adds no write path of its
              own, so a field it cannot safely write simply stays read-only here as everywhere. */}
          <IssueDetailPanel
            fieldEditing={openIssueEditMeta
              ? { editMeta: openIssueEditMeta, onFieldSaved: () => void loadBoard() }
              : undefined}
            isEmbedded
            issue={openIssue}
            onIssueUpdated={() => void loadBoard()}
          />
        </section>
      )}

      <QuickFilterBar allItems={loadState.allItems} filters={filters} onFiltersChange={setFilters} />

      <div className={styles.boardScroller}>
        <BoardColumnHeaderRow
          columns={layout.columns}
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
          onDragEnd={(dragEndEvent) => void handleBoardDragEnd(dragEndEvent)}
          sensors={dragSensors}
        >
          <SortableContext items={allFeatureKeys} strategy={verticalListSortingStrategy}>
            {layout.lanes.map((lane) => (
            <MasterCardLane
              columns={layout.columns}
              errorMessageByIssueKey={errorMessageByIssueKey}
              hasActiveFilters={hasActiveFilters(filters)}
              highlightedFamilyKey={highlightedFamilyKey}
              key={lane.masterCard.featureKey}
              lane={lane}
              onOpenIssue={(issueKey) => void handleOpenIssue(issueKey)}
              onSelectFamily={(item) => setHighlightedFamilyKey(item.parentKey ?? item.key)}
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
