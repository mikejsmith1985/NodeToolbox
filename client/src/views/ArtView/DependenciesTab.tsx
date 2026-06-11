// DependenciesTab.tsx — Legacy-style ART dependency graph built from the Blueprint hierarchy query chain.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  DependencyDirectionFilter,
  DependencyFilterState,
  DependencyGraphEdge,
  DependencyGraphNode,
  DependencyGraphData,
  DependencySourceIssue,
} from './dependencyGraph.ts';
import {
  buildDependencyGraphData,
  computeDependencyGraphLayout,
  createDefaultDependencyFilterState,
  filterDependencyGraphData,
} from './dependencyGraph.ts';
import { fetchBlueprintDependencySourceIssues } from './blueprintHierarchy.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import styles from './DependenciesTab.module.css';

interface DependenciesTabProps {
  teams: ArtTeam[];
  selectedPiName: string;
}

interface ArtAdvancedSettings {
  depLinkTypes?: string[];
}

interface DependencyDetailDrawerProps {
  dependencyGraphData: DependencyGraphData;
  selectedNodeKey: string;
  onClose: () => void;
  onSelectNode: (nodeKey: string) => void;
}

const ART_DEP_FILTER_STORAGE_KEY = 'tbxARTDepFilter';
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_DEPENDENCY_LINK_TYPES = ['blocks', 'is blocked by', 'depends on', 'is depended on by', 'relates to'];
const JIRA_BROWSE_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const NODE_WIDTH = 136;
const NODE_HEIGHT = 40;
const NODE_RADIUS = 10;
const DONE_NODE_FILL_COLOR = '#64748b';
const BUG_NODE_FILL_COLOR = '#ef4444';
const PROGRAM_EPIC_NODE_FILL_COLOR = '#7c3aed';
const FEATURE_NODE_FILL_COLOR = '#0ea5e9';
const STORY_NODE_FILL_COLOR = '#22c55e';

function readArtSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

function readConfiguredDependencyLinkTypes(): string[] {
  const configuredTypes = readArtSettings().depLinkTypes ?? [];
  return configuredTypes.length > 0 ? configuredTypes : DEFAULT_DEPENDENCY_LINK_TYPES;
}

function readPersistedDependencyFilterState(): DependencyFilterState {
  const defaultFilterState = createDefaultDependencyFilterState();
  try {
    const storedFilterState = JSON.parse(localStorage.getItem(ART_DEP_FILTER_STORAGE_KEY) || '{}') as Partial<DependencyFilterState>;
    return {
      ...defaultFilterState,
      ...storedFilterState,
    };
  } catch {
    return defaultFilterState;
  }
}

function persistDependencyFilterState(filterState: DependencyFilterState): void {
  localStorage.setItem(ART_DEP_FILTER_STORAGE_KEY, JSON.stringify(filterState));
}

function readTeamOptions(teams: ArtTeam[]): Array<{ key: string; label: string }> {
  return teams
    .filter((team) => Boolean(team.projectKey?.trim()))
    .map((team) => ({
      key: team.projectKey!.trim().toUpperCase(),
      label: team.name,
    }));
}

function readNodeStatusTone(statusName: string): { backgroundColor: string; color: string } {
  const normalizedStatusName = statusName.toLowerCase();
  if (['done', 'closed', 'resolved', 'complete', 'completed'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return { backgroundColor: 'var(--color-tone-success-bg)', color: 'var(--color-tone-success-fg)' };
  }

  if (['in progress', 'in review', 'in development'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return { backgroundColor: 'var(--color-tone-info-bg)', color: 'var(--color-tone-info-fg)' };
  }

  if (['blocked', 'impediment'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return { backgroundColor: 'var(--color-tone-danger-bg)', color: 'var(--color-tone-danger-fg)' };
  }

  return { backgroundColor: 'var(--color-tone-neutral-bg)', color: 'var(--color-tone-neutral-fg)' };
}

function readNodeFillColor(node: DependencyGraphNode): string {
  if (['done', 'closed', 'resolved', 'complete', 'completed'].some((keyword) => node.status.toLowerCase().includes(keyword))) {
    return DONE_NODE_FILL_COLOR;
  }

  if (node.issueType.toLowerCase().includes('bug') || node.issueType.toLowerCase().includes('defect')) {
    return BUG_NODE_FILL_COLOR;
  }

  if (node.nodeType === 'pe') {
    return PROGRAM_EPIC_NODE_FILL_COLOR;
  }

  if (node.nodeType === 'feature') {
    return FEATURE_NODE_FILL_COLOR;
  }

  return STORY_NODE_FILL_COLOR;
}

function readEdgeStrokeColor(edge: DependencyGraphEdge): string {
  if (edge.isBlocking) {
    return 'var(--color-danger)';
  }

  if (edge.isCrossTeam) {
    return 'var(--color-warning)';
  }

  return 'var(--color-text-secondary)';
}

function createDependencyEdgePath(
  fromCenterX: number,
  fromCenterY: number,
  toCenterX: number,
  toCenterY: number,
): string {
  const midpointX = (fromCenterX + toCenterX) / 2;
  return `M ${fromCenterX} ${fromCenterY} C ${midpointX} ${fromCenterY}, ${midpointX} ${toCenterY}, ${toCenterX} ${toCenterY}`;
}

function createChipLabel(count: number, singularLabel: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
}

function createFilterStatePatch(
  currentFilterState: DependencyFilterState,
  patch: Partial<DependencyFilterState>,
): DependencyFilterState {
  const nextFilterState = {
    ...currentFilterState,
    ...patch,
  };

  if (patch.focusMode === 'all') {
    nextFilterState.focusFeatureKey = '';
    nextFilterState.focusProgramEpicKey = '';
    nextFilterState.focusTeamProjectKey = '';
    nextFilterState.focusTeamPeerProjectKey = '';
  }

  return nextFilterState;
}

function DependencyFocusButtons({
  filterState,
  onChangeFilterState,
}: {
  filterState: DependencyFilterState;
  onChangeFilterState: (patch: Partial<DependencyFilterState>) => void;
}) {
  const focusModeButtons: Array<{ key: DependencyFilterState['focusMode']; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'feature', label: 'By Feature' },
    { key: 'program-epic', label: 'By Program Epic' },
    { key: 'team', label: 'By Team' },
    { key: 'team-pair', label: 'Team→Team' },
  ];

  return (
    <div className={styles.focusButtonRow}>
      <span className={styles.controlLabel}>Focus</span>
      {focusModeButtons.map((focusModeButton) => (
        <button
          key={focusModeButton.key}
          className={`${styles.focusButton} ${filterState.focusMode === focusModeButton.key ? styles.focusButtonActive : ''}`}
          onClick={() => onChangeFilterState({ focusMode: focusModeButton.key })}
          type="button"
        >
          {focusModeButton.label}
        </button>
      ))}
    </div>
  );
}

function DirectionButtonGroup({
  directionFilter,
  onChangeDirectionFilter,
}: {
  directionFilter: DependencyDirectionFilter;
  onChangeDirectionFilter: (directionFilter: DependencyDirectionFilter) => void;
}) {
  const directionButtons: Array<{ key: DependencyDirectionFilter; label: string }> = [
    { key: 'inbound', label: 'Inbound' },
    { key: 'both', label: 'Both' },
    { key: 'outbound', label: 'Outbound' },
  ];

  return (
    <div className={styles.directionButtonGroup}>
      {directionButtons.map((directionButton) => (
        <button
          key={directionButton.key}
          className={`${styles.directionButton} ${directionFilter === directionButton.key ? styles.directionButtonActive : ''}`}
          onClick={() => onChangeDirectionFilter(directionButton.key)}
          type="button"
        >
          {directionButton.label}
        </button>
      ))}
    </div>
  );
}

function DependencyDetailDrawer({
  dependencyGraphData,
  selectedNodeKey,
  onClose,
  onSelectNode,
}: DependencyDetailDrawerProps) {
  const selectedNode = dependencyGraphData.nodes.find((node) => node.key === selectedNodeKey);
  if (!selectedNode) {
    return null;
  }

  const relatedEdges = dependencyGraphData.edges.filter((edge) => edge.fromKey === selectedNodeKey || edge.toKey === selectedNodeKey);
  const statusTone = readNodeStatusTone(selectedNode.status);

  return (
    <aside aria-label="Dependency Details" className={styles.detailDrawer} role="complementary">
      <div className={styles.detailDrawerHeader}>
        <div>
          <h3 className={styles.detailDrawerTitle}>{selectedNode.key}</h3>
          <p className={styles.detailDrawerSummary}>{selectedNode.summary}</p>
        </div>
        <button aria-label="Close dependency details" className={styles.closeButton} onClick={onClose} type="button">×</button>
      </div>
      <div className={styles.detailMetaRow}>
        <span className={styles.detailMetaChip}>{selectedNode.issueType}</span>
        {selectedNode.teamName && <span className={styles.detailMetaChip}>{selectedNode.teamName}</span>}
        <span className={styles.detailMetaChip} style={statusTone}>{selectedNode.status}</span>
      </div>
      <a className={styles.issueLink} href={`${JIRA_BROWSE_PREFIX}${selectedNode.key}`} rel="noreferrer" target="_blank">
        Open in Jira
      </a>

      <div className={styles.relatedEdgesSection}>
        <h4 className={styles.relatedEdgesTitle}>Related Dependencies</h4>
        {relatedEdges.length === 0 && (
          <p className={styles.emptyDrawerState}>This issue has no dependency edges in the loaded graph.</p>
        )}
        {relatedEdges.map((edge) => {
          const isOutgoingEdge = edge.fromKey === selectedNodeKey;
          const otherNodeKey = isOutgoingEdge ? edge.toKey : edge.fromKey;
          return (
            <div className={styles.relatedEdgeRow} key={edge.id}>
              <button className={styles.relatedIssueButton} onClick={() => onSelectNode(otherNodeKey)} type="button">
                {isOutgoingEdge ? '→' : '←'} {otherNodeKey}
              </button>
              <span className={styles.relatedEdgeType}>{edge.typeName}</span>
              {edge.isCrossTeam && <span className={styles.badgeOrange}>Cross-team</span>}
              {edge.isBlocking && <span className={styles.badgeRed}>Blocking</span>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function DependencyGraphLegend() {
  return (
    <div aria-label="Dependency graph legend" className={styles.graphLegend} role="group">
      <div className={styles.legendSection}>
        <span className={styles.legendLabel}>Nodes</span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSwatch} style={{ backgroundColor: PROGRAM_EPIC_NODE_FILL_COLOR }} />
          Program Epic
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSwatch} style={{ backgroundColor: FEATURE_NODE_FILL_COLOR }} />
          Feature
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSwatch} style={{ backgroundColor: STORY_NODE_FILL_COLOR }} />
          Story
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSwatch} style={{ backgroundColor: BUG_NODE_FILL_COLOR }} />
          Bug / Defect
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSwatch} style={{ backgroundColor: DONE_NODE_FILL_COLOR, opacity: 0.45 }} />
          Done
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendNodeSwatch} ${styles.legendOffTrainSwatch}`} />
          Off-train
        </span>
      </div>
      <div className={styles.legendSection}>
        <span className={styles.legendLabel}>Lines</span>
        <span className={styles.legendItem}>
          <svg aria-hidden="true" className={styles.legendEdgeSample} viewBox="0 0 40 10">
            <line stroke="var(--color-text-secondary)" strokeWidth="2.5" x1="2" x2="38" y1="5" y2="5" />
          </svg>
          Same-team
        </span>
        <span className={styles.legendItem}>
          <svg aria-hidden="true" className={styles.legendEdgeSample} viewBox="0 0 40 10">
            <line stroke="var(--color-warning)" strokeWidth="2.5" x1="2" x2="38" y1="5" y2="5" />
          </svg>
          Cross-team
        </span>
        <span className={styles.legendItem}>
          <svg aria-hidden="true" className={styles.legendEdgeSample} viewBox="0 0 40 10">
            <line stroke="var(--color-danger)" strokeDasharray="7 4" strokeWidth="2.5" x1="2" x2="38" y1="5" y2="5" />
          </svg>
          Blocking
        </span>
      </div>
    </div>
  );
}

/** Renders the legacy dependency graph and filters using the Blueprint-backed issue hierarchy. */
export default function DependenciesTab({ teams, selectedPiName }: DependenciesTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [dependencySourceIssues, setDependencySourceIssues] = useState<DependencySourceIssue[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<DependencyFilterState>(readPersistedDependencyFilterState);
  const lastAutoLoadKeyRef = useRef('');

  useEffect(() => {
    persistDependencyFilterState(filterState);
  }, [filterState]);

  const teamOptions = useMemo(() => readTeamOptions(teams), [teams]);
  const configuredLinkTypes = useMemo(() => readConfiguredDependencyLinkTypes(), []);
  const hasNoPiSelected = !selectedPiName.trim();
  const hasNoTeams = teams.length === 0;

  const dependencyGraphData = useMemo(() => {
    if (!dependencySourceIssues) {
      return null;
    }

    return buildDependencyGraphData(dependencySourceIssues, configuredLinkTypes, teamOptions);
  }, [configuredLinkTypes, dependencySourceIssues, teamOptions]);

  const filteredGraph = useMemo(() => {
    if (!dependencyGraphData) {
      return null;
    }

    return filterDependencyGraphData(dependencyGraphData, filterState);
  }, [dependencyGraphData, filterState]);

  const dependencyGraphLayout = useMemo(() => {
    if (!filteredGraph) {
      return null;
    }

    return computeDependencyGraphLayout(filteredGraph.visibleNodes, teamOptions);
  }, [filteredGraph, teamOptions]);

  const nodesByKey = useMemo(
    () => new Map((dependencyGraphData?.nodes ?? []).map((node) => [node.key, node])),
    [dependencyGraphData],
  );

  const graphStats = useMemo(() => {
    if (!dependencyGraphData) {
      return null;
    }

    const crossTeamCount = dependencyGraphData.edges.filter((edge) => edge.isCrossTeam).length;
    const blockingCount = dependencyGraphData.edges.filter((edge) => edge.isBlocking).length;
    const offTrainCount = dependencyGraphData.edges.filter((edge) => {
      const fromNode = nodesByKey.get(edge.fromKey);
      const toNode = nodesByKey.get(edge.toKey);
      return Boolean(fromNode && toNode && (!fromNode.inTeam || !toNode.inTeam));
    }).length;

    return {
      totalEdgeCount: dependencyGraphData.edges.length,
      crossTeamCount,
      blockingCount,
      offTrainCount,
    };
  }, [dependencyGraphData, nodesByKey]);

  const handleLoadDependencies = useCallback(async () => {
    if (hasNoPiSelected || hasNoTeams) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setSelectedNodeKey(null);
    try {
      const loadedSourceIssues = await fetchBlueprintDependencySourceIssues(teams, selectedPiName);
      setDependencySourceIssues(loadedSourceIssues);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load dependencies');
    } finally {
      setIsLoading(false);
    }
  }, [hasNoPiSelected, hasNoTeams, selectedPiName, teams]);

  useEffect(() => {
    if (hasNoPiSelected || hasNoTeams) {
      return;
    }

    const autoLoadKey = `${selectedPiName}|${teams.map((team) => `${team.id}:${team.boardId}`).join(',')}`;
    if (lastAutoLoadKeyRef.current === autoLoadKey) {
      return;
    }

    lastAutoLoadKeyRef.current = autoLoadKey;
    void handleLoadDependencies();
  }, [handleLoadDependencies, hasNoPiSelected, hasNoTeams, selectedPiName, teams]);

  function handleChangeFilterState(patch: Partial<DependencyFilterState>) {
    setFilterState((currentFilterState) => createFilterStatePatch(currentFilterState, patch));
  }

  function handleResetFilters() {
    setFilterState(createDefaultDependencyFilterState());
  }

  if (hasNoPiSelected) {
    return (
      <div className={styles.dependenciesTab}>
        <p className={styles.warningText}>No PI selected. Choose a PI from the selector above to enable the dependency map.</p>
      </div>
    );
  }

  if (hasNoTeams) {
    return (
      <div className={styles.dependenciesTab}>
        <p className={styles.warningText}>No teams configured. Add teams in the Settings tab to load the dependency map.</p>
      </div>
    );
  }

  const hasLoadedData = dependencyGraphData !== null;
  const totalEdgeCount = graphStats?.totalEdgeCount ?? 0;
  const visibleEdgeCount = filteredGraph?.visibleEdges.length ?? 0;

  return (
    <div className={styles.dependenciesTab}>
      <div className={styles.toolbar}>
        <button className={styles.loadButton} disabled={isLoading} onClick={handleLoadDependencies} type="button">
          {isLoading ? 'Loading…' : hasLoadedData ? 'Reload Dependencies' : 'Load Dependencies'}
        </button>

        {graphStats && (
          <div className={styles.chipRow}>
            <span className={styles.infoChip}>{createChipLabel(graphStats.totalEdgeCount, 'link', 'links')}</span>
            {graphStats.crossTeamCount > 0 && <span className={styles.orangeChip}>{createChipLabel(graphStats.crossTeamCount, 'cross-team', 'cross-team')}</span>}
            {graphStats.blockingCount > 0 && <span className={styles.redChip}>{createChipLabel(graphStats.blockingCount, 'blocking', 'blocking')}</span>}
            {graphStats.offTrainCount > 0 && <span className={styles.yellowChip}>{createChipLabel(graphStats.offTrainCount, 'off-train', 'off-train')}</span>}
            {visibleEdgeCount !== totalEdgeCount && (
              <span className={styles.infoChip}>Showing {visibleEdgeCount} of {totalEdgeCount}</span>
            )}
          </div>
        )}
      </div>

      {hasLoadedData && dependencyGraphData && (
        <>
          <DependencyFocusButtons filterState={filterState} onChangeFilterState={handleChangeFilterState} />

          {filterState.focusMode === 'feature' && (
            <div className={styles.selectorRow}>
              <label className={styles.controlLabel} htmlFor="dependency-feature-filter">Feature</label>
              <select
                aria-label="Feature focus"
                className={styles.selectInput}
                id="dependency-feature-filter"
                onChange={(event) => handleChangeFilterState({ focusFeatureKey: event.target.value })}
                value={filterState.focusFeatureKey}
              >
                <option value="">— Select Feature —</option>
                {dependencyGraphData.featureOptions.map((featureOption) => (
                  <option key={featureOption.key} value={featureOption.key}>{featureOption.label}</option>
                ))}
              </select>
            </div>
          )}

          {filterState.focusMode === 'program-epic' && (
            <div className={styles.selectorRow}>
              <label className={styles.controlLabel} htmlFor="dependency-program-epic-filter">Program Epic</label>
              <select
                aria-label="Program Epic focus"
                className={styles.selectInput}
                id="dependency-program-epic-filter"
                onChange={(event) => handleChangeFilterState({ focusProgramEpicKey: event.target.value })}
                value={filterState.focusProgramEpicKey}
              >
                <option value="">— Select Program Epic —</option>
                {dependencyGraphData.programEpicOptions.map((programEpicOption) => (
                  <option key={programEpicOption.key} value={programEpicOption.key}>{programEpicOption.label}</option>
                ))}
              </select>
            </div>
          )}

          {filterState.focusMode === 'team' && (
            <div className={styles.selectorRow}>
              <label className={styles.controlLabel} htmlFor="dependency-team-filter">Team</label>
              <select
                aria-label="Team focus"
                className={styles.selectInput}
                id="dependency-team-filter"
                onChange={(event) => handleChangeFilterState({ focusTeamProjectKey: event.target.value })}
                value={filterState.focusTeamProjectKey}
              >
                <option value="">— Select Team —</option>
                {teamOptions.map((teamOption) => (
                  <option key={teamOption.key} value={teamOption.key}>{teamOption.label}</option>
                ))}
              </select>
              <DirectionButtonGroup
                directionFilter={filterState.directionFilter}
                onChangeDirectionFilter={(directionFilter) => handleChangeFilterState({ directionFilter })}
              />
            </div>
          )}

          {filterState.focusMode === 'team-pair' && (
            <div className={styles.selectorRow}>
              <label className={styles.controlLabel} htmlFor="dependency-team-a-filter">Team A</label>
              <select
                aria-label="Team A focus"
                className={styles.selectInput}
                id="dependency-team-a-filter"
                onChange={(event) => handleChangeFilterState({ focusTeamProjectKey: event.target.value })}
                value={filterState.focusTeamProjectKey}
              >
                <option value="">— Select Team —</option>
                {teamOptions.map((teamOption) => (
                  <option key={teamOption.key} value={teamOption.key}>{teamOption.label}</option>
                ))}
              </select>
              <label className={styles.controlLabel} htmlFor="dependency-team-b-filter">Team B</label>
              <select
                aria-label="Team B focus"
                className={styles.selectInput}
                id="dependency-team-b-filter"
                onChange={(event) => handleChangeFilterState({ focusTeamPeerProjectKey: event.target.value })}
                value={filterState.focusTeamPeerProjectKey}
              >
                <option value="">— Select Team —</option>
                {teamOptions.map((teamOption) => (
                  <option key={teamOption.key} value={teamOption.key}>{teamOption.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.toggleRow}>
            <label className={styles.checkboxLabel}>
              <input
                checked={filterState.isCrossTeamOnly}
                onChange={(event) => handleChangeFilterState({ isCrossTeamOnly: event.target.checked })}
                type="checkbox"
              />
              Cross-team only
            </label>
            <label className={styles.checkboxLabel}>
              <input
                checked={filterState.isBlockingOnly}
                onChange={(event) => handleChangeFilterState({ isBlockingOnly: event.target.checked })}
                type="checkbox"
              />
              Blocking only
            </label>
            <label className={styles.checkboxLabel}>
              <input
                aria-label="Off-train only"
                checked={filterState.isOffTrainOnly}
                onChange={(event) => handleChangeFilterState({ isOffTrainOnly: event.target.checked })}
                type="checkbox"
              />
              Off-train only
            </label>
            <label className={styles.checkboxLabel}>
              <input
                checked={filterState.shouldExcludeDone}
                onChange={(event) => handleChangeFilterState({ shouldExcludeDone: event.target.checked })}
                type="checkbox"
              />
              Exclude Done
            </label>
            <input
              aria-label="Dependency search"
              className={styles.searchInput}
              onChange={(event) => handleChangeFilterState({ searchText: event.target.value })}
              placeholder="Search key or summary…"
              type="search"
              value={filterState.searchText}
            />
            <button className={styles.resetButton} onClick={handleResetFilters} type="button">Reset Filters</button>
          </div>
        </>
      )}

      {loadError && <p className={styles.errorText}>{loadError}</p>}
      {isLoading && <p className={styles.loadingText}>Loading the legacy dependency graph from the Blueprint hierarchy…</p>}

      {!isLoading && !hasLoadedData && !loadError && (
        <p className={styles.emptyState}>Click "Load Dependencies" to build the legacy dependency graph from the Blueprint hierarchy query chain.</p>
      )}

      {!isLoading && hasLoadedData && totalEdgeCount === 0 && (
        <p className={styles.emptyState}>No dependencies were found in the loaded Blueprint hierarchy.</p>
      )}

      {!isLoading && hasLoadedData && totalEdgeCount > 0 && filteredGraph && dependencyGraphLayout && (
        <>
          {filteredGraph.visibleEdges.length === 0 ? (
            <div className={styles.emptyGraphState}>
              <p className={styles.emptyState}>No dependencies match the current filters.</p>
              <button className={styles.resetButton} onClick={handleResetFilters} type="button">Reset Filters</button>
            </div>
          ) : (
            <div className={styles.graphShell}>
              <DependencyGraphLegend />

              <svg
                aria-label="Dependency Graph"
                className={styles.graphSvg}
                height={dependencyGraphLayout.height}
                role="group"
                viewBox={`0 0 ${dependencyGraphLayout.width} ${dependencyGraphLayout.height}`}
                width="100%"
              >
                <defs>
                  <marker id="dependency-arrow-gray" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-secondary)" />
                  </marker>
                  <marker id="dependency-arrow-orange" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--color-warning)" />
                  </marker>
                  <marker id="dependency-arrow-red" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--color-danger)" />
                  </marker>
                </defs>

                {dependencyGraphLayout.lanes.map((lane) => (
                  <g key={lane.key}>
                    <rect
                      className={styles.laneBackground}
                      height={lane.height}
                      rx="12"
                      ry="12"
                      width={dependencyGraphLayout.width - 20}
                      x="10"
                      y={lane.top}
                    />
                    <text className={styles.laneLabel} x="24" y={lane.top + 22}>{lane.label}</text>
                  </g>
                ))}

                {filteredGraph.visibleEdges.map((edge) => {
                  const fromPosition = dependencyGraphLayout.nodePositions.get(edge.fromKey);
                  const toPosition = dependencyGraphLayout.nodePositions.get(edge.toKey);
                  if (!fromPosition || !toPosition) {
                    return null;
                  }

                  const strokeColor = readEdgeStrokeColor(edge);
                  const markerId = edge.isBlocking ? 'dependency-arrow-red' : edge.isCrossTeam ? 'dependency-arrow-orange' : 'dependency-arrow-gray';
                  return (
                    <path
                      key={edge.id}
                      className={edge.isBlocking ? styles.blockingEdge : styles.graphEdge}
                      d={createDependencyEdgePath(fromPosition.centerX, fromPosition.centerY, toPosition.centerX, toPosition.centerY)}
                      markerEnd={`url(#${markerId})`}
                      stroke={strokeColor}
                    />
                  );
                })}

                {filteredGraph.visibleNodes.map((node) => {
                  const nodePosition = dependencyGraphLayout.nodePositions.get(node.key);
                  if (!nodePosition) {
                    return null;
                  }

                  const isNodeDone = ['done', 'closed', 'resolved', 'complete', 'completed'].some((keyword) => node.status.toLowerCase().includes(keyword));
                  return (
                    <g
                      aria-label={`Open details for ${node.key}`}
                      className={styles.graphNode}
                      key={node.key}
                      onClick={() => setSelectedNodeKey(node.key)}
                      onKeyDown={(keyboardEvent) => {
                        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                          keyboardEvent.preventDefault();
                          setSelectedNodeKey(node.key);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <rect
                        fill={readNodeFillColor(node)}
                        height={NODE_HEIGHT}
                        opacity={isNodeDone ? 0.45 : 1}
                        rx={NODE_RADIUS}
                        ry={NODE_RADIUS}
                        width={NODE_WIDTH}
                        x={nodePosition.centerX - (NODE_WIDTH / 2)}
                        y={nodePosition.centerY - (NODE_HEIGHT / 2)}
                      />
                      {!node.inTeam && (
                        <rect
                          className={styles.offTrainOutline}
                          height={NODE_HEIGHT + 6}
                          rx={NODE_RADIUS + 2}
                          ry={NODE_RADIUS + 2}
                          width={NODE_WIDTH + 6}
                          x={nodePosition.centerX - (NODE_WIDTH / 2) - 3}
                          y={nodePosition.centerY - (NODE_HEIGHT / 2) - 3}
                        />
                      )}
                      <text className={styles.nodeKeyLabel} x={nodePosition.centerX} y={nodePosition.centerY - 4}>
                        {node.key}
                      </text>
                      <text className={styles.nodeSummaryLabel} x={nodePosition.centerX} y={nodePosition.centerY + 12}>
                        {node.summary.length > 20 ? `${node.summary.slice(0, 19)}…` : node.summary}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </>
      )}

      {dependencyGraphData && selectedNodeKey && (
        <DependencyDetailDrawer
          dependencyGraphData={dependencyGraphData}
          onClose={() => setSelectedNodeKey(null)}
          onSelectNode={setSelectedNodeKey}
          selectedNodeKey={selectedNodeKey}
        />
      )}
    </div>
  );
}
