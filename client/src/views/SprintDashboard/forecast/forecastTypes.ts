// forecastTypes.ts — Every shape the delivery forecast speaks in, and nothing else.
//
// Two conventions run through all of it, both inherited from the code this feature sits beside:
//
//   • A day is a 'YYYY-MM-DD' string, never a Date. Jira returns date fields as UTC-midnight
//     datetimes, and converting one to a local day yields the day BEFORE for everyone west of
//     Greenwich. A date field names the day written on its face.
//
//   • null means absent, and says so. It is never a stand-in for zero. An estimate of null is
//     "nobody has sized this", which is a different fact from an estimate of nought, and merging
//     the two is how a forecast comes to report unmeasured work as on track.
//
// Nothing here names a Jira custom field id. The engine receives points, statuses and dates as
// DATA — which is what keeps it inside the field-mapping boundary rule, and what makes the whole
// thing testable with no Jira at all.

import type { WorkingCalendar } from '../../../utils/workingDays.ts';

export type { WorkingCalendar };

// ── Configuration ─────────────────────────────────────────────────────────────

/** The validated settings one forecast run uses. Built once, passed everywhere. */
export interface ForecastConfig {
  /** How many story points one person completes in one working day. Always > 0. */
  pointsPerWorkingDay: number;
  calendar: WorkingCalendar;
  /** How far a Feature's children may exceed its own estimate before it is flagged. */
  featureSizingTolerancePercent: number;
  /** Injected, never read from the clock inside the engine — that is what makes runs reproducible. */
  todayIso: string;
}

/**
 * A stored setting that could not be used, and why.
 *
 * A bad setting falls back to its default AND is reported. Silently correcting it produces a
 * forecast nobody can reconcile with the settings screen, which is worse than no forecast.
 */
export interface RejectedSetting {
  name: string;
  storedValue: string;
  reason: string;
}

/** The outcome of reading settings: what will be used, and what was refused. */
export interface ForecastConfigResult {
  config: ForecastConfig;
  rejectedSettings: RejectedSetting[];
}

// ── Effort ────────────────────────────────────────────────────────────────────

/** What is LEFT in one issue, and the workings behind that figure. */
export interface RemainingEffort {
  /** The estimate as Jira holds it. null means unestimated. */
  storyPoints: number | null;
  /** 0–1, how far through the team's own column order this issue has got. */
  columnCredit: number;
  /** storyPoints x (1 - columnCredit), or null when unestimated. */
  remainingPoints: number | null;
  /** Whole working days. Floors at 1 for unfinished estimated work — see effortModel.ts. */
  remainingWorkingDays: number | null;
  isEstimated: boolean;
  /** Human-readable workings, so a disputed number can be checked rather than argued about. */
  basis: string;
}

// ── Windows and clocks ────────────────────────────────────────────────────────

/** Which span of a delivery calendar a window describes. */
export type ForecastWindowKind = 'to-code-freeze' | 'external-test' | 'deploy-buffer' | 'to-pi-end';

/** One span on one clock, with the working days it actually holds. */
export interface ForecastWindow {
  kind: ForecastWindowKind;
  /** First day, inclusive. */
  startIso: string;
  /** Last day, inclusive. */
  endIso: string;
  /** Working days in the span. Zero when the span has passed — never negative. */
  workingDayCount: number;
  hasPassed: boolean;
}

/**
 * The four boundaries of one release, and the three spans between them.
 *
 * Code freeze is NOT a new date: it is the Target End the date policy already writes, three weeks
 * before the release. Naming it here rather than deriving it twice is the whole point.
 */
export interface ReleaseClock {
  releaseDateIso: string;
  codeFreezeIso: string;
  externalTestStartIso: string;
  externalTestEndIso: string;
  deployBufferStartIso: string;
  toCodeFreeze: ForecastWindow;
  externalTest: ForecastWindow;
  deployBuffer: ForecastWindow;
}

/**
 * The PI's own deadline.
 *
 * `isConfigured: false` when the ART has no PI end date. Every PI verdict then reports NOT
 * CONFIGURED rather than falling back to a guess — a guessed commitment date is indistinguishable
 * from a real one once somebody acts on it.
 */
export interface PiClock {
  piEndIso: string | null;
  toPiEnd: ForecastWindow | null;
  isConfigured: boolean;
}

// ── Release dates ─────────────────────────────────────────────────────────────

/** One fix version as this feature needs it — name, date field, released flag. */
export interface FixVersionLike {
  name: string;
  releaseDate?: string | null;
  released?: boolean;
}

/** Where a release date came from, and whether its two possible sources agreed. */
export interface ReleaseDateResolution {
  versionName: string;
  /** From the version's own release-date field. */
  fieldDateIso: string | null;
  /** Parsed out of the version's NAME, which by convention carries it. */
  nameDateIso: string | null;
  resolvedDateIso: string | null;
  source: 'field' | 'name' | 'none';
  /** Both present and different — a real data defect worth naming rather than quietly preferring one. */
  hasDisagreement: boolean;
  /** The name held more than one date-shaped run, so the first was taken. */
  hasAmbiguousName: boolean;
  isReleased: boolean;
}

// ── Per-issue verdict ─────────────────────────────────────────────────────────

/**
 * Exactly one of these describes any issue. The precedence that picks between them lives in
 * issueForecast.ts and is the reason no issue can be silently absent from a total.
 */
export type IssueForecastState =
  | 'ahead'
  | 'on-track'
  | 'start-today'
  | 'behind'
  | 'cannot-fit'
  | 'unsized'
  | 'unassignable'
  | 'unforecastable';

/** Everything the forecast needs to know about one issue. */
export interface IssueForecastInput {
  issueKey: string;
  summary: string;
  /** Which saved Dashboard Team this came from, so a two-team view can attribute every row. */
  teamProfileId: string | null;
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  effort: RemainingEffort;
  /** The code-freeze day of this issue's driving fix version. */
  releaseDeadlineIso: string | null;
  /** PI end, or null when the ART has not configured one. */
  piDeadlineIso: string | null;
  /** The day it entered Working, when known — a fact that always beats a prediction. */
  actualStartIso: string | null;
  /** What Jira currently holds, so a disagreement can be reported rather than silently overwritten. */
  storedTargetStartIso: string | null;
  isComplete: boolean;
}

/** One issue's verdict, with the arithmetic that produced it. */
export interface IssueForecast {
  issueKey: string;
  summary: string;
  teamProfileId: string | null;
  assigneeDisplayName: string | null;
  assigneeAccountId: string | null;
  effort: RemainingEffort;
  releaseDeadlineIso: string | null;
  piDeadlineIso: string | null;
  /** The EARLIER of the two deadlines — the tighter commitment is the one that bites. */
  drivingDeadlineIso: string | null;
  drivingClock: 'release' | 'pi' | 'none';
  /** The last working day this can begin and still land on time. */
  latestStartIso: string | null;
  actualStartIso: string | null;
  state: IssueForecastState;
  /** Positive = spare working days, negative = shortfall. */
  slackWorkingDays: number | null;
  storedTargetStartIso: string | null;
  hasStoredDateDisagreement: boolean;
  /** One sentence a person can act on, naming the arithmetic. */
  reason: string;
}

// ── Capacity ──────────────────────────────────────────────────────────────────

/** One person the forecast may charge work to. */
export interface CapacityPerson {
  /** Account id where Jira gave one, display name otherwise. */
  personKey: string;
  displayName: string;
  /** false is REPORTED, not hidden — work assigned to somebody nobody rostered is worth seeing. */
  isOnRoster: boolean;
  canDevelop: boolean;
  canInternalTest: boolean;
}

/** One piece of work, reduced to what a capacity sum needs. */
export interface CapacityItem {
  issueKey: string;
  /** null means unassigned, which is reported separately and never pooled. */
  assigneePersonKey: string | null;
  remainingWorkingDays: number | null;
  isEstimated: boolean;
  /** Whether this item is inside the release/window being reported. */
  isInScope: boolean;
  chainRole: ChainRole;
}

/** How loaded one person is, in scope and overall. */
export interface PersonLoad {
  personKey: string;
  displayName: string;
  isOnRoster: boolean;
  inScopeWorkingDays: number;
  /** ALL their open work — so nobody looks free while drowning in another release. */
  totalAssignedWorkingDays: number;
  availableWorkingDays: number;
  overCapacityWorkingDays: number;
  isOverCapacity: boolean;
  unsizedIssueCount: number;
  inScopeIssueKeys: string[];
}

/** Whether the work committed to one window fits the people holding it. */
export interface CapacityAssessment {
  window: ForecastWindow;
  /** Most over-capacity first, then alphabetical — so the order is never arbitrary. */
  personLoads: PersonLoad[];
  unassignedWorkingDays: number;
  unassignedIssueKeys: string[];
  totalRemainingWorkingDays: number;
  totalAvailableWorkingDays: number;
  shortfallWorkingDays: number;
  shouldRemoveScope: boolean;
  unsizedIssueCount: number;
  undatedIssueCount: number;
}

// ── INT readiness and the dev-to-test chain ───────────────────────────────────

/**
 * Where one issue sits relative to the PI's Definition of Done.
 *
 * `unknown-sub-status` is returned when the instance has no sub-status field: the honest answer is
 * NOT CHECKED, which is a different claim from NOT READY.
 */
export type IntReadyState = 'int-ready' | 'not-int-ready' | 'cancelled' | 'unknown-sub-status';

/** What the INT check reads. Status and sub-status only — never a board column. */
export interface IntReadinessInput {
  statusName: string;
  subStatusValue: string | null;
  hasSubStatusField: boolean;
}

/** One Feature's INT verdict, and what is holding it. */
export interface FeatureIntReadiness {
  featureKey: string;
  state: IntReadyState;
  /** The children not yet INT-ready, named — a percentage cannot be acted on. */
  blockingIssueKeys: string[];
  cancelledIssueKeys: string[];
  contributingIssueCount: number;
}

/** Which side of the dev-then-test chain a piece of work sits on. */
export type ChainRole = 'dev' | 'sl' | 'unclassified';

/** The signals that decide a chain role, strongest first. */
export interface ChainRoleSignals {
  summary: string;
  /** null when the assignee is unknown or unrostered — which yields 'unclassified', not a guess. */
  assigneeCanInternalTest: boolean | null;
}

/** One item in the chain. */
export interface ChainItem {
  issueKey: string;
  summary: string;
  role: ChainRole;
  remainingWorkingDays: number | null;
  /** Dev complete and deployed to Dev — the state that releases the SL story to start. */
  isInternalTestReady: boolean;
  isComplete: boolean;
}

/** When dev finishes, when test can start, and when the Feature can reach INT. */
export interface ChainSchedule {
  devCompleteIso: string | null;
  slStartIso: string | null;
  slWorkingDays: number | null;
  dodDateIso: string | null;
  /** Reported rather than treated as zero test effort — an absent SL story is a gap, not a saving. */
  hasNoSlStory: boolean;
  unclassifiedIssueKeys: string[];
}

/** Whether a Feature can meet the PI commitment, and if not, which half of the chain is at fault. */
export interface FeatureDodAssessment {
  featureKey: string;
  intReadyState: IntReadyState;
  blockingIssueKeys: string[];
  cancelledIssueKeys: string[];
  devCompleteIso: string | null;
  slStartIso: string | null;
  slWorkingDays: number | null;
  dodDateIso: string | null;
  hasNoSlStory: boolean;
  unclassifiedIssueKeys: string[];
  piVerdict: 'meets' | 'at-risk' | 'not-configured';
  /** Which constraint binds — dev work too large, or too little room left to test it. */
  riskCause: 'dev-too-large' | 'test-squeeze' | null;
  shortfallWorkingDays: number | null;
}

// ── Feature sizing ────────────────────────────────────────────────────────────

/** One child of a Feature, reduced to what the sizing sum needs. */
export interface SizingChild {
  issueKey: string;
  typeBucket: 'story' | 'defect' | 'subtask' | 'other';
  storyPoints: number | null;
}

/** Whether a Feature's children have outgrown the estimate somebody put on the Feature. */
export interface FeatureSizingFlag {
  featureKey: string;
  featurePoints: number | null;
  /** Stories, defects and tasks. Sub-tasks are excluded — their points belong to their parent. */
  childrenPoints: number;
  overagePoints: number;
  overagePercent: number;
  state: 'within' | 'over' | 'not-sized';
  unsizedChildCount: number;
}

// ── The one result ────────────────────────────────────────────────────────────

/**
 * The honesty record, printed beside every total.
 *
 * A number that omits what it could not see is not a smaller number — it is a wrong one, presented
 * confidently. These counts are what let a reader tell the difference.
 */
export interface ForecastCompleteness {
  totalIssueCount: number;
  unsizedIssueCount: number;
  unassignedIssueCount: number;
  undatedVersionCount: number;
  cancelledIssueCount: number;
  /** false means INT readiness could not be evaluated at all on this instance. */
  hasSubStatusField: boolean;
  /** false means no column order was available, so every item carries zero credit — and it says so. */
  hasBoardVocabulary: boolean;
}

/**
 * Everything one forecast run produced.
 *
 * Every surface reads a slice of THIS. None re-derives a verdict for itself, which is why two
 * screens showing one figure cannot disagree — there is only one figure.
 */
export interface ForecastResult {
  config: ForecastConfig;
  rejectedSettings: RejectedSetting[];
  piClock: PiClock;
  releaseClocksByVersionName: Record<string, ReleaseClock>;
  releaseDateResolutions: ReleaseDateResolution[];
  issueForecasts: IssueForecast[];
  featureAssessments: FeatureDodAssessment[];
  sizingFlags: FeatureSizingFlag[];
  codeFreezeCapacityByVersionName: Record<string, CapacityAssessment>;
  externalTestCapacityByVersionName: Record<string, CapacityAssessment>;
  completeness: ForecastCompleteness;
}
