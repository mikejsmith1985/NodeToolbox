// PoTeamSelector.tsx — The PO Tool's own team and Program Increment picker.
//
// This is deliberately a separate control from the Team Dashboard's team switcher. It reads the same saved
// team profiles (a shared, read-only catalog) but reports changes back to the PO Tool alone, so a PO can
// plan for one team here while their Team Dashboard stays where they left it (FR-005a, INV-T3).
//
// The Program Increment is a Jira-populated dropdown (US4 / FR-012..014): the PO chooses from the PIs that
// actually exist for the selected team rather than typing a label from memory. When Jira cannot be reached
// it degrades to a manual-entry field so the tool is never blocked by an empty, locked control (FR-014).

import { useCallback, useEffect, useState } from 'react';

import { useSettingsStore } from '../../store/settingsStore';
import { loadAvailablePiNamesFromJira, type ArtTeam } from '../ArtView/hooks/useArtData';
import styles from './PoToolView.module.css';

interface PoTeamSelectorProps {
  /** The team profile the PO Tool is currently pointed at. */
  selectedTeamProfileId: string;
  /** The Program Increment in effect — the team's own PI unless the PO overrode it. */
  selectedPiName: string;
  /**
   * The selected team translated to the ArtTeam shape. It is the input to the PI-name lookup, so changing
   * team (a new array from the parent) automatically refreshes the Program Increment options.
   */
  piReviewTeams: ArtTeam[];
  onTeamProfileChange: (teamProfileId: string) => void;
  onPiNameChange: (piName: string) => void;
}

/** The live result of loading a team's Program Increment labels from Jira. */
interface PiNameOptionsState {
  availablePiNames: string[];
  isLoadingPiOptions: boolean;
  hasLoadFailed: boolean;
  reloadPiOptions: () => void;
}

/** A single load outcome, tagged with the exact request it answers so stale results can be ignored. */
interface PiNameRequestResult {
  requestId: string;
  piNames: string[];
  hasFailed: boolean;
}

/** The "nothing loaded yet" record — its empty requestId never matches a real request, so it reads as loading. */
const EMPTY_PI_NAME_RESULT: PiNameRequestResult = { requestId: '', piNames: [], hasFailed: false };

/**
 * Loads the Program Increment labels available for the selected team, mirroring the ArtView PI selector.
 *
 * The lookup re-runs on mount, whenever the selected team changes, and when the PO clicks Reload. Loading
 * and failure are DERIVED from whether the stored result answers the current request — so every state
 * update happens inside an async continuation (`.then`/`.catch`), never synchronously in the effect body.
 * That keeps the control honest about loading/failure without tripping the set-state-in-effect rule.
 */
function usePiNameOptions(piReviewTeams: ArtTeam[]): PiNameOptionsState {
  const [piNameResult, setPiNameResult] = useState<PiNameRequestResult>(EMPTY_PI_NAME_RESULT);
  // Bumped by the Reload button to force a fresh fetch even when the team is unchanged.
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const hasSelectedTeam = piReviewTeams.length > 0;
  // A stable identity for "which PIs we should be showing" — team roster plus the manual reload counter.
  const requestId = `${piReviewTeams.map((team) => team.id).join(',')}#${reloadNonce}`;

  useEffect(() => {
    // Nothing to query until a team is selected — its ArtTeam is what scopes the PI lookup.
    if (!hasSelectedTeam) {
      return;
    }
    // Guard against a slow earlier request overwriting a newer one after the team changed.
    let isIgnored = false;
    loadAvailablePiNamesFromJira(piReviewTeams)
      .then((loadedPiNames) => {
        if (!isIgnored) {
          setPiNameResult({ requestId, piNames: loadedPiNames, hasFailed: false });
        }
      })
      .catch(() => {
        // A Jira/VPN outage must never lock the PO out — record the failure so manual entry can take over.
        if (!isIgnored) {
          setPiNameResult({ requestId, piNames: [], hasFailed: true });
        }
      });
    return () => {
      isIgnored = true;
    };
  }, [requestId, hasSelectedTeam, piReviewTeams]);

  // The stored result is authoritative only while it still answers the current request; otherwise we are
  // mid-load and must show nothing yet (which the control renders as a loading dropdown).
  const isResultCurrent = piNameResult.requestId === requestId;
  const availablePiNames = isResultCurrent ? piNameResult.piNames : [];
  const hasLoadFailed = isResultCurrent && piNameResult.hasFailed;
  const isLoadingPiOptions = hasSelectedTeam && !isResultCurrent;

  const reloadPiOptions = useCallback(() => {
    setReloadNonce((previousNonce) => previousNonce + 1);
  }, []);

  return { availablePiNames, isLoadingPiOptions, hasLoadFailed, reloadPiOptions };
}

/**
 * Builds the option list shown in the dropdown. A currently-selected PI that is not in the freshly loaded
 * list is kept at the front so the PO's persisted choice never silently disappears from view.
 */
function buildPiOptionList(availablePiNames: string[], selectedPiName: string): string[] {
  if (selectedPiName && !availablePiNames.includes(selectedPiName)) {
    return [selectedPiName, ...availablePiNames];
  }
  return availablePiNames;
}

/** Lets the PO choose which team and PI this tool is working on, independently of any other tool. */
export default function PoTeamSelector({
  selectedTeamProfileId,
  selectedPiName,
  piReviewTeams,
  onTeamProfileChange,
  onPiNameChange,
}: PoTeamSelectorProps) {
  const teamProfiles = useSettingsStore((storeState) => storeState.sprintDashboardTeamProfiles);
  const { availablePiNames, isLoadingPiOptions, hasLoadFailed, reloadPiOptions } =
    usePiNameOptions(piReviewTeams);

  // Teams are configured once in Settings and shared by every tool; the PO Tool does not create them.
  if (teamProfiles.length === 0) {
    return (
      <section className={styles.teamSelector}>
        <p className={styles.teamSelectorEmpty}>
          Save a dashboard team first (Settings → Saved Dashboard Teams), then pick it here.
        </p>
      </section>
    );
  }

  // Offer manual entry when the load failed, or finished with nothing to choose from — never a locked,
  // empty dropdown. While a request is still in flight we keep the dropdown so the PO sees it is loading.
  const shouldOfferManualEntry =
    hasLoadFailed || (!isLoadingPiOptions && availablePiNames.length === 0);
  const piOptionNames = buildPiOptionList(availablePiNames, selectedPiName);

  return (
    <section className={styles.teamSelector}>
      <div className={styles.teamSelectorField}>
        <label className={styles.teamSelectorLabel} htmlFor="po-tool-team">
          Team
        </label>
        <select
          className={styles.teamSelectorControl}
          id="po-tool-team"
          value={selectedTeamProfileId}
          onChange={(changeEvent) => onTeamProfileChange(changeEvent.target.value)}
        >
          {teamProfiles.map((teamProfile) => (
            <option key={teamProfile.id} value={teamProfile.id}>
              {teamProfile.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.teamSelectorField}>
        <label className={styles.teamSelectorLabel} htmlFor="po-tool-pi">
          Program Increment
        </label>

        {shouldOfferManualEntry ? (
          <input
            className={styles.teamSelectorControl}
            id="po-tool-pi"
            type="text"
            value={selectedPiName}
            placeholder="PI 2026.3"
            onChange={(changeEvent) => onPiNameChange(changeEvent.target.value)}
          />
        ) : (
          <select
            className={styles.teamSelectorControl}
            id="po-tool-pi"
            value={selectedPiName}
            disabled={isLoadingPiOptions}
            onChange={(changeEvent) => onPiNameChange(changeEvent.target.value)}
          >
            <option value="">
              {isLoadingPiOptions ? 'Loading program increments…' : '— Select Program Increment —'}
            </option>
            {piOptionNames.map((piName) => (
              <option key={piName} value={piName}>
                {piName}
              </option>
            ))}
          </select>
        )}

        {shouldOfferManualEntry && (
          <p className={styles.teamSelectorHint}>
            {hasLoadFailed
              ? 'Couldn’t load program increments from Jira — type the PI name, or reload.'
              : 'No program increments found for this team — type the PI name, or reload.'}
          </p>
        )}

        <button
          className={styles.teamSelectorReload}
          type="button"
          disabled={isLoadingPiOptions}
          onClick={() => {
            void reloadPiOptions();
          }}
        >
          {isLoadingPiOptions ? 'Loading…' : 'Reload PIs'}
        </button>
      </div>

      <p className={styles.teamSelectorNote}>
        This selection is independent of the Team Dashboard — changing it here will not change your
        dashboard, and vice versa.
      </p>
    </section>
  );
}
