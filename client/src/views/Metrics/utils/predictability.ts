// predictability.ts — Pure Metrics helpers for sprint commitment predictability.
//
// These helpers isolate the legacy Greenhopper sprint-report math so the React
// hook can focus on Jira loading and the view can explain the results clearly.

const ZERO_TOTAL = 0;
const PERCENTAGE_SCALE = 100;

export interface SprintMeta {
  id: number;
  name: string;
}

export interface GreenhopperEstimateStatistic {
  statFieldValue?: {
    value?: number | string | null;
  } | null;
}

export interface GreenhopperIssue {
  key?: string;
  currentEstimateStatistic?: GreenhopperEstimateStatistic | null;
  estimateStatistic?: GreenhopperEstimateStatistic | null;
}

export interface SprintReportContents {
  completedIssues?: GreenhopperIssue[];
  incompletedIssues?: GreenhopperIssue[];
  puntedIssues?: GreenhopperIssue[];
  issueKeysAddedDuringSprint?: Record<string, unknown> | string[] | null;
}

export interface SprintReportResponse {
  contents?: SprintReportContents;
}

export interface PredictabilityPoint {
  sprintId: number;
  sprintName: string;
  committedPoints: number;
  completedPoints: number;
  completedItems: number;
  committedItems: number;
  completionPct: number;
}

/** Converts a Greenhopper sprint report into commitment and completion metrics for one sprint. */
export function parseSprintReport(report: SprintReportResponse | null | undefined, sprintMeta: SprintMeta): PredictabilityPoint {
  const sprintReportContents = report?.contents;
  if (!sprintReportContents) return createEmptyPredictabilityPoint(sprintMeta);

  const addedDuringSprintKeys = new Set(readAddedDuringSprintKeys(sprintReportContents.issueKeysAddedDuringSprint));
  const completedIssues = sprintReportContents.completedIssues ?? [];
  const committedIssues = [
    ...completedIssues,
    ...(sprintReportContents.incompletedIssues ?? []),
    ...(sprintReportContents.puntedIssues ?? []),
  ].filter((greenhopperIssue) => !isIssueAddedDuringSprint(greenhopperIssue, addedDuringSprintKeys));
  const completedCommittedIssues = completedIssues.filter(
    (greenhopperIssue) => !isIssueAddedDuringSprint(greenhopperIssue, addedDuringSprintKeys),
  );
  const committedPoints = sumStoryPoints(committedIssues);
  const completedPoints = sumStoryPoints(completedCommittedIssues);

  return {
    sprintId: sprintMeta.id,
    sprintName: sprintMeta.name,
    committedPoints,
    completedPoints,
    completedItems: completedCommittedIssues.length,
    committedItems: committedIssues.length,
    completionPct: computeCompletionPct(committedPoints, completedPoints),
  };
}

/** Calculates a rounded completion percentage and protects empty commitments from divide-by-zero noise. */
export function computeCompletionPct(committedPoints: number, completedPoints: number): number {
  if (committedPoints <= ZERO_TOTAL) return ZERO_TOTAL;
  return Math.round((completedPoints / committedPoints) * PERCENTAGE_SCALE);
}

/** Averages per-sprint completion percentages so predictability treats each sprint equally. */
export function averagePct(points: PredictabilityPoint[]): number {
  if (points.length === ZERO_TOTAL) return ZERO_TOTAL;
  const completionPercentTotal = points.reduce((runningTotal, predictabilityPoint) => {
    return runningTotal + predictabilityPoint.completionPct;
  }, ZERO_TOTAL);
  return Math.round(completionPercentTotal / points.length);
}

function createEmptyPredictabilityPoint(sprintMeta: SprintMeta): PredictabilityPoint {
  return {
    sprintId: sprintMeta.id,
    sprintName: sprintMeta.name,
    committedPoints: ZERO_TOTAL,
    completedPoints: ZERO_TOTAL,
    completedItems: ZERO_TOTAL,
    committedItems: ZERO_TOTAL,
    completionPct: ZERO_TOTAL,
  };
}

function readAddedDuringSprintKeys(addedDuringSprint: SprintReportContents['issueKeysAddedDuringSprint']): string[] {
  if (!addedDuringSprint) return [];
  if (Array.isArray(addedDuringSprint)) return addedDuringSprint;
  return Object.keys(addedDuringSprint);
}

function isIssueAddedDuringSprint(greenhopperIssue: GreenhopperIssue, addedDuringSprintKeys: Set<string>): boolean {
  return Boolean(greenhopperIssue.key && addedDuringSprintKeys.has(greenhopperIssue.key));
}

function sumStoryPoints(greenhopperIssues: GreenhopperIssue[]): number {
  return greenhopperIssues.reduce((runningPointTotal, greenhopperIssue) => {
    return runningPointTotal + readStoryPoints(greenhopperIssue);
  }, ZERO_TOTAL);
}

function readStoryPoints(greenhopperIssue: GreenhopperIssue): number {
  const currentEstimate = parseEstimateValue(greenhopperIssue.currentEstimateStatistic?.statFieldValue?.value);
  if (currentEstimate !== null) return currentEstimate;
  return parseEstimateValue(greenhopperIssue.estimateStatistic?.statFieldValue?.value) ?? ZERO_TOTAL;
}

function parseEstimateValue(candidateValue: number | string | null | undefined): number | null {
  const parsedEstimate = typeof candidateValue === 'number' ? candidateValue : Number.parseFloat(candidateValue ?? '');
  return Number.isFinite(parsedEstimate) ? parsedEstimate : null;
}
