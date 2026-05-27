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
      <button
        aria-pressed={mode === 'create'}
        className={mode === 'create' ? `${styles.modeToggleButton} ${styles.active}` : styles.modeToggleButton}
        onClick={() => onModeChange('create')}
        type="button"
      >
        Create CHG
      </button>
      <button
        aria-pressed={mode === 'modify'}
        className={mode === 'modify' ? `${styles.modeToggleButton} ${styles.active}` : styles.modeToggleButton}
        onClick={() => onModeChange('modify')}
        type="button"
      >
        Modify CHG
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
