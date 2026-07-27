// piPlanTypes.ts — The pure data contracts for the PI Planning Automation feature (spec 028).
//
// Everything here is plain data: no methods, no clock, no I/O — so the engine, the date/cadence
// module, the release scheduler, and the Jira-write layer all share one source of truth and stay
// fully unit-testable and deterministic. Types that already exist elsewhere (the FeatureCanvas
// planner's PlanItem/PersonCapacity/PlanResult) are reused, not redefined; this file adds only the
// planner-specific shapes described in data-model.md.

import type { PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';

/** A working-day calendar: which weekdays are non-working, plus explicit organisational holidays. */
export interface WorkingCalendar {
  /** JS getUTCDay() values treated as non-working (Sunday=0 … Saturday=6). Default weekend = [0, 6]. */
  weekendDays: number[];
  /** Organisational holiday dates as 'YYYY-MM-DD'. Honoured where a holiday calendar is available. */
  holidayIsoDates: string[];
}

/** One classified sub-task kind beneath a Story. */
export type SubTaskKind = 'internalTest' | 'deployInt' | 'deployRel' | 'deployProd';

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
