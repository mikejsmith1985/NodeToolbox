// BlueprintSelectionStep.tsx — Step 1 of the Feature Canvas: pick features from the real Blueprint.
//
// Rather than re-deriving the blueprint (which got per-team counts wrong), this embeds the ART view's
// proven BlueprintTab in selection mode, fed the full ART roster so its By-Team buckets are exactly
// what ART shows. The user checks features and adds them to the canvas; then step 2 (the board) takes
// over. Custom-JQL adds remain available on the board.

import { useEffect, useState } from 'react';

import BlueprintTab from '../../ArtView/BlueprintTab.tsx';
import { loadAvailablePiNamesFromJira, type ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import controlStyles from './canvasControls.module.css';

/** Props for the blueprint selection step. */
export interface BlueprintSelectionStepProps {
  teams: ArtTeam[];
  selectedPiName: string;
  /** Called when the user picks a different PI to run the exercise against. */
  onPiChange: (piName: string) => void;
  /** Feature keys already on the canvas (shown checked + disabled). */
  onCanvasKeys: ReadonlySet<string>;
  /** Called with the chosen feature keys to seed the canvas. */
  onAdd: (keys: string[]) => void;
  onClose: () => void;
  /** Whether a canvas already exists behind this step (enables "Back to canvas"). */
  hasCanvas: boolean;
}

/** Step 1: the blueprint, with a PI picker and per-feature add-to-canvas checkboxes. */
export function BlueprintSelectionStep({ teams, selectedPiName, onPiChange, onCanvasKeys, onAdd, onClose, hasCanvas }: BlueprintSelectionStepProps): React.JSX.Element {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [availablePiNames, setAvailablePiNames] = useState<string[]>([]);

  // Load the selectable PIs once per team roster, reusing ART's PI enumeration (autocomplete →
  // issue-scan fallback). The current PI is always offered even if the lookup misses it, so the
  // picker never hides the scope the canvas is already on. All state updates happen in the async
  // callbacks (never synchronously in the effect body) to avoid cascading renders.
  useEffect(() => {
    if (teams.length === 0) {
      return undefined;
    }
    let isCancelled = false;
    loadAvailablePiNamesFromJira(teams)
      .then((piNames) => { if (!isCancelled) { setAvailablePiNames(piNames); } })
      .catch(() => { if (!isCancelled) { setAvailablePiNames([]); } });
    return () => { isCancelled = true; };
  }, [teams]);

  // Merge the active PI in so it is always selectable, even before/after the async lookup.
  const piOptions = Array.from(new Set([selectedPiName, ...availablePiNames].map((piName) => piName.trim()).filter(Boolean)));

  const handleToggle = (featureKey: string): void => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(featureKey)) {
        next.delete(featureKey);
      } else {
        next.add(featureKey);
      }
      return next;
    });
  };

  // Bulk add/remove for the per-team "Select all" / "Clear" control.
  const handleSetKeysSelected = (featureKeys: readonly string[], isSelected: boolean): void => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      for (const featureKey of featureKeys) {
        if (isSelected) {
          next.add(featureKey);
        } else {
          next.delete(featureKey);
        }
      }
      return next;
    });
  };

  const handleAddToCanvas = (): void => {
    if (selectedKeys.size > 0) {
      onAdd([...selectedKeys]);
    }
    setSelectedKeys(new Set());
    onClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 8px' }}>
        <strong>Step 1 — pick features from the blueprint</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          PI:
          <select
            aria-label="Program Increment for this exercise"
            value={selectedPiName}
            onChange={(event) => onPiChange(event.target.value)}
          >
            {selectedPiName.trim() === '' && <option value="">— Select a PI —</option>}
            {piOptions.map((piName) => <option key={piName} value={piName}>{piName}</option>)}
          </select>
        </label>
        {hasCanvas && <button type="button" className={controlStyles.btn} onClick={onClose}>← Back to canvas</button>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <BlueprintTab
          teams={teams}
          selectedPiName={selectedPiName}
          selectionMode={{ onCanvasKeys, selectedKeys, onToggle: handleToggle, onSetKeysSelected: handleSetKeysSelected, onAddToCanvas: handleAddToCanvas }}
        />
      </div>
    </div>
  );
}
