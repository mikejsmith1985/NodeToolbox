// ChgTab.tsx — Unified CHG Create/Modify tab with mode toggle.
// Allows users to switch between creating new changes and modifying existing ones.

import { useState } from 'react';

import CreateChgTab from './CreateChgTab.tsx';
import ModifyChgTab from './ModifyChgTab.tsx';
import styles from './CreateChgTab.module.css';

type ChgMode = 'create' | 'modify';

function ModeToggle({ mode, onModeChange }: {
  mode: ChgMode;
  onModeChange: (mode: ChgMode) => void;
}) {
  return (
    <div className={styles.modeToggleContainer}>
      {/* Explicit new/existing wording: users did not discover that modifying an existing
          CHG (including adding CTASKs to it) lives behind this toggle (user report). */}
      <button
        aria-pressed={mode === 'create'}
        className={mode === 'create' ? `${styles.modeToggleButton} ${styles.active}` : styles.modeToggleButton}
        onClick={() => onModeChange('create')}
        type="button"
      >
        ➕ Create New CHG
      </button>
      <button
        aria-pressed={mode === 'modify'}
        className={mode === 'modify' ? `${styles.modeToggleButton} ${styles.active}` : styles.modeToggleButton}
        onClick={() => onModeChange('modify')}
        title="Load a change that already exists in ServiceNow — edit its fields or add CTASKs to it"
        type="button"
      >
        ✏️ Modify Existing CHG
      </button>
    </div>
  );
}

/**
 * Unified CHG tab with Create/Modify mode toggle.
 * Users can switch between creating new ServiceNow changes and modifying existing ones.
 */
export default function ChgTab(): React.ReactElement {
  const [mode, setMode] = useState<ChgMode>('create');

  return (
    <div>
      <ModeToggle mode={mode} onModeChange={setMode} />
      {mode === 'create' ? <CreateChgTab /> : <ModifyChgTab />}
    </div>
  );
}
