// planIngest.ts — The capacity-plan write-back round-trip: a copy-out "translate" prompt plus the
// strict ingest of the JSON reply that re-sprints canvas work.
//
// After the operator discusses and finalises a projected plan with Copilot in an ordinary chat,
// they paste the prompt from `buildTranslatePrompt` to have the assistant restate the agreed plan
// as exact JSON — using only the sprint names and roster names Toolbox knows. `parsePlanIngest`
// then validates that reply into well-formed assignments plus human-readable errors. Both functions
// are pure and deterministic: no clock, no DOM, no network.

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { extractJsonPayload } from '../ai/canvasAiAssist.ts';

/** The fixed discriminator the assistant must echo so a stray JSON blob is never misread as a plan. */
const INGEST_KIND = 'capacityPlanIngest';

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
 * Builds the copy-out prompt the operator pastes into their EXISTING Copilot chat once the plan is
 * agreed. It restates the plan as exact JSON, constrains sprint (and optionally assignee) values to
 * the names Toolbox recognises, and forbids invented issues, sprints, or names. Pure and deterministic.
 */
export function buildTranslatePrompt(
  validSprintNames: readonly string[],
  rosterNames: readonly string[],
  options: { allowAssignee: boolean },
): string {
  const jsonShape = buildJsonShape(options.allowAssignee);
  const sprintList = validSprintNames.map((sprintName) => `  - ${sprintName}`).join('\n');
  const sections: string[] = [
    'Convert the capacity plan we just agreed on in this conversation into the exact JSON below. Output ONLY the JSON, no prose.',
    '',
    'JSON shape:',
    jsonShape,
    '',
    'The "sprint" value MUST be exactly one of these sprint names (copy them verbatim):',
    sprintList,
    '',
    buildAssigneeSection(rosterNames, options.allowAssignee),
    'Include one entry per story/task that moves, using the exact issue keys from the plan. Do not invent issues, sprints, or names.',
  ];
  return sections.join('\n');
}

/** Returns the single-line JSON schema example, including the assignee field only when allowed. */
function buildJsonShape(allowAssignee: boolean): string {
  const assigneeField = allowAssignee ? ',"assignee":"NAME"' : '';
  return `{"kind":"${INGEST_KIND}","assignments":[{"issueKey":"KEY","sprint":"SPRINT"${assigneeField}}]}`;
}

/** Returns the assignee guidance: a roster whitelist when allowed, or an explicit exclusion when not. */
function buildAssigneeSection(rosterNames: readonly string[], allowAssignee: boolean): string {
  if (!allowAssignee) {
    return 'Do NOT include an "assignee" field on any entry.\n';
  }
  const rosterList = rosterNames.map((rosterName) => `  - ${rosterName}`).join('\n');
  return [
    'The "assignee" field is optional. When present it MUST be exactly one of these roster names:',
    rosterList,
    '',
  ].join('\n');
}

// ── Reply ingest ──

/**
 * Validates a translate reply into well-formed assignments plus descriptive errors. Tolerant of
 * fences and prose via `extractJsonPayload`; never throws on business-invalid content — every bad
 * entry becomes an error message while the good entries are kept. Pure and deterministic.
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
  if (!Array.isArray(payload.assignments)) {
    return { assignments: [], errors: ['The "assignments" field is missing or is not an array.'] };
  }

  return validateAssignments(payload.assignments, options);
}

/** Extracts and JSON-parses the payload, returning a tolerant error message rather than throwing. */
function readPayloadObject(responseText: string): { value: unknown; errorMessage: string | null } {
  let jsonText: string;
  try {
    jsonText = extractJsonPayload(responseText);
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
      placements.push({ featureKey: owningFeatureKey, storyKey: assignment.issueKey, sprint: assignment.sprint });
    } else if (featureKeys.has(assignment.issueKey)) {
      placements.push({ featureKey: assignment.issueKey, storyKey: null, sprint: assignment.sprint });
    } else {
      unknownIssueKeys.push(assignment.issueKey);
    }
  }
  return { placements, unknownIssueKeys };
}
