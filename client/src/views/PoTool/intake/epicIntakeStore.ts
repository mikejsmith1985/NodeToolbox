// epicIntakeStore.ts — Local persistence for a Guided Epic Intake, so a PO can leave one mid-morning and resume
// it exactly where they left off, or the next day (spec 037, contracts/summary-and-store.md §2).
//
// Follows the established draft-store pattern (splitDraftStorage.ts, rewriteBatchStore.ts): team-scoped keys,
// never throws on load or save, and normalises whatever it reads rather than trusting it. The one addition this
// feature needs that those stores lack is a schema-version + full-shape check, because an intake mid-checklist
// is a much larger, more structured record than a draft and a half-valid one must never be resumed silently.

import { buildTeamScopedStorageKey, resolveTeamScopedStorageProfileId } from '../../SprintDashboard/hooks/teamScopedStorage';
import { canPersistDrafts } from '../drafts/splitDraftStorage';
import {
  EPIC_INTAKE_SCHEMA_VERSION,
  INTAKE_LABELS,
  ITEM_KINDS,
  ITEM_OWNERS,
  SET_ASIDE_REASONS,
  type Decision,
  type DuplicateVerdict,
  type EpicIntake,
  type IntakeItem,
  type IntakeLabel,
  type ItemDecisions,
  type ItemKind,
  type ItemOwner,
  type SourceLine,
} from './epicIntakeModel.ts';

// ── Constants ──

/** Base storage key; the team profile id and intake id are appended, like the composition draft store. */
export const EPIC_INTAKE_STORAGE_PREFIX = 'tbxPoEpicIntake';

/** A stored intake bigger than this logs a console warning — GH #387's own record is about 40 KB (§2, no hard cap). */
export const EPIC_INTAKE_WARN_BYTES = 1_000_000;

const SETTLED_BY_VALUES = ['rule', 'ai', 'po'] as const;

// ── Public types ──

/** What loading an intake found: a usable record, nothing at that key, or a record that cannot be trusted. */
export type EpicIntakeLoadResult =
  | { status: 'loaded'; intake: EpicIntake }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string };

/** The list-view summary of one saved intake, without loading its full item tree. */
export interface EpicIntakeSummary {
  id: string;
  name: string;
  updatedAtIso: string;
  teamProfileId: string;
}

// ── Keys ──

/** The storage key for one team's one intake: `tbxPoEpicIntake:<intakeId>:<teamProfileId>`. */
function buildIntakeStorageKey(teamProfileId: string, intakeId: string): string {
  return buildTeamScopedStorageKey(`${EPIC_INTAKE_STORAGE_PREFIX}:${intakeId}`, teamProfileId);
}

// ── Save ──

/** Measures a serialised record's byte size (UTF-16 in `localStorage`, but this is an early-warning heuristic). */
function measureSerialisedByteSize(serialised: string): number {
  return serialised.length;
}

/**
 * Persists an intake (upsert), keyed by its own `teamProfileId` and `id`.
 *
 * Returns false when storage is unavailable or the write throws (quota exceeded, private browsing), so the
 * caller can warn the PO their work is not being saved rather than let them find out by losing it.
 */
export function saveEpicIntake(intake: EpicIntake): boolean {
  if (!canPersistDrafts()) {
    return false;
  }
  try {
    const serialised = JSON.stringify(intake);
    if (measureSerialisedByteSize(serialised) > EPIC_INTAKE_WARN_BYTES) {
      // Deliberate: an operator-visible early warning, not an error.
      console.warn(`Epic intake "${intake.id}" is unusually large (${serialised.length} bytes).`);
    }
    window.localStorage.setItem(buildIntakeStorageKey(intake.teamProfileId, intake.id), serialised);
    return true;
  } catch {
    return false;
  }
}

// ── Load ──

/**
 * Loads one intake by its team profile and id.
 *
 * Identity (`teamProfileId`, `id`) comes from these arguments, never from the stored payload, so a record
 * cannot claim to belong to a different team than the key it was found under.
 */
export function loadEpicIntake(teamProfileId: string, intakeId: string): EpicIntakeLoadResult {
  if (!canPersistDrafts()) {
    return { status: 'unreadable', reason: 'This browser is not saving intakes.' };
  }
  let storedValue: string | null;
  try {
    storedValue = window.localStorage.getItem(buildIntakeStorageKey(teamProfileId, intakeId));
  } catch {
    return { status: 'unreadable', reason: 'Storage could not be read.' };
  }
  if (storedValue === null) {
    return { status: 'missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(storedValue);
  } catch {
    return { status: 'unreadable', reason: 'The saved intake is not valid JSON.' };
  }
  const normalized = normalizeEpicIntake(parsed);
  if (normalized === null) {
    return { status: 'unreadable', reason: 'The saved intake could not be validated.' };
  }
  return { status: 'loaded', intake: { ...normalized, teamProfileId, id: intakeId } };
}

// ── List ──

/** Reads just enough of a raw stored value to summarise it, without fully validating the item tree. */
function buildSummaryFromStoredValue(
  storedValue: string,
  teamProfileId: string,
  intakeId: string,
): EpicIntakeSummary {
  try {
    const parsed = JSON.parse(storedValue) as { name?: unknown; updatedAtIso?: unknown };
    const name = typeof parsed.name === 'string' ? parsed.name : '(unreadable intake)';
    const updatedAtIso = typeof parsed.updatedAtIso === 'string' ? parsed.updatedAtIso : '';
    return { id: intakeId, name, updatedAtIso, teamProfileId };
  } catch {
    return { id: intakeId, name: '(unreadable intake)', updatedAtIso: '', teamProfileId };
  }
}

/**
 * Recovers the intake id from a storage key of the form `tbxPoEpicIntake:<intakeId>:<scopedProfileId>` — but only
 * when the key belongs to exactly this team. Intake ids never contain a colon; team profile ids often do
 * ("dashboard-team:ENCUC:123"). So the id is everything up to the FIRST colon after the prefix, and the rest must
 * equal the team id exactly. Reading "up to the last colon" swallowed part of the team id, and Resume and Discard
 * then used a key that did not exist (GH #387).
 */
function readIntakeIdFromStorageKey(storageKey: string, scopedProfileId: string): string | null {
  const keyPrefix = `${EPIC_INTAKE_STORAGE_PREFIX}:`;
  if (!storageKey.startsWith(keyPrefix)) {
    return null;
  }
  const withoutPrefix = storageKey.slice(keyPrefix.length);
  const firstColonIndex = withoutPrefix.indexOf(':');
  if (firstColonIndex <= 0 || withoutPrefix.slice(firstColonIndex + 1) !== scopedProfileId) {
    return null;
  }
  return withoutPrefix.slice(0, firstColonIndex);
}

/**
 * Lists this team's saved intakes, newest first, by scanning `localStorage` for the team-scoped key suffix.
 *
 * An unreadable record is still listed — with the name "(unreadable intake)" — so the PO can see and discard
 * it rather than have it silently vanish from the list.
 */
export function listEpicIntakes(teamProfileId: string): EpicIntakeSummary[] {
  if (!canPersistDrafts()) {
    return [];
  }
  const scopedProfileId = resolveTeamScopedStorageProfileId(teamProfileId);
  const summaries: EpicIntakeSummary[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      const intakeId = storageKey ? readIntakeIdFromStorageKey(storageKey, scopedProfileId) : null;
      const storedValue = storageKey && intakeId !== null ? window.localStorage.getItem(storageKey) : null;
      if (intakeId === null || storedValue === null) {
        continue;
      }
      summaries.push(buildSummaryFromStoredValue(storedValue, teamProfileId, intakeId));
    }
  } catch {
    return summaries;
  }
  return summaries.sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso));
}

// ── Delete ──

/** Removes one team's one intake. Best-effort: a storage error leaves nothing further to do. */
export function deleteEpicIntake(teamProfileId: string, intakeId: string): void {
  if (!canPersistDrafts()) {
    return;
  }
  try {
    window.localStorage.removeItem(buildIntakeStorageKey(teamProfileId, intakeId));
  } catch {
    // Nothing useful to do — the record is already unreachable for this session.
  }
}

// ── Normalisation ──

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isOneOf<TValue extends string>(value: unknown, allowed: readonly TValue[]): value is TValue {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Validates one `SourceLine`. Returns null on any violation — nothing is coerced. */
function normalizeSourceLine(raw: unknown): SourceLine | null {
  const candidate = raw as Partial<SourceLine> | null;
  if (
    !candidate
    || typeof candidate.lineNumber !== 'number'
    || !isNonEmptyString(candidate.text)
    || !isNonEmptyString(candidate.rawText)
    || (candidate.outlineLevel !== 0 && candidate.outlineLevel !== 1 && candidate.outlineLevel !== 2)
  ) {
    return null;
  }
  return {
    lineNumber: candidate.lineNumber,
    text: candidate.text,
    rawText: candidate.rawText,
    outlineLevel: candidate.outlineLevel,
  };
}

/** Validates one `SetAsideLine`. */
function normalizeSetAsideLine(raw: unknown): EpicIntake['setAsideLines'][number] | null {
  const candidate = raw as Partial<EpicIntake['setAsideLines'][number]> | null;
  if (
    !candidate
    || typeof candidate.lineNumber !== 'number'
    || !isOneOf(candidate.reason, SET_ASIDE_REASONS)
    || !isOneOf(candidate.settledBy, SETTLED_BY_VALUES)
    || (candidate.note !== null && !isNonEmptyString(candidate.note))
  ) {
    return null;
  }
  return { lineNumber: candidate.lineNumber, reason: candidate.reason, settledBy: candidate.settledBy, note: candidate.note };
}

/** Validates one `Decision<TValue>` slot, checking the settled/proposed value itself with `isValidValue`. */
function normalizeDecision<TValue>(
  raw: unknown,
  isValidValue: (value: unknown) => value is TValue,
): Decision<TValue> | null {
  const candidate = raw as { state?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  if (candidate.state === 'notApplicable') {
    const notApplicable = candidate as { reason?: unknown };
    return isNonEmptyString(notApplicable.reason) ? { state: 'notApplicable', reason: notApplicable.reason } : null;
  }
  if (candidate.state === 'settled') {
    const settled = candidate as { value?: unknown; settledBy?: unknown; reason?: unknown; aiAttempts?: unknown };
    if (
      !isValidValue(settled.value)
      || !isOneOf(settled.settledBy, SETTLED_BY_VALUES)
      || !isNonEmptyString(settled.reason)
      || typeof settled.aiAttempts !== 'number'
    ) {
      return null;
    }
    return { state: 'settled', value: settled.value, settledBy: settled.settledBy, reason: settled.reason, aiAttempts: settled.aiAttempts };
  }
  if (candidate.state === 'open') {
    const open = candidate as {
      aiAttempts?: unknown; isAwaitingPo?: unknown; lastRejection?: unknown; aiProposal?: unknown; aiReason?: unknown;
    };
    const hasValidProposal = open.aiProposal === null || isValidValue(open.aiProposal);
    if (
      typeof open.aiAttempts !== 'number'
      || typeof open.isAwaitingPo !== 'boolean'
      || (open.lastRejection !== null && !isNonEmptyString(open.lastRejection))
      || !hasValidProposal
      || (open.aiReason !== null && !isNonEmptyString(open.aiReason))
    ) {
      return null;
    }
    return {
      state: 'open', aiAttempts: open.aiAttempts, isAwaitingPo: open.isAwaitingPo,
      lastRejection: open.lastRejection, aiProposal: (open.aiProposal ?? null) as TValue | null, aiReason: open.aiReason,
    };
  }
  return null;
}

const isItemKind = (value: unknown): value is ItemKind => isOneOf(value, ITEM_KINDS);
const isItemOwner = (value: unknown): value is ItemOwner => isOneOf(value, ITEM_OWNERS);
const isSearchTermsValue = (value: unknown): value is string[] => isStringArray(value);
const isDuplicateVerdict = (value: unknown): value is DuplicateVerdict => {
  const candidate = value as { verdict?: unknown; key?: unknown } | null;
  if (!candidate || typeof candidate.verdict !== 'string') return false;
  if (candidate.verdict === 'existing') return isNonEmptyString(candidate.key);
  return candidate.verdict === 'createNew' || candidate.verdict === 'notActionable';
};
const isIntakeLabelValue = (value: unknown): value is IntakeLabel => isOneOf(value, INTAKE_LABELS);
const isDraftAcceptedValue = (value: unknown): value is 'accepted' | 'declined' => value === 'accepted' || value === 'declined';

/** Validates the six decision slots of one item's checklist. */
function normalizeItemDecisions(raw: unknown): ItemDecisions | null {
  const candidate = raw as Partial<Record<keyof ItemDecisions, unknown>> | null;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const kind = normalizeDecision(candidate.kind, isItemKind);
  const owner = normalizeDecision(candidate.owner, isItemOwner);
  const searchTerms = normalizeDecision(candidate.searchTerms, isSearchTermsValue);
  const duplicate = normalizeDecision(candidate.duplicate, isDuplicateVerdict);
  const label = normalizeDecision(candidate.label, isIntakeLabelValue);
  const draftAccepted = normalizeDecision(candidate.draftAccepted, isDraftAcceptedValue);
  if (kind === null || owner === null || searchTerms === null || duplicate === null || label === null || draftAccepted === null) {
    return null;
  }
  return { kind, owner, searchTerms, duplicate, label, draftAccepted };
}

/** Validates one `IntakeItem`, including its nested decisions, candidates, draft and creation record. */
function normalizeIntakeItem(raw: unknown): IntakeItem | null {
  const candidate = raw as Partial<IntakeItem> | null;
  if (
    !candidate
    || !isNonEmptyString(candidate.id)
    || !isNonEmptyString(candidate.title)
    || (candidate.proposedTitle !== null && !isNonEmptyString(candidate.proposedTitle))
    || !Array.isArray(candidate.lineNumbers)
    || !candidate.lineNumbers.every((entry) => typeof entry === 'number')
  ) {
    return null;
  }
  const decisions = normalizeItemDecisions(candidate.decisions);
  const creation = normalizeCreationRecord(candidate.creation);
  const draft = normalizeEpicDraft(candidate.draft);
  const areaSizes = normalizeAreaSizes(candidate.areaSizes);
  const namedKeys = normalizeNamedKeys(candidate.namedKeys);
  const candidates = normalizeDuplicateCandidates(candidate.candidates);
  if (decisions === null || creation === null || draft === undefined || areaSizes === null || namedKeys === null || candidates === null) {
    return null;
  }
  if (candidate.searchStatus !== 'notRun' && candidate.searchStatus !== 'ok' && candidate.searchStatus !== 'failed') {
    return null;
  }
  if (candidate.searchFailureReason !== null && !isNonEmptyString(candidate.searchFailureReason)) {
    return null;
  }
  if (candidate.deferralEvidence !== null && normalizeDeferralEvidence(candidate.deferralEvidence) === null) {
    return null;
  }
  if (candidate.aiEnrollmentShare !== null && typeof candidate.aiEnrollmentShare !== 'number') {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    proposedTitle: candidate.proposedTitle ?? null,
    lineNumbers: candidate.lineNumbers,
    areaSizes,
    namedKeys,
    deferralEvidence: candidate.deferralEvidence ? normalizeDeferralEvidence(candidate.deferralEvidence) : null,
    aiEnrollmentShare: candidate.aiEnrollmentShare ?? null,
    decisions,
    candidates,
    searchStatus: candidate.searchStatus,
    searchFailureReason: candidate.searchFailureReason ?? null,
    draft,
    creation,
  };
}

/** Validates one `DeferralEvidence` — the matched phrase plus whether it signals deferral or risk. */
function normalizeDeferralEvidence(raw: unknown): IntakeItem['deferralEvidence'] | null {
  const candidate = raw as Partial<NonNullable<IntakeItem['deferralEvidence']>> | null;
  if (!candidate || !isNonEmptyString(candidate.phrase) || (candidate.kind !== 'deferred' && candidate.kind !== 'risk')) {
    return null;
  }
  return { phrase: candidate.phrase, kind: candidate.kind };
}

function normalizeAreaSizes(raw: unknown): IntakeItem['areaSizes'] | null {
  if (!Array.isArray(raw)) return null;
  const areaSizes: IntakeItem['areaSizes'] = [];
  for (const entry of raw) {
    const candidate = entry as Partial<IntakeItem['areaSizes'][number]> | null;
    if (
      !candidate
      || !isNonEmptyString(candidate.area)
      || (candidate.canonicalArea !== 'enrollment' && candidate.canonicalArea !== 'fulfillment' && candidate.canonicalArea !== null)
      || !isNonEmptyString(candidate.size)
      || (candidate.cost !== null && !isNonEmptyString(candidate.cost))
      || typeof candidate.lineNumber !== 'number'
    ) {
      return null;
    }
    areaSizes.push({
      area: candidate.area, canonicalArea: candidate.canonicalArea, size: candidate.size,
      cost: candidate.cost, lineNumber: candidate.lineNumber,
    });
  }
  return areaSizes;
}

function normalizeNamedKeys(raw: unknown): IntakeItem['namedKeys'] | null {
  if (!Array.isArray(raw)) return null;
  const namedKeys: IntakeItem['namedKeys'] = [];
  for (const entry of raw) {
    const candidate = entry as Partial<IntakeItem['namedKeys'][number]> | null;
    if (!candidate || !isNonEmptyString(candidate.key) || !isNonEmptyString(candidate.projectKey) || typeof candidate.lineNumber !== 'number' || !candidate.lookup) {
      return null;
    }
    namedKeys.push({ key: candidate.key, projectKey: candidate.projectKey, lineNumber: candidate.lineNumber, lookup: candidate.lookup });
  }
  return namedKeys;
}

function normalizeDuplicateCandidates(raw: unknown): IntakeItem['candidates'] | null {
  if (!Array.isArray(raw)) return null;
  const candidates: IntakeItem['candidates'] = [];
  for (const entry of raw) {
    const candidate = entry as Partial<IntakeItem['candidates'][number]> | null;
    if (
      !candidate
      || !isNonEmptyString(candidate.key)
      || !isNonEmptyString(candidate.summary)
      || !isNonEmptyString(candidate.statusName)
      || !isNonEmptyString(candidate.statusCategory)
      || typeof candidate.descriptionExcerpt !== 'string'
      || (candidate.foundBy !== 'search' && candidate.foundBy !== 'namedKey')
    ) {
      return null;
    }
    candidates.push({
      key: candidate.key, summary: candidate.summary, statusName: candidate.statusName,
      statusCategory: candidate.statusCategory, descriptionExcerpt: candidate.descriptionExcerpt, foundBy: candidate.foundBy,
    });
  }
  return candidates;
}

/** `undefined` signals "invalid shape" (distinct from `null`, which is the valid empty draft). */
function normalizeEpicDraft(raw: unknown): IntakeItem['draft'] | undefined {
  if (raw === null) return null;
  const candidate = raw as Partial<NonNullable<IntakeItem['draft']>> | null;
  if (
    !candidate
    || !isNonEmptyString(candidate.summary)
    || !isNonEmptyString(candidate.description)
    || (candidate.source !== 'ai' && candidate.source !== 'po')
    || typeof candidate.editedByPo !== 'boolean'
  ) {
    return undefined;
  }
  return { summary: candidate.summary, description: candidate.description, source: candidate.source, editedByPo: candidate.editedByPo };
}

function normalizeCreationRecord(raw: unknown): IntakeItem['creation'] | null {
  const candidate = raw as { state?: unknown } | null;
  if (!candidate) return null;
  if (candidate.state === 'notStarted') return { state: 'notStarted' };
  if (candidate.state === 'creating') {
    const creating = candidate as { startedAtIso?: unknown };
    return isNonEmptyString(creating.startedAtIso) ? { state: 'creating', startedAtIso: creating.startedAtIso } : null;
  }
  if (candidate.state === 'created') {
    const created = candidate as { key?: unknown; createdAtIso?: unknown };
    return isNonEmptyString(created.key) && isNonEmptyString(created.createdAtIso)
      ? { state: 'created', key: created.key, createdAtIso: created.createdAtIso }
      : null;
  }
  if (candidate.state === 'failed') {
    const failed = candidate as { reason?: unknown; failedAtIso?: unknown };
    return isNonEmptyString(failed.reason) && isNonEmptyString(failed.failedAtIso)
      ? { state: 'failed', reason: failed.reason, failedAtIso: failed.failedAtIso }
      : null;
  }
  return null;
}

function normalizeEpicType(raw: unknown): EpicIntake['epicType'] | null {
  const candidate = raw as { state?: unknown } | null;
  if (!candidate) return null;
  if (candidate.state === 'unresolved') return { state: 'unresolved' };
  if (candidate.state === 'resolved') {
    const resolved = candidate as { id?: unknown; name?: unknown };
    return isNonEmptyString(resolved.id) && isNonEmptyString(resolved.name)
      ? { state: 'resolved', id: resolved.id, name: resolved.name }
      : null;
  }
  if (candidate.state === 'missing') {
    const missing = candidate as { offeredTypeNames?: unknown };
    return isStringArray(missing.offeredTypeNames) ? { state: 'missing', offeredTypeNames: missing.offeredTypeNames } : null;
  }
  if (candidate.state === 'error') {
    const error = candidate as { reason?: unknown };
    return isNonEmptyString(error.reason) ? { state: 'error', reason: error.reason } : null;
  }
  return null;
}

function normalizeRoundHistory(raw: unknown): EpicIntake['roundHistory'] | null {
  if (!Array.isArray(raw)) return null;
  const roundHistory: EpicIntake['roundHistory'] = [];
  for (const entry of raw) {
    const candidate = entry as Partial<EpicIntake['roundHistory'][number]> | null;
    if (
      !candidate
      || (candidate.kind !== 'epicIntakeClassify' && candidate.kind !== 'epicIntakeMatch' && candidate.kind !== 'epicIntakeDraft')
      || typeof candidate.partIndex !== 'number'
      || typeof candidate.partCount !== 'number'
      || typeof candidate.acceptedCount !== 'number'
      || !Array.isArray(candidate.rejected)
      || !isNonEmptyString(candidate.ingestedAtIso)
    ) {
      return null;
    }
    roundHistory.push({
      kind: candidate.kind, partIndex: candidate.partIndex, partCount: candidate.partCount,
      acceptedCount: candidate.acceptedCount, rejected: candidate.rejected, ingestedAtIso: candidate.ingestedAtIso,
    });
  }
  return roundHistory;
}

/** True when every top-level scalar/array field of a raw intake candidate has the right primitive shape. */
function hasValidTopLevelIntakeFields(candidate: Partial<EpicIntake>): boolean {
  return (
    isNonEmptyString(candidate.id)
    && isNonEmptyString(candidate.teamProfileId)
    && isNonEmptyString(candidate.name)
    && isNonEmptyString(candidate.targetProjectKey)
    && isNonEmptyString(candidate.createdAtIso)
    && isNonEmptyString(candidate.updatedAtIso)
    && isStringArray(candidate.sourceTitles)
    && Array.isArray(candidate.lines)
    && Array.isArray(candidate.items)
    && Array.isArray(candidate.setAsideLines)
    && typeof candidate.batchRequiredFieldValues === 'object'
    && candidate.batchRequiredFieldValues !== null
  );
}

/** The nested collections of an intake, each validated by its own per-part validator, or null on any violation. */
interface NormalizedIntakeParts {
  lines: SourceLine[];
  setAsideLines: EpicIntake['setAsideLines'];
  items: IntakeItem[];
  epicType: EpicIntake['epicType'];
  roundHistory: EpicIntake['roundHistory'];
}

/** Validates every nested collection of a raw intake candidate, short-circuiting on the first violation. */
function normalizeIntakeParts(candidate: Partial<EpicIntake>): NormalizedIntakeParts | null {
  const lines = (candidate.lines ?? []).map(normalizeSourceLine);
  const setAsideLines = (candidate.setAsideLines ?? []).map(normalizeSetAsideLine);
  const items = (candidate.items ?? []).map(normalizeIntakeItem);
  const epicType = normalizeEpicType(candidate.epicType);
  const roundHistory = normalizeRoundHistory(candidate.roundHistory);
  if (
    lines.some((line) => line === null)
    || setAsideLines.some((entry) => entry === null)
    || items.some((item) => item === null)
    || epicType === null
    || roundHistory === null
  ) {
    return null;
  }
  return { lines: lines as SourceLine[], setAsideLines: setAsideLines as EpicIntake['setAsideLines'], items: items as IntakeItem[], epicType, roundHistory };
}

/**
 * Validates a raw parsed value into an `EpicIntake`, or returns null on any violation.
 *
 * Checks `schemaVersion` first — a mismatch is reported immediately, never partially coerced — then every
 * enum used anywhere in the record against the model's own const arrays. Nothing is re-derived: derived values
 * (the current step, summary rows) are never part of the stored shape to begin with.
 */
export function normalizeEpicIntake(raw: unknown): EpicIntake | null {
  const candidate = raw as Partial<EpicIntake> | null;
  if (!candidate || typeof candidate !== 'object' || candidate.schemaVersion !== EPIC_INTAKE_SCHEMA_VERSION) {
    return null;
  }
  if (!hasValidTopLevelIntakeFields(candidate)) {
    return null;
  }
  const parts = normalizeIntakeParts(candidate);
  if (parts === null) {
    return null;
  }
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: candidate.id as string,
    teamProfileId: candidate.teamProfileId as string,
    name: candidate.name as string,
    targetProjectKey: candidate.targetProjectKey as string,
    createdAtIso: candidate.createdAtIso as string,
    updatedAtIso: candidate.updatedAtIso as string,
    sourceTitles: candidate.sourceTitles as string[],
    batchRequiredFieldValues: candidate.batchRequiredFieldValues as Record<string, unknown>,
    ...parts,
  };
}
