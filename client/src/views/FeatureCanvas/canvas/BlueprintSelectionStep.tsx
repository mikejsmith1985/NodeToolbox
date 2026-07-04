// BlueprintSelectionStep.tsx — Step 1 of the Feature Canvas: pick features from the real Blueprint.
//
// Rather than re-deriving the blueprint (which got per-team counts wrong), this embeds the ART view's
// proven BlueprintTab in selection mode, fed the full ART roster so its By-Team buckets are exactly
// what ART shows. The user checks features and adds them to the canvas; then step 2 (the board) takes
// over. Custom-JQL adds remain available on the board.

import { useState } from 'react';

import BlueprintTab from '../../ArtView/BlueprintTab.tsx';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import controlStyles from './canvasControls.module.css';

/** Props for the blueprint selection step. */
export interface BlueprintSelectionStepProps {
  teams: ArtTeam[];
  selectedPiName: string;
  /** Feature keys already on the canvas (shown checked + disabled). */
  onCanvasKeys: ReadonlySet<string>;
  /** Called with the chosen feature keys to seed the canvas. */
  onAdd: (keys: string[]) => void;
  onClose: () => void;
  /** Whether a canvas already exists behind this step (enables "Back to canvas"). */
  hasCanvas: boolean;
}

/** Step 1: the blueprint, with per-feature add-to-canvas checkboxes. */
export function BlueprintSelectionStep({ teams, selectedPiName, onCanvasKeys, onAdd, onClose, hasCanvas }: BlueprintSelectionStepProps): React.JSX.Element {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

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
