// BlueprintTab.tsx — React renderer for the legacy-style Program Epic → Feature → Story Blueprint hierarchy.

import { useMemo, useState } from 'react';

import type { ArtTeam } from './hooks/useArtData.ts';
import {
  fetchBlueprintHierarchy,
  filterProgramEpicsBySearch,
  flattenProgramEpicFeatures,
  type BlueprintFeatureNode,
  type BlueprintHealthStatus,
  type BlueprintProgramEpicNode,
  type BlueprintStoryNode,
  type BlueprintSubtaskNode,
  type BlueprintViewMode,
} from './blueprintHierarchy.ts';
import styles from './BlueprintTab.module.css';

const HEALTH_COLOR_MAP: Record<BlueprintHealthStatus, string> = {
  green: 'var(--color-success)',
  yellow: 'var(--color-warning)',
  red: 'var(--color-danger)',
  blue: 'var(--color-accent)',
  gray: 'var(--color-text-secondary)',
};

const VIEW_MODE_LABELS: Array<{ key: BlueprintViewMode; label: string }> = [
  { key: 'hierarchy', label: 'Full Hierarchy' },
  { key: 'by-team', label: 'By Team' },
  { key: 'features', label: 'Features Only' },
  { key: 'flat', label: 'Flat List' },
];

function readStatusToneClassName(statusName: string): string {
  const normalizedStatusName = statusName.toLowerCase();
  if (['done', 'closed', 'resolved'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return styles.statusToneSuccess;
  }

  if (['in progress', 'in review', 'in development'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return styles.statusToneInfo;
  }

  if (['blocked', 'impediment'].some((keyword) => normalizedStatusName.includes(keyword))) {
    return styles.statusToneDanger;
  }

  return styles.statusToneNeutral;
}

function isStoryDone(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return ['done', 'closed', 'resolved', 'complete'].some((keyword) => normalizedStatusName.includes(keyword));
}

function HealthRing({ completionPercent, healthStatus }: { completionPercent: number; healthStatus: BlueprintHealthStatus }) {
  const fillColor = HEALTH_COLOR_MAP[healthStatus];
  return (
    <div
      className={styles.healthRing}
      style={{ background: `conic-gradient(${fillColor} ${completionPercent}%, var(--color-surface-3) ${completionPercent}%)` }}
      title={`${completionPercent}% complete`}
    >
      <span className={styles.healthRingLabel}>{completionPercent}%</span>
    </div>
  );
}

function BlueprintViewModeSwitcher({
  viewMode,
  onSetViewMode,
}: {
  viewMode: BlueprintViewMode;
  onSetViewMode: (mode: BlueprintViewMode) => void;
}) {
  return (
    <div className={styles.blueprintViewModeStrip}>
      {VIEW_MODE_LABELS.map((modeOption) => (
        <button
          key={modeOption.key}
          className={`${styles.viewModeBtn} ${viewMode === modeOption.key ? styles.viewModeBtnActive : ''}`}
          onClick={() => onSetViewMode(modeOption.key)}
          type="button"
        >
          {modeOption.label}
        </button>
      ))}
    </div>
  );
}

function BlueprintSubtaskList({ subtasks }: { subtasks: BlueprintSubtaskNode[] }) {
  if (subtasks.length === 0) {
    return null;
  }

  return (
    <ul className={styles.blueprintSubtaskList}>
      {subtasks.map((subtask) => (
        <li key={subtask.key} className={styles.blueprintSubtaskRow}>
          <span className={styles.subtaskIcon}>⬡</span>
          <span className={styles.storyKey}>{subtask.key}</span>
          <span className={styles.storySummary}>{subtask.summary}</span>
          <span className={`${styles.storyStatus} ${readStatusToneClassName(subtask.status)}`}>{subtask.status}</span>
          {subtask.assignee && <span className={styles.storyAssignee}>👤 {subtask.assignee}</span>}
        </li>
      ))}
    </ul>
  );
}

function BlueprintStoryRow({ story }: { story: BlueprintStoryNode }) {
  const isDone = isStoryDone(story.status);
  return (
    <li className={`${styles.blueprintStoryRow} ${isDone ? styles.blueprintStoryRowDone : ''}`}>
      <div className={styles.blueprintStoryMainRow}>
        <span className={styles.storyTypeBadge}>{story.issueType}</span>
        <span className={styles.storyKey}>{story.key}</span>
        <span className={styles.storySummary}>{story.summary}</span>
        {story.teamName && <span className={styles.storyTeamName}>{story.teamName}</span>}
        {story.assignee && <span className={styles.storyAssignee}>👤 {story.assignee}</span>}
        {story.storyPoints !== null && <span className={styles.storyPointsBadge}>{story.storyPoints} SP</span>}
        <span className={`${styles.storyStatus} ${readStatusToneClassName(story.status)}`}>{story.status}</span>
        {story.isOffTrain && <span className={styles.offTrainBadge}>Off-train</span>}
      </div>
      {story.offTrainReasons.length > 0 && (
        <div className={styles.offTrainReasonRow}>
          {story.offTrainReasons.map((reason) => (
            <span className={styles.offTrainReasonBadge} key={`${story.key}-${reason.code}`}>
              {reason.label}
            </span>
          ))}
        </div>
      )}
      <BlueprintSubtaskList subtasks={story.subtasks} />
    </li>
  );
}

function BlueprintStoryList({
  stories,
  offTrainStories,
}: {
  stories: BlueprintStoryNode[];
  offTrainStories: BlueprintStoryNode[];
}) {
  return (
    <ul className={styles.blueprintStoryList}>
      {stories.map((story) => (
        <BlueprintStoryRow key={story.key} story={story} />
      ))}
      {offTrainStories.map((story) => (
        <BlueprintStoryRow key={story.key} story={story} />
      ))}
    </ul>
  );
}

function BlueprintFeatureRow({
  feature,
  isCollapsed,
  onToggleCollapse,
  showStories,
}: {
  feature: BlueprintFeatureNode;
  isCollapsed: boolean;
  onToggleCollapse: (featureKey: string) => void;
  showStories: boolean;
}) {
  const storyCount = feature.children.length + feature.offTrain.length;
  return (
    <div className={styles.blueprintFeatureBlock}>
      <div className={styles.blueprintFeatureRow}>
        <button
          className={styles.blueprintChevron}
          onClick={() => onToggleCollapse(feature.key)}
          aria-label={isCollapsed ? `Expand ${feature.key}` : `Collapse ${feature.key}`}
          aria-expanded={!isCollapsed}
          type="button"
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <HealthRing completionPercent={feature.completionPercent} healthStatus={feature.health} />
        <span className={styles.featureKey}>{feature.key}</span>
        <span className={styles.featureSummary}>{feature.summary}</span>
        <span className={styles.featureStatus}>{feature.status}</span>
        <span className={styles.storyCount}>{storyCount} {storyCount === 1 ? 'story' : 'stories'}</span>
        {feature.isExternal && <span className={styles.externalBadge}>External</span>}
      </div>
      {!isCollapsed && showStories && (
        <BlueprintStoryList stories={feature.children} offTrainStories={feature.offTrain} />
      )}
    </div>
  );
}

function BlueprintProgramEpicCard({
  programEpic,
  collapsedProgramEpicKeys,
  collapsedFeatureKeys,
  onToggleProgramEpicCollapse,
  onToggleFeatureCollapse,
  showStories,
}: {
  programEpic: BlueprintProgramEpicNode;
  collapsedProgramEpicKeys: Set<string>;
  collapsedFeatureKeys: Set<string>;
  onToggleProgramEpicCollapse: (programEpicKey: string) => void;
  onToggleFeatureCollapse: (featureKey: string) => void;
  showStories: boolean;
}) {
  const isCollapsed = collapsedProgramEpicKeys.has(programEpic.key);
  const totalStoryCount = programEpic.features.reduce((storyCount, feature) => storyCount + feature.children.length, 0);
  return (
    <section className={styles.programEpicCard}>
      <button
        className={styles.programEpicHeader}
        onClick={() => onToggleProgramEpicCollapse(programEpic.key)}
        style={{ borderLeftColor: HEALTH_COLOR_MAP[programEpic.health] }}
        type="button"
      >
        <span className={styles.programEpicIcon}>🔷</span>
        <div className={styles.programEpicSummary}>
          <div className={styles.programEpicTitle}>
            {programEpic.key !== '_none_' ? `${programEpic.key} — ` : ''}
            {programEpic.summary}
          </div>
          {programEpic.status && (
            <div className={styles.programEpicMeta}>
              {programEpic.status} · {programEpic.features.length} feature(s) · {totalStoryCount} story/defect(s)
            </div>
          )}
        </div>
        <div className={styles.programEpicProgress}>
          <div className={styles.programEpicProgressBar}>
            <div
              className={styles.programEpicProgressFill}
              style={{
                backgroundColor: HEALTH_COLOR_MAP[programEpic.health],
                width: `${programEpic.completionPercent}%`,
              }}
            />
          </div>
          <span className={styles.programEpicPercent}>{programEpic.completionPercent}%</span>
          <span className={styles.programEpicChevron}>{isCollapsed ? '▶' : '▼'}</span>
        </div>
      </button>
      {!isCollapsed && (
        <div className={styles.programEpicBody}>
          {programEpic.features.map((feature) => (
            <BlueprintFeatureRow
              key={feature.key}
              feature={feature}
              isCollapsed={collapsedFeatureKeys.has(feature.key)}
              onToggleCollapse={onToggleFeatureCollapse}
              showStories={showStories}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BlueprintFeatureList({
  features,
  collapsedFeatureKeys,
  onToggleFeatureCollapse,
  showStories,
}: {
  features: BlueprintFeatureNode[];
  collapsedFeatureKeys: Set<string>;
  onToggleFeatureCollapse: (featureKey: string) => void;
  showStories: boolean;
}) {
  return (
    <div className={styles.blueprintFeatureList}>
      {features.map((feature) => (
        <BlueprintFeatureRow
          key={feature.key}
          feature={feature}
          isCollapsed={collapsedFeatureKeys.has(feature.key)}
          onToggleCollapse={onToggleFeatureCollapse}
          showStories={showStories}
        />
      ))}
    </div>
  );
}

function BlueprintTeamBuckets({
  programEpics,
  collapsedFeatureKeys,
  onToggleFeatureCollapse,
}: {
  programEpics: BlueprintProgramEpicNode[];
  collapsedFeatureKeys: Set<string>;
  onToggleFeatureCollapse: (featureKey: string) => void;
}) {
  const featureBucketsByTeamName = useMemo(() => {
    const teamBuckets = new Map<string, BlueprintFeatureNode[]>();
    for (const feature of flattenProgramEpicFeatures(programEpics)) {
      const featureTeamNames = Array.from(new Set(feature.children.map((story) => story.teamName).filter(Boolean)));
      for (const teamName of featureTeamNames) {
        const teamFeatures = teamBuckets.get(teamName!) ?? [];
        teamFeatures.push({
          ...feature,
          children: feature.children.filter((story) => story.teamName === teamName),
        });
        teamBuckets.set(teamName!, teamFeatures);
      }
    }

    return Array.from(teamBuckets.entries()).sort(([leftTeamName], [rightTeamName]) => leftTeamName.localeCompare(rightTeamName));
  }, [programEpics]);

  return (
    <div className={styles.teamBucketList}>
      {featureBucketsByTeamName.map(([teamName, features]) => (
        <section className={styles.teamBucketCard} key={teamName}>
          <h4 className={styles.teamBucketTitle}>{teamName}</h4>
          <BlueprintFeatureList
            features={features}
            collapsedFeatureKeys={collapsedFeatureKeys}
            onToggleFeatureCollapse={onToggleFeatureCollapse}
            showStories
          />
        </section>
      ))}
    </div>
  );
}

interface BlueprintTabProps {
  teams: ArtTeam[];
  selectedPiName: string;
}

/** Blueprint tab: displays the bottom-up Program Epic hierarchy derived from ART team issues. */
export default function BlueprintTab({ teams, selectedPiName }: BlueprintTabProps) {
  const [viewMode, setViewMode] = useState<BlueprintViewMode>('hierarchy');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [programEpics, setProgramEpics] = useState<BlueprintProgramEpicNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsedProgramEpicKeys, setCollapsedProgramEpicKeys] = useState<Set<string>>(new Set());
  const [collapsedFeatureKeys, setCollapsedFeatureKeys] = useState<Set<string>>(new Set());

  const hasNoPiSelected = !selectedPiName.trim();
  const hasNoTeams = teams.length === 0;
  const hasLoadedData = programEpics !== null;
  const filteredProgramEpics = filterProgramEpicsBySearch(programEpics ?? [], searchTerm);
  const flattenedFeatures = flattenProgramEpicFeatures(filteredProgramEpics);

  async function handleLoadBlueprint() {
    if (hasNoTeams) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const loadedProgramEpics = await fetchBlueprintHierarchy(teams, selectedPiName);
      setProgramEpics(loadedProgramEpics);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load blueprint data');
    } finally {
      setIsLoading(false);
    }
  }

  function toggleProgramEpicCollapse(programEpicKey: string) {
    setCollapsedProgramEpicKeys((previous) => {
      const nextProgramEpicKeys = new Set(previous);
      if (nextProgramEpicKeys.has(programEpicKey)) {
        nextProgramEpicKeys.delete(programEpicKey);
      } else {
        nextProgramEpicKeys.add(programEpicKey);
      }

      return nextProgramEpicKeys;
    });
  }

  function toggleFeatureCollapse(featureKey: string) {
    setCollapsedFeatureKeys((previous) => {
      const nextFeatureKeys = new Set(previous);
      if (nextFeatureKeys.has(featureKey)) {
        nextFeatureKeys.delete(featureKey);
      } else {
        nextFeatureKeys.add(featureKey);
      }

      return nextFeatureKeys;
    });
  }

  if (hasNoPiSelected) {
    return (
      <div className={styles.blueprintTab}>
        <p className={styles.warningText}>No PI selected. Choose a PI from the selector above to enable the Blueprint hierarchy.</p>
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

  const shouldShowStories = viewMode !== 'features';
  const shouldShowProgramEpics = viewMode === 'hierarchy';
  const shouldShowTeamBuckets = viewMode === 'by-team';
  const shouldShowFlatFeatures = viewMode === 'features' || viewMode === 'flat';
  const hasVisibleBlueprintData = shouldShowProgramEpics
    ? filteredProgramEpics.length > 0
    : flattenedFeatures.length > 0;

  return (
    <div className={styles.blueprintTab}>
      <div className={styles.blueprintToolbar}>
        <button className={styles.loadBtn} onClick={handleLoadBlueprint} disabled={isLoading} type="button">
          {isLoading ? 'Loading…' : hasLoadedData ? 'Reload Blueprint' : 'Load Blueprint'}
        </button>
        <BlueprintViewModeSwitcher viewMode={viewMode} onSetViewMode={setViewMode} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search Program Epics, features, or stories…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      {loadError && <p className={styles.errorText}>{loadError}</p>}
      {isLoading && <p className={styles.loadingText}>Loading blueprint hierarchy…</p>}

      {!isLoading && !hasLoadedData && !loadError && (
        <p className={styles.emptyState}>Click "Load Blueprint" to run the legacy bottom-up Program Epic hierarchy query chain.</p>
      )}

      {!isLoading && hasLoadedData && !hasVisibleBlueprintData && (
        <p className={styles.emptyState}>
          {searchTerm
            ? 'No Program Epics, features, or stories match the current search.'
            : 'No Program Epics found. Check that the Feature Link and Parent Link fields are configured correctly in ART Settings.'}
        </p>
      )}

      {!isLoading && shouldShowProgramEpics && filteredProgramEpics.length > 0 && (
        <div className={styles.programEpicList}>
          {filteredProgramEpics.map((programEpic) => (
            <BlueprintProgramEpicCard
              key={programEpic.key}
              programEpic={programEpic}
              collapsedProgramEpicKeys={collapsedProgramEpicKeys}
              collapsedFeatureKeys={collapsedFeatureKeys}
              onToggleProgramEpicCollapse={toggleProgramEpicCollapse}
              onToggleFeatureCollapse={toggleFeatureCollapse}
              showStories={shouldShowStories}
            />
          ))}
        </div>
      )}

      {!isLoading && shouldShowTeamBuckets && filteredProgramEpics.length > 0 && (
        <BlueprintTeamBuckets
          programEpics={filteredProgramEpics}
          collapsedFeatureKeys={collapsedFeatureKeys}
          onToggleFeatureCollapse={toggleFeatureCollapse}
        />
      )}

      {!isLoading && shouldShowFlatFeatures && flattenedFeatures.length > 0 && (
        <BlueprintFeatureList
          features={flattenedFeatures}
          collapsedFeatureKeys={collapsedFeatureKeys}
          onToggleFeatureCollapse={toggleFeatureCollapse}
          showStories={viewMode === 'flat'}
        />
      )}
    </div>
  );
}
