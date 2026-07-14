// SprintDashboardPiReviewTab.tsx — Routes PI Review authoring through Team Dashboard for the current team.

import type { JiraIssue } from '../../types/jira.ts';
import PiReviewTab from '../ArtView/PiReviewTab.tsx';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import CapacityTab from './CapacityTab.tsx';
import PiFeatureRemapPanel from './PiFeatureRemapPanel.tsx';
import RiskManagementSection from './RiskManagementSection.tsx';
import { buildCapacitySummary } from './capacityModel.ts';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { readFallbackSelectedPiName } from './sprintDashboardArtContext.ts';
import styles from './SprintDashboardView.module.css';

const EMPTY_CONTEXT_LABEL = 'Not selected';
const PI_REVIEW_CAPACITY_INTRO =
  'Plan capacity here first so the same snapshot feeds Feature Scope, Confidence, and the Confluence PI Review save.';

interface SprintDashboardPiReviewTabProps {
  boardId: number | null;
  boardName: string | null;
  projectKey: string;
  /** Jira customfield ID for Risk Impact Date; empty string when not configured in Settings. */
  riskImpactDateFieldId: string;
  /** Jira customfield ID for the Risk Response / ROAM disposition field; empty string when not configured. */
  riskResponseFieldId: string;
  selectedPiName: string;
  sprintIssues: JiraIssue[];
}

function readCapacityBoardLabel(boardName: string | null, boardId: number | null): string {
  if (boardName && boardName.trim() !== '') {
    return boardName.trim();
  }

  return boardId === null ? EMPTY_CONTEXT_LABEL : String(boardId);
}

/** Mounts the shared PI Review editor and Risk Management panel inside Team Dashboard. */
export default function SprintDashboardPiReviewTab({
  boardId,
  boardName,
  projectKey,
  riskImpactDateFieldId,
  riskResponseFieldId,
  selectedPiName,
  sprintIssues,
}: SprintDashboardPiReviewTabProps) {
  const boardLabel = readCapacityBoardLabel(boardName, boardId);
  const capacityStartDate = useCapacityStore((state) => state.startDate);
  const capacityEndDate = useCapacityStore((state) => state.endDate);
  const capacityRows = useCapacityStore((state) => state.rows);
  // The active team profile is the single source of truth for this team's PI Review pages.
  const activeProfile = useSettingsStore(
    (storeState) =>
      storeState.sprintDashboardTeamProfiles.find(
        (profile) => profile.id === storeState.sprintDashboardActiveTeamProfileId,
      ) ?? null,
  );
  const effectiveSelectedPiName = selectedPiName.trim() || readFallbackSelectedPiName();
  const configuredPiReviewPages = activeProfile?.piReviewPages ?? [];
  // The team is ready for authoring once it has at least one PI Review page with a URL.
  const hasConfiguredPiReviewPage = configuredPiReviewPages.some((page) => page.pageUrl.trim() !== '');

  if (!activeProfile || !hasConfiguredPiReviewPage) {
    return (
      <section className={styles.piReviewAuthoringCard}>
        <h2 className={styles.settingsSectionTitle}>PI Review authoring</h2>
        <p className={styles.piReviewAuthoringText}>
          {activeProfile
            ? 'This team has no PI Review pages configured yet. Add one Confluence page per Program Increment in Settings → Saved Dashboard Teams → PI Review Pages, then Save the team.'
            : 'Save a dashboard team first (Settings), then add its PI Review pages there.'}
        </p>
        <p className={styles.piReviewAuthoringText}>
          Current dashboard context: board <strong>{boardName || boardId || 'Not selected'}</strong>
          {projectKey.trim() !== '' ? <> in project <strong>{projectKey.trim().toUpperCase()}</strong></> : null}.
        </p>
      </section>
    );
  }

  // Build the ArtTeam-shaped object the shared PI Review editor expects, sourced from the profile.
  const piReviewTeam: ArtTeam = {
    id: activeProfile.id,
    name: activeProfile.name,
    boardId: activeProfile.boardId,
    projectKey: activeProfile.projectKey || undefined,
    piReviewPages: configuredPiReviewPages,
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
      <RiskManagementSection
        projectKey={projectKey}
        riskImpactDateFieldId={riskImpactDateFieldId}
        riskResponseFieldId={riskResponseFieldId}
        selectedPiName={effectiveSelectedPiName}
      />
    </div>
  );
}
