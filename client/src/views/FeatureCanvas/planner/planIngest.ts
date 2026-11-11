// planIngest.ts — The capacity-plan write-back round-trip: a copy-out "translate" prompt plus the
// strict ingest of the JSON reply that re-sprints canvas work.
//
// After the operator discusses and finalises a projected plan with the assistant in an ordinary
// chat, they paste the prompt from `buildTranslatePrompt` to have it restate the agreed plan as a
// table — using only the sprint names and roster names Toolbox knows. Google's AI Mode, the team's
// only assistant (GH #499), ignores JSON but fills in a table reliably; the shared record reader
// turns that table back into the same {kind, items} payload, and a JSON reply is still read.
// `parsePlanIngest` then validates it into well-formed assignments plus human-readable errors. All
// functions are pure and deterministic: no clock, no DOM, no network.

import type { CanvasNode } from '../logic/canvasTypes.ts';
import {
  buildRecordFillInTable,
  extractRecordReplyPayload,
  isUnreadableRecordReply,
  type ReplyRecordColumn,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';

/** The fixed discriminator the assistant must echo so a stray JSON blob is never misread as a plan. */
const INGEST_KIND = 'capacityPlanIngest';
/** The line the reply's table follows, so the reader can skip any intro the assistant writes first. */
const PLAN_REPLY_MARKER = 'PLAN_TABLE:';
const ASSIGNEE_COLUMN: ReplyRecordColumn = { field: 'assignee', header: 'Assignee' };
/** The table the prompt asks for without reassignments: which issue moves to which sprint. */
const PLAN_REPLY_SPEC: ReplyRecordSpec = {
  kind: INGEST_KIND,
  replyMarker: PLAN_REPLY_MARKER,
  columns: [{ field: 'issueKey', header: 'Issue key' }, { field: 'sprint', header: 'Sprint' }],
};
/** The table with the optional Assignee column — also what the reader accepts, so a stray assignee is seen and dropped. */
const PLAN_REPLY_SPEC_WITH_ASSIGNEE: ReplyRecordSpec = { ...PLAN_REPLY_SPEC, columns: [...PLAN_REPLY_SPEC.columns, ASSIGNEE_COLUMN] };

/** One re-sprint instruction: move an issue to a known sprint, optionally reassigning its owner. */
export interface IngestAssignment {
  /** A story/task/defect key that exists on the canvas (e.g. "NT-42"). */
  issueKey: string;
  /** An exact sprint name from the provided valid list (e.g. "26.3.4"). */
  sprint: string;
  /** Optional new owner; only ever present when reassignment is enabled. */
  assignee?: string;
}

/** The outcome of ingesting a reply: the accepted assignments and one message per rejected entry. */
export interface PlanIngestResult {
  /** The well-formed assignments, in the order the assistant listed them. */
  assignments: IngestAssignment[];
  /** One human-readable message per rejected entry or structural problem. */
  errors: string[];
}

/** Options that shape how a reply is validated. */
interface ParseOptions {
  /** The only sprint names Toolbox will accept; matching is exact and case-sensitive. */
  validSprintNames: readonly string[];
  /** When false, any assignee the assistant supplies is dropped rather than kept. */
  allowAssignee: boolean;
}

// ── Prompt building ──

/**
 * Builds the copy-out prompt the operator pastes into their EXISTING assistant chat once the plan is
 * agreed. It restates the plan as a table, constrains sprint (and optionally assignee) values to the
 * names Toolbox recognises, and forbids invented issues, sprints, or names. Pure and deterministic.
 */
export function buildTranslatePrompt(
  validSprintNames: readonly string[],
  rosterNames: readonly string[],
  options: { allowAssignee: boolean },
): string {
  return [
    'Convert the capacity plan we just agreed on in this conversation into the table below.',
    '',
    buildPlanTableInstructions(validSprintNames, rosterNames, options.allowAssignee),
  ].join('\n');
}

/**
 * The rules, name lists and empty table a translate prompt (and its follow-up) ends with. The rows
 * are not known in advance — only the assistant knows which stories the agreed plan moves — so the
 * table is the header alone and the assistant adds one row per moving story.
 */
function buildPlanTableInstructions(validSprintNames: readonly string[], rosterNames: readonly string[], allowAssignee: boolean): string {
  const replySpec = allowAssignee ? PLAN_REPLY_SPEC_WITH_ASSIGNEE : PLAN_REPLY_SPEC;
  const sprintList = validSprintNames.map((sprintName) => `  - ${sprintName}`).join('\n');
  return [
    `Answer ONLY with the table, starting with the line ${PLAN_REPLY_MARKER}. Copy its header row exactly, then add one `
      + 'row per story/task that moves, using the exact issue keys from the plan. Write nothing before or after the '
      + 'table, do not answer in JSON or bullet points, never put a "|" inside a cell, and ask no questions.',
    '',
    'The Sprint cell MUST be exactly one of these sprint names (copy them verbatim):',
    sprintList,
    '',
    buildAssigneeSection(rosterNames, allowAssignee),
    'Do not invent issues, sprints, or names.',
    '',
    PLAN_REPLY_MARKER,
    ...buildRecordFillInTable(replySpec, []),
  ].join('\n');
}

/** Returns the assignee guidance: a roster whitelist when allowed, or an explicit exclusion when not. */
function buildAssigneeSection(rosterNames: readonly string[], allowAssignee: boolean): string {
  if (!allowAssignee) {
    return 'Do NOT include an Assignee column.\n';
  }
  const rosterList = rosterNames.map((rosterName) => `  - ${rosterName}`).join('\n');
  return [
    'The Assignee cell is optional (leave it ___ to keep the owner). When filled it MUST be exactly one of these roster names:',
    rosterList,
    '',
  ].join('\n');
}

/**
 * The follow-up to paste into the same assistant chat, or '' when the reply needs none. An
 * unreadable reply gets the table instructions again; a reply with rejected rows (an unknown sprint,
 * a missing key) gets the reasons and a request to restate only those rows. Nothing is guessed.
 */
export function buildPlanIngestFollowUpPrompt(
  replyText: string,
  ingestResult: PlanIngestResult,
  validSprintNames: readonly string[],
  rosterNames: readonly string[],
  options: { allowAssignee: boolean },
): string {
  const tableInstructions = buildPlanTableInstructions(validSprintNames, rosterNames, options.allowAssignee);
  if (isUnreadableRecordReply(replyText, PLAN_REPLY_SPEC_WITH_ASSIGNEE)) {
    return ['Your last reply was not in the form I need, so it could not be read. Keep the plan you gave, but put it in this table.', tableInstructions].join('\n');
  }
  if (ingestResult.errors.length === 0) {
    return '';
  }
  return [
    `Some rows of your last reply could not be used: ${ingestResult.errors.join(' ')} Restate only those rows now.`,
    tableInstructions,
  ].join('\n');
}

// ── Reply ingest ──

/**
 * Validates a translate reply — its filled-in table, or JSON — into well-formed assignments plus
 * descriptive errors. Tolerant of an intro, fences and a closing offer; never throws on
 * business-invalid content — every bad entry becomes an error message while the good entries are
 * kept. Pure and deterministic.
 */
export function parsePlanIngest(responseText: string, options: ParseOptions): PlanIngestResult {
  const parsed = readPayloadObject(responseText);
  if (parsed.errorMessage !== null) {
    return { assignments: [], errors: [parsed.errorMessage] };
  }

  const payload = parsed.value as Record<string, unknown>;
  if (payload.kind !== INGEST_KIND) {
    return { assignments: [], errors: [`Response kind "${String(payload.kind)}" is not ${INGEST_KIND}`] };
  }
  // A table reply arrives as {kind, items}; a JSON reply carries "assignments" as before.
  const rawAssignments = Array.isArray(payload.assignments) ? payload.assignments : payload.items;
  if (!Array.isArray(rawAssignments)) {
    return { assignments: [], errors: ['The "assignments" field is missing or is not an array.'] };
  }

  return validateAssignments(rawAssignments, options);
}

/** Extracts and JSON-parses the payload, returning a tolerant error message rather than throwing. */
function readPayloadObject(responseText: string): { value: unknown; errorMessage: string | null } {
  let jsonText: string;
  try {
    jsonText = extractRecordReplyPayload(responseText, PLAN_REPLY_SPEC_WITH_ASSIGNEE);
  } catch {
    return { value: null, errorMessage: 'No JSON object found in the assistant response.' };
  }
  try {
    return { value: JSON.parse(jsonText), errorMessage: null };
  } catch {
    return { value: null, errorMessage: 'The assistant response was not valid JSON.' };
  }
}

/** Validates each raw assignment, collecting accepted entries and one error per rejected entry. */
function validateAssignments(rawAssignments: unknown[], options: ParseOptions): PlanIngestResult {
  const assignments: IngestAssignment[] = [];
  const errors: string[] = [];

  rawAssignments.forEach((rawAssignment, index) => {
    const outcome = validateOneAssignment(rawAssignment, index, options);
    if (outcome.assignment !== null) {
      assignments.push(outcome.assignment);
    } else {
      errors.push(outcome.errorMessage);
    }
  });

  return { assignments, errors };
}

/** Validates one raw entry into either an accepted assignment or a descriptive error message. */
function validateOneAssignment(
  rawAssignment: unknown,
  index: number,
  options: ParseOptions,
): { assignment: IngestAssignment | null; errorMessage: string } {
  const entry = (rawAssignment ?? {}) as Record<string, unknown>;
  const issueKey = readTrimmedString(entry.issueKey);
  const sprint = readTrimmedString(entry.sprint);

  if (issueKey === '') {
    return { assignment: null, errorMessage: `Assignment at position ${index + 1} is missing an issueKey.` };
  }
  if (sprint === '') {
    return { assignment: null, errorMessage: `Assignment "${issueKey}" is missing a sprint.` };
  }
  if (!options.validSprintNames.includes(sprint)) {
    return { assignment: null, errorMessage: `Assignment "${issueKey}" has unknown sprint "${sprint}".` };
  }

  const assignment: IngestAssignment = { issueKey, sprint };
  const assignee = readTrimmedString(entry.assignee);
  if (options.allowAssignee && assignee !== '') {
    assignment.assignee = assignee;
  }
  return { assignment, errorMessage: '' };
}

/** Returns a trimmed string when the value is a string, or an empty string for any other type. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// ── Resolving assignments to canvas placements ──

/** A resolved re-sprint action against the canvas: which feature/story moves to which named sprint. */
export interface IngestPlacement {
  /** The parent feature (node) key — the target for setContainer, or the owner for setStoryPlacement. */
  featureKey: string;
  /** The child story key to move, or null when the ingested issue is a feature node itself. */
  storyKey: string | null;
  /** The target sprint name (a valid sprint the caller maps to / creates a box for). */
  sprint: string;
  /** The proposed new owner's display name, carried through only when reassignment was enabled. */
  assignee?: string;
}

/**
 * Resolves ingested assignments against the canvas: each issue key is matched to a child story (so its
 * parent feature is known for setStoryPlacement) or, failing that, to a feature node itself. Issue keys
 * that are on neither are returned as `unknownIssueKeys` so the operator sees exactly what was skipped.
 * Pure: no controller calls happen here — the caller applies the placements.
 */
export function resolveIngestPlacements(
  assignments: readonly IngestAssignment[],
  canvasNodes: readonly CanvasNode[],
): { placements: IngestPlacement[]; unknownIssueKeys: string[] } {
  const featureKeyByStoryKey = new Map<string, string>();
  const featureKeys = new Set<string>();
  for (const node of canvasNodes) {
    featureKeys.add(node.issueKey);
    for (const childStory of node.childStories) {
      featureKeyByStoryKey.set(childStory.key, node.issueKey);
    }
  }

  const placements: IngestPlacement[] = [];
  const unknownIssueKeys: string[] = [];
  for (const assignment of assignments) {
    const owningFeatureKey = featureKeyByStoryKey.get(assignment.issueKey);
    if (owningFeatureKey !== undefined) {
      placements.push({ featureKey: owningFeatureKey, storyKey: assignment.issueKey, sprint: assignment.sprint, assignee: assignment.assignee });
    } else if (featureKeys.has(assignment.issueKey)) {
      placements.push({ featureKey: assignment.issueKey, storyKey: null, sprint: assignment.sprint, assignee: assignment.assignee });
    } else {
      unknownIssueKeys.push(assignment.issueKey);
    }
  }
  return { placements, unknownIssueKeys };
}
