// rollupBoardTypes.ts — The shapes and named constants the Feature Roll-Up Board is built from.
//
// The board re-renders the team's existing Jira board as a stack of Feature swimlanes. Nothing here
// performs work; this module exists so every other module in the feature agrees on one vocabulary,
// and so the board's load-bearing promises ("nothing is hidden", "a parent is drawn once") can be
// expressed as data invariants that a unit test can assert without rendering anything.

import type { ChecklistItem } from './checklistItems.ts';
import type { ChecklistCard, ChecklistColumnMapping } from './checklistCards.ts';
import type { ColumnDensity } from './columnDensity.ts';
import type { JiraIssue } from '../../../types/jira.ts';

// ── Named constants ──

/** The always-present column that holds issues whose status combination no team column claims. */
export const UNMAPPED_COLUMN_ID = '__unmapped__';

/** The synthetic Master Card key for work that cannot be traced to any Feature — a hygiene problem. */
export const NO_FEATURE_KEY = '__no_feature__';

/** Board size we design for. Passing it warns about responsiveness; it NEVER truncates the issue set. */
export const EXPECTED_BOARD_ISSUE_CEILING = 300;

/** Parent keys per `parent in (…)` request. One parent can fan out to many sub-tasks, so keep it small. */
export const SUBTASK_PARENT_CHUNK_SIZE = 50;

/** Issue keys per `key in (…)` request when reading Features, which live in other projects. */
export const FEATURE_KEY_CHUNK_SIZE = 50;

// ── Scope ──

/** Everything that decides what the board shows. All of it is read-only input from the Team space. */
export interface RollupBoardScope {
  /** The Jira board already selected in team settings. The board never picks its own. */
  boardId: number;
  /** Keys the shared column vocabulary and the viewer's personal preferences. */
  teamProfileId: string;
  /** The custom field linking a child issue to its Feature on this instance. */
  featureLinkFieldId: string;
  /** The discovered sub-status field, or '' when this instance has none (columns then map on status alone). */
  subStatusFieldId: string;
  /** Candidate story-point field ids, in preference order. */
  storyPointsFieldIds: readonly string[];
  /**
   * The Smart Checklist field on this instance, or '' when it has none.
   *
   * Discovered rather than configured: the field belongs to a third-party app and its id differs
   * between instances, so hardcoding one would silently show every team an empty checklist.
   */
  checklistFieldId?: string;
  /**
   * Every checklist-ish field on this instance.
   *
   * Plural because one instance carries three, holding the same items in different formats, and which
   * one is readable is a property of the VALUE rather than of the field's name.
   */
  checklistFieldIds?: readonly string[];
  /**
   * Whichever field this instance keeps Jira's impediment flag in.
   *
   * Discovered by name, never assumed: the default `customfield_10021` is not it here, which made the
   * flag unreadable and unwritable at the same time.
   */
  flagFieldId?: string;
}

// ── Loaded issues ──

/** Which retrieval stage failed, and what was lost, so the board can say so instead of looking short. */
export interface LoadFailure {
  stage: 'board' | 'subtasks' | 'features' | 'feature-children';
  detail: string;
}

/** Whether the board is showing everything it should be, stated rather than inferred from an empty list. */
export interface LoadCompleteness {
  isComplete: boolean;
  /** The total Jira itself reported for the board. */
  expectedBoardIssueCount: number;
  loadedBoardIssueCount: number;
  /** True past EXPECTED_BOARD_ISSUE_CEILING — a warning, never a reason to drop issues. */
  isOversized: boolean;
  failures: LoadFailure[];
}

/** The raw result of the three retrieval sweeps, before anything is resolved. */
/**
 * Why one Feature the board references could not be read, established by asking Jira about that key
 * on its own rather than inferring it from a bulk query that simply came back short.
 */
export type FeatureReadFailureReason =
  /** Jira says no such issue — usually a Feature Link left pointing at something deleted. */
  | 'not-found'
  /** The issue exists but this account may not see it: project permission or an issue security level. */
  | 'no-permission'
  /**
   * Readable one at a time, yet absent from the bulk search. Jira excludes ARCHIVED issues from search
   * results while still serving them by key, so this is the signature of an archived Feature.
   */
  | 'archived-or-unsearchable'
  /** Something else went wrong; the message carries whatever Jira said. */
  | 'error';

/** One Feature that could not be read, with the cause named rather than guessed at. */
export interface FeatureReadFailure {
  featureKey: string;
  reason: FeatureReadFailureReason;
  detail: string;
}

export interface RollupBoardIssueSet {
  boardIssues: JiraIssue[];
  /** Sub-tasks are NOT returned by the board endpoint; they come from a separate parent sweep. */
  subtaskIssues: JiraIssue[];
  /** Features, read by key because they usually live in a different Jira project. */
  featureIssues: Map<string, JiraIssue>;
  /** Referenced Features the bulk read did not return, each with the reason Jira gave. */
  featureReadFailures: FeatureReadFailure[];
  load: LoadCompleteness;
}

/** How many missing Features are probed individually before the board stops asking. */
export const MAX_FEATURE_READ_PROBES = 10;

// ── Roll-up ──

/** One hop on the path from a child issue to the Feature it delivers. */
export type RollUpRouteStep =
  | { kind: 'featureLink'; fieldId: string; toKey: string }
  | { kind: 'parent'; toKey: string }
  | { kind: 'issueLink'; linkTypeName: string; toKey: string };

/** Which rule of the defect precedence chain placed a defect. */
/**
 * How a defect reached its Feature, strongest first.
 *
 * `own-feature-link` outranks the rest because it is the only one nobody has to infer: somebody set
 * the Feature Link on the defect itself, which is a deliberate statement rather than a relationship
 * the board deduced by walking links. Every other issue type on this board already treats that field
 * as authoritative; defects were the exception, and that is why a defect could disagree with its own
 * sub-tasks about which Feature it delivers.
 */
export type DefectPrecedence = 'own-feature-link' | 'dev-story' | 'via-qa-issue' | 'direct-feature';

/** Something the resolution examined but did not choose. Kept so no relationship is silently discarded. */
export interface RollUpCandidate {
  toKey: string;
  /** The issue-link type this candidate came through, or null when it came from a field. */
  viaLinkTypeName: string | null;
  resolvedFeatureKey: string | null;
}

/** A note about how resolution behaved, surfaced on the card as a hygiene observation. */
export type RollUpNote = 'link-loop-detected' | 'parent-out-of-scope' | 'multiple-features-touched'
  /** A stronger-ranked route was passed over because the Feature it reached is already finished. */
  | 'preferred-unfinished-feature';

/** The displayable explanation of how one issue reaches its Master Card. */
export interface RollUpRoute {
  /** Ordered outward from the issue. Non-empty whenever featureKey is set — a Feature is never asserted bare. */
  steps: RollUpRouteStep[];
  featureKey: string | null;
  /** Set only for defects, naming which precedence rule applied. */
  precedenceRank: DefectPrecedence | null;
  /** Every candidate examined and not taken. Never filtered for brevity. */
  unchosenCandidates: RollUpCandidate[];
  notes: RollUpNote[];
}

// ── Board items ──

/** The visual family an issue belongs to. 'other' is a first-class value, not a place to hide things. */
export type IssueTypeBucket = 'story' | 'defect' | 'subtask' | 'other';

/** One resolved issue: where it belongs, where it sits, and how it got there. */
export interface RollupBoardItem {
  issue: JiraIssue;
  key: string;
  summary: string;
  typeBucket: IssueTypeBucket;
  typeName: string;
  /** The issue this one groups under in a column, or null when it groups under nothing. */
  parentKey: string | null;
  route: RollUpRoute;
  featureKey: string | null;
  /** Derived from THIS issue's own status and sub-status — never from a parent's or a child's. */
  columnId: string;
  statusName: string;
  subStatusValue: string | null;
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  /**
   * Every id Jira gave for this assignee — account id, username, user key.
   *
   * Kept because a Smart Checklist mention names a person by whichever of these somebody typed, and
   * matching it needs all of them. Not used for anything else.
   *
   * Optional because it only ever ADDS resolutions: absent, a person is still known by the single id
   * the filter uses, which is what the board managed with before this existed.
   */
  assigneeIdentifiers?: string[];
  fixVersionNames: string[];
  /** null means no estimate exists. It is never 0, which would claim an estimate of zero. */
  storyPoints: number | null;
  /** Present ONLY when the host issue carries readable checklist data; never defaulted to zero-of-zero. */
  checklistCompletion: { completedCount: number; totalCount: number } | null;
  /**
   * The checklist's own items, drawn nested inside this card.
   *
   * A third way teams break work down, alongside Stories and sub-tasks — and the only one the board
   * used to reduce to a bare "2/5", which says how much is left but never what any of it is.
   */
  checklistItems: ChecklistItem[];
  /**
   * The field these items were READ from, which is where a write should be aimed first.
   *
   * Per issue rather than per board: the choice is made on which candidate field actually yields
   * items for THAT issue, and an instance carrying three checklist fields does not fill the same one
   * on every issue.
   */
  checklistFieldId?: string | null;
  /**
   * Whether Jira considers this issue impeded — flagged, blocked by status, or blocked by a link.
   *
   * The Feature's own flag has always been shown in the lane header; the work underneath it carried no
   * such marker at all, so a blocked Story sat in its column looking exactly like a moving one. On a
   * board whose whole job is status visibility that is the worst thing to leave silent.
   *
   * Read through the SAME detection the lane header uses, so a Feature and its children can never
   * disagree about what "flagged" means.
   *
   * The FLAG FIELD only — not "impeded in some way". It was briefly the latter, which made a card
   * blocked by a link claim it was flagged and then offer to remove a flag it never had. The toggle
   * writes the flag field, so the thing it is labelled from has to be the flag field too.
   */
  isFlagged: boolean;
  /**
   * Every reason Jira considers this issue impeded — flagged, a blocking link, a blocking status.
   *
   * Kept separate from `isFlagged` because they answer different questions. This one says what is
   * WRONG, which is what the card should show; `isFlagged` says what can be UNDONE from here.
   */
  impedimentReasons: string[];
}

// ── Master cards ──

/** How complete a Feature is, and on what basis — the basis is inseparable from the number. */
export interface FeatureProgress {
  /** null when there is nothing to measure. */
  percentComplete: number | null;
  basis: 'story-points' | 'issue-count' | 'none';
  completedUnits: number;
  totalUnits: number;
}

/** The Feature vital signs shown in a swimlane header, readable without expanding the lane. */
export interface MasterCardVitals {
  key: string;
  summary: string;
  statusName: string | null;
  progress: FeatureProgress;
  dependencyCount: number;
  isFlagged: boolean;
  /** null means the Feature carries no estimate; it is stated as absent, not shown as zero. */
  storyPoints: number | null;
  priorityName: string | null;
  childCount: number;
}

/** One Feature rendered as a collapsible full-width swimlane. */
export interface MasterCard {
  featureKey: string;
  /** True for the synthetic "No Feature" card that collects unattributable work. */
  isSynthetic: boolean;
  featureIssue: JiraIssue | null;
  /** The Feature key resolved but its issue could not be read — kept visible rather than folded away. */
  isFeatureUnreadable: boolean;
  /** True for a Feature the team owns that nothing rolls up to yet — a gap, not progress. */
  hasNoWorkYet?: boolean;
  vitals: MasterCardVitals;
  /** The Feature's COMPLETE set. Filtering never mutates this, which is why vitals ignore filters. */
  items: RollupBoardItem[];
}

// ── Column vocabulary ──

/** The Jira state one team column stands for. */
export interface ColumnStatusMapping {
  jiraStatusName: string;
  /** null when this instance has no sub-status field, so the column maps on status alone. */
  subStatusValue: string | null;
}

/**
 * One column in the team's own words.
 *
 * A column claims MANY Jira states, exactly as a real Jira board column does — that is what lets a
 * status nobody has placed yet be dropped into the column the team wants it in, instead of forcing
 * a new column per state. An empty list means defined but not yet mapped: it holds nothing and says
 * so, which is not an error.
 */
export interface BoardColumn {
  id: string;
  name: string;
  order: number;
  mappings: ColumnStatusMapping[];
}

/** A team's agreed column set. Shared by the team, never per person. */
export interface BoardVocabulary {
  teamProfileId: string;
  columns: BoardColumn[];
  /**
   * Which column each Smart Checklist state belongs in.
   *
   * Part of the team's shared vocabulary rather than a personal preference, for the same reason the
   * columns themselves are: two people looking at the same board must see a finished checklist item
   * in the same place, or the board stops being a thing a team can hold a standup around.
   *
   * Optional because every vocabulary saved before this existed has none — the board then draws
   * checklist items in Unmapped, visibly, rather than guessing a home for them.
   */
  checklistColumnMapping?: ChecklistColumnMapping;
  /**
   * The field checklist changes are written to, when the team has nominated one.
   *
   * A Smart Checklist lives in a third-party app, and which custom field the app actually READS is
   * an instance decision the board cannot infer: on this instance the board wrote to a plain-text
   * checklist field Jira accepted happily and the app ignored completely. Guessing again would only
   * produce the same silence, so the team points at the right field once — with the diagnostics panel
   * showing which candidates are text and which are the app's own data.
   *
   * Absent means "let the board choose", which is what every team had before this existed.
   */
  checklistWriteFieldId?: string;
  updatedAt: string;
  /** null means never synchronised with the shared workspace. */
  lastSyncedAt: string | null;
}

/** Why a vocabulary was refused. Two columns can never claim one Jira state. */
export type VocabularyErrorKind = 'duplicate-mapping' | 'duplicate-name' | 'blank-name';

export interface VocabularyError {
  kind: VocabularyErrorKind;
  message: string;
  columnIds: string[];
}

export interface VocabularyValidation {
  isValid: boolean;
  errors: VocabularyError[];
}

// ── Layout ──

/** A per-column grouping label. It is NOT a card and never counts as a rendering of the parent issue. */
export interface ParentContainer {
  parentKey: string;
  parentSummary: string;
  /** False when the parent is not in THIS lane: the header still shows, but no parent card is drawn. */
  isParentInScope: boolean;
  /**
   * The lane the parent actually sits in, when it is on the board but somewhere else.
   *
   * Null means it is genuinely absent from the board. The distinction matters: a parent in another
   * lane means the parent and its children disagree about which Feature they deliver, which is a data
   * problem to go and fix — not the scope problem that "not on this board" implies.
   */
  parentLaneFeatureKey?: string | null;
  items: RollupBoardItem[];
  /**
   * This parent's checklist items that belong in THIS column.
   *
   * Separate from `items` on purpose. A checklist item is not a Jira issue, and everything reading
   * `items` — counts, progress, the rollups — would silently start including it. Keeping the two
   * apart makes "does this count?" a decision each of those takes for itself rather than inherits.
   */
  checklistCards?: ChecklistCard[];
}

/** One column as rendered, including the always-present Unmapped column. */
export interface RenderedColumn {
  id: string;
  name: string;
  order: number;
  mappings: ColumnStatusMapping[];
  isUnmappedColumn: boolean;
}

/** One column's worth of one lane. */
export interface LaneCell {
  containers: ParentContainer[];
  /** Items with no in-scope parent — including a parent's own childless card. */
  looseItems: RollupBoardItem[];
  /**
   * Everything in the cell in the order it should be DRAWN, containers and loose cards interleaved.
   *
   * The two lists above are kept because counts and progress read them, but they cannot be rendered
   * one after the other — which is what the lane used to do. All containers were drawn, then all loose
   * cards, so the order between a contained card and a loose one was fixed by the markup and no drag
   * could change it. A column holding one of each simply refused to reorder.
   */
  entries: LaneCellEntry[];
}

/** One drawable thing in a cell: a parent's container, or a card standing on its own. */
export type LaneCellEntry =
  | { kind: 'container'; container: ParentContainer }
  | { kind: 'item'; item: RollupBoardItem };
//
// There is deliberately no loose `checklist` entry. A checklist item ALWAYS has a parent issue, so it
// is always drawn inside that issue's container — the container is opened in this column if the
// parent's own card happens to be in another one. Encoding that as an invariant rather than a
// convention is what stops a checklist card ever appearing detached from the work it belongs to.

/**
 * One non-dev participant in a Feature family: QE, BT, or anything else a team adds later.
 *
 * Free-text name rather than a fixed enum, so a fourth discipline costs a configuration entry rather
 * than a code change.
 */
export interface DisciplineProjects {
  name: string;
  /** The Jira project holding this discipline's CLONED Features, e.g. 'QEINT'. */
  featureProjectKey: string;
  /**
   * The Jira projects holding this discipline's work. EMPTY means "do not narrow by project".
   *
   * Plural, and optional, because of what QE actually does: QEINT-608's children live in ENFCT and
   * INTTEST — two projects, neither of them QE's own Feature project. Narrowing to a single project
   * found none of them. The Feature Link is the real constraint; a project list is only a further
   * narrowing for a team that wants one.
   */
  storyProjectKeys: string[];
}

/** One clone named on a dev Feature, before anything has judged what it is. */
export interface CloneLink {
  cloneIssueKey: string;
  /** How it was found — reported to the user, because an inference must not read as a fact. */
  evidence: 'cloners-link' | 'feature-name-match';
}

/**
 * What the board decided a clone actually is.
 *
 * The three cases exist because a Cloners link is NOT by itself evidence of another discipline: a
 * team clones inside its own project to split scope. The project decides, not the link.
 */
export type CloneClassification =
  /** In a configured discipline project — becomes a sub-lane. */
  | { kind: 'discipline'; discipline: DisciplineProjects; cloneIssueKey: string; evidence: CloneLink['evidence'] }
  /** In the dev team's own Feature project — a peer Feature, which keeps its own top-level lane. */
  | { kind: 'peer'; cloneIssueKey: string }
  /** In a project nobody configured. Reported once; never silently dropped. */
  | { kind: 'unconfigured'; cloneIssueKey: string; projectKey: string };

/** One discipline's band beneath a primary lane. */
export interface SubLane {
  discipline: DisciplineProjects;
  cloneFeatureKey: string;
  /** Null when the clone could not be read; the band still renders and says so. */
  cloneFeatureIssue: JiraIssue | null;
  /** Which tone pair this discipline draws in, from its position in the configured list. */
  toneIndex: number;
  /** True when found by name rather than by link, so the inference is never presented as a fact. */
  isInferredMatch: boolean;
  /** In the DEV team's columns — the whole board reads as one board. */
  cellsByColumnId: Record<string, LaneCell>;
  /** Every item under this clone, unfiltered — what the family figure is computed from. */
  items: RollupBoardItem[];
  isCollapsed: boolean;
  matchedItemCount: number;
  totalItemCount: number;
  /**
   * Linkages Jira refused to answer about, if any.
   *
   * An empty band means one of two very different things — this discipline has no work, or the board
   * could not ask — and reporting only the first is how a rejected query passed for an absence.
   */
  lookupFailures: string[];
}

/**
 * The two progress figures a lane shows.
 *
 * Both come from the same computation. Redefining the existing number would silently change what
 * every figure on the board and on the PI surfaces means; showing only the dev number lets a Feature
 * read as finished while QE still has open work. Both are true and they answer different questions.
 */
export interface FamilyProgress {
  dev: FeatureProgress;
  /** Null when there are no sub-lanes — a family figure equal to the dev figure is noise. */
  family: FeatureProgress | null;
  /** True when dev reads complete and the family does not. The signal worth acting on. */
  hasDisagreement: boolean;
}

export interface RenderedLane {
  masterCard: MasterCard;
  isCollapsed: boolean;
  /** Under the active filters. */
  matchedItemCount: number;
  /** Ignores filters, so "n of N match" is two counts of two sets rather than one count reused. */
  totalItemCount: number;
  cellsByColumnId: Record<string, LaneCell>;
  /** Empty for a Feature with no clones, which then renders exactly as it did before sub-lanes. */
  subLanes: SubLane[];
}

export interface BoardLayout {
  columns: RenderedColumn[];
  lanes: RenderedLane[];
}

// ── Viewer state ──

/** The active quick filters. An empty typeBuckets set means "no type filter", not "match nothing". */
export interface QuickFilterState {
  /**
   * `'checklist'` is a filter value but never an ISSUE's bucket — a Jira issue is never a checklist
   * item. Selecting it therefore hides every issue and leaves the checklist cards, which is exactly
   * what "Checklist only" should do, and it falls out of the existing rule rather than needing one.
   */
  typeBuckets: ReadonlySet<IssueTypeBucket | 'checklist'>;
  assigneeAccountId: string | null;
  fixVersionName: string | null;
}

/** One person's view preferences. Never shared with the team, never written to Jira. */
export interface BoardPreferences {
  teamProfileId: string;
  boardId: number;
  /** Feature keys in the viewer's chosen order. Anything absent sorts to the end. */
  laneOrder: string[];
  collapsedByFeatureKey: Record<string, boolean>;
  /**
   * The order cards sit in within one lane's column, so work can be shown in the sequence it needs
   * to happen. Keyed by `<featureKey>::<columnId>`; anything absent sorts to the end.
   */
  cardOrderByCell?: Record<string, string[]>;
  /**
   * Columns narrowed to a strip, by id.
   *
   * Local like the collapsed lanes beside it, and for the same reason: which columns you have
   * narrowed on your screen is a view of your own, not a decision the team took.
   */
  collapsedColumnIds?: string[];
  /**
   * How tightly the board packs its columns.
   *
   * Absent on preferences saved before this existed, which reads as the default rather than as an
   * error — a team that never chose gets the width that fits twelve columns on a normal screen.
   */
  columnDensity?: ColumnDensity;
}
