// PoToolView.tsx — The PO Tool shell: a home for Product-Owner work on Features.
//
// It brings together the two surfaces a PO already relies on — Feature Review and PI Review — with its own
// team/PI selection, and hosts two authoring tabs (Feature Splitter, Feature Composition).
//
// The reused tabs are THE SAME components the Team Dashboard mounts, never copies. That is the point: a
// change to either tab shows up in both tools, so they can never drift apart (FR-003, INV-T1).
//
// Two rules this file must keep (contracts/tab-reuse.md):
//   1. Mount `ArtView/PiReviewTab` DIRECTLY — never the Team Dashboard's PI Review adapter, which hardwires
//      the app-wide active team and pulls in execution-only concerns.
//   2. Never write `sprintDashboardActiveTeamProfileId`. That value belongs to the Team Dashboard.

import { useEffect, useMemo } from 'react';

import { PrimaryTabs, type PrimaryTabOption } from '../../components/PrimaryTabs/PrimaryTabs';
import PiReviewTab from '../ArtView/PiReviewTab.tsx';
import FeatureCompositionTab from './FeatureCompositionTab';
import FeatureSplitterTab from './FeatureSplitterTab';
import FeatureReviewTab from '../SprintDashboard/FeatureReviewTab.tsx';
import { useStandupRosterStore } from '../SprintDashboard/hooks/useStandupRosterStore';
import { buildArtTeamFromProfile } from './poToolArtTeam';
import PoTeamSelector from './PoTeamSelector';
import { usePoToolState, type PoToolTab } from './hooks/usePoToolState';
import styles from './PoToolView.module.css';

const PO_TOOL_TAB_DEFINITIONS: PrimaryTabOption<PoToolTab>[] = [
  { key: 'featurereview', label: 'Feature Review' },
  { key: 'pireview', label: 'PI Review' },
  { key: 'splitter', label: 'Feature Splitter' },
  { key: 'composition', label: 'Feature Composition' },
];

/** Matches the ids PrimaryTabs generates, so each panel is announced with its tab. */
const PO_TOOL_TAB_ID_PREFIX = 'po-tool';

/** Board ids are stored as text on a team profile but the Feature Review tab reads a number. */
function readBoardIdAsNumber(boardId: string): number | null {
  const parsedBoardId = Number.parseInt(boardId, 10);
  return Number.isNaN(parsedBoardId) ? null : parsedBoardId;
}

/** The Product Owner's home for Feature-level work. */
export default function PoToolView() {
  const {
    activeTab,
    setActiveTab,
    selectedTeamProfileId,
    setSelectedTeamProfileId,
    selectedTeamProfile,
    selectedPiName,
    setSelectedPiName,
  } = usePoToolState();

  // Scope the shared roster store to THIS tool's selected team, so PI Review's "Pull Features from Jira"
  // filters by the right Product Owner. The Team Dashboard re-asserts its own scope whenever it mounts or
  // changes team, so this cannot strand it on the PO Tool's choice.
  useEffect(() => {
    useStandupRosterStore.getState().setDashboardTeamProfileId(selectedTeamProfileId);
  }, [selectedTeamProfileId]);

  const piReviewTeams = useMemo(
    () => (selectedTeamProfile ? [buildArtTeamFromProfile(selectedTeamProfile)] : []),
    [selectedTeamProfile],
  );

  function renderActiveTabPanel() {
    if (!selectedTeamProfile) {
      return (
        <div className={styles.placeholderPanel}>
          <p className={styles.placeholderTitle}>No team selected</p>
          <p className={styles.placeholderText}>
            Pick a team above to work on. Teams are saved in Settings → Saved Dashboard Teams.
          </p>
        </div>
      );
    }

    if (activeTab === 'featurereview') {
      return (
        <FeatureReviewTab
          boardId={readBoardIdAsNumber(selectedTeamProfile.boardId)}
          boardName={selectedTeamProfile.boardName}
          projectKey={selectedTeamProfile.projectKey}
          selectedPiName={selectedPiName}
          dashboardTeamProfileId={selectedTeamProfileId}
        />
      );
    }

    if (activeTab === 'pireview') {
      // mode="authoring" is what a PO wants here: the page for the selected PI, editable. It also keeps the
      // "Edit in Team Dashboard" handoff (the tab's only write to the app-wide team) off the screen entirely.
      return <PiReviewTab mode="authoring" selectedPiName={selectedPiName} teams={piReviewTeams} />;
    }

    if (activeTab === 'splitter') {
      // Keyed by team: a draft belongs to one team, so switching team starts a clean workspace.
      return <FeatureSplitterTab key={selectedTeamProfileId} dashboardTeamProfileId={selectedTeamProfileId} />;
    }

    return (
      <FeatureCompositionTab
        key={selectedTeamProfileId}
        dashboardTeamProfileId={selectedTeamProfileId}
        defaultProjectKey={selectedTeamProfile.projectKey}
      />
    );
  }

  return (
    <div className={styles.poToolView}>
      <header className={styles.poToolHeader}>
        <h1 className={styles.poToolTitle}>🧭 PO Tool</h1>
        <p className={styles.poToolSubtitle}>
          Feature-level product owner work — review, split, and compose Features in one place.
        </p>
      </header>

      <PoTeamSelector
        selectedTeamProfileId={selectedTeamProfileId}
        selectedPiName={selectedPiName}
        onTeamProfileChange={setSelectedTeamProfileId}
        onPiNameChange={setSelectedPiName}
      />

      <PrimaryTabs
        ariaLabel="PO Tool tabs"
        idPrefix={PO_TOOL_TAB_ID_PREFIX}
        tabs={PO_TOOL_TAB_DEFINITIONS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div
        className={styles.tabPanel}
        role="tabpanel"
        id={`${PO_TOOL_TAB_ID_PREFIX}-${activeTab}-panel`}
        aria-labelledby={`${PO_TOOL_TAB_ID_PREFIX}-${activeTab}-tab`}
      >
        {renderActiveTabPanel()}
      </div>
    </div>
  );
}
