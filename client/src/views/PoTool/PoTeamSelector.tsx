// PoTeamSelector.tsx — The PO Tool's own team and Program Increment picker.
//
// This is deliberately a separate control from the Team Dashboard's team switcher. It reads the same saved
// team profiles (a shared, read-only catalog) but reports changes back to the PO Tool alone, so a PO can
// plan for one team here while their Team Dashboard stays where they left it (FR-005a, INV-T3).

import { useSettingsStore } from '../../store/settingsStore';
import styles from './PoToolView.module.css';

interface PoTeamSelectorProps {
  /** The team profile the PO Tool is currently pointed at. */
  selectedTeamProfileId: string;
  /** The Program Increment in effect — the team's own PI unless the PO overrode it. */
  selectedPiName: string;
  onTeamProfileChange: (teamProfileId: string) => void;
  onPiNameChange: (piName: string) => void;
}

/** Lets the PO choose which team and PI this tool is working on, independently of any other tool. */
export default function PoTeamSelector({
  selectedTeamProfileId,
  selectedPiName,
  onTeamProfileChange,
  onPiNameChange,
}: PoTeamSelectorProps) {
  const teamProfiles = useSettingsStore((storeState) => storeState.sprintDashboardTeamProfiles);

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
        <input
          className={styles.teamSelectorControl}
          id="po-tool-pi"
          type="text"
          value={selectedPiName}
          placeholder="PI 2026.3"
          onChange={(changeEvent) => onPiNameChange(changeEvent.target.value)}
        />
      </div>

      <p className={styles.teamSelectorNote}>
        This selection is independent of the Team Dashboard — changing it here will not change your
        dashboard, and vice versa.
      </p>
    </section>
  );
}
