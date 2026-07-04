// CanvasLegend.tsx — A toggleable key that explains the card markings AND focuses the canvas.
//
// The cards pack a lot of signal into small marks — a colored left stripe, a health dot, and a row
// of badges. This popover spells each one out (reading its colors from the same maps FeatureNode
// renders, so the key can never drift). When wired with a filter callback, clicking a status or
// health entry also *focuses* the canvas on those features — matching cards stay bright, the rest
// dim back — and clicking it again (or "Show all") clears the focus.

import { useState } from 'react';

import { HEALTH_COLORS, STATUS_CATEGORY_COLORS } from './nodeColors.ts';
import { isSameFilter, type CanvasNodeFilter } from '../logic/nodeFilter.ts';
import controlStyles from './canvasControls.module.css';

/** One labeled swatch row in the legend, with the node value it filters on. */
interface LegendEntry {
  color: string;
  label: string;
  value: string;
}

// Left-stripe meanings, in the order work flows. Value is the Jira status-category key.
const STATUS_STRIPE_ENTRIES: LegendEntry[] = [
  { color: STATUS_CATEGORY_COLORS.new, label: 'To do / not started', value: 'new' },
  { color: STATUS_CATEGORY_COLORS.indeterminate, label: 'In progress (counts toward WIP)', value: 'indeterminate' },
  { color: STATUS_CATEGORY_COLORS.done, label: 'Done', value: 'done' },
];

// Health-dot meanings. The dot is the small ● in the card's top-right corner.
const HEALTH_DOT_ENTRIES: LegendEntry[] = [
  { color: HEALTH_COLORS.green, label: 'Healthy', value: 'green' },
  { color: HEALTH_COLORS.yellow, label: 'At risk', value: 'yellow' },
  { color: HEALTH_COLORS.red, label: 'Blocked / critical', value: 'red' },
  { color: HEALTH_COLORS.gray, label: 'Unknown', value: 'gray' },
];

/** Props for the canvas legend. When the filter props are supplied, entries become focus toggles. */
export interface CanvasLegendProps {
  activeFilter?: CanvasNodeFilter | null;
  onToggleFilter?: (filter: CanvasNodeFilter) => void;
}

/** The color swatch element shared by static and interactive rows. */
function Swatch({ color, isDot }: { color: string; isDot: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-block', width: isDot ? 12 : 16, height: 12, borderRadius: isDot ? '50%' : 2, background: color, flex: 'none' }}
    />
  );
}

/** A single legend row: a plain label, or a focus toggle button when the legend is interactive. */
function SwatchRow({
  entry,
  isDot,
  isActive,
  onToggle,
}: {
  entry: LegendEntry;
  isDot: boolean;
  isActive: boolean;
  onToggle?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      <Swatch color={entry.color} isDot={isDot} />
      <span>{entry.label}</span>
      {isActive && <span aria-hidden style={{ marginLeft: 'auto' }}>✓</span>}
    </>
  );

  if (!onToggle) {
    return <li style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>{content}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isActive}
        title={`Focus on: ${entry.label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '3px 4px', textAlign: 'left', cursor: 'pointer',
          border: `1px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
          borderRadius: 4,
          background: isActive ? 'var(--color-surface-hover)' : 'transparent',
          color: 'inherit', font: 'inherit',
        }}
      >
        {content}
      </button>
    </li>
  );
}

/** A titled group of swatch rows; interactive when a dimension + toggle handler are given. */
function LegendSection({
  title,
  entries,
  isDot,
  dimension,
  activeFilter,
  onToggleFilter,
}: {
  title: string;
  entries: LegendEntry[];
  isDot: boolean;
  dimension?: CanvasNodeFilter['dimension'];
  activeFilter?: CanvasNodeFilter | null;
  onToggleFilter?: (filter: CanvasNodeFilter) => void;
}): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ opacity: 0.6, marginBottom: 2 }}>{title}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const entryFilter: CanvasNodeFilter | null = dimension ? { dimension, value: entry.value } : null;
          const isActive = entryFilter !== null && isSameFilter(activeFilter ?? null, entryFilter);
          return (
            <SwatchRow
              key={entry.label}
              entry={entry}
              isDot={isDot}
              isActive={isActive}
              onToggle={dimension && onToggleFilter && entryFilter ? () => onToggleFilter(entryFilter) : undefined}
            />
          );
        })}
      </ul>
    </div>
  );
}

/** The toggleable canvas legend/key popover shown from the toolbar. */
export function CanvasLegend({ activeFilter = null, onToggleFilter }: CanvasLegendProps = {}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const isInteractive = typeof onToggleFilter === 'function';

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className={controlStyles.btn} onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} title="What do the card markings mean?">
        ❓ Key
      </button>
      {isOpen && (
        <div role="dialog" aria-label="Canvas legend" className={controlStyles.popover} style={{ position: 'absolute', top: 36, left: 0, zIndex: 40, width: 280, padding: 12, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Card key</strong>
            <button type="button" className={controlStyles.iconBtn} onClick={() => setIsOpen(false)} aria-label="Close legend">✕</button>
          </div>

          {isInteractive && (
            <p style={{ margin: '4px 0 0', opacity: 0.6 }}>
              {activeFilter ? 'Focusing — click again or Show all to clear.' : 'Click a status or health color to focus the canvas on it.'}
            </p>
          )}
          {isInteractive && activeFilter && (
            <button type="button" className={controlStyles.btn} style={{ marginTop: 6 }} onClick={() => onToggleFilter?.(activeFilter)}>
              Show all
            </button>
          )}

          <LegendSection title="Left stripe — status" entries={STATUS_STRIPE_ENTRIES} isDot={false} dimension={isInteractive ? 'status' : undefined} activeFilter={activeFilter} onToggleFilter={onToggleFilter} />
          <LegendSection title="Corner dot — health" entries={HEALTH_DOT_ENTRIES} isDot dimension={isInteractive ? 'health' : undefined} activeFilter={activeFilter} onToggleFilter={onToggleFilter} />

          <div style={{ marginTop: 8 }}>
            <div style={{ opacity: 0.6, marginBottom: 2 }}>Badges</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li style={{ padding: '2px 0' }}>Size · points (e.g. <em>L · 8pt</em>)</li>
              <li style={{ padding: '2px 0' }}>MoSCoW priority (Must / Should / Could / Wont)</li>
              <li style={{ padding: '2px 0' }}>% complete</li>
              <li style={{ padding: '2px 0' }}>⚑ hygiene flags found</li>
              <li style={{ padding: '2px 0' }}>⏸ parked (excluded from WIP)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
