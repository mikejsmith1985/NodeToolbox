// dependencyGraph.ts — Builds and filters the legacy-style dependency graph from Blueprint-backed Jira issues.

export type DependencyNodeType = 'pe' | 'feature' | 'story';
export type DependencyFocusMode = 'all' | 'feature' | 'program-epic' | 'team' | 'team-pair';
export type DependencyDirectionFilter = 'inbound' | 'both' | 'outbound';

interface DependencyLinkedIssueFields {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  issuetype?: { name?: string };
}

export interface DependencyLinkedIssueRef {
  key: string;
  fields?: DependencyLinkedIssueFields;
}

export interface DependencySourceIssueLink {
  id?: string;
  type: {
    name?: string;
    inward?: string;
    outward?: string;
  };
  inwardIssue?: DependencyLinkedIssueRef;
  outwardIssue?: DependencyLinkedIssueRef;
}

export interface DependencySourceIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  nodeType: DependencyNodeType;
  teamName: string | null;
  projectKey: string;
  inTeam: boolean;
  featureKey: string | null;
  programEpicKey: string | null;
  issueLinks: DependencySourceIssueLink[];
}

export interface DependencyGraphNode {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  nodeType: DependencyNodeType;
  teamName: string | null;
  projectKey: string;
  inTeam: boolean;
  featureKey: string | null;
  programEpicKey: string | null;
  isPlaceholder: boolean;
}

export interface DependencyGraphEdge {
  id: string;
  fromKey: string;
  toKey: string;
  typeName: string;
  outwardName: string;
  inwardName: string;
  isCrossTeam: boolean;
  isBlocking: boolean;
}

export interface DependencyFilterState {
  focusMode: DependencyFocusMode;
  focusFeatureKey: string;
  focusProgramEpicKey: string;
  focusTeamProjectKey: string;
  focusTeamPeerProjectKey: string;
  directionFilter: DependencyDirectionFilter;
  isCrossTeamOnly: boolean;
  isBlockingOnly: boolean;
  isOffTrainOnly: boolean;
  shouldExcludeDone: boolean;
  searchText: string;
}

export interface DependencyGraphData {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  featureOptions: Array<{ key: string; label: string }>;
  programEpicOptions: Array<{ key: string; label: string }>;
}

export interface DependencyFilterResult {
  visibleNodes: DependencyGraphNode[];
  visibleEdges: DependencyGraphEdge[];
}

export interface DependencyLayoutLane {
  key: string;
  label: string;
  top: number;
  height: number;
}

export interface DependencyNodePosition {
  centerX: number;
  centerY: number;
}

export interface DependencyGraphLayout {
  lanes: DependencyLayoutLane[];
  nodePositions: Map<string, DependencyNodePosition>;
  width: number;
  height: number;
}

const DEFAULT_NODE_TITLE_LENGTH = 52;
const UNKNOWN_LANE_KEY = '__unknown__';
const LANE_HEADER_HEIGHT = 34;
const LANE_VERTICAL_PADDING = 24;
const MIN_LANE_HEIGHT = 120;
const NODE_WIDTH = 136;
const NODE_HEIGHT = 40;
const NODE_COLUMN_GAP = 42;
const NODE_ROW_GAP = 18;
const GRAPH_LEFT_PADDING = 140;
const GRAPH_RIGHT_PADDING = 60;
const GRAPH_TOP_PADDING = 20;
const GRAPH_BOTTOM_PADDING = 20;
const DONE_STATUS_KEYWORDS = ['done', 'closed', 'resolved', 'complete', 'completed'];

function truncateNodeSummary(summary: string): string {
  if (summary.length <= DEFAULT_NODE_TITLE_LENGTH) {
    return summary;
  }

  return `${summary.slice(0, DEFAULT_NODE_TITLE_LENGTH - 1)}…`;
}

function isDoneStatus(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return DONE_STATUS_KEYWORDS.some((keyword) => normalizedStatusName.includes(keyword));
}

function readBlockingState(outwardName: string, inwardName: string, typeName: string): boolean {
  const combinedNames = `${typeName} ${outwardName} ${inwardName}`.toLowerCase();
  return combinedNames.includes('block');
}

function createDependencyNode(sourceIssue: DependencySourceIssue): DependencyGraphNode {
  return {
    key: sourceIssue.key,
    summary: sourceIssue.summary,
    status: sourceIssue.status,
    issueType: sourceIssue.issueType,
    nodeType: sourceIssue.nodeType,
    teamName: sourceIssue.teamName,
    projectKey: sourceIssue.projectKey,
    inTeam: sourceIssue.inTeam,
    featureKey: sourceIssue.featureKey,
    programEpicKey: sourceIssue.programEpicKey,
    isPlaceholder: false,
  };
}

function createPlaceholderNode(
  linkedIssue: DependencyLinkedIssueRef,
  teamOptions: Array<{ key: string; label: string }>,
): DependencyGraphNode {
  const issueProjectKey = linkedIssue.key.split('-')[0]?.toUpperCase() ?? '';
  const matchingTeamOption = teamOptions.find((teamOption) => teamOption.key === issueProjectKey);
  return {
    key: linkedIssue.key,
    summary: linkedIssue.fields?.summary ?? linkedIssue.key,
    status: linkedIssue.fields?.status?.name ?? 'Unknown',
    issueType: linkedIssue.fields?.issuetype?.name ?? 'Unknown',
    nodeType: 'story',
    teamName: matchingTeamOption?.label ?? null,
    projectKey: issueProjectKey,
    inTeam: Boolean(matchingTeamOption),
    featureKey: null,
    programEpicKey: null,
    isPlaceholder: true,
  };
}

function createOptionLabel(node: DependencyGraphNode): string {
  return `${node.key}: ${truncateNodeSummary(node.summary)}`;
}

function readMatchingLinkNames(issueLink: DependencySourceIssueLink): string[] {
  return [
    issueLink.type.name,
    issueLink.type.outward,
    issueLink.type.inward,
  ].filter((linkName): linkName is string => Boolean(linkName)).map((linkName) => linkName.toLowerCase());
}

function shouldIncludeLinkType(issueLink: DependencySourceIssueLink, configuredLinkTypes: string[]): boolean {
  if (configuredLinkTypes.length === 0) {
    return true;
  }

  const normalizedConfiguredTypes = configuredLinkTypes.map((linkType) => linkType.toLowerCase());
  const matchingLinkNames = readMatchingLinkNames(issueLink);
  return matchingLinkNames.some((linkName) => normalizedConfiguredTypes.includes(linkName));
}

function addMissingPlaceholderNode(
  nodesByKey: Map<string, DependencyGraphNode>,
  linkedIssue: DependencyLinkedIssueRef | undefined,
  teamOptions: Array<{ key: string; label: string }>,
): void {
  if (!linkedIssue || nodesByKey.has(linkedIssue.key)) {
    return;
  }

  nodesByKey.set(linkedIssue.key, createPlaceholderNode(linkedIssue, teamOptions));
}

function buildDependencyEdges(
  sourceIssues: DependencySourceIssue[],
  nodesByKey: Map<string, DependencyGraphNode>,
  configuredLinkTypes: string[],
  teamOptions: Array<{ key: string; label: string }>,
): DependencyGraphEdge[] {
  const seenEdgeIds = new Set<string>();
  const dependencyEdges: DependencyGraphEdge[] = [];

  for (const sourceIssue of sourceIssues) {
    for (const issueLink of sourceIssue.issueLinks) {
      if (!shouldIncludeLinkType(issueLink, configuredLinkTypes)) {
        continue;
      }

      const typeName = issueLink.type.name ?? issueLink.type.outward ?? issueLink.type.inward ?? 'Link';
      const outwardName = issueLink.type.outward ?? typeName;
      const inwardName = issueLink.type.inward ?? typeName;
      const outwardIssue = issueLink.outwardIssue;
      const inwardIssue = issueLink.inwardIssue;
      const fromKey = outwardIssue ? sourceIssue.key : inwardIssue?.key ?? '';
      const toKey = outwardIssue?.key ?? sourceIssue.key;
      if (!fromKey || !toKey) {
        continue;
      }

      if (outwardIssue) {
        addMissingPlaceholderNode(nodesByKey, outwardIssue, teamOptions);
      }

      if (inwardIssue && !outwardIssue) {
        addMissingPlaceholderNode(nodesByKey, inwardIssue, teamOptions);
      }

      const fromNode = nodesByKey.get(fromKey);
      const toNode = nodesByKey.get(toKey);
      if (!fromNode || !toNode) {
        continue;
      }

      const edgeId = `${fromKey}__${toKey}__${typeName}`;
      if (seenEdgeIds.has(edgeId)) {
        continue;
      }

      seenEdgeIds.add(edgeId);
      dependencyEdges.push({
        id: edgeId,
        fromKey,
        toKey,
        typeName,
        outwardName,
        inwardName,
        isCrossTeam: fromNode.projectKey !== toNode.projectKey && (fromNode.inTeam || toNode.inTeam),
        isBlocking: readBlockingState(outwardName, inwardName, typeName),
      });
    }
  }

  return dependencyEdges;
}

function sortNodes(nodes: DependencyGraphNode[]): DependencyGraphNode[] {
  const nodeTypeWeight: Record<DependencyNodeType, number> = {
    pe: 0,
    feature: 1,
    story: 2,
  };
  return [...nodes].sort((leftNode, rightNode) => {
    if (leftNode.projectKey !== rightNode.projectKey) {
      return leftNode.projectKey.localeCompare(rightNode.projectKey);
    }

    if (nodeTypeWeight[leftNode.nodeType] !== nodeTypeWeight[rightNode.nodeType]) {
      return nodeTypeWeight[leftNode.nodeType] - nodeTypeWeight[rightNode.nodeType];
    }

    if ((leftNode.programEpicKey ?? '') !== (rightNode.programEpicKey ?? '')) {
      return (leftNode.programEpicKey ?? '').localeCompare(rightNode.programEpicKey ?? '');
    }

    if ((leftNode.featureKey ?? '') !== (rightNode.featureKey ?? '')) {
      return (leftNode.featureKey ?? '').localeCompare(rightNode.featureKey ?? '');
    }

    return leftNode.key.localeCompare(rightNode.key);
  });
}

function createNodeOptions(nodes: DependencyGraphNode[], nodeType: DependencyNodeType): Array<{ key: string; label: string }> {
  return nodes
    .filter((node) => node.nodeType === nodeType)
    .sort((leftNode, rightNode) => leftNode.key.localeCompare(rightNode.key))
    .map((node) => ({ key: node.key, label: createOptionLabel(node) }));
}

/** Builds the legacy dependency graph model from Blueprint-backed source issues. */
export function buildDependencyGraphData(
  sourceIssues: DependencySourceIssue[],
  configuredLinkTypes: string[],
  teamOptions: Array<{ key: string; label: string }>,
): DependencyGraphData {
  const nodesByKey = new Map<string, DependencyGraphNode>();
  for (const sourceIssue of sourceIssues) {
    if (!nodesByKey.has(sourceIssue.key)) {
      nodesByKey.set(sourceIssue.key, createDependencyNode(sourceIssue));
    }
  }

  const dependencyEdges = buildDependencyEdges(sourceIssues, nodesByKey, configuredLinkTypes, teamOptions);
  const sortedNodes = sortNodes(Array.from(nodesByKey.values()));

  return {
    nodes: sortedNodes,
    edges: dependencyEdges,
    featureOptions: createNodeOptions(sortedNodes, 'feature'),
    programEpicOptions: createNodeOptions(sortedNodes, 'pe'),
  };
}

/** Returns the default dependency filter state used by the dependency graph toolbar. */
export function createDefaultDependencyFilterState(): DependencyFilterState {
  return {
    focusMode: 'all',
    focusFeatureKey: '',
    focusProgramEpicKey: '',
    focusTeamProjectKey: '',
    focusTeamPeerProjectKey: '',
    directionFilter: 'both',
    isCrossTeamOnly: false,
    isBlockingOnly: false,
    isOffTrainOnly: false,
    shouldExcludeDone: false,
    searchText: '',
  };
}

function matchesSearchText(node: DependencyGraphNode, searchText: string): boolean {
  if (!searchText) {
    return true;
  }

  const normalizedSearchText = searchText.toLowerCase();
  return node.key.toLowerCase().includes(normalizedSearchText)
    || node.summary.toLowerCase().includes(normalizedSearchText)
    || (node.teamName ?? '').toLowerCase().includes(normalizedSearchText)
    || node.status.toLowerCase().includes(normalizedSearchText);
}

function matchesFocusFilter(
  edge: DependencyGraphEdge,
  nodesByKey: Map<string, DependencyGraphNode>,
  filterState: DependencyFilterState,
): boolean {
  const fromNode = nodesByKey.get(edge.fromKey);
  const toNode = nodesByKey.get(edge.toKey);
  if (!fromNode || !toNode) {
    return false;
  }

  if (filterState.focusMode === 'feature' && filterState.focusFeatureKey) {
    return fromNode.featureKey === filterState.focusFeatureKey
      || toNode.featureKey === filterState.focusFeatureKey
      || fromNode.key === filterState.focusFeatureKey
      || toNode.key === filterState.focusFeatureKey;
  }

  if (filterState.focusMode === 'program-epic' && filterState.focusProgramEpicKey) {
    return fromNode.programEpicKey === filterState.focusProgramEpicKey
      || toNode.programEpicKey === filterState.focusProgramEpicKey
      || fromNode.key === filterState.focusProgramEpicKey
      || toNode.key === filterState.focusProgramEpicKey;
  }

  if (filterState.focusMode === 'team' && filterState.focusTeamProjectKey) {
    if (filterState.directionFilter === 'inbound') {
      return toNode.projectKey === filterState.focusTeamProjectKey;
    }

    if (filterState.directionFilter === 'outbound') {
      return fromNode.projectKey === filterState.focusTeamProjectKey;
    }

    return fromNode.projectKey === filterState.focusTeamProjectKey
      || toNode.projectKey === filterState.focusTeamProjectKey;
  }

  if (
    filterState.focusMode === 'team-pair'
    && filterState.focusTeamProjectKey
    && filterState.focusTeamPeerProjectKey
  ) {
    return (
      fromNode.projectKey === filterState.focusTeamProjectKey
      && toNode.projectKey === filterState.focusTeamPeerProjectKey
    ) || (
      fromNode.projectKey === filterState.focusTeamPeerProjectKey
      && toNode.projectKey === filterState.focusTeamProjectKey
    );
  }

  return true;
}

function matchesBooleanFilters(
  edge: DependencyGraphEdge,
  fromNode: DependencyGraphNode,
  toNode: DependencyGraphNode,
  filterState: DependencyFilterState,
): boolean {
  if (filterState.isCrossTeamOnly && !edge.isCrossTeam) {
    return false;
  }

  if (filterState.isBlockingOnly && !edge.isBlocking) {
    return false;
  }

  if (filterState.isOffTrainOnly && fromNode.inTeam && toNode.inTeam) {
    return false;
  }

  if (filterState.shouldExcludeDone && isDoneStatus(fromNode.status) && isDoneStatus(toNode.status)) {
    return false;
  }

  return true;
}

/** Filters the dependency graph according to the active toolbar state. */
export function filterDependencyGraphData(
  graphData: DependencyGraphData,
  filterState: DependencyFilterState,
): DependencyFilterResult {
  const nodesByKey = new Map(graphData.nodes.map((node) => [node.key, node]));
  const visibleEdges = graphData.edges.filter((edge) => {
    const fromNode = nodesByKey.get(edge.fromKey);
    const toNode = nodesByKey.get(edge.toKey);
    if (!fromNode || !toNode) {
      return false;
    }

    if (!matchesFocusFilter(edge, nodesByKey, filterState)) {
      return false;
    }

    if (!matchesBooleanFilters(edge, fromNode, toNode, filterState)) {
      return false;
    }

    return matchesSearchText(fromNode, filterState.searchText) || matchesSearchText(toNode, filterState.searchText);
  });

  const visibleNodeKeys = new Set<string>();
  for (const edge of visibleEdges) {
    visibleNodeKeys.add(edge.fromKey);
    visibleNodeKeys.add(edge.toKey);
  }

  const visibleNodes = graphData.nodes.filter((node) => visibleNodeKeys.has(node.key));
  return { visibleNodes, visibleEdges };
}

function readLaneKey(node: DependencyGraphNode, teamOptions: Array<{ key: string; label: string }>): string {
  const hasConfiguredTeamLane = teamOptions.some((teamOption) => teamOption.key === node.projectKey);
  return hasConfiguredTeamLane ? node.projectKey : UNKNOWN_LANE_KEY;
}

function createLaneLabel(laneKey: string, teamOptions: Array<{ key: string; label: string }>): string {
  if (laneKey === UNKNOWN_LANE_KEY) {
    return 'Other / External';
  }

  return teamOptions.find((teamOption) => teamOption.key === laneKey)?.label ?? laneKey;
}

function groupNodesByLane(
  visibleNodes: DependencyGraphNode[],
  teamOptions: Array<{ key: string; label: string }>,
): Map<string, DependencyGraphNode[]> {
  const nodesByLane = new Map<string, DependencyGraphNode[]>();
  for (const node of visibleNodes) {
    const laneKey = readLaneKey(node, teamOptions);
    const laneNodes = nodesByLane.get(laneKey) ?? [];
    laneNodes.push(node);
    nodesByLane.set(laneKey, laneNodes);
  }

  for (const laneNodes of nodesByLane.values()) {
    laneNodes.sort((leftNode, rightNode) => leftNode.key.localeCompare(rightNode.key));
  }

  return nodesByLane;
}

function createLaneOrder(
  nodesByLane: Map<string, DependencyGraphNode[]>,
  teamOptions: Array<{ key: string; label: string }>,
): string[] {
  const orderedTeamLanes = teamOptions
    .map((teamOption) => teamOption.key)
    .filter((teamKey) => (nodesByLane.get(teamKey)?.length ?? 0) > 0);
  const hasUnknownLane = (nodesByLane.get(UNKNOWN_LANE_KEY)?.length ?? 0) > 0;
  return hasUnknownLane ? [...orderedTeamLanes, UNKNOWN_LANE_KEY] : orderedTeamLanes;
}

function readLaneHeight(nodeCount: number, columnCount: number): number {
  const rowCount = Math.max(1, Math.ceil(nodeCount / columnCount));
  const contentHeight = rowCount * NODE_HEIGHT + Math.max(0, rowCount - 1) * NODE_ROW_GAP;
  return Math.max(MIN_LANE_HEIGHT, LANE_HEADER_HEIGHT + (LANE_VERTICAL_PADDING * 2) + contentHeight);
}

/** Computes deterministic lane-based positions for the dependency graph SVG. */
export function computeDependencyGraphLayout(
  visibleNodes: DependencyGraphNode[],
  teamOptions: Array<{ key: string; label: string }>,
): DependencyGraphLayout {
  const nodesByLane = groupNodesByLane(visibleNodes, teamOptions);
  const laneOrder = createLaneOrder(nodesByLane, teamOptions);
  const maxLaneNodeCount = Math.max(1, ...laneOrder.map((laneKey) => nodesByLane.get(laneKey)?.length ?? 0));
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(maxLaneNodeCount)));

  const lanes: DependencyLayoutLane[] = [];
  const nodePositions = new Map<string, DependencyNodePosition>();
  let currentTop = GRAPH_TOP_PADDING;

  for (const laneKey of laneOrder) {
    const laneNodes = nodesByLane.get(laneKey) ?? [];
    const laneHeight = readLaneHeight(laneNodes.length, columnCount);
    lanes.push({
      key: laneKey,
      label: createLaneLabel(laneKey, teamOptions),
      top: currentTop,
      height: laneHeight,
    });

    laneNodes.forEach((node, nodeIndex) => {
      const columnIndex = nodeIndex % columnCount;
      const rowIndex = Math.floor(nodeIndex / columnCount);
      const centerX = GRAPH_LEFT_PADDING + (columnIndex * (NODE_WIDTH + NODE_COLUMN_GAP)) + (NODE_WIDTH / 2);
      const centerY = currentTop + LANE_HEADER_HEIGHT + LANE_VERTICAL_PADDING + (rowIndex * (NODE_HEIGHT + NODE_ROW_GAP)) + (NODE_HEIGHT / 2);
      nodePositions.set(node.key, { centerX, centerY });
    });

    currentTop += laneHeight + NODE_ROW_GAP;
  }

  return {
    lanes,
    nodePositions,
    width: GRAPH_LEFT_PADDING + (columnCount * NODE_WIDTH) + ((columnCount - 1) * NODE_COLUMN_GAP) + GRAPH_RIGHT_PADDING,
    height: currentTop + GRAPH_BOTTOM_PADDING,
  };
}

