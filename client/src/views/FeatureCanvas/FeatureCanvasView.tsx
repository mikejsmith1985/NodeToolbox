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
import { collectMissingNodeStates, mapFeaturesToNodes } from './canvas/nodeMapping.ts';
import { SurfaceScopeBar } from './canvas/SurfaceScopeBar.tsx';
import { NlToJqlControl } from './canvas/NlToJqlControl.tsx';
import { applyScopeFilters, EMPTY_SCOPE_FILTERS, type ScopeFilters } from './canvas/scopeQuery.ts';
import { useCanvasFeatures } from './canvas/useCanvasFeatures.ts';
import { CoachPanel } from './coach/CoachPanel.tsx';
import { AiSuggestionPanel } from './ai/AiSuggestionPanel.tsx';
import { ReviewCommitPanel } from './commit/ReviewCommitPanel.tsx';
import { computeContainerCapacity } from './logic/capacity.ts';
import type { ContainerCapacity } from './logic/canvasTypes.ts';
import { computeWipSnapshot } from './logic/wip.ts';
import type { CanvasContainer, ContainerKind } from './overlay/overlayModel.ts';
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
  const features = useCanvasFeatures();
  const scopeKey = deriveScopeKey(features.projectKey, features.piName);
  const controller = useCanvasOverlay(profileId, scopeKey);
  const { overlay } = controller;

  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isCommitOpen, setIsCommitOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [filters, setFilters] = useState<ScopeFilters>(EMPTY_SCOPE_FILTERS);

  // Give every newly-surfaced feature a persisted position so the arrangement survives reloads.
  useEffect(() => {
    if (features.status === 'ready') {
      controller.ensureNodeStates(collectMissingNodeStates(features.items, overlay));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features.status, features.items, scopeKey]);

  const canvasNodes = useMemo(() => mapFeaturesToNodes(features.items, overlay), [features.items, overlay]);
  // Refine filters narrow only what the board shows; WIP/capacity/selection still see the full set,
  // and the overlay arrangement of filtered-out features is retained for when the filter clears.
  const filteredKeys = useMemo(
    () => new Set(applyScopeFilters(features.items, filters).map((item) => item.feature.key)),
    [features.items, filters],
  );
  const boardNodes = useMemo(() => canvasNodes.filter((node) => filteredKeys.has(node.issueKey)), [canvasNodes, filteredKeys]);
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

  // Without a configured ART team there is nothing to scope a query against, so keep the guidance
  // empty state as a full-view message (no scope bar).
  if (features.status === 'no-team') {
    return <CanvasMessage text="Configure an ART team for this board (in ART settings) to surface its features on the canvas." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 480 }}>
      <SurfaceScopeBar
        jql={features.jql}
        onJqlChange={features.setJql}
        onSurface={features.surface}
        filters={filters}
        onFiltersChange={setFilters}
        status={features.status}
        error={features.error}
        resultCount={boardNodes.length}
        aiHelperSlot={<NlToJqlControl projectKey={features.projectKey} piName={features.piName} onAcceptJql={features.setJql} />}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {features.status === 'loading' ? (
          <CanvasMessage text="Surfacing features…" />
        ) : (
          <>
            <div style={{ position: 'relative', flex: 1 }}>
              <FeatureCanvasBoard
                canvasNodes={boardNodes}
                containers={overlay.containers}
                capacities={capacities}
                onSelect={setSelectedIssueKey}
                onPositionChange={(issueKey, x, y) => controller.updateNode(issueKey, { position: { x, y } })}
                onDropIntoContainer={handleDropIntoContainer}
                onDeleteContainer={(containerId) => controller.removeContainer(containerId)}
              />
              {isCommitOpen && (
                <ReviewCommitPanel
                  canvasNodes={canvasNodes}
                  containers={overlay.containers}
                  sizeMapping={overlay.sizeMapping}
                  boardId={features.boardId}
                  projectKey={features.projectKey}
                  onClose={() => setIsCommitOpen(false)}
                />
              )}
              {isAiOpen && (
                <AiSuggestionPanel canvasNodes={canvasNodes} controller={controller} onClose={() => setIsAiOpen(false)} />
              )}
            </div>
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
