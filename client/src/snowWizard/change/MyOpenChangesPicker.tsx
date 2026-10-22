// MyOpenChangesPicker.tsx — "Load my open changes", then pick one from the list instead of typing its number.
//
// The list is ServiceNow's own (the same read as Toolbox's Modify CHG), so the number picked always exists — a typed
// number can be mistyped and silently find nothing (pick, don't type). The list is read once per screen, on request.

import { useId, useState } from 'react';

import styles from './ChangeWizard.module.css';
import { useMyOpenChanges, type MyOpenChangesLoadState as LoadState } from './useMyOpenChanges.ts';

/** "Load my open changes" and what came back, for any screen that can show more than one pick list below it. */
export function MyOpenChangesLoader({ loadState, onLoad }: { loadState: LoadState; onLoad: () => void }) {
  if (loadState.kind === 'loaded') {
    return loadState.changes.length === 0 ? <p className={styles.hint}>You have no open changes assigned to you.</p> : null;
  }
  return (
    <div className={styles.buttonRow}>
      <button type="button" className={styles.secondaryButton} disabled={loadState.kind === 'loading'} onClick={onLoad}>
        {loadState.kind === 'loading' ? 'Loading…' : 'Load my open changes'}
      </button>
      {loadState.kind === 'failed' ? <p className={styles.errorText}>{`Could not load your changes: ${loadState.message}`}</p> : null}
    </div>
  );
}

/**
 * One pick list of the loaded changes; nothing until they are loaded. The picked change stays shown — snapping back to
 * "Choose…" made a pick look ignored (owner feedback).
 */
export function MyOpenChangeSelect({ loadState, label, onPick }: { loadState: LoadState; label: string; onPick: (changeNumber: string) => void }) {
  const selectId = useId();
  const [pickedNumber, setPickedNumber] = useState('');
  if (loadState.kind !== 'loaded' || loadState.changes.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={selectId}>{label}</label>
      <select id={selectId} className={styles.selectField} value={pickedNumber} onChange={(changeEvent) => {
        setPickedNumber(changeEvent.target.value);
        if (changeEvent.target.value) onPick(changeEvent.target.value);
      }}>
        <option value="">Choose…</option>
        {loadState.changes.map((change) => (
          <option key={change.changeNumber} value={change.changeNumber}>{`${change.changeNumber} — ${change.shortDescription}`}</option>
        ))}
      </select>
    </div>
  );
}

/** The whole picker for a screen with one change number: load, then pick. */
export default function MyOpenChangesPicker({ label = 'Or pick one of my open changes', onPick }: { label?: string; onPick: (changeNumber: string) => void }) {
  const { loadState, load } = useMyOpenChanges();
  return (
    <>
      <MyOpenChangesLoader loadState={loadState} onLoad={() => { void load(); }} />
      <MyOpenChangeSelect loadState={loadState} label={label} onPick={onPick} />
    </>
  );
}
