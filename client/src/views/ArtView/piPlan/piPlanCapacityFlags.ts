// piPlanCapacityFlags.ts — Deterministic capacity-honesty checks for the PI Delivery Framework (spec 032).
//
// Two rule-derived flags the framework was missing:
//   1. Defect-bucket undersize — a "Defect(s)" Feature is pointed as a fixed capacity budget (e.g. 40). As child
//      defect issues are created after the fact, their points can exceed that budget. When the sum of a defect
//      Feature's child points passes its own size, the Feature is under-sized and must be re-pointed or split.
//   2. (Story sprint-fit lives in piPlanBottlenecks as `storyOversize`, computed after decomposition.)
//
// Pure and deterministic so both are unit-testable and can never disagree with the numbers they describe.

/** The minimal Feature shape these checks read (key, summary, point size). */
export interface CapacityFlagFeature {
  key: string;
  summary: string;
  sizePoints: number | null;
}

/** One defect Feature whose child issues have outgrown its point budget. */
export interface DefectUndersizeFlag {
  featureKey: string;
  summary: string;
  /** The Feature's own point size — the intended defect capacity budget. */
  featureSize: number;
  /** The summed points of the Feature's child issues. */
  childTotal: number;
  /** How far the children exceed the budget (childTotal − featureSize, always > 0 when flagged). */
  overBy: number;
}

/**
 * True when a Feature is a defect-capacity bucket: an ordinary Feature whose summary contains "Defect" or
 * "Defects" (the team's convention — Jira has no distinct portfolio defect type). Word-boundary matched so a
 * summary like "Defect Backlog Q3" flags but "Defective-part enrollment" does not.
 */
export function isDefectFeature(summary: string): boolean {
  return /\bdefects?\b/i.test(summary);
}

/**
 * Flags every defect-bucket Feature whose child issues have outgrown its point budget. Non-defect Features and
 * unsized Features are skipped (an unsized bucket has no budget to overrun — surfaced elsewhere as "not sized").
 */
export function detectDefectUndersize(
  features: readonly CapacityFlagFeature[],
  childPointsByFeature: Record<string, number>,
): DefectUndersizeFlag[] {
  const flags: DefectUndersizeFlag[] = [];
  for (const feature of features) {
    if (!isDefectFeature(feature.summary) || feature.sizePoints == null) {
      continue;
    }
    const childTotal = childPointsByFeature[feature.key] ?? 0;
    if (childTotal > feature.sizePoints) {
      flags.push({
        featureKey: feature.key,
        summary: feature.summary,
        featureSize: feature.sizePoints,
        childTotal,
        overBy: childTotal - feature.sizePoints,
      });
    }
  }
  return flags;
}
