// ChgTab.tsx — The CHG Generator tab: the SNow Wizard's guided change flow by default, the classic screens on request.
//
// The guided flow is the SNow Wizard's own change job (snowWizard/change/ChangeWizard.tsx), mounted here unchanged, so
// creating or modifying a change works identically in Toolbox and the Wizard and one fix serves both. It already runs
// on Toolbox's own change engine (useCrgState), relay and Jira proxy, so nothing is translated. The classic Create /
// Modify screens stay one click away until the guided flow has proved itself in production.

import { useState } from 'react';

import ChangeWizard from '../../../snowWizard/change/ChangeWizard.tsx';
import CreateChgTab from './CreateChgTab.tsx';
import ModifyChgTab from './ModifyChgTab.tsx';
import { AddIcon, EditIcon } from '../../../components/AppIcons/index.tsx';
import styles from './CreateChgTab.module.css';

type ChgMode = 'create' | 'modify';
type ChgGeneratorView = 'guided' | 'classic';

/** Browser storage key remembering which view the user last chose. */
export const CHG_GENERATOR_VIEW_STORAGE_KEY = 'tbxChgGeneratorView';
const DEFAULT_VIEW: ChgGeneratorView = 'guided';

/** The view to open on: the remembered one, or guided when nothing is remembered or storage is blocked. */
function readRememberedView(): ChgGeneratorView {
  try {
    return localStorage.getItem(CHG_GENERATOR_VIEW_STORAGE_KEY) === 'classic' ? 'classic' : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Remembers the chosen view; a blocked storage only means the choice is not remembered. */
function rememberView(view: ChgGeneratorView): void {
  try {
    localStorage.setItem(CHG_GENERATOR_VIEW_STORAGE_KEY, view);
  } catch {
    /* storage blocked — the choice still applies for this visit */
  }
}

/** One toggle button; the pressed state uses the same classes as the Create/Modify toggle. */
function ToggleButton({ isActive, label, title, onClick }: { isActive: boolean; label: React.ReactNode; title?: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={isActive}
      className={isActive ? `${styles.modeToggleButton} ${styles.active}` : styles.modeToggleButton}
      onClick={onClick}
      title={title}
      type="button"
    >
      {label}
    </button>
  );
}

function ViewToggle({ view, onViewChange }: { view: ChgGeneratorView; onViewChange: (view: ChgGeneratorView) => void }) {
  return (
    <div className={styles.modeToggleContainer}>
      <ToggleButton isActive={view === 'guided'} label="🧭 Guided" onClick={() => onViewChange('guided')}
        title="One step per screen to Create or Save — the same change flow as the SNow Wizard" />
      <ToggleButton isActive={view === 'classic'} label="🛠️ Classic screens" onClick={() => onViewChange('classic')}
        title="The previous Create and Modify screens, everything on one page" />
    </div>
  );
}

function ModeToggle({ mode, onModeChange }: {
  mode: ChgMode;
  onModeChange: (mode: ChgMode) => void;
}) {
  return (
    <div className={styles.modeToggleContainer}>
      {/* Explicit new/existing wording: users did not discover that modifying an existing
          CHG (including adding CTASKs to it) lives behind this toggle (user report). */}
      <ToggleButton isActive={mode === 'create'} label={<><AddIcon /> Create New CHG</>} onClick={() => onModeChange('create')} />
      <ToggleButton isActive={mode === 'modify'} label={<><EditIcon /> Modify Existing CHG</>} onClick={() => onModeChange('modify')}
        title="Load a change that already exists in ServiceNow — edit its fields or add CTASKs to it" />
    </div>
  );
}

/** The classic screens: Create or Modify, switched by a toggle. */
function ClassicChgScreens() {
  const [mode, setMode] = useState<ChgMode>('create');
  return (
    <>
      <ModeToggle mode={mode} onModeChange={setMode} />
      {mode === 'create' ? <CreateChgTab /> : <ModifyChgTab />}
    </>
  );
}

/**
 * The CHG Generator tab. The guided flow gets no way home (`onExit`): SNow Hub is its home, so leaving a job returns to
 * the flow's own first screen.
 */
export default function ChgTab(): React.ReactElement {
  const [view, setView] = useState<ChgGeneratorView>(readRememberedView);

  const changeView = (nextView: ChgGeneratorView) => {
    rememberView(nextView);
    setView(nextView);
  };

  return (
    <div>
      <ViewToggle view={view} onViewChange={changeView} />
      {view === 'guided' ? <ChangeWizard /> : <ClassicChgScreens />}
    </div>
  );
}
