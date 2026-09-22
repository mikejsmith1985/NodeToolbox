// epicIntakeModel.ts — The data shapes of an Epic Intake: notes turned into items, each item carrying a fixed
// checklist of decisions that Toolbox, the assistant, or the PO fills in (spec 037, data-model.md).
//
// Everything here is plain serialisable data — no classes, no functions, no Date objects — so a whole intake
// round-trips through localStorage unchanged and can be resumed the next morning exactly as it was left.

import type { FeatureSizeName } from '../../ArtView/ai/piReviewSizing.ts';

// ── Constants ──

/** Bumped only when a stored intake can no longer be read as-is; an older record is reported, never coerced. */
export const EPIC_INTAKE_SCHEMA_VERSION = 1;

/** The project Epics are created in and searched for duplicates, stored per intake so no query reads a constant. */
export const DEFAULT_INTAKE_PROJECT_KEY = 'DENP';

/** The issue type the intake creates. Resolved live against the project; this is only the name to look for. */
export const EPIC_ISSUE_TYPE_NAME = 'Epic';

/** The two labels an Epic created by the intake may carry — exactly one of them (FR-020). */
export const INTAKE_LABELS = ['Roadmap', 'Stability'] as const;

// ── Enumerations ──

/** Who settled a decision: a deterministic rule, the assistant's reply, or the PO. */
export type SettledBy = 'rule' | 'ai' | 'po';

/** What a group of lines in the notes actually is. */
export const ITEM_KINDS = ['work', 'risk', 'personAction', 'deferred', 'noise'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * Which area owns an item's scope. Enrollment-owned work is searched and created. `shared` means both teams have
 * real work of their own (AEP, say): Enrollment creates an Epic for its part only, and Fulfillment's part is
 * reported for hand-off. Adding it is additive — every stored intake remains readable.
 */
export const ITEM_OWNERS = ['enrollment', 'shared', 'fulfillment', 'notActionable'] as const;
export type ItemOwner = (typeof ITEM_OWNERS)[number];

export type IntakeLabel = (typeof INTAKE_LABELS)[number];

/** Why a source line belongs to no item. */
export const SET_ASIDE_REASONS = ['headingOrProse', 'duplicateOfAnotherLine', 'notWork', 'contextOnly'] as const;
export type SetAsideReason = (typeof SET_ASIDE_REASONS)[number];

/** The decision slots every item carries, in the order the intake resolves them. */
export const DECISION_SLOTS = ['kind', 'owner', 'searchTerms', 'duplicate', 'label', 'draftAccepted'] as const;
export type DecisionSlot = (typeof DECISION_SLOTS)[number];

/** The steps of an intake, in fixed order. The current step is derived, never stored. */
export const INTAKE_STEP_ORDER = [
  'sortNotes',
  'decideOwners',
  'checkDenp',
  'match',
  'confirmLabels',
  'draft',
  'create',
  'summary',
] as const;
export type IntakeStepId = (typeof INTAKE_STEP_ORDER)[number];

/** Whose move it is: the assistant (copy/paste exchange), Toolbox (a Jira read or write), the PO, or nobody. */
export type IntakeTurn = 'ai' | 'toolbox' | 'po' | 'done';

/**
 * The reply kinds recorded in an intake's audit trail. Today the assistant is asked to sort (`epicIntakeClassify`)
 * and then to resolve matches, labels and drafts in one go (`epicIntakeResolve`); the separate match and draft
 * kinds are kept so intakes saved before that change still load.
 */
export type IntakeRoundKind = 'epicIntakeClassify' | 'epicIntakeResolve' | 'epicIntakeMatch' | 'epicIntakeDraft';

// ── Decisions ──

/**
 * One checklist slot on an item. It is open until something settles it, and a slot the PO settled is never
 * changed by a later reply (FR-008). `aiProposal` holds a suggestion that is not allowed to settle the slot on
 * its own — the label, or an ownership share inside the close-call band — so the PO sees it beside the choice.
 */
export type Decision<TValue> =
  | {
      state: 'open';
      aiAttempts: number;
      /** True once the slot has been handed to the PO — a close call, a low-confidence pick, or the PO's own choice. */
      isAwaitingPo: boolean;
      lastRejection: string | null;
      aiProposal: TValue | null;
      aiReason: string | null;
    }
  | { state: 'settled'; value: TValue; settledBy: SettledBy; reason: string; aiAttempts: number }
  | { state: 'notApplicable'; reason: string };

/** The duplicate verdict: an existing Epic covers it, a new one is needed, or it should not be acted on. */
export type DuplicateVerdict =
  | { verdict: 'existing'; key: string }
  | { verdict: 'createNew' }
  | { verdict: 'notActionable' };

/** The six decisions every item carries. The seventh — the outcome — is derived from these plus creation. */
export interface ItemDecisions {
  kind: Decision<ItemKind>;
  owner: Decision<ItemOwner>;
  searchTerms: Decision<string[]>;
  duplicate: Decision<DuplicateVerdict>;
  label: Decision<IntakeLabel>;
  draftAccepted: Decision<'accepted' | 'declined'>;
}

// ── Source material ──

/** One numbered, non-blank line of the notes. Numbering is fixed for the life of the intake (FR-003). */
export interface SourceLine {
  lineNumber: number;
  /** The line with its bullet marker removed and whitespace trimmed. */
  text: string;
  /** The line exactly as pasted — shown to the PO and quoted in prompts. */
  rawText: string;
  /** 0 = unmarked heading or prose, 1 = top-level bullet, 2 = sub-bullet. */
  outlineLevel: 0 | 1 | 2;
}

/** A line deliberately not part of any item, with the reason. */
export interface SetAsideLine {
  lineNumber: number;
  reason: SetAsideReason;
  settledBy: SettledBy;
  note: string | null;
}

/** An area size stated in the notes, e.g. "XL Enrollment" or "Vendor size L". */
export interface AreaSize {
  /** The area as written ("Fulfilment", "Infra"). */
  area: string;
  /** Set only for the two owning areas; every other area is reported and never votes on ownership. */
  canonicalArea: 'enrollment' | 'fulfillment' | null;
  size: FeatureSizeName;
  /** A stated cost on the same line, e.g. "1.2M". Reported, never used to decide. */
  cost: string | null;
  lineNumber: number;
}

/** What looking up a named key found. */
export type NamedKeyLookup =
  | { status: 'notRun' }
  | { status: 'openEpicInTarget'; summary: string }
  | {
      status: 'unusable';
      reason: 'notFound' | 'noPermission' | 'done' | 'notEpic' | 'otherProject' | 'error';
      detail: string;
    };

/** A Jira key the notes named explicitly, e.g. "denp-632" (stored upper-cased). */
export interface NamedKey {
  key: string;
  projectKey: string;
  lineNumber: number;
  lookup: NamedKeyLookup;
}

/** Evidence in the notes that an item is not current work ("future conversation", "no funding"). */
export interface DeferralEvidence {
  phrase: string;
  kind: 'deferred' | 'risk';
}

// ── Jira facts ──

/** An open Epic Toolbox found that might already cover an item. */
export interface DuplicateCandidate {
  key: string;
  summary: string;
  statusName: string;
  statusCategory: string;
  descriptionExcerpt: string;
  foundBy: 'search' | 'namedKey';
}

/** The Epic draft the PO reviews before anything is written to Jira. */
export interface EpicDraft {
  summary: string;
  description: string;
  source: 'ai' | 'po';
  editedByPo: boolean;
}

/** Where an item's Epic creation stands. `creating` is written before the request so a crash can be recovered. */
export type CreationRecord =
  | { state: 'notStarted' }
  | { state: 'creating'; startedAtIso: string }
  | { state: 'created'; key: string; createdAtIso: string }
  | { state: 'failed'; reason: string; failedAtIso: string };

/** The project's Epic issue type, looked up live — never assumed. */
export type EpicTypeResolution =
  | { state: 'unresolved' }
  | { state: 'resolved'; id: string; name: string }
  | { state: 'missing'; offeredTypeNames: string[] }
  | { state: 'error'; reason: string };

// ── The intake ──

/** One candidate piece of work from the notes, with its lines, the facts Toolbox read from them, and its decisions. */
export interface IntakeItem {
  /** `item-<n>` — stable for the life of the intake; the id every reply must use. */
  id: string;
  title: string;
  proposedTitle: string | null;
  lineNumbers: number[];
  areaSizes: AreaSize[];
  namedKeys: NamedKey[];
  deferralEvidence: DeferralEvidence | null;
  /** The assistant's estimate of Enrollment's share of the scope (0–100), recorded even when sizes decided. */
  aiEnrollmentShare: number | null;
  /**
   * Why this row deserves a second look in the review table — an unsure match, a Shared split, a key the notes
   * named that could not be used — or null when the assistant's answers can simply be trusted.
   */
  reviewFlag: string | null;
  decisions: ItemDecisions;
  candidates: DuplicateCandidate[];
  searchStatus: 'notRun' | 'ok' | 'failed';
  searchFailureReason: string | null;
  draft: EpicDraft | null;
  creation: CreationRecord;
}

/** An audit line for one pasted reply. */
export interface RoundRecord {
  kind: IntakeRoundKind;
  partIndex: number;
  partCount: number;
  acceptedCount: number;
  rejected: IngestRejection[];
  ingestedAtIso: string;
}

/** Why part of a reply was not used. `itemId` is null when the whole reply was unusable. */
export interface IngestRejection {
  itemId: string | null;
  reason: string;
}

/** The whole persisted intake — notes to summary. */
export interface EpicIntake {
  schemaVersion: typeof EPIC_INTAKE_SCHEMA_VERSION;
  id: string;
  teamProfileId: string;
  name: string;
  targetProjectKey: string;
  createdAtIso: string;
  updatedAtIso: string;
  sourceTitles: string[];
  lines: SourceLine[];
  items: IntakeItem[];
  setAsideLines: SetAsideLine[];
  epicType: EpicTypeResolution;
  /** PO answers to fields the Epic create screen requires, applied to every Epic. Keyed by field id. */
  batchRequiredFieldValues: Record<string, unknown>;
  roundHistory: RoundRecord[];
}

/** What a reply parser returns: the usable answers plus every rejection, never a throw. */
export interface IngestOutcome<TAccepted> {
  accepted: TAccepted[];
  rejected: IngestRejection[];
}

// ── Derived (never stored) ──

/** What the summary table says happened to an item. */
export type SummaryAction =
  | 'existing'
  | 'created'
  | 'skippedFulfillment'
  | 'notActionable'
  | 'declined'
  | 'failed'
  /** Everything is decided and drafted; only the PO's Create click is left. */
  | 'ready'
  | 'open';

/** One row of the summary table. */
export interface SummaryRow {
  itemId: string;
  itemTitle: string;
  kind: ItemKind | null;
  owner: ItemOwner | null;
  action: SummaryAction;
  jiraKey: string | null;
  jiraUrl: string | null;
  label: IntakeLabel | null;
  statedSizes: string;
  reason: string;
}

// ── Factories ──

/** A fresh open decision: no attempts, no rejection, no proposal. */
export function createOpenDecision<TValue>(): Decision<TValue> {
  return { state: 'open', aiAttempts: 0, isAwaitingPo: false, lastRejection: null, aiProposal: null, aiReason: null };
}

/** A fresh checklist with every slot open. Applicability is applied afterwards by the engine. */
export function createEmptyItemDecisions(): ItemDecisions {
  return {
    kind: createOpenDecision<ItemKind>(),
    owner: createOpenDecision<ItemOwner>(),
    searchTerms: createOpenDecision<string[]>(),
    duplicate: createOpenDecision<DuplicateVerdict>(),
    label: createOpenDecision<IntakeLabel>(),
    draftAccepted: createOpenDecision<'accepted' | 'declined'>(),
  };
}

/** A new item for the given lines, with every decision open and nothing looked up yet. */
export function createIntakeItem(itemNumber: number, title: string, lineNumbers: number[]): IntakeItem {
  return {
    id: `item-${itemNumber}`,
    title,
    proposedTitle: null,
    lineNumbers: [...lineNumbers].sort((left, right) => left - right),
    areaSizes: [],
    namedKeys: [],
    deferralEvidence: null,
    aiEnrollmentShare: null,
    reviewFlag: null,
    decisions: createEmptyItemDecisions(),
    candidates: [],
    searchStatus: 'notRun',
    searchFailureReason: null,
    draft: null,
    creation: { state: 'notStarted' },
  };
}

/** Reads a settled decision's value, or null while it is open or not applicable. */
export function readSettledValue<TValue>(decision: Decision<TValue>): TValue | null {
  return decision.state === 'settled' ? decision.value : null;
}

/** The title shown for an item: the assistant's clearer title when it gave one, else the first line. */
export function readItemDisplayTitle(item: IntakeItem): string {
  return item.proposedTitle ?? item.title;
}
