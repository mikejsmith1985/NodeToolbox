// epicCreate.ts — Creates the Epics the PO accepted, one at a time, recording each outcome as it lands so nothing is
// ever created twice (spec 037, contracts/epic-create.md).
//
// Field-blind by design: no Jira field id is written here. The Epic Name field is found by its NAME on the live create
// screen, and any other field that screen requires is asked of the PO once and applied to every Epic.
// Framework-First: the create loop reuses the split commit's pattern (sequential, one failure isolated to its own
// item) and its `readFailureReason`; it does not reuse `runCompositionCommit`, which commits a single draft through
// an update diff and writes no labels.

import { createIssue } from '../../../services/jiraApi.ts';
import type { CreateIssueRequest, CreateIssueResponse, CreateMetaFieldEntry, JiraIssue } from '../../../types/jira.ts';
import { escapeJqlValue } from '../../../utils/jqlValue.ts';
import { buildIssueTextMatchTerms } from '../../../utils/jqlTextTerms.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../../SprintDashboard/featureReviewFixes.ts';
import { normalizeFeatureDescription, stripAiAttribution } from '../ai/featureDocSections.ts';
import { readFailureReason } from '../jira/runCommit.ts';
import { searchJiraIssues, type SearchIssuesFunction } from './duplicateSearch.ts';
import { readSettledValue, type CreationRecord, type EpicIntake, type IntakeItem } from './epicIntakeModel.ts';
import { isItemReadyToCreate, replaceIntakeItem } from './intakeChecklist.ts';

// ── Constants ──

/** How the create screen's Epic Name field is recognised: by its name, never by an instance-specific id. */
export const EPIC_NAME_FIELD_NAME_PATTERN = /^epic\s*name$/i;

/** The fields the intake always fills itself, so the PO is never asked for them. */
export const INTAKE_SUPPLIED_FIELD_IDS = ['project', 'issuetype', 'summary', 'description', 'labels'] as const;

/** Jira's schema marker for a parent/child (cascading) select, which the required-field picker renders as two lists. */
const CASCADING_SELECT_SCHEMA_FRAGMENT = 'cascadingselect';
const CASCADING_SELECT_SCHEMA_TYPE = 'option-with-child';
const UNKNOWN_SCHEMA_TYPE = 'unknown';

/** How many same-summary Epics the recovery search looks at. A real duplicate is one; this leaves headroom. */
const RECOVERY_SEARCH_MAX_RESULTS = 20;
const RECOVERY_SEARCH_FIELDS = ['summary'] as const;

/** The creation states the loop acts on. `created` is deliberately absent: a created Epic is never posted again. */
const CREATABLE_STATES: ReadonlySet<CreationRecord['state']> = new Set(['notStarted', 'failed', 'creating']);

// ── Types ──

/** What the Epic create screen needs beyond what the intake supplies: the Epic Name field, and questions for the PO. */
export interface EpicCreateScreenFields {
  /** The create screen's required Epic Name field, filled from each summary; null when the screen does not require it. */
  epicNameFieldId: string | null;
  /** Every other required field without a default, asked of the PO once for the whole batch. */
  unanswered: TransitionRequiredField[];
}

/** The Jira calls and clock the create loop uses, injected so tests can stand in for them. */
export interface EpicCreateDeps {
  createIssue: (request: CreateIssueRequest) => Promise<CreateIssueResponse>;
  searchIssues: SearchIssuesFunction;
  nowIso: () => string;
}

/** The real Jira calls and clock, for the Create button. */
export function createEpicCreateDeps(): EpicCreateDeps {
  return { createIssue, searchIssues: searchJiraIssues, nowIso: () => new Date().toISOString() };
}

// ── Pre-flight ──

function mapToRequiredField(createField: CreateMetaFieldEntry): TransitionRequiredField {
  const isCascadingSelect = createField.schema?.custom?.includes(CASCADING_SELECT_SCHEMA_FRAGMENT) === true;
  return {
    fieldId: createField.fieldId,
    name: createField.name?.trim() || createField.fieldId,
    schemaType: isCascadingSelect ? CASCADING_SELECT_SCHEMA_TYPE : (createField.schema?.type ?? UNKNOWN_SCHEMA_TYPE),
    allowedValues: createField.allowedValues ?? [],
  };
}

function isUnsuppliedRequiredField(createField: CreateMetaFieldEntry): boolean {
  const isSuppliedByIntake = (INTAKE_SUPPLIED_FIELD_IDS as readonly string[]).includes(createField.fieldId);
  return createField.required && createField.hasDefaultValue !== true && !isSuppliedByIntake;
}

/**
 * Reads the live Epic create screen for what it requires that the intake does not already fill. A required Epic
 * Name field is found by name and filled from each summary, so it is never asked; every other required field
 * without a default is returned for the PO to answer once, in the same picker the transition screens use.
 */
export function readUnansweredEpicRequiredFields(createFields: readonly CreateMetaFieldEntry[]): EpicCreateScreenFields {
  let epicNameFieldId: string | null = null;
  const unanswered: TransitionRequiredField[] = [];
  for (const createField of createFields.filter(isUnsuppliedRequiredField)) {
    if (epicNameFieldId === null && EPIC_NAME_FIELD_NAME_PATTERN.test(createField.name?.trim() ?? '')) {
      epicNameFieldId = createField.fieldId;
    } else {
      unanswered.push(mapToRequiredField(createField));
    }
  }
  return { epicNameFieldId, unanswered };
}

/** Reads the PO's stored batch answers, keeping only entries shaped like a picker answer. */
function readBatchSelections(batchRequiredFieldValues: Record<string, unknown>): Record<string, TransitionFieldSelection> {
  const selections: Record<string, TransitionFieldSelection> = {};
  for (const [fieldId, storedValue] of Object.entries(batchRequiredFieldValues)) {
    if (typeof storedValue === 'object' && storedValue !== null) {
      selections[fieldId] = storedValue as TransitionFieldSelection;
    }
  }
  return selections;
}

// ── Payload ──

/**
 * Builds the create request for one accepted Epic: project, Epic type, summary, the nine-section description with
 * any AI self-attribution removed, exactly one label (Roadmap or Stability), Epic Name when the screen requires it,
 * and the PO's batch answers. Sizes, costs, and reasons never go to Jira.
 *
 * `batchRequiredFields` are the pre-flight's unanswered fields; their answers are read from the intake's
 * `batchRequiredFieldValues` (one picker answer per field id). Throws for an item that is not ready to create, has
 * no settled label, or has no draft — the screen never offers such an item, and the throw keeps it that way.
 */
export function buildEpicCreatePayload(
  item: IntakeItem,
  intake: EpicIntake,
  epicNameFieldId: string | null,
  batchRequiredFields: readonly TransitionRequiredField[] = [],
): CreateIssueRequest {
  const label = readSettledValue(item.decisions.label);
  if (!isItemReadyToCreate(item) || label === null || item.draft === null || intake.epicType.state !== 'resolved') {
    throw new Error(`${item.id} is not ready to create: it needs an accepted draft, a label, and a resolved Epic type.`);
  }
  const summary = item.draft.summary.trim();
  const fields: Record<string, unknown> = {
    project: { key: intake.targetProjectKey },
    issuetype: { id: intake.epicType.id },
    summary,
    description: stripAiAttribution(normalizeFeatureDescription(item.draft.description)),
    labels: [label],
  };
  if (epicNameFieldId !== null) {
    fields[epicNameFieldId] = summary;
  }
  return { fields: { ...fields, ...buildTransitionFieldsPayload(batchRequiredFields, readBatchSelections(intake.batchRequiredFieldValues)) } };
}

// ── Recovery ──

/** The search for an Epic the current user already created today with this exact summary. */
function buildRecoverySearchJql(intake: EpicIntake, epicTypeName: string, summary: string): string | null {
  const matchTerms = buildIssueTextMatchTerms(summary, { shouldWildcardLastTerm: false });
  if (matchTerms === null) {
    return null;
  }
  return `project = "${escapeJqlValue(intake.targetProjectKey)}" AND issuetype = "${escapeJqlValue(epicTypeName)}" `
    + `AND summary ~ "${escapeJqlValue(matchTerms)}" AND creator = currentUser() AND created >= -1d`;
}

function normaliseSummary(summary: string): string {
  return summary.trim().toLowerCase();
}

/**
 * For an item whose earlier request was sent — left `creating` (the tab closed) or `failed` (possibly after Jira had
 * already created it) — finds the Epic that request may have made. Returns its key, or null when there is none. Throws when the search itself fails, because posting
 * without knowing could create a second Epic.
 */
async function findAlreadyCreatedEpicKey(item: IntakeItem, intake: EpicIntake, epicTypeName: string, deps: EpicCreateDeps): Promise<string | null> {
  const summary = item.draft?.summary ?? '';
  const recoveryJql = buildRecoverySearchJql(intake, epicTypeName, summary);
  if (recoveryJql === null) {
    return null;
  }
  const foundIssues: JiraIssue[] = await deps.searchIssues(recoveryJql, RECOVERY_SEARCH_FIELDS, RECOVERY_SEARCH_MAX_RESULTS);
  const exactMatch = foundIssues.find((issue) => normaliseSummary(issue.fields?.summary ?? '') === normaliseSummary(summary));
  return exactMatch?.key ?? null;
}

// ── The loop ──

/** Records a creation outcome on one item, saves it through `onProgress`, and returns the updated intake. */
function recordCreation(intake: EpicIntake, item: IntakeItem, creation: CreationRecord, onProgress: (intake: EpicIntake) => void): EpicIntake {
  const updatedIntake = replaceIntakeItem(intake, { ...item, creation });
  onProgress(updatedIntake);
  return updatedIntake;
}

/** Creates (or recovers) one item's Epic, recording every step, and never throws. */
async function createOneEpic(
  intake: EpicIntake,
  item: IntakeItem,
  screenFields: EpicCreateScreenFields,
  deps: EpicCreateDeps,
  onProgress: (intake: EpicIntake) => void,
): Promise<EpicIntake> {
  const epicTypeName = intake.epicType.state === 'resolved' ? intake.epicType.name : '';
  try {
    if (item.creation.state !== 'notStarted') {
      // A request that was sent may have landed even though its answer never arrived — the tab closed (`creating`),
      // or the response timed out (`failed`). Checking first is one read; skipping it risks a second Epic.
      const recoveredKey = await findAlreadyCreatedEpicKey(item, intake, epicTypeName, deps);
      if (recoveredKey !== null) {
        return recordCreation(intake, item, { state: 'created', key: recoveredKey, createdAtIso: deps.nowIso() }, onProgress);
      }
    }
    const payload = buildEpicCreatePayload(item, intake, screenFields.epicNameFieldId, screenFields.unanswered);
    const creatingIntake = recordCreation(intake, item, { state: 'creating', startedAtIso: deps.nowIso() }, onProgress);
    const createdIssue = await deps.createIssue(payload);
    return recordCreation(creatingIntake, item, { state: 'created', key: createdIssue.key, createdAtIso: deps.nowIso() }, onProgress);
  } catch (thrownError) {
    return recordCreation(intake, item, { state: 'failed', reason: readFailureReason(thrownError), failedAtIso: deps.nowIso() }, onProgress);
  }
}

function assertBatchCanStart(intake: EpicIntake, screenFields: EpicCreateScreenFields): void {
  if (intake.epicType.state !== 'resolved') {
    throw new Error(`${intake.targetProjectKey}'s Epic issue type is not resolved, so no Epic can be created.`);
  }
  const selections = readBatchSelections(intake.batchRequiredFieldValues);
  if (!areTransitionSelectionsComplete(screenFields.unanswered, selections)) {
    const fieldNames = screenFields.unanswered.map((requiredField) => requiredField.name).join(', ');
    throw new Error(`Answer the fields the Epic create screen requires first: ${fieldNames}.`);
  }
}

/**
 * Creates the accepted Epics in intake order, one at a time. Each item is saved as `creating` before its request
 * and as `created` or `failed` straight after, so a closed tab loses nothing and a retry re-posts only what did not
 * land. A failure records Jira's own reason and the loop carries on. An item already `created` is never posted
 * again; one stranded in `creating`, or retried after `failed`, is first searched for, and an Epic the user created
 * today with the same summary is adopted instead of made twice.
 *
 * `screenFields` is the pre-flight result from `readUnansweredEpicRequiredFields` — the Epic Name field to fill and
 * the required fields whose batch answers go with every Epic. Throws before creating anything if the Epic type is
 * not resolved or a required field is still unanswered.
 */
export async function runEpicCreates(
  intake: EpicIntake,
  deps: EpicCreateDeps,
  onProgress: (intake: EpicIntake) => void,
  screenFields: EpicCreateScreenFields,
): Promise<EpicIntake> {
  assertBatchCanStart(intake, screenFields);
  const creatableItems = intake.items.filter((item) => isItemReadyToCreate(item) && CREATABLE_STATES.has(item.creation.state));
  let workingIntake = intake;
  for (const item of creatableItems) {
    workingIntake = await createOneEpic(workingIntake, item, screenFields, deps, onProgress);
  }
  return workingIntake;
}
