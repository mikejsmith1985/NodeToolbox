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
import type { JiraIssue } from '../../../types/jira.ts';
import { loadConfiguredFeatureLinkFieldId } from '../../../utils/featureLink.ts';
import { createIssue, createIssueLink, getProjectIssueTypes, jiraGet, jiraPut } from '../../../services/jiraApi.ts';
import type { CreateMetaIssueType } from '../../../types/jira.ts';
import { buildJqlFieldReference, loadHygieneFieldConfig, readConfiguredPiFieldId } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  fetchFeatureReviewEditMeta,
  getStoryPointsCandidateFieldIds,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewTransition,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../featureReviewFixes.ts';
import { buildRenderedColumns, resolveColumnIdForItem } from './boardColumns.ts';
import {
  describeStatusPair,
  describeUnmappedStatusGroup,
  summarizeUnmappedStatuses,
} from './unmappedStatusSummary.ts';
import { EMPTY_QUICK_FILTER_STATE, hasActiveFilters } from './boardFilters.ts';
import { buildBoardLayout } from './boardLayout.ts';
import {
  clearManualOrder,
  hasManualOrder,
  loadBoardPreferences,
  moveCardBefore,
  moveLaneBefore,
  moveLaneToEnd,
  moveLaneToRank,
  saveBoardPreferences,
  setAllLanesCollapsed,
  toggleLaneCollapsed,
} from './boardPreferencesStore.ts';
import { loadTeamVocabulary, markVocabularySynced, saveTeamVocabulary } from './boardVocabularyStore.ts';
import { previewBoardVocabularyPull, publishBoardVocabulary, type VocabularyPullPreview } from './boardVocabularySync.ts';
import { parseCardTargetId, resolveCardDrop, resolveCardDropZone } from './cardDropRouting.ts';
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
import { selectDetailIssueKeys, selectVisibleColumns, toggleColumnFocus } from './columnFocus.ts';
import {
  COLUMN_DENSITY_LABELS,
  DEFAULT_COLUMN_DENSITY,
  describeColumnFit,
  readColumnMinWidth,
  type ColumnDensity,
} from './columnDensity.ts';
import {
  diagnoseMoveBlock,
  matchEditMetaFieldsByName,
  type MoveBlockDiagnosis,
} from './moveBlockDiagnosis.ts';
import { MoveBlockedDialog } from './components/MoveBlockedDialog.tsx';
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
import { MasterCardLane } from './components/MasterCardLane.tsx';
import { PlacementTroubleshooter } from './components/PlacementTroubleshooter.tsx';
import { QuickFilterBar } from './components/QuickFilterBar.tsx';
import styles from './RollupBoardTab.module.css';
import {
  EXPECTED_BOARD_ISSUE_CEILING,
  NO_FEATURE_KEY,
  UNMAPPED_COLUMN_ID,
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

    if (carryOverScope.featureKeys.length > 0) {
      notices.push({
        id: 'carry-over',
        tone: 'info',
        summary: `↩ ${describeCarryOverScope(carryOverScope)}`,
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
  }, [loadState, sprintPiGap, carryOverScope, featuresWithoutWork, unmappedStatusGroups]);

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

  const layout = useMemo(
    () => buildBoardLayout({ masterCards: laneMasterCards, columns: visibleColumns, filters, preferences }),
    [laneMasterCards, visibleColumns, filters, preferences],
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
  const handleCardDrop = useCallback(async (dragEndEvent: DragEndEvent): Promise<void> => {
    // Where the dragged card came to rest inside the target decides between sequencing and nesting.
    // Both rectangles come from the drag event, so no extra pointer tracking is needed.
    const draggedRect = dragEndEvent.active.rect.current.translated;
    const targetRect = dragEndEvent.over?.rect ?? null;
    const cardDropZone = draggedRect && targetRect
      ? resolveCardDropZone(draggedRect.top + draggedRect.height / 2, targetRect.top, targetRect.height)
      : undefined;

    const decision = resolveCardDrop({
      draggedItemKey: String(dragEndEvent.active.id),
      dropTargetId: dragEndEvent.over ? String(dragEndEvent.over.id) : null,
      itemsByKey: new Map(loadState.allItems.map((item) => [item.key, item])),
      columnsById: new Map(renderedColumns.map((column) => [column.id, column])),
      cardDropZone,
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
      const moveInput: ExecuteStatusMoveInput = {
        issueKey: decision.item.key,
        currentStatusName: decision.item.statusName,
        currentSubStatusValue: decision.item.subStatusValue,
        // A column can claim several statuses; a drop writes the first one it claims.
        targetMapping: decision.targetColumn.mappings[0],
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
      return;
    }

    setOpenIssueKey(issueKey);
    setOpenIssueEditMeta(await fetchFeatureReviewEditMeta(issueKey).catch(() => null));
  }, [openIssueKey]);

  /**
   * The Feature whose lane the open issue sits in, so its detail can be shown THERE.
   *
   * The panel used to render at the top of the page. On a board tall enough to need scrolling — which
   * is every real board — that meant clicking a card was a scroll up to read it and a scroll back down
   * to find your place again, for every single issue.
   */
  const openIssueLaneFeatureKey = useMemo(
    () => loadState.allItems.find((item) => item.key === openIssueKey)?.featureKey ?? null,
    [loadState.allItems, openIssueKey],
  );

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
        {/* Sits on the toolbar rather than inside Board setup because it is the answer to a problem
            people hit on their first look at the board — too many columns for the screen — and the
            reflex fix for that is the browser's zoom control, which shrinks the whole app instead. */}
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

      {/* A load failure is not a notice — it means there is no board — so it stays on its own. */}
      {loadState.loadError !== null && (
        <p className={styles.boardWarning}>Could not load the board: {loadState.loadError}</p>
      )}

      {/* Everything else the board wants to say, in ONE collapsible box. Nine stacked boxes pushed the
          board itself off the screen, and buried whatever was rendered among them — which is how the
          add-work dialog came to look like a button that did nothing. */}
      <BoardNotices notices={boardNotices} />

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
          carryOverPiValue={featureScope.carryOverPiValue}
          featureLinkFieldId={loadConfiguredFeatureLinkFieldId()}
          featureProjectKeys={featureScope.featureProjectKeys}
          piFieldId={readConfiguredPiFieldId()}
          selectedPiValue={selectedPiValue ?? ''}
          teamFeatureLabel={featureScope.teamFeatureLabel}
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

      <QuickFilterBar allItems={loadState.allItems} filters={filters} onFiltersChange={setFilters} />

      <div className={styles.boardScroller}>
        <BoardColumnHeaderRow
          columnMinWidth={columnMinWidth}
          columns={layout.columns}
          focusedColumnId={focusedColumnId}
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
          onDragEnd={(dragEndEvent) => void handleBoardDragEnd(dragEndEvent)}
          sensors={dragSensors}
        >
          <SortableContext items={allFeatureKeys} strategy={verticalListSortingStrategy}>
            {layout.lanes.map((lane, laneIndex) => (
            <MasterCardLane
              cardDetailByIssueKey={cardDetailByIssueKey}
              columnMinWidth={columnMinWidth}
              columns={layout.columns}
              inlineDetail={openIssue !== null && lane.masterCard.featureKey === openIssueLaneFeatureKey
                ? (
                  <section aria-label={`Details for ${openIssue.key}`} data-testid="rollup-issue-detail">
                    <p className={styles.inlineDetailHint}>
                      Click {openIssue.key} again to close this.
                    </p>
                    {/* Editing delegates entirely to the shared editors: the board adds no write path
                        of its own, so a field it cannot safely write stays read-only here as
                        everywhere. */}
                    <IssueDetailPanel
                      fieldEditing={openIssueEditMeta
                        ? { editMeta: openIssueEditMeta, onFieldSaved: () => void loadBoard() }
                        : undefined}
                      isEmbedded
                      issue={openIssue}
                      onIssueUpdated={() => void loadBoard()}
                    />
                  </section>
                )
                : null}
              errorMessageByIssueKey={errorMessageByIssueKey}
              hasActiveFilters={hasActiveFilters(filters)}
              highlightedFamilyKey={highlightedFamilyKey}
              key={lane.masterCard.featureKey}
              featureReadFailureDetail={loadState.featureReadFailures
                .find((failure) => failure.featureKey === lane.masterCard.featureKey)?.detail ?? null}
              lane={lane}
              laneRank={laneIndex + 1}
              onRankChange={(laneFeatureKey, nextRank) =>
                applyPreferences(moveLaneToRank(preferences, laneFeatureKey, nextRank, allFeatureKeys))}
              onAddWork={projectKey !== ''
                ? (laneFeatureKey, laneSummary) => void openAddWork(laneFeatureKey, laneSummary)
                : undefined}
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
