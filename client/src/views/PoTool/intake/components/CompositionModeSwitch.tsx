// CompositionModeSwitch.tsx — The two-way switch at the top of Feature Composition: compose one Feature as before, or
// run an Epic Intake from notes. Switching never touches the composition draft (FR-001).

import styles from '../EpicIntakeWorkspace.module.css';

/** The two modes of the Feature Composition tab. */
export type CompositionMode = 'compose' | 'intake';

const MODE_OPTIONS: readonly { mode: CompositionMode; label: string }[] = [
  { mode: 'compose', label: 'Compose one Feature' },
  { mode: 'intake', label: 'Epic Intake from notes' },
];

interface CompositionModeSwitchProps {
  mode: CompositionMode;
  onModeChange: (mode: CompositionMode) => void;
}

/** A radio-group switch between composing one Feature and an Epic Intake. */
export default function CompositionModeSwitch({ mode, onModeChange }: CompositionModeSwitchProps) {
  return (
    <div className={styles.intakeModeSwitch} role="radiogroup" aria-label="Composition mode">
      {MODE_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={mode === option.mode}
          className={styles.intakeModeOption}
          onClick={() => onModeChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
