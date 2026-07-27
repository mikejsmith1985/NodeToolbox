// componentMappingAiAssist.ts — The propose-only AI that maps a Feature to the repo components it touches
// (spec 031, US2). Mirrors compositionAiAssist: prompt out, strictly-validated reply in, nothing written to
// Jira, every proposal reviewed before it counts. The reply is constrained to the REPO ALLOWLIST — a value
// not on the allowlist (a domain tag, a typo, an unknown repo) is rejected on ingest and never proposed, so
// a non-repo component can never become a repo mapping. No automated/background AI; nothing AI-attributed.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
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
    'Respond ONLY with valid JSON:',
    `{"kind":"${COMPONENT_MAPPING_KIND}","featureKey":"${feature.key}","components":["<a name from the list>"],"rationale":"..."}`,
  ].join('\n');
}

/** Reads the payload object, turning both unreadable cases into one plain error (never throws). */
function readPayloadObject(responseText: string): { payload?: Record<string, unknown>; error?: string } {
  let jsonText: string;
  try {
    jsonText = extractJsonPayload(responseText);
  } catch {
    return { error: 'No JSON object found in the assistant response.' };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null) {
      return { error: 'The assistant response was not valid JSON.' };
    }
    return { payload: parsed as Record<string, unknown> };
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
