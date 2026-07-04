// SurfacePicker.tsx — The board's "Add via JQL" panel (step 2 secondary add path).
//
// The primary way to add work is the blueprint selection step. This covers the secondary case: pulling
// in features a custom JQL query finds (with the hidden passphrase-gated NL→JQL helper). The user runs
// a query, picks from the matches, and adds them — additively, skipping any already on the canvas. A
// bad query shows an error and adds nothing.

import { useMemo, useState } from 'react';

import { NlToJqlControl } from './NlToJqlControl.tsx';
import { PersonFinder } from './PersonFinder.tsx';
import controlStyles from './canvasControls.module.css';
import {
  collectAddableKeys,
  collectSelectableKeys,
  filterGroupsBySearch,
  mapJqlItemsToGroups,
  type PickerGroup,
} from './pickerModel.ts';
import { usePickerCandidates } from './usePickerCandidates.ts';

/** Props for the Custom-JQL add panel. */
export interface SurfacePickerProps {
  piName: string;
  projectKey: string;
  /** Feature keys already on the canvas (shown as "already added"). */
  onCanvasKeys: ReadonlySet<string>;
  /** Default JQL that pre-fills the query box. */
  defaultJql: string;
  /** Called with the keys the user chose to add. */
  onAdd: (keys: string[]) => void;
  onClose: () => void;
}

/** The Custom-JQL add panel. */
export function SurfacePicker({ piName, projectKey, onCanvasKeys, defaultJql, onAdd, onClose }: SurfacePickerProps): React.JSX.Element {
  const [jql, setJql] = useState(defaultJql);
  const [runToken, setRunToken] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const candidates = usePickerCandidates({ jql, runToken });

  const groups = useMemo<PickerGroup[]>(
    () => filterGroupsBySearch(mapJqlItemsToGroups(candidates.jqlItems, onCanvasKeys), search),
    [candidates.jqlItems, onCanvasKeys, search],
  );

  const toggleKey = (key: string): void => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Appends a Person-finder clause to the current query with AND, or seeds the box when it's empty,
  // so the resolved `assignee = "<id>"` composes with whatever the user already typed.
  const insertJqlClause = (clause: string): void => {
    setJql((current) => {
      const trimmedCurrent = current.trim();
      return trimmedCurrent === '' ? clause : `${trimmedCurrent} AND ${clause}`;
    });
  };

  const handleAdd = (): void => {
    const addableKeys = collectAddableKeys(selectedKeys, onCanvasKeys);
    if (addableKeys.length > 0) {
      onAdd(addableKeys);
    }
    setSelectedKeys(new Set());
    onClose();
  };

  const isLoading = candidates.status === 'loading';

  return (
    <div role="dialog" aria-label="Add via JQL" className={controlStyles.popover} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, width: 460, maxHeight: '80vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Add via JQL</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close picker">✕</button>
      </div>

      <textarea aria-label="Custom JQL" value={jql} onChange={(event) => setJql(event.target.value)} rows={2} style={{ width: '100%', fontSize: 12 }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className={controlStyles.btn} onClick={() => setRunToken((token) => token + 1)}>Run query</button>
        <PersonFinder onInsertClause={insertJqlClause} />
        <NlToJqlControl projectKey={projectKey} piName={piName} onAcceptJql={setJql} />
      </div>

      <input aria-label="Search features" placeholder="Search by key or summary" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: '100%' }} />

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className={controlStyles.btn} onClick={() => setSelectedKeys(new Set(collectSelectableKeys(groups)))}>Select all</button>
        <button type="button" className={controlStyles.btn} onClick={() => setSelectedKeys(new Set())}>Clear</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {candidates.status === 'error' && <p role="alert" style={{ color: '#ef4444' }}>{candidates.error}</p>}
        {isLoading && <p>Loading…</p>}
        {!isLoading && candidates.status === 'idle' && <p style={{ opacity: 0.7 }}>Run a query to find features.</p>}
        {!isLoading && candidates.status === 'ready' && groups.length === 0 && <p>No features found.</p>}

        {groups.map((group) => (
          <div key={group.programEpicKey ?? group.programEpicSummary} style={{ marginBottom: 8 }}>
            {group.features.map((feature) => (
              <label key={feature.key} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', opacity: feature.isAlreadyOnCanvas ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  aria-label={`Select ${feature.key}`}
                  disabled={feature.isAlreadyOnCanvas}
                  checked={selectedKeys.has(feature.key)}
                  onChange={() => toggleKey(feature.key)}
                />
                <span>{feature.key} — {feature.summary}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>
                  {feature.isAlreadyOnCanvas ? 'already added' : `${feature.childCount} child`}
                </span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className={controlStyles.btnPrimary} onClick={handleAdd} disabled={selectedKeys.size === 0}>Add to canvas</button>
      </div>
    </div>
  );
}
