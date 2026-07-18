// readinessScan.ts — The SINGLE readiness evaluation (021 FR-010).
//
// This pure module is the only place lens membership, alert predicates, refinement, and counts are
// decided. Every renderer (the panel's tiles, the listing, the AI prompt scope) consumes its one
// output, so a lens count and its drilled-in listing can never disagree (SC-003). No React, no I/O —
// the fetch lives in readinessFeatureQuery.ts; this takes the already-fetched features and grades.

import { classifyStatusBucket } from '../../../utils/workflowDelivery.ts';
import { detectImpedimentReasons, type ImpedimentReason } from '../hooks/artHelpers.ts';
import { readFeatureReviewFieldValue } from '../../SprintDashboard/featureReviewFixes.ts';
import type { HygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks.ts';
import type { JiraIssue } from '../../../types/jira.ts';

// ── Types ──

/** The five org-dashboard alert families, plus their id used as deep-link filter tokens. */
export type ReadinessAlertId =
  | 'missing-ownership'
  | 'missing-estimate'
  | 'missing-pcode'
  | 'target-end-missing-or-past'
  | 'due-date-missing-or-past';

export const READINESS_ALERT_IDS: readonly ReadinessAlertId[] = [
  'missing-ownership',
  'missing-estimate',
  'missing-pcode',
  'target-end-missing-or-past',
  'due-date-missing-or-past',
];

/** A field family is either evaluated ('active') or absent on this instance ('notConfigured'). */
export type ReadinessAlertFamilyState = 'active' | 'notConfigured';

/** The three status buckets, lower-cased for use as count keys and filter tokens. */
export type ReadinessStatusBucket = 'todo' | 'inProgress' | 'done';

/** One evaluated Feature — the raw issue plus resolved readings and the alerts that fired. */
export interface ReadinessFeature {
  issue: JiraIssue;
  key: string;
  summary: string;
  statusName: string;
  statusBucket: ReadinessStatusBucket;
  assigneeDisplayName: string | null;
  productOwnerDisplayName: string | null;
  estimateValue: string | null;
  pcodeValue: string | null;
  targetEndIso: string | null;
  dueDateIso: string | null;
  ageDays: number | null;
  impedimentReasons: ImpedimentReason[];
  alerts: ReadinessAlertId[];
}

/** One PI lens: which PIs it covers, the features in it, and its derived counts. */
export interface ReadinessLens {
  id: 'carryover' | 'current' | 'upcoming';
  piNames: string[];
  features: ReadinessFeature[];
  countsByBucket: Record<ReadinessStatusBucket, number>;
  /** Upcoming lens only — state-based refinement (clarify Q1); zero for other lenses. */
  refinedCount: number;
  unrefinedCount: number;
  /** Upcoming lens only — false when no newer PI is configured. */
  isPiConfigured: boolean;
  /** True when the carryover query hit its PI-history cap (rendered as a note). */
  isCoverageCapped: boolean;
}

/** The Jira field ids the inline fixes write to (first configured id per family, or null). */
export interface ReadinessWriteFieldIds {
  productOwnerFieldId: string | null;
  estimateFieldId: string | null;
  pcodeFieldId: string | null;
  targetEndFieldId: string | null;
}

/** The one evaluation result every renderer consumes. */
export interface ReadinessScanResult {
  lenses: { carryover: ReadinessLens; current: ReadinessLens; upcoming: ReadinessLens };
  /** null = load failed; 0 = empty scope; >0 = features scanned. */
  scannedFeatureCount: number | null;
  alertFamilyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState>;
  /** The write targets the inline fixes use, resolved once from the field config. */
  writeFieldIds: ReadinessWriteFieldIds;
  loadError: string | null;
  scopeDescription: string;
}

/** Everything the pure scan needs; the query module produces the feature lists. */
export interface ReadinessScanInput {
  piFieldId: string;
  fieldConfig: HygieneFieldConfig;
  currentPiName: string;
  upcomingPiName: string | null;
  carryoverPiNames: string[];
  currentFeatures: JiraIssue[];
  upcomingFeatures: JiraIssue[];
  carryoverFeatures: JiraIssue[];
  loadError: string | null;
  scopeDescription: string;
  /** True when carryover coverage was capped (some older PIs not queried). */
  isCarryoverCapped?: boolean;
  /** Injectable clock for deterministic date-based alert tests. */
  nowMs?: number;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Field reading ──

/** Reads a display value from the first configured field id in a family, or null when none holds one. */
function readFirstConfiguredValue(issue: JiraIssue, fieldIds: readonly string[]): string | null {
  for (const fieldId of fieldIds) {
    const value = readFeatureReviewFieldValue(issue, fieldId).trim();
    if (value !== '') return value;
  }
  return null;
}

/** Whole days since the issue was last touched, or null when the timestamp is unusable. */
function computeAgeDays(issue: JiraIssue, nowMs: number): number | null {
  const isoDate = issue.fields.updated ?? issue.fields.created;
  if (!isoDate) return null;
  const parsed = new Date(isoDate).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / MILLISECONDS_PER_DAY));
}

/** Maps the Overview bucket label to the lower-cased readiness token. */
function toReadinessBucket(issue: JiraIssue): ReadinessStatusBucket {
  const bucket = classifyStatusBucket(issue);
  if (bucket === 'Done') return 'done';
  if (bucket === 'In Progress') return 'inProgress';
  return 'todo';
}

/** True when an ISO date is missing or strictly before the start of today. */
function isMissingOrPast(isoDate: string | null, nowMs: number): boolean {
  if (!isoDate) return true;
  const parsed = new Date(isoDate).getTime();
  if (!Number.isFinite(parsed)) return true;
  return parsed < nowMs;
}

// ── Alert evaluation ──

/**
 * Evaluates one Feature into a graded ReadinessFeature. `familyStates` tells the predicates which
 * alert families are configured — an unconfigured family never fires (GH #167 honesty).
 */
function evaluateFeature(
  issue: JiraIssue,
  input: ReadinessScanInput,
  familyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState>,
  nowMs: number,
): ReadinessFeature {
  const assigneeDisplayName = issue.fields.assignee?.displayName?.trim() || null;
  const productOwnerDisplayName = readFirstConfiguredValue(issue, input.fieldConfig.productOwnerFieldIds);
  const estimateValue = readFirstConfiguredValue(issue, input.fieldConfig.estimateFieldIds ?? []);
  const pcodeValue = readFirstConfiguredValue(issue, input.fieldConfig.pcodeFieldIds ?? []);
  const targetEndIso = readFirstConfiguredValue(issue, input.fieldConfig.targetEndFieldIds);
  const dueDateIso = issue.fields.duedate?.trim() || null;
  const statusBucket = toReadinessBucket(issue);
  const isDone = statusBucket === 'done';

  const alerts: ReadinessAlertId[] = [];
  // Ownership: fired only when BOTH the assignee and the configured PO field are empty (clarify Q2).
  // If the PO family is unconfigured, the assignee alone decides.
  if (assigneeDisplayName === null && productOwnerDisplayName === null) {
    alerts.push('missing-ownership');
  }
  if (familyStates['missing-estimate'] === 'active' && estimateValue === null) {
    alerts.push('missing-estimate');
  }
  if (familyStates['missing-pcode'] === 'active' && pcodeValue === null) {
    alerts.push('missing-pcode');
  }
  if (familyStates['target-end-missing-or-past'] === 'active' && !isDone && isMissingOrPast(targetEndIso, nowMs)) {
    alerts.push('target-end-missing-or-past');
  }
  if (!isDone && isMissingOrPast(dueDateIso, nowMs)) {
    alerts.push('due-date-missing-or-past');
  }

  return {
    issue,
    key: issue.key,
    summary: issue.fields.summary || issue.key,
    statusName: issue.fields.status.name,
    statusBucket,
    assigneeDisplayName,
    productOwnerDisplayName,
    estimateValue,
    pcodeValue,
    targetEndIso,
    dueDateIso,
    ageDays: computeAgeDays(issue, nowMs),
    impedimentReasons: detectImpedimentReasons(issue),
    alerts,
  };
}

/** Tallies a lens's features into the three-bucket count map. */
function countByBucket(features: readonly ReadinessFeature[]): Record<ReadinessStatusBucket, number> {
  const counts: Record<ReadinessStatusBucket, number> = { todo: 0, inProgress: 0, done: 0 };
  for (const feature of features) counts[feature.statusBucket] += 1;
  return counts;
}

// ── Public entry ──

/**
 * Grades already-fetched features into the three lenses and the alert-family states. This is the
 * single source of truth for every readiness count and listing (FR-010). Ownership never depends on
 * an unconfigured family; estimate/pcode/target families that resolved to no field id are reported
 * `notConfigured` and never flag a feature.
 */
export function runReadinessScan(input: ReadinessScanInput): ReadinessScanResult {
  const nowMs = input.nowMs ?? Date.now();

  // A family is 'active' only when it has at least one configured field id (system fields — assignee,
  // due date — are always available, so their alerts are always active).
  const alertFamilyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState> = {
    'missing-ownership': 'active',
    'missing-estimate': (input.fieldConfig.estimateFieldIds ?? []).length > 0 ? 'active' : 'notConfigured',
    'missing-pcode': (input.fieldConfig.pcodeFieldIds ?? []).length > 0 ? 'active' : 'notConfigured',
    'target-end-missing-or-past': input.fieldConfig.targetEndFieldIds.length > 0 ? 'active' : 'notConfigured',
    'due-date-missing-or-past': 'active',
  };

  const gradeAll = (issues: readonly JiraIssue[]): ReadinessFeature[] =>
    issues.map((issue) => evaluateFeature(issue, input, alertFamilyStates, nowMs));

  const currentFeatures = gradeAll(input.currentFeatures);
  const upcomingFeatures = gradeAll(input.upcomingFeatures);
  // Carryover only carries UNFINISHED work — done features are settled, not carried (contract rule).
  const carryoverFeatures = gradeAll(input.carryoverFeatures).filter((feature) => feature.statusBucket !== 'done');

  const current: ReadinessLens = {
    id: 'current',
    piNames: [input.currentPiName],
    features: currentFeatures,
    countsByBucket: countByBucket(currentFeatures),
    refinedCount: 0,
    unrefinedCount: 0,
    isPiConfigured: input.currentPiName.trim() !== '',
    isCoverageCapped: false,
  };

  const upcoming: ReadinessLens = {
    id: 'upcoming',
    piNames: input.upcomingPiName ? [input.upcomingPiName] : [],
    features: upcomingFeatures,
    countsByBucket: countByBucket(upcomingFeatures),
    // State-based refinement (clarify Q1): To Do (status category new) = unrefined, else refined.
    unrefinedCount: upcomingFeatures.filter((feature) => feature.statusBucket === 'todo').length,
    refinedCount: upcomingFeatures.filter((feature) => feature.statusBucket !== 'todo').length,
    isPiConfigured: input.upcomingPiName !== null && input.upcomingPiName.trim() !== '',
    isCoverageCapped: false,
  };

  const carryover: ReadinessLens = {
    id: 'carryover',
    piNames: input.carryoverPiNames,
    features: carryoverFeatures,
    countsByBucket: countByBucket(carryoverFeatures),
    refinedCount: 0,
    unrefinedCount: 0,
    isPiConfigured: true,
    isCoverageCapped: input.isCarryoverCapped ?? false,
  };

  const scannedFeatureCount = input.loadError !== null
    ? null
    : currentFeatures.length + upcomingFeatures.length + carryoverFeatures.length;

  return {
    lenses: { carryover, current, upcoming },
    scannedFeatureCount,
    alertFamilyStates,
    writeFieldIds: {
      productOwnerFieldId: input.fieldConfig.productOwnerFieldIds[0] ?? null,
      estimateFieldId: (input.fieldConfig.estimateFieldIds ?? [])[0] ?? null,
      pcodeFieldId: (input.fieldConfig.pcodeFieldIds ?? [])[0] ?? null,
      targetEndFieldId: input.fieldConfig.targetEndFieldIds[0] ?? null,
    },
    loadError: input.loadError,
    scopeDescription: input.scopeDescription,
  };
}

// ── PCode normalization (shared by the fix control and AI accept) ──

/** Result of normalizing raw PCode input: a clean whole-number string, or a rejection reason. */
export type PcodeNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Normalizes Spark ID/PCode input to the whole-number form Jira expects. `P00012345` → `12345`;
 * plain digits pass through; anything with non-digit remainder is rejected BEFORE any write so a
 * bad value never reaches Jira.
 */
export function normalizePcodeInput(rawInput: string): PcodeNormalizationResult {
  const trimmed = rawInput.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'Enter the whole-number PCode (e.g. 12345).' };
  }
  const withoutPrefix = /^[Pp]0*(\d+)$/.exec(trimmed);
  if (withoutPrefix) {
    return { ok: true, value: withoutPrefix[1] };
  }
  if (/^\d+$/.test(trimmed)) {
    return { ok: true, value: trimmed.replace(/^0+(?=\d)/, '') };
  }
  return { ok: false, reason: 'PCode must be a whole number (e.g. 12345 from P00012345).' };
}
