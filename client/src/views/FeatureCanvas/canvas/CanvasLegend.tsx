// CanvasLegend.tsx — A toggleable key that explains what the canvas card markings mean.
//
// The cards pack a lot of signal into small marks — a colored left stripe, a health dot, and a row
// of badges. New users can't tell that the blue left edge means "in progress / WIP". This popover
// spells each one out, reading its colors from the same maps FeatureNode renders so the key can
// never drift from the cards it describes.

import { useState } from 'react';

import { HEALTH_COLORS, STATUS_CATEGORY_COLORS } from './nodeColors.ts';
import controlStyles from './canvasControls.module.css';

/** One labeled swatch row in the legend. */
interface LegendEntry {
  color: string;
  label: string;
}

// Left-stripe meanings, in the order work flows. "Blue = in progress" is the WIP signal users ask about.
const STATUS_STRIPE_ENTRIES: LegendEntry[] = [
  { color: STATUS_CATEGORY_COLORS.new, label: 'To do / not started' },
  { color: STATUS_CATEGORY_COLORS.indeterminate, label: 'In progress (counts toward WIP)' },
  { color: STATUS_CATEGORY_COLORS.done, label: 'Done' },
];

// Health-dot meanings. The dot is the small ● in the card's top-right corner.
const HEALTH_DOT_ENTRIES: LegendEntry[] = [
  { color: HEALTH_COLORS.green, label: 'Healthy' },
  { color: HEALTH_COLORS.yellow, label: 'At risk' },
  { color: HEALTH_COLORS.red, label: 'Blocked / critical' },
  { color: HEALTH_COLORS.gray, label: 'Unknown' },
];

/** A single color swatch beside its meaning. */
function SwatchRow({ swatch, label, isDot }: { swatch: string; label: string; isDot: boolean }): React.JSX.Element {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: isDot ? 12 : 16,
          height: 12,
          borderRadius: isDot ? '50%' : 2,
          background: swatch,
          flex: 'none',
        }}
      />
      <span>{label}</span>
    </li>
  );
}

/** A titled group of swatch rows. */
function LegendSection({ title, entries, isDot }: { title: string; entries: LegendEntry[]; isDot: boolean }): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ opacity: 0.6, marginBottom: 2 }}>{title}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry) => <SwatchRow key={entry.label} swatch={entry.color} label={entry.label} isDot={isDot} />)}
      </ul>
    </div>
  );
}

/** The toggleable canvas legend/key popover shown from the toolbar. */
export function CanvasLegend(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

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

          <LegendSection title="Left stripe — status" entries={STATUS_STRIPE_ENTRIES} isDot={false} />
          <LegendSection title="Corner dot — health" entries={HEALTH_DOT_ENTRIES} isDot />

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
