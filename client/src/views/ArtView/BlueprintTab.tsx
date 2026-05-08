// BlueprintTab.tsx — PI→Feature→Story hierarchy viewer for the Blueprint tab.

import { useState } from 'react';
import { jiraGet } from '../../services/jiraApi.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import styles from './BlueprintTab.module.css';

// ── Types ──

type BlueprintViewMode = 'hierarchy' | 'by-team' | 'features' | 'flat';
type HealthStatus = 'green' | 'amber' | 'red';

/** A Jira issue as returned by the Blueprint API call (extends base issue with feature-link fields). */
interface BlueprintRawIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    assignee?: { displayName: string } | null;
    /** Feature Epic Link — default customfield, configurable in settings. */
    customfield_10108?: string | { key?: string } | null;
    /** Parent link field. */
    customfield_10100?: string | { key?: string } | null;
    parent?: { key: string; fields?: { summary?: string } } | null;
  };
}

/** Fully resolved story node within a feature. */
interface BlueprintStoryNode {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  issueType: string;
  /** True when this story's project key is not in the ART team project key list. */
  isOffTrain: boolean;
}

/** Fully resolved feature node containing all linked stories. */
interface BlueprintFeatureNode {
  key: string;
  summary: string;
  status: string;
  completionPercent: number;
  healthStatus: HealthStatus;
  /** True when this feature was discovered via hierarchy but has no stories from any ART team. */
  isExternal: boolean;
  stories: BlueprintStoryNode[];
}

/** Advanced ART settings shape stored in localStorage under 'tbxARTSettings'. */
interface ArtAdvancedSettings {
  featureLinkField?: string;
  piFieldId?: string;
  staleDays?: number;
}

// ── Constants ──

const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const HEALTH_GREEN_THRESHOLD = 70;
const HEALTH_AMBER_THRESHOLD = 40;
const STATUS_DONE_KEYWORDS = ['done', 'closed', 'resolved', 'complete'];

// ── Pure helper functions ──

function loadArtSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

function computeHealthStatus(completionPercent: number): HealthStatus {
  if (completionPercent >= HEALTH_GREEN_THRESHOLD) return 'green';
  if (completionPercent >= HEALTH_AMBER_THRESHOLD) return 'amber';
  return 'red';
}

function isStatusDone(statusName: string): boolean {
  const lower = statusName.toLowerCase();
  return STATUS_DONE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/** Extracts the feature/epic key from a sprint issue, checking multiple candidate fields. */
function extractFeatureKey(
  fields: BlueprintRawIssue['fields'],
  featureLinkField: string,
): string | null {
  const candidateFieldIds = [featureLinkField, DEFAULT_FEATURE_LINK_FIELD, 'customfield_10100'];
  for (const fieldId of candidateFieldIds) {
    const rawValue = fields[fieldId as keyof typeof fields];
    if (!rawValue) continue;
    if (typeof rawValue === 'string' && rawValue.includes('-')) return rawValue;
    if (typeof rawValue === 'object' && 'key' in rawValue && rawValue.key) return rawValue.key;
  }
  if (fields.parent?.key) return fields.parent.key;
  return null;
}

/** Groups raw sprint issues into a map of featureKey → list of story nodes. */
function buildStoryMapFromRawIssues(
  rawIssues: BlueprintRawIssue[],
  featureLinkField: string,
  artProjectKeys: Set<string>,
): Map<string, BlueprintStoryNode[]> {
  const storyMap = new Map<string, BlueprintStoryNode[]>();
  for (const rawIssue of rawIssues) {
    const featureKey = extractFeatureKey(rawIssue.fields, featureLinkField);
    if (!featureKey) continue;
    const projectKey = rawIssue.key.split('-')[0].toUpperCase();
    const isOffTrain = artProjectKeys.size > 0 && !artProjectKeys.has(projectKey);
    const story: BlueprintStoryNode = {
      key: rawIssue.key,
      summary: rawIssue.fields.summary ?? rawIssue.key,
      status: rawIssue.fields.status?.name ?? 'Unknown',
      assignee: rawIssue.fields.assignee?.displayName ?? null,
      issueType: rawIssue.fields.issuetype?.name ?? 'Story',
      isOffTrain,
    };
    if (!storyMap.has(featureKey)) storyMap.set(featureKey, []);
    storyMap.get(featureKey)!.push(story);
  }
  return storyMap;
}

/** Assembles the final BlueprintFeatureNode list from raw feature details + grouped stories. */
function buildFeatureNodes(
  featureKeys: string[],
  featureDetailsById: Map<string, BlueprintRawIssue>,
  storyMap: Map<string, BlueprintStoryNode[]>,
): BlueprintFeatureNode[] {
  return featureKeys.map((featureKey) => {
    const detail = featureDetailsById.get(featureKey);
    const stories = storyMap.get(featureKey) ?? [];
    const doneCount = stories.filter((story) => isStatusDone(story.status)).length;
    const completionPercent = stories.length > 0 ? Math.round((doneCount / stories.length) * 100) : 0;
    return {
      key: featureKey,
      summary: detail?.fields.summary ?? featureKey,
      status: detail?.fields.status?.name ?? 'Unknown',
      completionPercent,
      healthStatus: computeHealthStatus(completionPercent),
      isExternal: stories.length === 0,
      stories,
    };
  });
}

/** Main Jira data-fetching logic for the blueprint hierarchy. */
async function fetchBlueprintData(teams: ArtTeam[]): Promise<BlueprintFeatureNode[]> {
  const settings = loadArtSettings();
  const featureLinkField = settings.featureLinkField ?? DEFAULT_FEATURE_LINK_FIELD;
  const artProjectKeys = new Set(
    teams.map((team) => team.projectKey?.toUpperCase()).filter((key): key is string => Boolean(key)),
  );

  // Fetch sprint issues for every team board with feature-link fields included
  const allRawIssues: BlueprintRawIssue[] = [];
  for (const team of teams) {
    const jql = `board = ${team.boardId} AND sprint in openSprints()`;
    const fields = `summary,status,issuetype,assignee,${featureLinkField},parent,customfield_10100`;
    const result = await jiraGet<{ issues: BlueprintRawIssue[] }>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=200`,
    );
    allRawIssues.push(...(result.issues ?? []));
  }

  const storyMap = buildStoryMapFromRawIssues(allRawIssues, featureLinkField, artProjectKeys);
  const featureKeys = Array.from(storyMap.keys());
  if (featureKeys.length === 0) return [];

  // Batch-fetch feature details for all discovered feature keys
  const featureJql = `key in (${featureKeys.join(',')})`;
  const featureResult = await jiraGet<{ issues: BlueprintRawIssue[] }>(
    `/rest/api/2/search?jql=${encodeURIComponent(featureJql)}&fields=summary,status,issuetype,assignee&maxResults=${featureKeys.length}`,
  );
  const featureDetailsById = new Map<string, BlueprintRawIssue>(
    (featureResult.issues ?? []).map((feat) => [feat.key, feat]),
  );

  return buildFeatureNodes(featureKeys, featureDetailsById, storyMap);
}

/** Filters the feature list by a search term (checks feature key, summary, and story summaries). */
function filterFeaturesBySearch(
  features: BlueprintFeatureNode[],
  searchTerm: string,
): BlueprintFeatureNode[] {
  if (!searchTerm.trim()) return features;
  const lowerTerm = searchTerm.toLowerCase();
  return features.filter(
    (feature) =>
      feature.key.toLowerCase().includes(lowerTerm) ||
      feature.summary.toLowerCase().includes(lowerTerm) ||
      feature.stories.some((story) => story.summary.toLowerCase().includes(lowerTerm)),
  );
}

// ── Sub-components ──

interface HealthRingProps {
  completionPercent: number;
  healthStatus: HealthStatus;
}

const HEALTH_COLOR_MAP: Record<HealthStatus, string> = {
  green: '#28a745',
  amber: '#ffc107',
  red: '#dc3545',
};

/** Circular conic-gradient health ring showing feature completion percentage. */
function HealthRing({ completionPercent, healthStatus }: HealthRingProps) {
  const fillColor = HEALTH_COLOR_MAP[healthStatus];
  const backgroundStyle = {
    background: `conic-gradient(${fillColor} ${completionPercent}%, #e9ecef ${completionPercent}%)`,
  };
  return (
    <div className={styles.healthRing} style={backgroundStyle} title={`${completionPercent}% complete`}>
      <span className={styles.healthRingLabel}>{completionPercent}%</span>
    </div>
  );
}

interface BlueprintViewModeSwitcherProps {
  viewMode: BlueprintViewMode;
  onSetViewMode: (mode: BlueprintViewMode) => void;
}

const VIEW_MODE_LABELS: { key: BlueprintViewMode; label: string }[] = [
  { key: 'hierarchy', label: 'Full Hierarchy' },
  { key: 'by-team', label: 'By Team' },
  { key: 'features', label: 'Features Only' },
  { key: 'flat', label: 'Flat List' },
];

/** Row of buttons allowing the user to switch between Blueprint view modes. */
function BlueprintViewModeSwitcher({ viewMode, onSetViewMode }: BlueprintViewModeSwitcherProps) {
  return (
    <div className={styles.blueprintViewModeStrip}>
      {VIEW_MODE_LABELS.map((modeOption) => (
        <button
          key={modeOption.key}
          className={`${styles.viewModeBtn} ${viewMode === modeOption.key ? styles.viewModeBtnActive : ''}`}
          onClick={() => onSetViewMode(modeOption.key)}
        >
          {modeOption.label}
        </button>
      ))}
    </div>
  );
}

interface BlueprintStoryListProps {
  stories: BlueprintStoryNode[];
}

/** Renders the indented list of story rows beneath an expanded feature. */
function BlueprintStoryList({ stories }: BlueprintStoryListProps) {
  return (
    <ul className={styles.blueprintStoryList}>
      {stories.map((story) => (
        <li key={story.key} className={styles.blueprintStoryRow}>
          <span className={styles.storyKey}>{story.key}</span>
          <span className={styles.storySummary}>{story.summary}</span>
          <span className={styles.storyStatus}>{story.status}</span>
          {story.assignee && <span className={styles.storyAssignee}>{story.assignee}</span>}
          {story.isOffTrain && <span className={styles.offTrainBadge}>Off-train</span>}
        </li>
      ))}
    </ul>
  );
}

interface BlueprintFeatureRowProps {
  feature: BlueprintFeatureNode;
  isCollapsed: boolean;
  onToggleCollapse: (featureKey: string) => void;
  showStories: boolean;
}

/** Renders a single feature row with health ring, collapse chevron, and optional story list. */
function BlueprintFeatureRow({ feature, isCollapsed, onToggleCollapse, showStories }: BlueprintFeatureRowProps) {
  const collapseLabel = isCollapsed ? `Expand ${feature.key}` : `Collapse ${feature.key}`;
  const storyCountLabel = `${feature.stories.length} ${feature.stories.length === 1 ? 'story' : 'stories'}`;

  return (
    <div className={styles.blueprintFeatureBlock}>
      <div className={styles.blueprintFeatureRow}>
        <button
          className={styles.blueprintChevron}
          onClick={() => onToggleCollapse(feature.key)}
          aria-label={collapseLabel}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <HealthRing completionPercent={feature.completionPercent} healthStatus={feature.healthStatus} />
        <span className={styles.featureKey}>{feature.key}</span>
        <span className={styles.featureSummary}>{feature.summary}</span>
        <span className={styles.featureStatus}>{feature.status}</span>
        <span className={styles.storyCount}>{storyCountLabel}</span>
        {feature.isExternal && <span className={styles.externalBadge}>External</span>}
      </div>
      {!isCollapsed && showStories && <BlueprintStoryList stories={feature.stories} />}
    </div>
  );
}

interface BlueprintFeatureListProps {
  viewMode: BlueprintViewMode;
  features: BlueprintFeatureNode[];
  collapsedFeatureKeys: Set<string>;
  onToggleCollapse: (featureKey: string) => void;
}

/** Renders the feature list according to the active view mode. */
function BlueprintFeatureList({
  viewMode,
  features,
  collapsedFeatureKeys,
  onToggleCollapse,
}: BlueprintFeatureListProps) {
  const shouldShowStories = viewMode === 'hierarchy' || viewMode === 'by-team';

  return (
    <div className={styles.blueprintFeatureList}>
      {features.map((feature) => (
        <BlueprintFeatureRow
          key={feature.key}
          feature={feature}
          isCollapsed={collapsedFeatureKeys.has(feature.key)}
          onToggleCollapse={onToggleCollapse}
          showStories={shouldShowStories}
        />
      ))}
    </div>
  );
}

// ── Main component ──

interface BlueprintTabProps {
  teams: ArtTeam[];
  selectedPiName: string;
}

/** Blueprint tab: displays the PI→Feature→Story hierarchy for all ART teams. */
export default function BlueprintTab({ teams, selectedPiName }: BlueprintTabProps) {
  const [viewMode, setViewMode] = useState<BlueprintViewMode>('hierarchy');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [features, setFeatures] = useState<BlueprintFeatureNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsedFeatureKeys, setCollapsedFeatureKeys] = useState<Set<string>>(new Set());

  const hasNoPiSelected = !selectedPiName.trim();
  const hasNoTeams = teams.length === 0;
  const hasLoadedData = features !== null;
  const filteredFeatures = filterFeaturesBySearch(features ?? [], searchTerm);

  async function handleLoadBlueprint() {
    if (hasNoTeams) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const loadedFeatures = await fetchBlueprintData(teams);
      setFeatures(loadedFeatures);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load blueprint data';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function toggleFeatureCollapse(featureKey: string) {
    setCollapsedFeatureKeys((previous) => {
      const next = new Set(previous);
      if (next.has(featureKey)) {
        next.delete(featureKey);
      } else {
        next.add(featureKey);
      }
      return next;
    });
  }

  if (hasNoPiSelected) {
    return (
      <div className={styles.blueprintTab}>
        <p className={styles.warningText}>No PI selected. Choose a PI name in the Board Prep tab to enable the Blueprint view.</p>
      </div>
    );
  }

  if (hasNoTeams) {
    return (
      <div className={styles.blueprintTab}>
        <p className={styles.warningText}>No teams configured. Add teams in the Settings tab to load the Blueprint hierarchy.</p>
      </div>
    );
  }

  return (
    <div className={styles.blueprintTab}>
      <div className={styles.blueprintToolbar}>
        <button className={styles.loadBtn} onClick={handleLoadBlueprint} disabled={isLoading}>
          {isLoading ? 'Loading…' : hasLoadedData ? 'Reload Blueprint' : 'Load Blueprint'}
        </button>
        <BlueprintViewModeSwitcher viewMode={viewMode} onSetViewMode={setViewMode} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search features or stories…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      {loadError && <p className={styles.errorText}>{loadError}</p>}

      {isLoading && <p className={styles.loadingText}>Loading blueprint hierarchy…</p>}

      {!isLoading && !hasLoadedData && !loadError && (
        <p className={styles.emptyState}>Click "Load Blueprint" to fetch the PI feature hierarchy from Jira.</p>
      )}

      {!isLoading && hasLoadedData && filteredFeatures.length === 0 && (
        <p className={styles.emptyState}>
          {searchTerm ? 'No features match the current search.' : 'No features found. Ensure sprint issues have a feature-link field configured in Settings.'}
        </p>
      )}

      {!isLoading && filteredFeatures.length > 0 && (
        <BlueprintFeatureList
          viewMode={viewMode}
          features={filteredFeatures}
          collapsedFeatureKeys={collapsedFeatureKeys}
          onToggleCollapse={toggleFeatureCollapse}
        />
      )}
    </div>
  );
}
