// componentMappingAiAssist.ts — The propose-only AI that maps a Feature to the repo components it touches
// (spec 031, US2). Mirrors compositionAiAssist: prompt out, strictly-validated reply in, nothing written to
// Jira, every proposal reviewed before it counts. The reply is constrained to the REPO ALLOWLIST — a value
// not on the allowlist (a domain tag, a typo, an unknown repo) is rejected on ingest and never proposed, so
// a non-repo component can never become a repo mapping. No automated/background AI; nothing AI-attributed.
//
// Google's AI Mode — the team's only assistant — ignores reply syntax, so the prompt ends with a fill-in table that
// already lists every allowlisted repo; the assistant only answers yes or no per row, so it cannot invent a repo. A
// JSON reply is still read. A reply that is unreadable or leaves rows blank gets a follow-up for the same chat (GH #499).

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  isUnreadableRecordReply,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import type { AiIngestResult } from './splitAiAssist';

/** The fixed discriminator the assistant must echo. */
export const COMPONENT_MAPPING_KIND = 'componentMapping';

/** The Feature content handed to the assistant to reason about which repos it touches. */
export interface FeatureForMapping {
  key: string;
  summary: string;
  description: string;
}

/** One accepted mapping: a repo component name that is guaranteed to be on the allowlist. */
export interface MappedComponent {
  componentName: string;
}

/** The fill-in table the prompt ends with: one row per allowlisted repo, answered yes or no. */
export const COMPONENT_MAPPING_REPLY_SPEC: ReplyRecordSpec = {
  kind: COMPONENT_MAPPING_KIND,
  replyMarker: 'REPO_MAPPING_TABLE:',
  columns: [
    { field: 'componentName', header: 'Repository' },
    { field: 'isTouched', header: 'Touched', valueKind: 'boolean', answerHint: 'yes or no — when unsure, no' },
    { field: 'reason', header: 'Why', answerHint: 'a few words from the Feature that show it, or ___ for a no' },
  ],
};

/** How much of a long description to include so it cannot crowd out the instructions. */
const MAX_DESCRIPTION_LENGTH = 4000;

function readTrimmedDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.length <= MAX_DESCRIPTION_LENGTH ? trimmed : `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH)}\n… (truncated)`;
}

/** Builds the prompt the PO copies into their assistant. The repo allowlist is the ONLY menu of choices. */
export function buildComponentMappingPrompt(feature: FeatureForMapping, repoAllowlistNames: readonly string[]): string {
  const allowlistLines = repoAllowlistNames.length > 0
    ? repoAllowlistNames.map((name) => `  - ${name}`).join('\n')
    : '  (no repo components have been classified yet)';

  return [
    'You are helping a Product Owner tag a Jira Feature with the repositories (components) it touches.',
    '',
    `Feature ${feature.key}: ${feature.summary}`,
    '',
    feature.description.trim() !== '' ? `Description:\n${readTrimmedDescription(feature.description)}` : 'No description provided.',
    '',
    'Choose the repositories this Feature touches. Use ONLY names from this list — do not invent names, do not',
    'add anything that is not listed, and when unsure include fewer:',
    allowlistLines,
    '',
    'Never state or imply that this was decided, written, or drafted by AI.',
    '',
    ...(repoAllowlistNames.length > 0
      ? [buildRecordReplyInstructions(COMPONENT_MAPPING_REPLY_SPEC, repoAllowlistNames.map((name) => [name]))]
      : []),
  ].join('\n');
}

/** A table row as the reply reader hands it back: the repo, and whether the assistant said the Feature touches it. */
interface RepoMappingRow {
  componentName?: unknown;
  isTouched?: unknown;
}

/**
 * Turns a table reply's rows into the JSON shape the validator below reads: the repos answered "yes". The table's
 * kind is the round's own, so the identity check still applies to it.
 */
function convertTableRowsToComponents(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.items) || Array.isArray(payload.components)) {
    return payload;
  }
  const touchedNames = (payload.items as RepoMappingRow[])
    .filter((row) => row.isTouched === true)
    .map((row) => row.componentName);
  return { ...payload, components: touchedNames };
}

/** Reads the payload object, turning both unreadable cases into one plain error (never throws). */
function readPayloadObject(responseText: string): { payload?: Record<string, unknown>; error?: string } {
  let jsonText: string;
  try {
    jsonText = extractRecordReplyPayload(responseText, COMPONENT_MAPPING_REPLY_SPEC);
  } catch {
    return { error: 'No JSON object found in the assistant response.' };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null) {
      return { error: 'The assistant response was not valid JSON.' };
    }
    return { payload: convertTableRowsToComponents(parsed as Record<string, unknown>) };
  } catch {
    return { error: 'The assistant response was not valid JSON.' };
  }
}

/**
 * Ingests a component-mapping reply. Never throws. Every proposed value is checked against the repo
 * allowlist (case-insensitive); a value not on the allowlist is REJECTED with an error and never returned,
 * so a domain tag or unknown value can never be proposed as a repo. Duplicates collapse; allowlist casing wins.
 */
export function parseComponentMappingIngest(
  responseText: string,
  repoAllowlistNames: readonly string[],
): AiIngestResult<MappedComponent> {
  const { payload, error } = readPayloadObject(responseText);
  if (!payload) {
    return { items: [], errors: [error!] };
  }
  if (payload.kind !== COMPONENT_MAPPING_KIND) {
    return { items: [], errors: [`Response kind "${String(payload.kind)}" is not ${COMPONENT_MAPPING_KIND}.`] };
  }

  const allowlistByLower = new Map(repoAllowlistNames.map((name) => [name.trim().toLowerCase(), name]));
  const rawComponents = Array.isArray(payload.components) ? payload.components : [];
  const seen = new Set<string>();
  const items: MappedComponent[] = [];
  const errors: string[] = [];

  for (const rawValue of rawComponents) {
    const name = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (name === '') {
      continue;
    }
    const canonical = allowlistByLower.get(name.toLowerCase());
    if (!canonical) {
      errors.push(`"${name}" is not a known repo component, so it was ignored.`);
      continue;
    }
    const dedupeKey = canonical.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    items.push({ componentName: canonical });
  }

  return { items, errors };
}

/** The allowlisted repos a table reply answered neither yes nor no — read only from a table, never from JSON. */
function listUnansweredRepos(responseText: string, repoAllowlistNames: readonly string[]): string[] {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(extractRecordReplyPayload(responseText, COMPONENT_MAPPING_REPLY_SPEC)) as Record<string, unknown>;
  } catch {
    return [];
  }
  // A JSON reply lists only the repos it chose; leaving the rest out is its answer, not a gap.
  if (!Array.isArray(payload.items)) {
    return [];
  }
  const answeredNames = new Set((payload.items as RepoMappingRow[])
    .filter((row) => typeof row.isTouched === 'boolean')
    .map((row) => String(row.componentName).trim().toLowerCase()));
  return repoAllowlistNames.filter((name) => !answeredNames.has(name.trim().toLowerCase()));
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply was read in full. An unreadable reply gets the
 * whole table again; a table that left repos unanswered gets a table of only those, so nothing is guessed for them.
 */
export function buildComponentMappingFollowUp(responseText: string, repoAllowlistNames: readonly string[]): string {
  if (repoAllowlistNames.length === 0) {
    return '';
  }
  if (isUnreadableRecordReply(responseText, COMPONENT_MAPPING_REPLY_SPEC)) {
    return buildRecordFormatFixPrompt(COMPONENT_MAPPING_REPLY_SPEC, repoAllowlistNames.map((name) => [name]));
  }
  const unansweredNames = listUnansweredRepos(responseText, repoAllowlistNames);
  if (unansweredNames.length === 0) {
    return '';
  }
  return [
    `Your last reply did not say yes or no for ${unansweredNames.length} repositor${unansweredNames.length === 1 ? 'y' : 'ies'}. Answer only these.`,
    buildRecordReplyInstructions(COMPONENT_MAPPING_REPLY_SPEC, unansweredNames.map((name) => [name])),
  ].join('\n');
}
