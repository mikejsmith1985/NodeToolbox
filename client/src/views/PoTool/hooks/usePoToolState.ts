// usePoToolState.ts — Holds the PO Tool's own tab and team/PI selection.
//
// The single most important rule in this file: the PO Tool NEVER writes the app-wide
// `sprintDashboardActiveTeamProfileId`. That value belongs to the Team Dashboard. The saved team profile
// list is a read-only catalog shared by every tool, and it already carries everything the reused tabs
// need — so the PO Tool simply tracks which profile IT is pointed at. That is what lets a PO work on one
// team here while the Team Dashboard stays on another (FR-005a, INV-T3 in contracts/tab-reuse.md).

import { useCallback, useMemo, useState } from 'react';

import { useSettingsStore, type SprintDashboardTeamProfile } from '../../../store/settingsStore';

/** The PO Tool's tabs. Two are reused as-is from the Team Dashboard; two are new authoring surfaces. */
export type PoToolTab = 'featurereview' | 'pireview' | 'splitter' | 'composition';

/** Where the PO Tool persists its own selection — deliberately separate from any Team Dashboard key. */
export const PO_TOOL_SELECTION_STORAGE_KEY = 'tbxPoToolSelection';

/** The PO Tool's persisted selection. Kept small and additive so an older payload still reads cleanly. */
interface PoToolStoredSelection {
  selectedTeamProfileId?: string;
  selectedPiName?: string;
}

export interface PoToolState {
  activeTab: PoToolTab;
  setActiveTab: (tab: PoToolTab) => void;
  selectedTeamProfileId: string;
  setSelectedTeamProfileId: (teamProfileId: string) => void;
  selectedTeamProfile: SprintDashboardTeamProfile | null;
  selectedPiName: string;
  setSelectedPiName: (piName: string) => void;
}

/** Guards every storage touch — private browsing and blocked storage must degrade, never throw. */
function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Reads the stored selection, treating anything unreadable as "no stored selection". */
function readStoredSelection(): PoToolStoredSelection {
  if (!canUseLocalStorage()) {
    return {};
  }
  try {
    const storedValue = window.localStorage.getItem(PO_TOOL_SELECTION_STORAGE_KEY);
    if (storedValue === null) {
      return {};
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return {};
    }
    return parsedValue as PoToolStoredSelection;
  } catch {
    // A corrupt selection must never stop the tool opening — fall back to the defaults.
    return {};
  }
}

/** Persists the selection; a blocked or full store is a no-op, not an error. */
function writeStoredSelection(selection: PoToolStoredSelection): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(PO_TOOL_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Storage full or blocked — the in-memory selection remains authoritative for this session.
  }
}

/**
 * Provides the PO Tool's tab and team/PI selection, restoring the PO's last choice where possible.
 *
 * The first time the tool is opened it starts on the app-wide active team purely as a convenience
 * (the PO is most likely to want the team they were just looking at). From that point the two
 * selections move independently: nothing here ever writes the app-wide value back.
 */
export function usePoToolState(): PoToolState {
  const teamProfiles = useSettingsStore((storeState) => storeState.sprintDashboardTeamProfiles);
  // Read-only: the app-wide active team seeds the FIRST visit, and is never written by this tool.
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );

  const [activeTab, setActiveTab] = useState<PoToolTab>('featurereview');

  const [storedSelection] = useState<PoToolStoredSelection>(readStoredSelection);

  // A stored profile that has since been deleted must not strand the tool on a dangling id.
  const initialTeamProfileId = useMemo(() => {
    const storedTeamProfileId = storedSelection.selectedTeamProfileId ?? '';
    const isStoredProfileStillSaved = teamProfiles.some(
      (teamProfile) => teamProfile.id === storedTeamProfileId,
    );
    return isStoredProfileStillSaved ? storedTeamProfileId : activeDashboardTeamProfileId;
    // Resolved once on mount; later profile edits must not yank the PO's current selection away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedTeamProfileId, setSelectedTeamProfileIdState] = useState(initialTeamProfileId);
  const [piNameOverride, setPiNameOverride] = useState(storedSelection.selectedPiName ?? '');

  const selectedTeamProfile = useMemo(
    () => teamProfiles.find((teamProfile) => teamProfile.id === selectedTeamProfileId) ?? null,
    [teamProfiles, selectedTeamProfileId],
  );

  // An explicit PI override wins; otherwise follow the selected team's own PI so switching team
  // switches PI too, which is what a PO expects when they change which team they are planning for.
  const selectedPiName = piNameOverride.trim() || (selectedTeamProfile?.selectedPiValue ?? '');

  const setSelectedTeamProfileId = useCallback(
    (teamProfileId: string) => {
      setSelectedTeamProfileIdState(teamProfileId);
      // Changing team clears a stale PI override so the new team's own PI applies.
      setPiNameOverride('');
      writeStoredSelection({ selectedTeamProfileId: teamProfileId, selectedPiName: '' });
    },
    [],
  );

  const setSelectedPiName = useCallback(
    (piName: string) => {
      setPiNameOverride(piName);
      writeStoredSelection({ selectedTeamProfileId, selectedPiName: piName });
    },
    [selectedTeamProfileId],
  );

  return {
    activeTab,
    setActiveTab,
    selectedTeamProfileId,
    setSelectedTeamProfileId,
    selectedTeamProfile,
    selectedPiName,
    setSelectedPiName,
  };
}
