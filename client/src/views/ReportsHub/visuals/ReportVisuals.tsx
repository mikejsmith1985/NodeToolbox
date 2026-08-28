// ReportVisuals.tsx — The shapes every report in the hub draws with.
//
// The reports were tables. A table is the data; the reader still has to do the understanding, which is
// what a chart is for — and "I can get the data by running a query" is exactly the right complaint
// about a report that only tabulates.
//
// These are the three shapes borrowed from the PI Review capacity panel, the surface this app has
// settled on as its baseline, so the reports read as pieces of one product rather than as four screens
// that grew separately:
//
//   - a STAT CARD for the figure somebody quotes;
//   - a METER for one value against the scale it belongs on, with a threshold when there is one;
//   - a DISTRIBUTION for "where did it come from", where the share is the point.
//
// Presentational only: every one takes numbers already computed and draws them. No fetching, no
// arithmetic beyond turning a value into a width.

import { readDistributionColour } from './distributionColours.ts';
import styles from './reportVisuals.module.css';

/** How a figure should read: neutral unless something is genuinely good or genuinely wrong. */
export type VisualTone = 'neutral' | 'good' | 'warn' | 'bad';

const TONE_CLASS: Readonly<Record<VisualTone, string>> = {
  neutral: '',
  good: styles.toneGood,
  warn: styles.toneWarn,
  bad: styles.toneBad,
};

const METER_FILL_CLASS: Readonly<Record<VisualTone, string>> = {
  neutral: '',
  good: '',
  warn: styles.meterFillWarn,
  bad: styles.meterFillBad,
};

interface ReportPanelProps {
  title: string;
  /** One sentence on what the panel shows and how to read it. */
  caption?: string;
  children: React.ReactNode;
}

/** A titled card with the accent rail, matching the PI Review capacity panel. */
export function ReportPanel({ title, caption, children }: ReportPanelProps) {
  return (
    <section className={styles.panel}>
      <span className={styles.panelAccent} />
      <h4 className={styles.panelTitle}>{title}</h4>
      {caption === undefined ? null : <p className={styles.panelCaption}>{caption}</p>}
      {children}
    </section>
  );
}

/** One headline figure. */
export interface StatCardData {
  label: string;
  value: string;
  /** What the figure means, or what it is measured against. */
  context?: string;
  tone?: VisualTone;
}

/** A row of headline figures, wrapping rather than scrolling on a narrow window. */
export function StatCards({ stats }: { stats: readonly StatCardData[] }) {
  return (
    <div className={styles.statGrid}>
      {stats.map((stat) => (
        <div className={styles.statCard} key={stat.label}>
          <span className={styles.statLabel}>{stat.label}</span>
          <span className={`${styles.statValue} ${TONE_CLASS[stat.tone ?? 'neutral']}`}>{stat.value}</span>
          {stat.context === undefined ? null : <span className={styles.statContext}>{stat.context}</span>}
        </div>
      ))}
    </div>
  );
}

/** One bar: a name, a value, and how far along its scale it sits. */
export interface MeterRowData {
  name: string;
  /** The number the bar represents. */
  value: number;
  /** How the value should read — "12 issues", "9.5 days". */
  valueLabel: string;
  tone?: VisualTone;
}

interface MeterListProps {
  rows: readonly MeterRowData[];
  /**
   * The value a bar would have to reach to fill the track. Absent means the largest row sets it, so a
   * set of bars is always comparable with itself.
   */
  scaleMax?: number;
  /** A threshold to draw a line at — the value that makes a bar "too long". */
  markerValue?: number;
  /** What the marker means, for the reader who wonders what the line is. */
  markerLabel?: string;
}

/** A list of bars on one shared scale, so their lengths can be compared by eye. */
export function MeterList({ rows, scaleMax, markerValue, markerLabel }: MeterListProps) {
  // A zero scale would divide by zero; a set of all-zero rows draws as empty tracks, which is honest.
  const resolvedMax = Math.max(scaleMax ?? 0, ...rows.map((row) => row.value), 0);
  const markerPercent = markerValue !== undefined && resolvedMax > 0
    ? Math.min(100, (markerValue / resolvedMax) * 100)
    : null;

  return (
    <div className={styles.meter}>
      {rows.map((row) => (
        <div key={row.name}>
          <div className={styles.meterHeader}>
            <span className={styles.meterName}>{row.name}</span>
            <span className={styles.meterValue}>{row.valueLabel}</span>
          </div>
          <div className={styles.meterTrack}>
            <span
              className={`${styles.meterFill} ${METER_FILL_CLASS[row.tone ?? 'neutral']}`}
              style={{ width: `${resolvedMax > 0 ? Math.min(100, (row.value / resolvedMax) * 100) : 0}%` }}
            />
            {markerPercent === null ? null : (
              <span className={styles.meterMarker} style={{ left: `${markerPercent}%` }} title={markerLabel} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One slice of a distribution. */
export interface DistributionSliceData {
  name: string;
  count: number;
}

/**
 * One bar split by category, with a legend.
 *
 * Counts ride inside the segments wide enough to hold them and in the legend regardless, so a thin
 * slice is still readable rather than being a colour nobody can name.
 */
export function DistributionBar({ slices }: { slices: readonly DistributionSliceData[] }) {
  const total = slices.reduce((runningTotal, slice) => runningTotal + slice.count, 0);
  if (total === 0) {
    return <p className={styles.emptyNote}>Nothing to show — no items fell into any of these.</p>;
  }

  return (
    <div className={styles.meter}>
      <div className={styles.distributionTrack}>
        {slices.map((slice, index) => (
          <span
            className={styles.distributionSegment}
            key={slice.name}
            style={{ flexGrow: slice.count, background: readDistributionColour(index) }}
            title={`${slice.name}: ${slice.count}`}
          >
            {/* Hidden below a tenth of the bar, where the number would be clipped to nonsense. */}
            {slice.count / total > 0.1 ? slice.count : ''}
          </span>
        ))}
      </div>
      <ul className={styles.distributionLegend}>
        {slices.map((slice, index) => (
          <li className={styles.distributionLegendItem} key={slice.name}>
            <span className={styles.distributionSwatch} style={{ background: readDistributionColour(index) }} />
            {`${slice.name} — ${slice.count}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says what was not found, rather than leaving a reader unsure whether the report is broken. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className={styles.emptyNote}>{children}</p>;
}
