// piPlanTypes.ts — The pure data contracts for the PI Planning Automation feature (spec 028).
//
// Everything here is plain data: no methods, no clock, no I/O — so the engine, the date/cadence
// module, the release scheduler, and the Jira-write layer all share one source of truth and stay
// fully unit-testable and deterministic. Types that already exist elsewhere (the FeatureCanvas
// planner's PlanItem/PersonCapacity/PlanResult) are reused, not redefined; this file adds only the
// planner-specific shapes described in data-model.md.

import type { PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';

// A working-day calendar — which weekdays are non-working, plus explicit organisational holidays.
// Declared once in utils/workingDays.ts alongside the arithmetic that consumes it, and re-exported
// here so every existing `from './piPlanTypes.ts'` import keeps resolving. Two structurally
// identical declarations would type-check happily and then drift, which is the failure this
// codebase has spent several changes removing.
export type { WorkingCalendar } from '../../../utils/workingDays.ts';

/** One classified sub-task kind beneath a Story.
 *  028 kinds: 'internalTest' + the three deploys. 032 (PI Delivery Framework) ADDS 'coding' (one per repo,
 *  repeatable) and 'slTest' (the renamed-for-clarity SL test checkpoint). Both vocabularies coexist so the
 *  028 engine and its tests stay byte-identical while the 032 delivery path uses 'coding'/'slTest'. */
export type SubTaskKind = 'coding' | 'slTest' | 'internalTest' | 'deployInt' | 'deployRel' | 'deployProd';

/** A reviewable plan item's kind — a Story, one of its sub-tasks, a sprint creation, or a release suggestion. */
export type PlanItemKind = 'story' | SubTaskKind | 'sprintCreate' | 'releaseSuggest';

/** The lifecycle of a single reviewable proposal item. `existing` ⇒ an idempotency match, never re-created. */
export type PlanItemStatus = 'new' | 'existing' | 'accepted' | 'dismissed';

/** An already-present child of a Feature (a Story) or of a Story (a sub-task), read for idempotency. */
export interface ExistingChild {
  key: string;
  kind: 'story' | SubTaskKind | 'unknown';
  parentKey: string;
  summary: string;
}

/** The planner's view of one in-scope Feature, assembled from PI Review + reconciled Jira reads. */
export interface FeatureInput {
  key: string;
  summary: string;
  /** Feature point size; null ⇒ unplannable-until-sized (surfaced as an honest state). */
  sizePoints: number | null;
  /** Ordering signal for scheduling (from the PI Review priority column). Lower = more urgent. */
  priorityRank: number;
  /** Jira priority name (e.g. 'High') mapped to a MoSCoW bucket by piPlanBreakdown (research R2a). */
  priorityName: string | null;
  /** True when the Feature is marked committed in PI Review (forces at least a 'Should' bucket). */
  isCommitted: boolean;
  dependencyKeys: string[];
  targetFixVersion: string | null;
  existingChildren: ExistingChild[];
  /** The Feature's components already filtered to those classified `repo` (spec 031). Drives repo-only story
   *  generation — one Story per name. Absent/empty for ordinary 028 planning (unaffected). */
  repoComponentNames?: string[];
}

/** One proposed Story within a Feature breakdown (AI output). */
export interface StorySuggestion {
  summary: string;
  sizePoints: number;
  /** Drives the internal-test sub-task; defaults true unless the model marks it a spike (FR-021). */
  hasTestableOutput: boolean;
  /** Set by ingest when this matches an ExistingChild — the idempotency link (FR-055). */
  matchExistingKey: string | null;
}

/** One AI breakdown item — a Feature and its proposed Stories. The `{kind:'piPlan'}` envelope carries these. */
export interface BreakdownSuggestion {
  featureKey: string;
  stories: StorySuggestion[];
  rationale: string | null;
}

/** The result of ingesting an AI reply: usable suggestions plus everything that was rejected, honestly. */
export interface PiPlanParseResult {
  suggestions: BreakdownSuggestion[];
  rejected: { featureKey: string; reason: string }[];
  unknownKeys: string[];
  unparsedCount: number;
}

/** An accepted Story expanded into a scheduled unit (post-breakdown, pre-dating). */
export interface ScheduledStory {
  tempId: string;
  featureKey: string;
  summary: string;
  sizePoints: number;
  /** 70% of size (rounded). */
  devPoints: number;
  /** 30% of size (rounded; the two sum to sizePoints). */
  internalTestPoints: number;
  hasTestableOutput: boolean;
  /** Roster displayName of the assignee (capability-filtered least-loaded; PO-overridable). */
  assignee: string | null;
  sprintName: string;
  sprintStartIso: string;
  sprintEndIso: string;
  /** For a repo-driven Story (spec 031): the resolved component id of the single repo this Story represents.
   *  Set → the create payload carries `components: [{id}]`. Absent/null for ordinary 028 stories (unaffected). */
  repoComponentId?: string | null;
}

/** The five scheduled dates for a Story and its sub-tasks, each with a plain-language derivation. */
export interface DatedItem {
  targetStartIso: string;
  /** End of the 30% internal-test portion; null when hasTestableOutput=false. Gates external testing. */
  internalTestEndIso: string | null;
  /** Code in INT (the PI Definition of Done). Invariant: always equal to deployIntIso. */
  targetEndIso: string;
  deployIntIso: string;
  deployRelIso: string;
  /** First production release date on/after REL; null when no release (existing or suggested) is available. */
  deployProdIso: string | null;
  /** Delivery to production; equals deployProdIso and may fall after the PI end. */
  dueIso: string | null;
  derivations: Record<string, string>;
}

/** One production release — an existing Jira fixVersion in the PI window, or a suggested monthly addition. */
export interface ReleaseEntry {
  name: string;
  releaseDateIso: string;
  /** True ⇒ a proposed monthly release requiring acceptance (FR-037). */
  isSuggested: boolean;
}

/** The production release calendar for the PI window. */
export interface ReleaseSchedule {
  entries: ReleaseEntry[];
}

/** A derived sprint the plan proposes creating because the board does not yet cover the PI window. */
export interface SprintCreate {
  name: string;
  startIso: string;
  endIso: string;
}

/** One reviewable, individually acceptable unit of the proposal. */
export interface PlanItemProposal {
  id: string;
  kind: PlanItemKind;
  status: PlanItemStatus;
  /** Feature (for a Story) / Story tempId or key (for a sub-task) / null. */
  parentKey: string | null;
  payload: ScheduledStory | DatedItem | ReleaseEntry | SprintCreate;
  /** The computed dates for a Story and its sub-tasks (the sub-task reads the field matching its kind). */
  dates?: DatedItem;
  warnings: string[];
}

/** The top-level engine output: the reviewable proposal plus the shared PlanResult that drives the map. */
export interface PlanProposal {
  piName: string;
  /** The FeatureCanvas planner result — the SAME object drives both the schedule and the capacity map. */
  planResult: PlanResult;
  items: PlanItemProposal[];
  releaseSchedule: ReleaseSchedule;
  /** Empty scope, unsized Features, capability gaps, empty releases, PI over-commitment (FR-056). */
  honestStates: string[];
}

// ── PI Delivery Framework (spec 032) — additive types ────────────────────────────────────────────────

/** One coding sub-task — one per repository a Story touches (the 032 repo→sub-task 1:1 rule). */
export interface RepoCodingSubtask {
  /** The repository this coding sub-task covers. */
  repoName: string;
  /** Resolved Jira component id for the repo → set on the sub-task's `components` field. Null when unresolved. */
  repoComponentId: string | null;
  /** This repo's share of the Story's dev (70%) points, at least 1; PO-editable before acceptance. */
  devPoints: number;
  /** Roster display name of the load-balanced assignee (PO-overridable); null when unassigned. */
  assignee: string | null;
}

/** One classified component on a Feature, as the fact sheet records it (repo vs domain). */
export type ComponentClass = 'repo' | 'domain' | 'unclassified';

/** One in-scope Feature as recorded on the PI Planning Fact Sheet. */
export interface FactSheetFeature {
  key: string;
  summary: string;
  /** Plain-text Feature description (truncated), embedded in the prompt so the AI decomposes from real
   *  content — not just the title. Optional so existing FactSheetFeature literals still type-check. */
  description?: string;
  sizePoints: number | null;
  priorityRank: number;
  priorityName: string | null;
  isCommitted: boolean;
  /** Component names classified `repo` (drive coding sub-tasks). */
  repoComponentNames: string[];
  /** Component names classified `domain` (never generate a sub-task). */
  domainComponentNames: string[];
  dependencyKeys: string[];
  targetFixVersion: string | null;
  existingChildren: ExistingChild[];
  /** True when the Feature already has child Stories in flight (carryover) — reconcile, never regenerate.
   *  Optional so pre-existing callers/tests that build a FactSheetFeature literal still type-check. */
  isCarryover?: boolean;
}

/** One roster person on the fact sheet, capacity already load-factored. */
export interface FactSheetPerson {
  displayName: string;
  accountId: string | null;
  /** 'dev' | 'internalTest' (=SL test) | 'externalTest'. */
  roles: string[];
  /** Points available per sprint — already scaled by the load factor. */
  pointsPerSprint: number;
}

/** One sprint on the fact sheet; the final sprint's second week may be the innovation week. */
export interface FactSheetSprint {
  name: string;
  startIso: string;
  endIso: string;
  /** True for the Sprint-5 Week-2 innovation window (no delivery capacity). */
  isInnovationWeek?: boolean;
}

/** The deterministic bundle that both feeds the engine and is embedded verbatim in the AI prompt. */
export interface PiPlanningFactSheet {
  piName: string;
  piStartIso: string;
  /** End of Sprint-5 Week-1 — the delivery deadline (Target Ends must fall on/before this). */
  deliveryDeadlineIso: string;
  features: FactSheetFeature[];
  people: FactSheetPerson[];
  sprints: FactSheetSprint[];
  releaseSchedule: ReleaseSchedule;
  /** The authoritative set of nameable repos — the ingest allowlist. */
  repoAllowlist: string[];
  fieldConfig: { inIntStatusNames: string[]; slDoneStatusNames: string[]; doneCategoryNames: string[] };
  velocityByPerson: Record<string, number>;
  /** Honest states surfaced during assembly (unsized Features, no repos, empty roster/release, etc.). */
  notes: string[];
}

/** One engine-detected bottleneck; the AI may attach a mitigation only to a matching id. */
export type BottleneckKind = 'slTestThroughput' | 'keyPerson' | 'dependencyOrder' | 'prodCarry' | 'storyOversize';
export interface Bottleneck {
  id: string;
  kind: BottleneckKind;
  sprintName: string | null;
  subjectKey: string | null;
  /** The underlying numbers (e.g. { devPoints, slCapacity, additionalTesters }). */
  figures: Record<string, number>;
  statement: string;
  /** Filled from the AI narrative on ingest when its bottleneckId matches this id; null otherwise. */
  mitigation: string | null;
}

/** One monitoring signal computed against the written plan. */
export type MonitorSignalKind = 'burnUp' | 'subtaskAging' | 'slQueueDepth' | 'freshness' | 'commitVsComplete';
export interface MonitorSignal {
  kind: MonitorSignalKind;
  sprintName: string | null;
  value: number;
  target: number;
  isOnTrack: boolean;
  detail: string;
}

/** An explicit escalation from monitoring to a re-plan. */
export type ReplanTriggerKind = 'storySlipped' | 'slQueueOverTwoSprints';
export interface ReplanTrigger {
  kind: ReplanTriggerKind;
  subjectKey: string | null;
  statement: string;
}

export interface MonitorResult {
  signals: MonitorSignal[];
  triggers: ReplanTrigger[];
}
