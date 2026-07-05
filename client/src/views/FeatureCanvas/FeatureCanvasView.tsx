// FeatureCanvasView.tsx — Top-level Feature Canvas view: scope guard, data wiring, and layout.
//
// This orchestrates the whole feature: it resolves the active team + PI scope, loads the feature
// set and the persisted planning overlay, joins them into canvas nodes, and lays out the board
// beside the coaching panel with the Review & Commit and (gated) AI panels. When no ART team is
// configured it shows the same guidance empty state the Feature Review surface uses.

import { useMemo, useState } from 'react';

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
import { CoachPanel } from './coach/CoachPanel.tsx';
import { AiSuggestionPanel } from './ai/AiSuggestionPanel.tsx';
import { ReviewCommitPanel } from './commit/ReviewCommitPanel.tsx';
import { computeContainerCapacity } from './logic/capacity.ts';
import type { ContainerCapacity } from './logic/canvasTypes.ts';
import { computeWipSnapshot } from './logic/wip.ts';
import { isSameFilter, type CanvasNodeFilter } from './logic/nodeFilter.ts';
import { createNodeState, type ContainerKind } from './overlay/overlayModel.ts';
import { createProvisionalContainer } from './overlay/containerFactory.ts';
import { deriveScopeKey } from './overlay/overlayStorage.ts';
import { useCanvasOverlay } from './overlay/useCanvasOverlay.ts';

/** A centered guidance message used by the empty/loading/error states. */
function CanvasMessage({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: 48, textAlign: 'center', opacity: 0.8 }}>{text}</div>;
}

/** The Feature Canvas view. Default export so it can be lazy-loaded from the router. */
export default function FeatureCanvasView(): React.JSX.Element {
  const profileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);
  const isAiUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);

  // A user-chosen PI for this exercise (step 1), overriding the active profile's PI when set. Null
  // means "use the profile default". Changing it re-scopes the overlay, commit target, and blueprint.
  const [piOverride, setPiOverride] = useState<string | null>(null);

  // Resolve scope first (no fetch) so the overlay key can be built before the working-set fetch.
  const scope = useCanvasScope(piOverride);
  const scopeKey = deriveScopeKey(scope.projectKey, scope.piName);
  const controller = useCanvasOverlay(profileId, scopeKey);
  const { overlay } = controller;

  // The curated working set is the overlay's node keys; the canvas fetches live data for exactly those.
  const workingSetKeys = useMemo(() => Object.keys(overlay.nodes), [overlay.nodes]);
  const features = useCanvasFeatures(workingSetKeys);

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isCommitOpen, setIsCommitOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
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

  const isWorkingSetEmpty = workingSetKeys.length === 0;

  // Step 1 — pick features from the reused blueprint. Short-circuits the board while active.
  if (isSelecting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 480 }}>
        <BlueprintSelectionStep
          teams={artRoster}
          selectedPiName={scope.piName}
          onPiChange={setPiOverride}
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
        <button type="button" className={controlStyles.btnPrimary} onClick={() => setIsSelecting(true)}>➕ Add features</button>
        <button type="button" className={controlStyles.btn} onClick={() => setIsPickerOpen(true)}>Add via JQL</button>
        <button type="button" className={controlStyles.btn} onClick={() => controller.undo()} disabled={!controller.canUndo} title="Undo the last canvas change">↩️ Undo</button>
        <button type="button" className={controlStyles.btn} onClick={() => controller.redo()} disabled={!controller.canRedo} title="Redo the last undone change">↪️ Redo</button>
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
        {scope.piName.trim() !== '' && <span style={{ fontSize: 12, opacity: 0.7 }}>PI: {scope.piName}</span>}
        {artRoster.length === 0 && <span style={{ fontSize: 12, opacity: 0.7 }}>No ART teams configured — use Add via JQL.</span>}
        {features.status === 'error' && <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)' }}>{features.error}</span>}
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
              {isAiOpen && (
                <AiSuggestionPanel canvasNodes={canvasNodes} controller={controller} wip={wip} onClose={() => setIsAiOpen(false)} />
              )}
            </div>
            <NodeInspectorPanel node={selectedNode} onClose={() => setSelectedIssueKey(null)} />
            <CoachPanel
              controller={controller}
              selectedNode={selectedNode}
              wip={wip}
              onAddContainer={(kind) => controller.addContainer(createProvisionalContainer(kind, overlay.containers.length))}
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
