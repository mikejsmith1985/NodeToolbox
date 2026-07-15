// draftModel.ts — The shape of a PO Tool draft and the rules every draft store obeys.
//
// A draft is uncommitted work: a split or a composition a PO is part-way through. It survives sessions
// because this work spans days, not minutes — a PO is interrupted by meetings, and losing the draft on a
// browser refresh would make the tool unusable for the people it is for.
//
// A draft is NEVER a Jira write. Nothing here reaches Jira until the PO reviews a diff and commits.

import type { ReferencedSource } from '../sources/sourceModel';

/** Bumped when the stored shape changes; a draft written by an older version is healed on read. */
export const PO_DRAFT_SCHEMA_VERSION = 1;

/**
 * What every draft carries so it can describe itself.
 *
 * Identity lives on the record as well as in the key so a save call needs no key argument. On read the
 * identity is taken from the ARGUMENTS rather than the payload, so a draft that somehow lands under the
 * wrong key corrects itself instead of infecting the tool.
 */
export interface PoDraftEnvelope {
  schemaVersion: number;
  profileId: string;
  scopeKey: string;
  /** Stamped by the caller — deterministic modules here never read the wall clock. */
  updatedAtIso: string;
}

/** One smaller Feature proposed from a split. It has no Jira key until it is committed. */
export interface ProposedIncrement {
  /** Stable client-side id. NOT a Jira key — none exists yet. */
  localId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  /** Whether a human wrote this or an AI proposed it. Drives the accept/reject affordance. */
  origin: 'manual' | 'ai';
  /** AI-proposed increments land unaccepted; a manual one is accepted by definition. */
  isAccepted: boolean;
  /** Why this is a sensible increment. Free text, and the AI fills it when it proposes one. */
  rationale: string;
  /** Set once the increment exists in Jira, so a retry after a partial failure never double-creates it. */
  createdJiraKey: string | null;
}

/** What was loaded from Jira, kept so a commit can notice the original changed underneath the PO. */
export interface SourceFeatureSnapshot {
  key: string;
  projectKey: string;
  /** The original's OWN issue type id — increments echo it, so "Feature" is never hard-coded. */
  issueTypeId: string;
  issueTypeName: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  /** The hygiene-relevant fields, verbatim, for display and for the AI prompt. */
  fields: Record<string, unknown>;
  loadedAtIso: string;
}

/** A split in progress: the original, the increments proposed from it, and where they will land. */
export interface SplitDraft extends PoDraftEnvelope {
  sourceFeatureKey: string;
  sourceSnapshot: SourceFeatureSnapshot | null;
  /** Defaults to the original's project; the PO may send increments elsewhere. */
  targetProjectKey: string;
  increments: ProposedIncrement[];
  /** Chosen from the instance's own link types. Never hard-coded. */
  linkTypeName: string;
}

/** The link type used when the instance offers it and the PO expresses no preference. */
export const DEFAULT_SPLIT_LINK_TYPE = 'relates to';

/** Builds an empty split draft. Used for a fresh split and as the safe fallback for an unreadable one. */
export function createEmptySplitDraft(profileId: string, scopeKey: string): SplitDraft {
  return {
    schemaVersion: PO_DRAFT_SCHEMA_VERSION,
    profileId,
    scopeKey,
    updatedAtIso: '',
    sourceFeatureKey: '',
    sourceSnapshot: null,
    targetProjectKey: '',
    increments: [],
    linkTypeName: DEFAULT_SPLIT_LINK_TYPE,
  };
}

/** Builds a blank increment for the PO to type into. */
export function createEmptyIncrement(localId: string): ProposedIncrement {
  return {
    localId,
    summary: '',
    description: '',
    acceptanceCriteria: '',
    origin: 'manual',
    isAccepted: true,
    rationale: '',
    createdJiraKey: null,
  };
}

/** Coerces anything to a string, so a malformed stored value degrades to empty rather than crashing. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Heals one stored increment, keeping what is readable and defaulting the rest. */
function normalizeIncrement(rawIncrement: unknown, index: number): ProposedIncrement {
  const candidate = (typeof rawIncrement === 'object' && rawIncrement !== null ? rawIncrement : {}) as Partial<ProposedIncrement>;
  return {
    // A missing id would break React keys and accept/reject; mint a stable one from the position.
    localId: readString(candidate.localId) || `increment-${index + 1}`,
    summary: readString(candidate.summary),
    description: readString(candidate.description),
    acceptanceCriteria: readString(candidate.acceptanceCriteria),
    origin: candidate.origin === 'ai' ? 'ai' : 'manual',
    // Anything not explicitly accepted is treated as pending — the safe direction, since an
    // unaccepted increment is merely shown, whereas a wrongly-accepted one could be committed.
    isAccepted: candidate.isAccepted === true,
    rationale: readString(candidate.rationale),
    createdJiraKey: typeof candidate.createdJiraKey === 'string' ? candidate.createdJiraKey : null,
  };
}

/** Heals a stored snapshot, or drops it entirely if it cannot identify its own issue. */
function normalizeSnapshot(rawSnapshot: unknown): SourceFeatureSnapshot | null {
  if (typeof rawSnapshot !== 'object' || rawSnapshot === null) {
    return null;
  }
  const candidate = rawSnapshot as Partial<SourceFeatureSnapshot>;
  // Without a key and an issue type id the snapshot cannot drive a create; a fresh load is safer.
  if (!readString(candidate.key) || !readString(candidate.issueTypeId)) {
    return null;
  }
  return {
    key: readString(candidate.key),
    projectKey: readString(candidate.projectKey),
    issueTypeId: readString(candidate.issueTypeId),
    issueTypeName: readString(candidate.issueTypeName),
    summary: readString(candidate.summary),
    description: readString(candidate.description),
    acceptanceCriteria: readString(candidate.acceptanceCriteria),
    fields: (typeof candidate.fields === 'object' && candidate.fields !== null ? candidate.fields : {}) as Record<string, unknown>,
    loadedAtIso: readString(candidate.loadedAtIso),
  };
}

/**
 * Heals a stored split draft into something safe to use.
 *
 * Anything unreadable becomes an empty draft rather than an exception: a corrupt draft must never stop
 * the tab opening. Identity comes from the arguments, so a mis-filed draft re-files itself.
 */
export function normalizeSplitDraft(rawDraft: unknown, profileId: string, scopeKey: string): SplitDraft {
  if (typeof rawDraft !== 'object' || rawDraft === null) {
    return createEmptySplitDraft(profileId, scopeKey);
  }
  const candidate = rawDraft as Partial<SplitDraft>;
  const storedIncrements = Array.isArray(candidate.increments) ? candidate.increments : [];

  return {
    schemaVersion: PO_DRAFT_SCHEMA_VERSION,
    profileId,
    scopeKey,
    updatedAtIso: readString(candidate.updatedAtIso),
    sourceFeatureKey: readString(candidate.sourceFeatureKey),
    sourceSnapshot: normalizeSnapshot(candidate.sourceSnapshot),
    targetProjectKey: readString(candidate.targetProjectKey),
    increments: storedIncrements.map(normalizeIncrement),
    linkTypeName: readString(candidate.linkTypeName) || DEFAULT_SPLIT_LINK_TYPE,
  };
}

// ── Composition ──

/** A Feature being composed: the draft fields, plus the material it is being written from. */
export interface CompositionDraft extends PoDraftEnvelope {
  /** Set when enriching a Feature that already exists in Jira; null when creating a new one. */
  existingIssueKey: string | null;
  /** Required when creating; ignored when updating, since the issue already has a project. */
  targetProjectKey: string | null;
  /** Resolved from the target project's createmeta; ignored when updating. */
  targetIssueTypeId: string | null;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  /** Other Jira fields the PO set, keyed by field id. */
  fields: Record<string, unknown>;
  /** The PO's own words about the Feature — what the AI prompt leads with (FR-031). */
  poNarrative: string;
  /** Everything gathered to write from (FR-023). */
  sources: ReferencedSource[];
}

/** Builds an empty composition draft — a fresh Feature, or the fallback for an unreadable draft. */
export function createEmptyCompositionDraft(profileId: string, scopeKey: string): CompositionDraft {
  return {
    schemaVersion: PO_DRAFT_SCHEMA_VERSION,
    profileId,
    scopeKey,
    updatedAtIso: '',
    existingIssueKey: null,
    targetProjectKey: null,
    targetIssueTypeId: null,
    summary: '',
    description: '',
    acceptanceCriteria: '',
    fields: {},
    poNarrative: '',
    sources: [],
  };
}

/** Keeps a stored source only if it still identifies itself; a shapeless one is dropped, not guessed at. */
function normalizeSource(rawSource: unknown): ReferencedSource | null {
  if (typeof rawSource !== 'object' || rawSource === null) {
    return null;
  }
  const candidate = rawSource as Partial<ReferencedSource> & { kind?: string };
  if (!readString(candidate.id) || !readString(candidate.kind)) {
    return null;
  }
  if (!['confluence', 'workbook', 'jira', 'paste'].includes(candidate.kind as string)) {
    return null;
  }
  return candidate as ReferencedSource;
}

/**
 * Heals a stored composition draft.
 *
 * Same contract as the split draft: never throws, identity comes from the arguments, and anything
 * unreadable degrades rather than taking the tab down (FR-046).
 */
export function normalizeCompositionDraft(
  rawDraft: unknown,
  profileId: string,
  scopeKey: string,
): CompositionDraft {
  if (typeof rawDraft !== 'object' || rawDraft === null) {
    return createEmptyCompositionDraft(profileId, scopeKey);
  }
  const candidate = rawDraft as Partial<CompositionDraft>;
  const storedSources = Array.isArray(candidate.sources) ? candidate.sources : [];

  return {
    schemaVersion: PO_DRAFT_SCHEMA_VERSION,
    profileId,
    scopeKey,
    updatedAtIso: readString(candidate.updatedAtIso),
    existingIssueKey: typeof candidate.existingIssueKey === 'string' ? candidate.existingIssueKey : null,
    targetProjectKey: typeof candidate.targetProjectKey === 'string' ? candidate.targetProjectKey : null,
    targetIssueTypeId: typeof candidate.targetIssueTypeId === 'string' ? candidate.targetIssueTypeId : null,
    summary: readString(candidate.summary),
    description: readString(candidate.description),
    acceptanceCriteria: readString(candidate.acceptanceCriteria),
    fields: (typeof candidate.fields === 'object' && candidate.fields !== null ? candidate.fields : {}) as Record<string, unknown>,
    poNarrative: readString(candidate.poNarrative),
    sources: storedSources.map(normalizeSource).filter((source): source is ReferencedSource => source !== null),
  };
}
