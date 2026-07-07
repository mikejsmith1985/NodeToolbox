// FeatureCanvasView.tsx — Top-level Feature Canvas view: scope guard, data wiring, and layout.
//
// This orchestrates the whole feature: it resolves the active team + PI scope, loads the feature
// set and the persisted planning overlay, joins them into canvas nodes, and lays out the board
// beside the coaching panel with the Review & Commit and (gated) AI panels. When no ART team is
// configured it shows the same guidance empty state the Feature Review surface uses.

import { useEffect, useMemo, useState } from 'react';

import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { FeatureCanvasBoard } from './canvas/FeatureCanvasBoard.tsx';
import { computeDefaultPosition, mapFeaturesToNodes } from './canvas/nodeMapping.ts';
import { SurfacePicker } from './canvas/SurfacePicker.tsx';
import { CanvasLegend } from './canvas/CanvasLegend.tsx';
import controlStyles from './canvas/canvasControls.module.css';
import { BlueprintSelectionStep } from './canvas/BlueprintSelectionStep.tsx';
import { NodeInspectorPanel } from './canvas/NodeInspectorPanel.tsx';
import { useCanvasFeatures } from './canvas/useCanvasFeatures.ts';
import { useCanvasScope } from './canvas/useCanvasScope.ts';
import { readStoredArtTeams } from '../SprintDashboard/sprintDashboardArtContext.ts';
import { loadDashboardConfigFromStorage } from '../SprintDashboard/hooks/useDashboardConfig.ts';
import { fetchTeamVelocity } from '../SprintDashboard/fetchTeamVelocity.ts';
import { CoachPanel } from './coach/CoachPanel.tsx';
import { AiSuggestionPanel } from './ai/AiSuggestionPanel.tsx';
import { WorkReallocationPanel } from './ai/WorkReallocationPanel.tsx';
import { CapacityPlanPanel } from './planner/CapacityPlanPanel.tsx';
import {
  filterRosterMembersByActiveTeam,
  useStandupRosterStore,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { ReviewCommitPanel } from './commit/ReviewCommitPanel.tsx';
import { StoryPlanningPanel } from './commit/StoryPlanningPanel.tsx';
import { computeContainerCapacity } from './logic/capacity.ts';
import type { ContainerCapacity } from './logic/canvasTypes.ts';
import { computeWipSnapshot } from './logic/wip.ts';
import { isSameFilter, type CanvasNodeFilter } from './logic/nodeFilter.ts';
import { daysRemainingInPi } from './logic/piSchedule.ts';
import { createNodeState, type ContainerKind } from './overlay/overlayModel.ts';
import { createProvisionalContainer, createRealSprintContainer } from './overlay/containerFactory.ts';
import { getBoardSprints } from '../../services/jiraApi.ts';
import { deriveScopeKey } from './overlay/overlayStorage.ts';
import { useCanvasOverlay } from './overlay/useCanvasOverlay.ts';

// Ultimate sprint-capacity fallback when there is neither a configured override nor a computed velocity.
const DEFAULT_SPRINT_CAPACITY_FALLBACK = 20;

/** A centered guidance message used by the empty/loading/error states. */
function CanvasMessage({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: 48, textAlign: 'center', opacity: 0.8 }}>{text}</div>;
}

/** The Feature Canvas view. Default export so it can be lazy-loaded from the router. */
export default function FeatureCanvasView(): React.JSX.Element {
  const profileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles);
  const setActiveTeamProfileId = useSettingsStore((state) => state.setSprintDashboardActiveTeamProfileId);
  const activeTeamName = useSettingsStore((state) => state.sprintDashboardActiveTeam);
  const allRosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const isAiUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);

  // Scope the shared roster store to THIS canvas's active team profile. The Team Dashboard scopes it
  // when it is open; without this the canvas could read a different profile's roster (people present
  // but their role capabilities missing), so the re-allocation planner saw everyone as "no roles".
  useEffect(() => {
    useStandupRosterStore.getState().setDashboardTeamProfileId(profileId);
  }, [profileId]);

  // The PI is the active team profile's selectedPiValue — the SAME source the Sprint Dashboard reads.
  // Step 1's PI picker writes here (not to transient state), so the choice persists across navigation
  // (the canvas isn't empty when you return) and stays in sync with the team's other tools.
  const updateActiveTeamProfile = useSettingsStore((state) => state.updateActiveSprintDashboardTeamProfile);
  const changePi = (piName: string): void => updateActiveTeamProfile({ selectedPiValue: piName });

  // Resolve scope first (no fetch) so the overlay key can be built before the working-set fetch.
  const scope = useCanvasScope();
  const scopeKey = deriveScopeKey(scope.projectKey, scope.piName);
  const controller = useCanvasOverlay(profileId, scopeKey);
  const { overlay } = controller;

  // The curated working set is the overlay's node keys; the canvas fetches live data for exactly those.
  const workingSetKeys = useMemo(() => Object.keys(overlay.nodes), [overlay.nodes]);
  // Use the active team's configured story-points field (same as the Sprint Dashboard) so child
  // points read the right field; otherwise everything looks unpointed and the AI plans on zero effort.
  const teamConfig = useMemo(() => loadDashboardConfigFromStorage(profileId), [profileId]);
  const customStoryPointsFieldId = teamConfig.customStoryPointsFieldId;
  // Sprint-box capacity resolution: a configured Sprint Point Capacity (>0) OVERRIDES everything;
  // otherwise use the team's real velocity (resolved when sprints are pulled); ultimate fallback 20.
  const [resolvedSprintCapacity, setResolvedSprintCapacity] = useState(teamConfig.sprintPointCapacity > 0 ? teamConfig.sprintPointCapacity : DEFAULT_SPRINT_CAPACITY_FALLBACK);
  const features = useCanvasFeatures(workingSetKeys, customStoryPointsFieldId);

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isCommitOpen, setIsCommitOpen] = useState(false);
  const [isStoryPlanOpen, setIsStoryPlanOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isReallocOpen, setIsReallocOpen] = useState(false);
  const [isCapacityPlanOpen, setIsCapacityPlanOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  // Legend focus filter: clicking a key entry dims the non-matching cards; clicking it again clears.
  const [activeFilter, setActiveFilter] = useState<CanvasNodeFilter | null>(null);
  const toggleFilter = (filter: CanvasNodeFilter): void => {
    setActiveFilter((current) => (isSameFilter(current, filter) ? null : filter));
  };

  const onCanvasKeys = useMemo(() => new Set(workingSetKeys), [workingSetKeys]);
  // Step 1 (blueprint selection) is fed the full ART roster so its per-team buckets match ART's counts.
  const artRoster = useMemo(() => readStoredArtTeams(), []);

  // Adding from the picker seeds a persisted node state per chosen key (additive; dedup is upstream),
  // which grows the working set and triggers the live fetch for the new features.
  const handleAddFeatures = (keys: string[]): void => {
    const existingCount = workingSetKeys.length;
    controller.ensureNodeStates(keys.map((key, index) => {
      const position = computeDefaultPosition(existingCount + index);
      return createNodeState(key, position.x, position.y);
    }));
  };

  const canvasNodes = useMemo(() => mapFeaturesToNodes(features.items, overlay), [features.items, overlay]);
  const capacities = useMemo(() => {
    const capacityByContainer = new Map<string, ContainerCapacity>();
    for (const container of overlay.containers) {
      capacityByContainer.set(container.id, computeContainerCapacity(container, canvasNodes));
    }
    return capacityByContainer;
  }, [overlay.containers, canvasNodes]);
  const wip = useMemo(() => computeWipSnapshot(canvasNodes, overlay.wipLimit), [canvasNodes, overlay.wipLimit]);

  // The active-team roster (with role capabilities) and the canvas's sprint boxes feed the gated
  // Work Re-Allocation planner — the roster is scoped exactly like the Team Dashboard's roster view.
  const reallocRoster = useMemo(
    () => filterRosterMembersByActiveTeam(allRosterMembers, activeTeamName, { includeTeamlessMembers: true }),
    [allRosterMembers, activeTeamName],
  );
  const sprintContainers = useMemo(
    () => overlay.containers.filter((container) => container.kind === 'sprint'),
    [overlay.containers],
  );

  const selectedNode = canvasNodes.find((node) => node.issueKey === selectedIssueKey) ?? null;

  const handleDropIntoContainer = (issueKey: string, containerId: string | null): void => {
    const container = containerId ? overlay.containers.find((candidate) => candidate.id === containerId) : null;
    if (container && container.kind === ('parkingLot' satisfies ContainerKind)) {
      controller.setParked(issueKey, true);
      controller.setContainer(issueKey, container.id);
      return;
    }
    controller.setContainer(issueKey, containerId);
    if (containerId) {
      controller.setParked(issueKey, false);
    }
  };

  // Pulls the board's real active/future sprints in as boxes (provenance 'real', so committing
  // assigns to the existing sprint instead of creating one). Skips sprints already on the canvas.
  const [sprintPullError, setSprintPullError] = useState<string | null>(null);
  const handlePullSprints = async (): Promise<void> => {
    setSprintPullError(null);
    if (scope.boardId === null) {
      setSprintPullError('No board configured for this team — cannot pull sprints.');
      return;
    }
    try {
      // Capacity defaults to the team's real velocity over the last N closed sprints; fall back to the
      // configured value for boards with no closed-sprint history. Resolved once, reused for later adds.
      const velocity = await fetchTeamVelocity(scope.boardId, teamConfig.sprintWindow).catch(() => null);
      // A configured capacity (>0) overrides the computed velocity; otherwise use velocity, else 20.
      const capacity = teamConfig.sprintPointCapacity > 0 ? teamConfig.sprintPointCapacity : (velocity ?? DEFAULT_SPRINT_CAPACITY_FALLBACK);
      setResolvedSprintCapacity(capacity);
      const sprints = await getBoardSprints(scope.boardId);
      const existingSprintIds = new Set(overlay.containers.map((container) => container.provenance.jiraSprintId).filter((id): id is number => id !== null));
      let boxCount = overlay.containers.length;
      for (const sprint of sprints) {
        if (existingSprintIds.has(sprint.id)) {
          continue;
        }
        controller.addContainer(createRealSprintContainer(sprint.id, sprint.name, boxCount, sprint.startDate ?? null, sprint.endDate ?? null, capacity));
        boxCount += 1;
      }
      if (sprints.length === 0) {
        setSprintPullError('No active or future sprints found on this board.');
      }
    } catch (pullError) {
      setSprintPullError(pullError instanceof Error ? pullError.message : 'Failed to load sprints from the board.');
    }
  };

  const isWorkingSetEmpty = workingSetKeys.length === 0;

  // Step 1 — pick features from the reused blueprint. Short-circuits the board while active.
  if (isSelecting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 480 }}>
        <BlueprintSelectionStep
          teams={artRoster}
          selectedPiName={scope.piName}
          onPiChange={changePi}
          onCanvasKeys={onCanvasKeys}
          onAdd={handleAddFeatures}
          onClose={() => setIsSelecting(false)}
          hasCanvas={!isWorkingSetEmpty}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 480 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
        {teamProfiles.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            Team:
            <select
              aria-label="Active team"
              value={profileId}
              onChange={(event) => setActiveTeamProfileId(event.target.value)}
              title="Swap the team this canvas plans (also the Sprint Dashboard's active team)"
            >
              {teamProfiles.map((teamProfile) => <option key={teamProfile.id} value={teamProfile.id}>{teamProfile.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className={controlStyles.btnPrimary} onClick={() => setIsSelecting(true)}>➕ Add features</button>
        <button type="button" className={controlStyles.btn} onClick={() => setIsPickerOpen(true)}>Add via JQL</button>
        <button type="button" className={controlStyles.btn} onClick={() => controller.undo()} disabled={!controller.canUndo} title="Undo the last canvas change">↩️ Undo</button>
        <button type="button" className={controlStyles.btn} onClick={() => controller.redo()} disabled={!controller.canRedo} title="Redo the last undone change">↪️ Redo</button>
        {overlay.containers.length > 0 && (
          <button type="button" className={controlStyles.btn} onClick={() => controller.relayoutBoxes()} title="Tidy boxes into two columns, each sized to its cards">🧹 Tidy boxes</button>
        )}
        {overlay.containers.some((container) => container.kind === 'sprint') && (
          <button type="button" className={controlStyles.btn} onClick={() => setIsStoryPlanOpen(true)} title="Plan each sprint at the story level — move child stories between boxes">🧩 Plan stories</button>
        )}
        {isAiUnlocked && !isWorkingSetEmpty && (
          <button type="button" className={controlStyles.btn} onClick={() => setIsReallocOpen(true)} title="Generate a role-aware work re-allocation prompt for a target sprint (copy into your assistant)">⚖️ Re-allocation plan</button>
        )}
        {!isWorkingSetEmpty && (
          <button type="button" className={controlStyles.btn} onClick={() => setIsCapacityPlanOpen(true)} title="Build a deterministic, read-only capacity plan from the selected priority buckets and the team roster">📅 Build capacity plan</button>
        )}
        {!isWorkingSetEmpty && (
          <button
            type="button"
            className={controlStyles.btn}
            onClick={() => {
              if (window.confirm(`Reset the canvas? This removes all ${workingSetKeys.length} feature(s) and every box, clears the WIP limit, and resets the 5 phases. It changes nothing in Jira.`)) {
                controller.clearNodes();
                setSelectedIssueKey(null);
              }
            }}
          >
            🗑 Clear canvas
          </button>
        )}
        <CanvasLegend activeFilter={activeFilter} onToggleFilter={toggleFilter} />
        {scope.piName.trim() !== '' && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            PI: {scope.piName}
            {(() => {
              // Days-to-PI-end (from the PI name's date range) — the same time signal fed to the AI.
              const daysLeft = daysRemainingInPi(scope.piName, new Date().toISOString().slice(0, 10));
              if (daysLeft === null) {
                return null;
              }
              return <span style={{ marginLeft: 6 }}>· {daysLeft < 0 ? 'PI ended' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}</span>;
            })()}
          </span>
        )}
        {artRoster.length === 0 && <span style={{ fontSize: 12, opacity: 0.7 }}>No ART teams configured — use Add via JQL.</span>}
        {features.status === 'error' && <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)' }}>{features.error}</span>}
        {sprintPullError !== null && <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)' }}>{sprintPullError}</span>}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {isPickerOpen && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 40 }}>
            <SurfacePicker
              piName={scope.piName}
              projectKey={scope.projectKey}
              onCanvasKeys={onCanvasKeys}
              defaultJql={scope.defaultJql}
              onAdd={handleAddFeatures}
              onClose={() => setIsPickerOpen(false)}
            />
          </div>
        )}
        {features.status === 'loading' ? (
          <CanvasMessage text="Loading features…" />
        ) : isWorkingSetEmpty ? (
          <CanvasMessage text="Add features to begin — click “Add features” to pull work from the blueprint onto the canvas." />
        ) : (
          <>
            <div style={{ position: 'relative', flex: 1 }}>
              <FeatureCanvasBoard
                canvasNodes={canvasNodes}
                containers={overlay.containers}
                capacities={capacities}
                filter={activeFilter}
                onSelect={setSelectedIssueKey}
                onPositionChange={(issueKey, x, y) => controller.updateNode(issueKey, { position: { x, y } })}
                onDropIntoContainer={handleDropIntoContainer}
                onDeleteContainer={(containerId) => controller.removeContainer(containerId)}
                onDeleteNode={(issueKey) => {
                  controller.removeNode(issueKey);
                  if (selectedIssueKey === issueKey) {
                    setSelectedIssueKey(null);
                  }
                }}
                onMoveContainer={(containerId, x, y) => controller.moveContainer(containerId, x, y)}
                onResizeContainer={(containerId, bounds) => controller.updateContainer(containerId, { bounds })}
              />
              {isCommitOpen && (
                <ReviewCommitPanel
                  canvasNodes={canvasNodes}
                  containers={overlay.containers}
                  sizeMapping={overlay.sizeMapping}
                  boardId={scope.boardId}
                  projectKey={scope.projectKey}
                  onClose={() => setIsCommitOpen(false)}
                />
              )}
              {isStoryPlanOpen && (
                <StoryPlanningPanel canvasNodes={canvasNodes} controller={controller} onClose={() => setIsStoryPlanOpen(false)} />
              )}
              {isAiOpen && (
                <AiSuggestionPanel
                  canvasNodes={canvasNodes}
                  controller={controller}
                  wip={wip}
                  piName={scope.piName}
                  onEnsureSprints={() => {
                    // Master plan asks for this when no sprints exist yet — pull the board's real ones.
                    if (scope.boardId !== null && !overlay.containers.some((container) => container.kind === 'sprint')) {
                      void handlePullSprints();
                    }
                  }}
                  onClose={() => setIsAiOpen(false)}
                />
              )}
              {isReallocOpen && (
                <WorkReallocationPanel
                  canvasNodes={canvasNodes}
                  sprintContainers={sprintContainers}
                  rosterMembers={reallocRoster}
                  piName={scope.piName}
                  teamProfileId={profileId}
                  projectKey={scope.projectKey}
                  onClose={() => setIsReallocOpen(false)}
                />
              )}
              {isCapacityPlanOpen && (
                <CapacityPlanPanel
                  canvasNodes={canvasNodes}
                  rosterMembers={reallocRoster}
                  projectKey={scope.projectKey}
                  piName={scope.piName}
                  storyPointsFieldId={customStoryPointsFieldId}
                  onClose={() => setIsCapacityPlanOpen(false)}
                />
              )}
            </div>
            <NodeInspectorPanel
              node={selectedNode}
              onClose={() => setSelectedIssueKey(null)}
              onSetPriority={(issueKey, priority) => controller.setPriority(issueKey, priority)}
              onSetSize={(issueKey, size) => controller.setSize(issueKey, size)}
              onSetComment={(issueKey, comment) => controller.updateNode(issueKey, { pendingComment: comment })}
            />
            <CoachPanel
              controller={controller}
              selectedNode={selectedNode}
              wip={wip}
              onAddContainer={(kind) => controller.addContainer(createProvisionalContainer(kind, overlay.containers.length, undefined, resolvedSprintCapacity))}
              onPullSprints={() => void handlePullSprints()}
              onOpenCommit={() => setIsCommitOpen(true)}
              isAiUnlocked={isAiUnlocked}
              onOpenAi={() => setIsAiOpen(true)}
            />
          </>
        )}
      </div>
    </div>
  );
}
