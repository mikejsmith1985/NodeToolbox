// SprintDashboardPiReviewTab.tsx — Routes PI Review authoring through Team Dashboard for the current team.

import { useMemo } from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import PiReviewTab from '../ArtView/PiReviewTab.tsx';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import CapacityTab from './CapacityTab.tsx';
import { buildCapacitySummary } from './capacityModel.ts';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import styles from './SprintDashboardView.module.css';

const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams';
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const ART_VIEW_ROUTE = '/art';
const EMPTY_PI_NAME = '';
const EMPTY_CONTEXT_LABEL = 'Not selected';
const PI_REVIEW_CAPACITY_INTRO =
  'Plan capacity here first so the same snapshot feeds Feature Scope, Confidence, and the Confluence PI Review save.';

interface SprintDashboardPiReviewTabProps {
  boardId: number | null;
  boardName: string | null;
  projectKey: string;
  selectedPiName: string;
  sprintIssues: JiraIssue[];
}

interface StoredArtSettings {
  piName?: string;
}

function normalizeStoredArtTeam(team: Partial<ArtTeam>): ArtTeam | null {
  const teamName = typeof team.name === 'string' ? team.name.trim() : '';
  const teamBoardId = typeof team.boardId === 'string' ? team.boardId.trim() : '';
  if (teamName === '' || teamBoardId === '') {
    return null;
  }

  return {
    id: typeof team.id === 'string' && team.id.trim() !== '' ? team.id.trim() : `${teamBoardId}-${teamName}`,
    name: teamName,
    boardId: teamBoardId,
    boardName: typeof team.boardName === 'string' && team.boardName.trim() !== '' ? team.boardName.trim() : undefined,
    projectKey: typeof team.projectKey === 'string' && team.projectKey.trim() !== '' ? team.projectKey.trim() : undefined,
    piReviewPageUrl: typeof team.piReviewPageUrl === 'string' && team.piReviewPageUrl.trim() !== '' ? team.piReviewPageUrl.trim() : undefined,
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}

function readStoredArtTeams(): ArtTeam[] {
  try {
    const storedTeams = localStorage.getItem(ART_TEAMS_STORAGE_KEY);
    if (!storedTeams) {
      return [];
    }

    const parsedTeams = JSON.parse(storedTeams) as unknown;
    if (!Array.isArray(parsedTeams)) {
      return [];
    }

    return parsedTeams
      .filter((team): team is Partial<ArtTeam> => typeof team === 'object' && team !== null)
      .map((team) => normalizeStoredArtTeam(team))
      .filter((team): team is ArtTeam => team !== null);
  } catch {
    return [];
  }
}

function readFallbackSelectedPiName(): string {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as StoredArtSettings;
    return storedSettings.piName?.trim() || EMPTY_PI_NAME;
  } catch {
    return EMPTY_PI_NAME;
  }
}

function findMatchingArtTeam(artTeams: ArtTeam[], boardId: number | null, projectKey: string): ArtTeam | null {
  const normalizedBoardId = boardId === null ? '' : String(boardId);
  const normalizedProjectKey = projectKey.trim().toUpperCase();

  if (normalizedBoardId !== '' && normalizedProjectKey !== '') {
    const exactMatch = artTeams.find((team) =>
      team.boardId === normalizedBoardId
      && (team.projectKey?.trim().toUpperCase() ?? '') === normalizedProjectKey);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (normalizedBoardId !== '') {
    const boardMatch = artTeams.find((team) => team.boardId === normalizedBoardId);
    if (boardMatch) {
      return boardMatch;
    }
  }

  if (normalizedProjectKey === '') {
    return null;
  }

  return artTeams.find((team) => (team.projectKey?.trim().toUpperCase() ?? '') === normalizedProjectKey) ?? null;
}

function readCapacityBoardLabel(boardName: string | null, boardId: number | null): string {
  if (boardName && boardName.trim() !== '') {
    return boardName.trim();
  }

  return boardId === null ? EMPTY_CONTEXT_LABEL : String(boardId);
}

/** Mounts the shared PI Review editor inside Team Dashboard for the current matched ART team. */
export default function SprintDashboardPiReviewTab({
  boardId,
  boardName,
  projectKey,
  selectedPiName,
  sprintIssues,
}: SprintDashboardPiReviewTabProps) {
  const storedArtTeams = useMemo(() => readStoredArtTeams(), []);
  const boardLabel = readCapacityBoardLabel(boardName, boardId);
  const capacityStartDate = useCapacityStore((state) => state.startDate);
  const capacityEndDate = useCapacityStore((state) => state.endDate);
  const capacityRows = useCapacityStore((state) => state.rows);
  const matchedArtTeam = useMemo(
    () => findMatchingArtTeam(storedArtTeams, boardId, projectKey),
    [boardId, projectKey, storedArtTeams],
  );
  const effectiveSelectedPiName = selectedPiName.trim() || readFallbackSelectedPiName();

  if (!matchedArtTeam || !matchedArtTeam.piReviewPageUrl) {
    return (
      <section className={styles.piReviewAuthoringCard}>
        <h2 className={styles.settingsSectionTitle}>PI Review authoring</h2>
        <p className={styles.piReviewAuthoringText}>
          Team Dashboard owns PI Review creation and maintenance, but this dashboard does not yet match an ART team with a configured PI Review page URL.
        </p>
        <p className={styles.piReviewAuthoringText}>
          Current dashboard context: board <strong>{boardName || boardId || 'Not selected'}</strong>
          {projectKey.trim() !== '' ? <> in project <strong>{projectKey.trim().toUpperCase()}</strong></> : null}.
        </p>
        <a className={styles.piReviewAuthoringLink} href={ART_VIEW_ROUTE}>
          Open ART Settings
        </a>
      </section>
    );
  }

  const piReviewTeam: ArtTeam = {
    ...matchedArtTeam,
    sprintIssues,
    isLoading: false,
    loadError: null,
  };
  const teamDashboardCapacitySummary = buildCapacitySummary(
    `${piReviewTeam.name} Capacity`,
    capacityRows,
    capacityStartDate,
    capacityEndDate,
  );
  const hasCapacityContext = capacityRows.length > 0 && teamDashboardCapacitySummary.workDayCount > 0;

  return (
    <div className={styles.piReviewWorkspace}>
      <section className={styles.piReviewCapacitySection}>
        <div className={styles.piReviewCapacityHeader}>
          <div>
            <h2 className={styles.settingsSectionTitle}>Capacity</h2>
            <p className={styles.piReviewCapacityText}>{PI_REVIEW_CAPACITY_INTRO}</p>
          </div>
          <span className={styles.piReviewCapacityBadge}>PI prep context</span>
        </div>
        <div className={styles.piReviewCapacityMetaRow}>
          <span className={styles.piReviewCapacityMetaPill}>
            Board context: <strong>{boardLabel}</strong>
          </span>
          <span className={styles.piReviewCapacityMetaPill}>
            Confluence sync: <strong>{hasCapacityContext ? 'Live snapshot ready' : 'Waiting for a complete plan'}</strong>
          </span>
        </div>
        <CapacityTab />
      </section>
      <PiReviewTab
        mode="authoring"
        selectedPiName={effectiveSelectedPiName}
        teamCapacitySummaries={{ [piReviewTeam.id]: hasCapacityContext ? teamDashboardCapacitySummary : null }}
        teams={[piReviewTeam]}
      />
    </div>
  );
}
