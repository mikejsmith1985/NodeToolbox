// agingTriageActionModel.ts — Rolls ingested AI triage verdicts into an actionable, grouped model.
//
// After the operator ingests the assistant's per-issue verdicts, this pure module joins each verdict to
// its issue's real signals and rolls the result up two levels — first by RECOMMENDATION (cancel-safe →
// review → must-remain), then by the parent FEATURE within each recommendation. That shape is what lets a
// reviewer act on a whole feature at once (e.g. close a Done feature and every supporting item under it)
// while still seeing each issue. It takes no clock and does no I/O, so it is deterministic and unit-tested.

import type { AgingTriageIssue, AgingTriageSuggestion, AgingTriageVerdict } from './agingTriage.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/** One issue row in the actionable table: its verdict + rationale alongside the signals that justified it. */
export interface TriageActionIssue {
  issueKey: string;
  verdict: AgingTriageVerdict;
  rationale: string;
  summary: string;
  status: string;
  priority: string | null;
  ageDays: number;
}

/** A feature bucket within a recommendation: the parent feature (null = "no feature") and its issues. */
export interface TriageFeatureGroup {
  featureKey: string | null;
  featureSummary: string | null;
  featureStatus: string | null;
  issues: TriageActionIssue[];
}

/** All issues sharing one recommendation, split into feature buckets. */
export interface TriageVerdictGroup {
  verdict: AgingTriageVerdict;
  issueCount: number;
  featureGroups: TriageFeatureGroup[];
}

/** The whole actionable roll-up: recommendation groups in a fixed, meaningful order. */
export interface TriageActionModel {
  verdictGroups: TriageVerdictGroup[];
}

// The recommendation display order — the cleanup-first ordering a reviewer works top to bottom.
const VERDICT_ORDER: readonly AgingTriageVerdict[] = ['cancel-safe', 'review', 'must-remain'];

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the recommendation → feature → issue roll-up from the ingested verdicts and the issues that were
 * actually shown. Verdicts for unknown issue keys are dropped (they were never on screen). Recommendations
 * appear in cleanup-first order and only when non-empty; within each, real features sort by summary and the
 * "no feature" bucket sorts last; issues sort oldest-first so the strongest cancel candidates lead.
 */
export function buildTriageActionModel(
  suggestions: readonly AgingTriageSuggestion[],
  triageIssues: readonly AgingTriageIssue[],
): TriageActionModel {
  const issueByKey = new Map(triageIssues.map((issue) => [issue.issueKey, issue]));

  // Join each verdict to its shown issue, dropping any verdict whose issue was not on screen.
  const rows: Array<{ issue: AgingTriageIssue; row: TriageActionIssue }> = [];
  for (const suggestion of suggestions) {
    const issue = issueByKey.get(suggestion.issueKey);
    if (issue === undefined) {
      continue;
    }
    rows.push({ issue, row: toActionIssue(issue, suggestion) });
  }

  const verdictGroups = VERDICT_ORDER
    .map((verdict) => buildVerdictGroup(verdict, rows.filter((entry) => entry.row.verdict === verdict)))
    .filter((group): group is TriageVerdictGroup => group !== null);

  return { verdictGroups };
}

/** Projects one issue + its verdict into a table row, carrying the signals a reviewer weighs. */
function toActionIssue(issue: AgingTriageIssue, suggestion: AgingTriageSuggestion): TriageActionIssue {
  return {
    issueKey: issue.issueKey,
    verdict: suggestion.verdict,
    rationale: suggestion.rationale,
    summary: issue.summary,
    status: issue.status,
    priority: issue.priority,
    ageDays: issue.ageDays,
  };
}

/** Builds one recommendation group's feature buckets, or null when the recommendation has no issues. */
function buildVerdictGroup(
  verdict: AgingTriageVerdict,
  entries: ReadonlyArray<{ issue: AgingTriageIssue; row: TriageActionIssue }>,
): TriageVerdictGroup | null {
  if (entries.length === 0) {
    return null;
  }

  // Bucket issues by their feature key (a literal null key holds the "no feature" bucket).
  const bucketByFeatureKey = new Map<string | null, { issue: AgingTriageIssue; rows: TriageActionIssue[] }>();
  for (const entry of entries) {
    const existing = bucketByFeatureKey.get(entry.issue.featureKey);
    if (existing) {
      existing.rows.push(entry.row);
    } else {
      bucketByFeatureKey.set(entry.issue.featureKey, { issue: entry.issue, rows: [entry.row] });
    }
  }

  const featureGroups = Array.from(bucketByFeatureKey.values())
    .map(({ issue, rows }) => ({
      featureKey: issue.featureKey,
      featureSummary: issue.featureSummary,
      featureStatus: issue.featureStatus,
      issues: [...rows].sort(compareByAgeThenKey),
    }))
    .sort(compareFeatureGroups);

  return { verdict, issueCount: entries.length, featureGroups };
}

/** Orders issue rows oldest-first so the strongest cancel candidates lead; ties broken by key. */
function compareByAgeThenKey(first: TriageActionIssue, second: TriageActionIssue): number {
  if (first.ageDays !== second.ageDays) {
    return second.ageDays - first.ageDays;
  }
  return first.issueKey < second.issueKey ? -1 : first.issueKey > second.issueKey ? 1 : 0;
}

/** Orders feature buckets: real features by summary (then key), with the null "no feature" bucket last. */
function compareFeatureGroups(first: TriageFeatureGroup, second: TriageFeatureGroup): number {
  if (first.featureKey === null) {
    return second.featureKey === null ? 0 : 1;
  }
  if (second.featureKey === null) {
    return -1;
  }
  const firstLabel = first.featureSummary ?? first.featureKey;
  const secondLabel = second.featureSummary ?? second.featureKey;
  return firstLabel.localeCompare(secondLabel) || first.featureKey.localeCompare(second.featureKey);
}
