// SprintDashboardPiReviewTab.tsx — Routes PI Review authoring through Team Dashboard for the current team.

import { useMemo } from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import PiReviewTab from '../ArtView/PiReviewTab.tsx';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import CapacityTab from './CapacityTab.tsx';
import PiFeatureRemapPanel from './PiFeatureRemapPanel.tsx';
import { buildCapacitySummary } from './capacityModel.ts';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import {
  findMatchingArtTeam,
  readFallbackSelectedPiName,
  readStoredArtTeams,
} from './sprintDashboardArtContext.ts';
import styles from './SprintDashboardView.module.css';

const ART_VIEW_ROUTE = '/art';
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
        <CapacityTab selectedPiName={effectiveSelectedPiName} />
      </section>
      <PiReviewTab
        mode="authoring"
        selectedPiName={effectiveSelectedPiName}
        teamCapacitySummaries={{ [piReviewTeam.id]: hasCapacityContext ? teamDashboardCapacitySummary : null }}
        teams={[piReviewTeam]}
      />
      <PiFeatureRemapPanel
        projectKey={projectKey}
        selectedPiName={effectiveSelectedPiName}
      />
    </div>
  );
}
