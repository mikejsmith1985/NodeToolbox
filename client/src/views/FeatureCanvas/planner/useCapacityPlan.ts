// useCapacityPlan.ts — React hook that runs the deterministic capacity pipeline on demand (feature 013, Layer 4a).
//
// The pure engine (capacityPlanner), classifier (planItemMapping), and fetch (plannerFetch) are already
// built and tested. This hook is the thin, impure seam that wires them to the canvas: on run() it derives
// which child stories are planable (from each feature's MoSCoW bucket), fetches their live Jira detail,
// enriches the primaries with bucket + intra-bucket rank, maps roster → capacity, and builds the plan.
// It performs NO Jira writes and reads the clock exactly once (todayIso) — the engine itself stays pure.

import { useCallback, useState } from 'react';

import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { buildCapacityPlan } from './capacityPlanner.ts';
import type { MoscowBucket } from '../overlay/overlayModel.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { PlanResult } from './capacityTypes.ts';
import { buildPlanItems, mapRosterToCapacity, type PlannerSourceIssue } from './planItemMapping.ts';
import { fetchPlannerSourceIssues } from './plannerFetch.ts';

// ── Named constants (no magic numbers/strings) ───────────────────────────────

/** Sprint length the projection uses, in days — a fixed 2-week cadence (FR-10, D5). */
const SPRINT_LENGTH_DAYS = 14;
/** Default fraction of dev points synthesized as internal-test cost when a dev item has no QA child (FR-8a). */
const DEFAULT_SYNTHETIC_TEST_FRACTION = 0.5;
/** External-test work lives in this project; such issues are secondary and inherit their parent's bucket/rank. */
const EXTERNAL_TEST_PROJECT_KEY = 'DIP';

// ── Public contract ───────────────────────────────────────────────────────────

/** The four MoSCoW buckets the operator can include in a plan. */
export type IncludableBucket = MoscowBucket;

/** Everything the hook needs to build a plan for the current canvas scope. */
export interface UseCapacityPlanParams {
  /** The feature nodes on the canvas; their child stories are the planable primary work items. */
  canvasNodes: readonly CanvasNode[];
  /** The active-team roster (with role capabilities) mapped to delivery capacity. */
  rosterMembers: readonly StandupRosterMember[];
  /** Active project key — passed to the fetch for scope symmetry. */
  projectKey: string;
  /** Active PI name — drives the projection's PI start/end window. */
  piName: string;
  /** The team's configured story-points field id, so child points read the right field. */
  storyPointsFieldId: string;
  /** Which priority buckets to include; only features in these buckets are planned. */
  includedBuckets: ReadonlySet<IncludableBucket>;
  /**
   * Optional set of feature issue keys to restrict the plan to — so the operator can plan just their
   * top few "priority one" features instead of an entire (often huge) MoSCoW bucket. When undefined,
   * every feature in the included buckets is planned; when provided, only these features are.
   */
  selectedFeatureKeys?: ReadonlySet<string>;
  /** Date the plan starts from (ISO). Defaults to today; the first sprint is prorated when mid-sprint. */
  planStartIso?: string;
  /** Optional override for the synthesized internal-test fraction (defaults to 0.5). */
  syntheticTestFraction?: number;
}

/** The lifecycle status of a plan run. */
export type CapacityPlanStatus = 'idle' | 'loading' | 'ready' | 'error';

/** What the hook exposes to the panel: the current status, the result (when ready), any error, and run(). */
export interface UseCapacityPlanResult {
  status: CapacityPlanStatus;
  result: PlanResult | null;
  error: string | null;
  /** Kicks off (or re-runs) the deterministic pipeline for the current params. */
  run: () => void;
}

/** The priority position a planable child story inherits from its parent feature. */
interface BucketRank {
  bucket: MoscowBucket;
  rankInBucket: number;
}

// ── Pure derivation: which child stories are planable, and their inherited bucket/rank ─

/**
 * Builds the child-story → {bucket, rankInBucket} map from the canvas. A feature contributes its child
 * stories only when its MoSCoW priority is in `includedBuckets` and (when `selectedFeatureKeys` is given)
 * its key is in that selection; features with no priority are excluded from v1 planning. `rankInBucket` is
 * the feature's stable index within its bucket (features sorted by issueKey), so every child of one feature
 * shares that feature's bucket and rank.
 */
export function buildChildBucketRankMap(
  canvasNodes: readonly CanvasNode[],
  includedBuckets: ReadonlySet<IncludableBucket>,
  selectedFeatureKeys?: ReadonlySet<string>,
): Map<string, BucketRank> {
  // Group the eligible features by bucket so each bucket can be ranked independently.
  const featuresByBucket = new Map<MoscowBucket, CanvasNode[]>();
  for (const node of canvasNodes) {
    if (node.priority === null || !includedBuckets.has(node.priority)) {
      continue;
    }
    // When the operator narrowed the plan to specific features, skip anything not chosen.
    if (selectedFeatureKeys !== undefined && !selectedFeatureKeys.has(node.issueKey)) {
      continue;
    }
    const bucketFeatures = featuresByBucket.get(node.priority) ?? [];
    bucketFeatures.push(node);
    featuresByBucket.set(node.priority, bucketFeatures);
  }

  const childBucketRankMap = new Map<string, BucketRank>();
  for (const [bucket, bucketFeatures] of featuresByBucket) {
    // Sort by issueKey for a stable, reproducible rank (SC-1) independent of canvas array order.
    const rankedFeatures = [...bucketFeatures].sort((first, second) => first.issueKey.localeCompare(second.issueKey));
    rankedFeatures.forEach((feature, rankInBucket) => {
      for (const child of feature.childStories) {
        childBucketRankMap.set(child.key, { bucket, rankInBucket });
      }
    });
  }
  return childBucketRankMap;
}

/** Stamps each PRIMARY source issue (a non-sub-task, non-DIP item) with its inherited bucket + rank. */
function enrichPrimariesWithBucketRank(
  sourceIssues: readonly PlannerSourceIssue[],
  childBucketRankMap: Map<string, BucketRank>,
): PlannerSourceIssue[] {
  return sourceIssues.map((issue) => {
    const isPrimary = !issue.isSubtask && issue.projectKey !== EXTERNAL_TEST_PROJECT_KEY;
    if (!isPrimary) {
      // Sub-tasks and DIP external items inherit bucket/rank from their parent in the mapping layer.
      return issue;
    }
    const bucketRank = childBucketRankMap.get(issue.key);
    if (bucketRank === undefined) {
      return issue;
    }
    return { ...issue, bucket: bucketRank.bucket, rankInBucket: bucketRank.rankInBucket };
  });
}

// ── The hook ──────────────────────────────────────────────────────────────────

/**
 * Runs the read-only capacity pipeline on demand. Returns `{ status, result, error, run }`; call `run()`
 * to (re)build the plan for the current params. Every failure mode — empty roster, no delivery capacity,
 * no planable work, or a fetch/engine exception — resolves to a clear `error` string, never a throw.
 */
export function useCapacityPlan(params: UseCapacityPlanParams): UseCapacityPlanResult {
  const [status, setStatus] = useState<CapacityPlanStatus>('idle');
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { canvasNodes, rosterMembers, projectKey, piName, storyPointsFieldId, includedBuckets, selectedFeatureKeys, planStartIso } = params;
  const syntheticTestFraction = params.syntheticTestFraction ?? DEFAULT_SYNTHETIC_TEST_FRACTION;

  const run = useCallback(() => {
    // Fail fast on the two inputs that make a plan impossible before spending a network round-trip.
    if (rosterMembers.length === 0) {
      setStatus('error');
      setResult(null);
      setError('No roster: add a team roster (with roles) in Team Dashboard → Roster before planning.');
      return;
    }
    const people = mapRosterToCapacity(rosterMembers);
    if (people.length === 0) {
      setStatus('error');
      setResult(null);
      setError('No delivery capacity: no roster member holds a Developer, Internal Tester, or External Tester role.');
      return;
    }

    const childBucketRankMap = buildChildBucketRankMap(canvasNodes, includedBuckets, selectedFeatureKeys);
    const primaryKeys = [...childBucketRankMap.keys()];
    if (primaryKeys.length === 0) {
      setStatus('error');
      setResult(null);
      setError('No planable work: none of the selected features/buckets contain features with child stories.');
      return;
    }

    setStatus('loading');
    setResult(null);
    setError(null);

    // The single allowed clock read: injected into the pure engine so the engine stays clock-free (SC-1).
    const todayIso = new Date().toISOString().slice(0, 10);

    void (async () => {
      try {
        const sourceIssues = await fetchPlannerSourceIssues({ teamIssueKeys: primaryKeys, projectKey, piName, storyPointsFieldId });
        const enrichedIssues = enrichPrimariesWithBucketRank(sourceIssues, childBucketRankMap);
        const items = buildPlanItems(enrichedIssues, rosterMembers, syntheticTestFraction);
        if (items.length === 0) {
          setStatus('error');
          setError('No planable work returned for the selected buckets — the stories may be missing or unpointed.');
          return;
        }
        const planResult = buildCapacityPlan(
          { items, people, piName, sprintLengthDays: SPRINT_LENGTH_DAYS, syntheticTestFraction, planStartIso: planStartIso ?? todayIso },
          todayIso,
        );
        setResult(planResult);
        setStatus('ready');
      } catch (caught) {
        setStatus('error');
        setResult(null);
        setError(caught instanceof Error ? caught.message : 'Failed to build the capacity plan.');
      }
    })();
  }, [canvasNodes, rosterMembers, projectKey, piName, storyPointsFieldId, includedBuckets, selectedFeatureKeys, planStartIso, syntheticTestFraction]);

  return { status, result, error, run };
}
