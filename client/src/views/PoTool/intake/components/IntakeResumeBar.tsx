// IntakeResumeBar.tsx — The team's saved intakes: resume one exactly where it was left, discard one after a confirm
// step, or start a new one (US6). Discarding removes only the saved intake; Epics already in Jira stay.

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import rewriteStyles from '../../rewrite/rewrite.module.css';
import type { EpicIntakeSummary } from '../epicIntakeStore.ts';
import styles from '../EpicIntakeWorkspace.module.css';

interface IntakeResumeBarProps {
  savedIntakes: readonly EpicIntakeSummary[];
  activeIntakeId: string | null;
  onResume: (intakeId: string) => void;
  onDiscard: (intakeId: string) => void;
  onStartNew: () => void;
}

/** Formats a saved time for the list, falling back to the raw value if it cannot be read. */
function formatSavedTime(isoTime: string): string {
  const savedDate = new Date(isoTime);
  return Number.isNaN(savedDate.getTime()) ? isoTime : savedDate.toLocaleString();
}

/** Lists saved intakes with Resume and Discard; Discard asks once more before it removes anything. */
export default function IntakeResumeBar({ savedIntakes, activeIntakeId, onResume, onDiscard, onStartNew }: IntakeResumeBarProps) {
  const [confirmingIntakeId, setConfirmingIntakeId] = useState<string | null>(null);
  return (
    <section aria-label="Saved intakes">
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.secondaryButton} onClick={onStartNew}>Start a new intake</button>
      </div>
      {savedIntakes.length > 0 ? (
        <ul className={rewriteStyles.batchList}>
          {savedIntakes.map((savedIntake) => (
            <li key={savedIntake.id} className={rewriteStyles.batchRow}>
              <span>
                <strong>{savedIntake.name}</strong>
                <span className={rewriteStyles.batchRowMeta}> · saved {formatSavedTime(savedIntake.updatedAtIso)}</span>
                {savedIntake.id === activeIntakeId ? <span className={styles.intakeCount}> · open now</span> : null}
              </span>
              <span className={rewriteStyles.batchRowActions}>
                {confirmingIntakeId === savedIntake.id ? (
                  <>
                    <span>Discard this saved intake? Epics already in Jira are not affected.</span>
                    <button type="button" className={compositionStyles.dangerButton} onClick={() => { setConfirmingIntakeId(null); onDiscard(savedIntake.id); }}>Yes, discard</button>
                    <button type="button" className={compositionStyles.secondaryButton} onClick={() => setConfirmingIntakeId(null)}>Keep it</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={compositionStyles.secondaryButton} disabled={savedIntake.id === activeIntakeId} onClick={() => onResume(savedIntake.id)}>Resume</button>
                    <button type="button" className={compositionStyles.secondaryButton} onClick={() => setConfirmingIntakeId(savedIntake.id)}>Discard</button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
