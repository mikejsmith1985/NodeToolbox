// hygieneStatBand.ts — The four figures worth leading with, before any list of findings.
//
// The page opened with a wall of twenty identical tiles, one per check, every number the same size
// and the same colour. Twenty equal numbers is not a summary — it is the same counting job the
// reader came here to avoid, and nothing in it says which issue to open first.
//
// These are the four a Scrum Master acts on, in the order they act: what is broken, what is merely
// untidy, what the deterministic fix can clear without anyone deciding anything, and how much of the
// board is clean. The daily forecast leads with the same shape for the same reason.

import type { HygieneFinding } from './checks/hygieneChecks.ts';

/** One figure on the band: what it counts, what to call it, and how loudly to say it. */
export interface HygieneStat {
  id: 'errors' | 'warnings' | 'fixable-dates' | 'clean';
  label: string;
  note: string;
  tone: 'bad' | 'warn' | 'good' | 'muted';
  count: number;
}

/** The date families a deterministic write can clear without anybody deciding anything. */
const DETERMINISTIC_DATE_CHECK_IDS = [
  'missing-due-date',
  'missing-target-start',
  'missing-target-end',
  'dates-out-of-sync',
];

/**
 * Builds the band from the findings on the page.
 *
 * Counts ISSUES, not flags, for the first three — an issue is the thing somebody opens and fixes, so
 * a count of flags would overstate the work by however many problems happen to share a ticket. The
 * clean figure is the remainder of the scan, which is the only figure here that needs the scan size.
 *
 * An issue carrying both an error and a warning counts ONLY as an error. Counting it twice would
 * make the two figures sum to more than the board, and the more serious verdict is the one that
 * decides what happens to it.
 */
export function buildHygieneStatBand(
  findings: readonly HygieneFinding[],
  scannedIssueCount: number,
): HygieneStat[] {
  const errorIssueCount = findings.filter((finding) =>
    finding.flags.some((flag) => flag.severity === 'error')).length;
  const warningIssueCount = findings.length - errorIssueCount;
  const fixableDateIssueCount = findings.filter((finding) =>
    finding.flags.some((flag) => DETERMINISTIC_DATE_CHECK_IDS.includes(flag.checkId))).length;
  // Never negative: a truncated scan can report fewer issues than it found findings for, and a
  // negative "clean" figure would be a nonsense the reader has to work out how to discount.
  const cleanIssueCount = Math.max(0, scannedIssueCount - findings.length);

  return [
    { id: 'errors', label: 'BROKEN', note: 'issues with an error flag', tone: 'bad', count: errorIssueCount },
    { id: 'warnings', label: 'UNTIDY', note: 'warnings only', tone: 'warn', count: warningIssueCount },
    {
      id: 'fixable-dates',
      label: 'DATES FIXABLE',
      note: 'one click, no decisions',
      tone: 'muted',
      count: fixableDateIssueCount,
    },
    { id: 'clean', label: 'CLEAN', note: 'no flags at all', tone: 'good', count: cleanIssueCount },
  ];
}
