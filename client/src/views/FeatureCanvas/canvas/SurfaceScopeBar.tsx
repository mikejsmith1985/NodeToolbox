// SurfaceScopeBar.tsx — Stage 1 (Surface) scope control: the query that defines what gets surfaced.
//
// The user edits a Jira query (pre-filled from the active team + PI) and presses Surface to pull the
// matching features onto the canvas. Label / text / status chips refine the already-surfaced set
// client-side (no refetch). This control is fully deterministic — no AI. (The hidden NL→JQL helper
// is layered on separately for the passphrase-unlocked owner.)

import type { CanvasFeaturesStatus } from './useCanvasFeatures.ts';
import type { ScopeFilters } from './scopeQuery.ts';

/** Props the scope bar needs to drive surfacing and refinement. */
export interface SurfaceScopeBarProps {
  jql: string;
  onJqlChange: (nextJql: string) => void;
  onSurface: () => void;
  filters: ScopeFilters;
  onFiltersChange: (nextFilters: ScopeFilters) => void;
  status: CanvasFeaturesStatus;
  error: string | null;
  resultCount: number;
  /** Optional slot for the passphrase-gated NL→JQL helper (rendered by the parent when unlocked). */
  aiHelperSlot?: React.ReactNode;
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit',
};

/** The Surface scope control bar shown above the canvas. */
export function SurfaceScopeBar(props: SurfaceScopeBarProps): React.JSX.Element {
  const { jql, onJqlChange, onSurface, filters, onFiltersChange, status, error, resultCount, aiHelperSlot } = props;
  const isLoading = status === 'loading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(148,163,184,0.3)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          aria-label="Surface query (JQL)"
          value={jql}
          onChange={(event) => onJqlChange(event.target.value)}
          placeholder='e.g. project = ENCUC AND labels = ENCUC AND issuetype in (Feature, Epic)'
          style={{ ...INPUT_STYLE, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
        />
        <button
          type="button"
          onClick={onSurface}
          disabled={isLoading}
          style={{ padding: '4px 14px', borderRadius: 6, cursor: isLoading ? 'default' : 'pointer', border: '1px solid #8b5cf6', background: 'rgba(139,92,246,0.25)', color: 'inherit' }}
        >
          {isLoading ? 'Surfacing…' : 'Surface'}
        </button>
        {aiHelperSlot}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ opacity: 0.7 }}>Refine:</span>
        <input aria-label="Filter by text" value={filters.text} onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })} placeholder="text" style={{ ...INPUT_STYLE, width: 140 }} />
        <input aria-label="Filter by label" value={filters.label ?? ''} onChange={(event) => onFiltersChange({ ...filters, label: event.target.value || null })} placeholder="label" style={{ ...INPUT_STYLE, width: 120 }} />
        <input aria-label="Filter by status" value={filters.status ?? ''} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value || null })} placeholder="status" style={{ ...INPUT_STYLE, width: 120 }} />
        {status === 'ready' && <span style={{ opacity: 0.7 }}>{resultCount} feature{resultCount === 1 ? '' : 's'}</span>}
      </div>

      {status === 'error' && error && (
        <div role="alert" style={{ color: '#ef4444', fontSize: 12 }}>Query failed: {error}</div>
      )}
    </div>
  );
}
