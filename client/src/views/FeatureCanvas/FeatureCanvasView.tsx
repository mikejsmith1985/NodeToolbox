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
import { createNodeState, type CanvasContainer, type ContainerKind } from './overlay/overlayModel.ts';
import { deriveScopeKey } from './overlay/overlayStorage.ts';
import { useCanvasOverlay } from './overlay/useCanvasOverlay.ts';

/** Builds a provisional container box positioned in a lower band of the canvas. */
function createProvisionalContainer(kind: 'sprint' | 'release', existingCount: number): CanvasContainer {
  const columnIndex = existingCount % 3;
  return {
    id: `ctr-${Date.now()}-${kind}`,
    kind,
    title: kind === 'sprint' ? 'New sprint' : 'New release',
    bounds: { x: 40 + columnIndex * 440, y: 720, width: 400, height: 260 },
    capacityBudget: kind === 'sprint' ? 20 : null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}

/** A centered guidance message used by the empty/loading/error states. */
function CanvasMessage({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: 48, textAlign: 'center', opacity: 0.8 }}>{text}</div>;
}

/** The Feature Canvas view. Default export so it can be lazy-loaded from the router. */
export default function FeatureCanvasView(): React.JSX.Element {
  const profileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);
  const isAiUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);

  // Resolve scope first (no fetch) so the overlay key can be built before the working-set fetch.
  const scope = useCanvasScope();
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
        <button type="button" onClick={() => setIsSelecting(true)}>➕ Add features</button>
        <button type="button" onClick={() => setIsPickerOpen(true)}>Add via JQL</button>
        {artRoster.length === 0 && <span style={{ fontSize: 12, opacity: 0.7 }}>No ART teams configured — use Add via JQL.</span>}
        {features.status === 'error' && <span role="alert" style={{ fontSize: 12, color: '#ef4444' }}>{features.error}</span>}
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
                <AiSuggestionPanel canvasNodes={canvasNodes} controller={controller} onClose={() => setIsAiOpen(false)} />
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
