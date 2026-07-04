// SurfacePicker.tsx — The "Add features" picker for the Feature Canvas.
//
// This is the deliberate front door to the canvas. Its default source is the cross-project blueprint
// (the parent-walk for the active team + PI), grouped Program Epic → Feature; a secondary Custom-JQL
// source feeds the same selectable list. The user checks which features to add — nothing reaches the
// canvas without a choice — and adding is additive (already-on-canvas rows are shown, disabled). A bad
// custom query surfaces an error and adds nothing.

import { useMemo, useState } from 'react';

import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { NlToJqlControl } from './NlToJqlControl.tsx';
import {
  collectAddableKeys,
  collectSelectableKeys,
  filterGroupsBySearch,
  mapBlueprintToGroups,
  mapJqlItemsToGroups,
  type PickerGroup,
} from './pickerModel.ts';
import { usePickerCandidates, type PickerSource } from './usePickerCandidates.ts';

/** Props for the Surface picker. */
export interface SurfacePickerProps {
  team: ArtTeam | null;
  piName: string;
  projectKey: string;
  /** Feature keys already on the canvas (shown as "already added"). */
  onCanvasKeys: ReadonlySet<string>;
  /** Default JQL that pre-fills the Custom-query box. */
  defaultJql: string;
  /** Called with the keys the user chose to add (already-on-canvas keys are excluded upstream). */
  onAdd: (keys: string[]) => void;
  onClose: () => void;
}

/** The Surface picker panel. */
export function SurfacePicker({ team, piName, projectKey, onCanvasKeys, defaultJql, onAdd, onClose }: SurfacePickerProps): React.JSX.Element {
  const [source, setSource] = useState<PickerSource>('blueprint');
  const [jql, setJql] = useState(defaultJql);
  const [runToken, setRunToken] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const candidates = usePickerCandidates({ source, team, piName, jql, runToken });

  // Map the raw source result into selectable, searched groups with the live on-canvas set.
  const groups = useMemo<PickerGroup[]>(() => {
    const mapped = source === 'blueprint'
      ? mapBlueprintToGroups(candidates.programEpics, onCanvasKeys)
      : mapJqlItemsToGroups(candidates.jqlItems, onCanvasKeys);
    return filterGroupsBySearch(mapped, search);
  }, [source, candidates.programEpics, candidates.jqlItems, onCanvasKeys, search]);

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

  const handleSelectAll = (): void => setSelectedKeys(new Set(collectSelectableKeys(groups)));
  const handleClearAll = (): void => setSelectedKeys(new Set());

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
    <div role="dialog" aria-label="Add features" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, width: 460, maxHeight: '80vh', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Add features</strong>
        <button type="button" onClick={onClose} aria-label="Close picker">✕</button>
      </div>

      {/* Source toggle */}
      <div role="tablist" style={{ display: 'flex', gap: 6 }}>
        <button type="button" role="tab" aria-selected={source === 'blueprint'} onClick={() => setSource('blueprint')}>Blueprint</button>
        <button type="button" role="tab" aria-selected={source === 'jql'} onClick={() => setSource('jql')}>Custom JQL</button>
      </div>

      {source === 'jql' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <textarea aria-label="Custom JQL" value={jql} onChange={(event) => setJql(event.target.value)} rows={2} style={{ width: '100%', fontSize: 12 }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" onClick={() => setRunToken((token) => token + 1)}>Run query</button>
            <NlToJqlControl projectKey={projectKey} piName={piName} onAcceptJql={setJql} />
          </div>
        </div>
      )}

      <input aria-label="Search features" placeholder="Search by key or summary" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: '100%' }} />

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={handleSelectAll}>Select all</button>
        <button type="button" onClick={handleClearAll}>Clear</button>
      </div>

      {/* Candidate list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {candidates.status === 'no-team' && <p>No ART team is configured for this board. Configure a team, or use the Custom JQL source.</p>}
        {candidates.status === 'error' && <p role="alert" style={{ color: '#ef4444' }}>{candidates.error}</p>}
        {isLoading && <p>Loading…</p>}
        {!isLoading && candidates.status !== 'error' && groups.length === 0 && candidates.status !== 'no-team' && <p>No features found.</p>}

        {groups.map((group) => (
          <div key={group.programEpicKey ?? group.programEpicSummary} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 0' }}>{group.programEpicSummary}</div>
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
        <button type="button" onClick={handleAdd} disabled={selectedKeys.size === 0}>Add to canvas</button>
      </div>
    </div>
  );
}
