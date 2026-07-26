// featureDocSections.ts — The pure nine-section canon for AI-composed Feature descriptions (spec 029).
//
// Framework-First drift (documented gap): nothing in the codebase structures a description into these nine
// sections, flags under-supported ones for validation, strips AI self-attribution, or extracts risk-link
// keys from a Risks section. `normalizeRichTextToPlainText` only flattens markup — it has no notion of
// sections. This module is pure (no I/O, no clock) so it is fully deterministic and unit-tested.

/** Which kind of validation an under-supported section needs. */
export type ValidationKind = 'business' | 'technical' | 'both';

/** The canonical nine sections, in the exact required order. */
export const SECTION_LABELS = [
  'Description',
  'Benefit Hypothesis',
  'Acceptance Criteria',
  'Assumptions',
  'Dependencies',
  'In Scope',
  'Out of Scope',
  'Risks',
  'Non-Functional Requirements (NFR)',
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];

/** The three fixed validation markers. A marker means "information is missing", never "AI wrote this". */
export const VALIDATION_MARKER: Record<ValidationKind, string> = {
  business: '⚠ REQUIRES BUSINESS VALIDATION',
  technical: '⚠ REQUIRES TECHNICAL VALIDATION',
  both: '⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION',
};

/** Default validation kind used when a MISSING section is inserted as a placeholder (research R2). */
export const DEFAULT_VALIDATION_KIND: Record<SectionLabel, ValidationKind> = {
  'Description': 'both',
  'Benefit Hypothesis': 'business',
  'Acceptance Criteria': 'both',
  'Assumptions': 'both',
  'Dependencies': 'technical',
  'In Scope': 'business',
  'Out of Scope': 'business',
  'Risks': 'business',
  'Non-Functional Requirements (NFR)': 'technical',
};

/** Normalises a string to a comparison token: lowercase, punctuation → space, collapsed whitespace. */
function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NORMALIZED_LABELS = SECTION_LABELS.map((label) => ({ label, token: normalizeToken(label) }));

/** If a line is a section heading (just a canonical label before the colon), returns the label + any inline text. */
function matchLabelHeading(line: string): { label: SectionLabel; inlineContent: string } | null {
  const colonIndex = line.indexOf(':');
  const beforeColon = colonIndex >= 0 ? line.slice(0, colonIndex) : line;
  const token = normalizeToken(beforeColon);
  const match = NORMALIZED_LABELS.find((candidate) => candidate.token === token);
  if (!match) {
    return null;
  }
  return { label: match.label, inlineContent: colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : '' };
}

/** Parses a raw description into a label → content map. Text before the first heading folds into Description. */
function parseSections(rawDescription: string): Map<SectionLabel, string> {
  const sections = new Map<SectionLabel, string>();
  let currentLabel: SectionLabel | null = null;
  let buffer: string[] = [];
  const preamble: string[] = [];

  const flush = () => {
    if (currentLabel !== null) {
      sections.set(currentLabel, buffer.join('\n').trim());
    }
    buffer = [];
  };

  for (const line of rawDescription.split('\n')) {
    const heading = matchLabelHeading(line);
    if (heading) {
      flush();
      currentLabel = heading.label;
      buffer = heading.inlineContent !== '' ? [heading.inlineContent] : [];
    } else if (currentLabel === null) {
      preamble.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();

  // Any text before the first labeled section belongs to Description so nothing is lost.
  const preambleText = preamble.join('\n').trim();
  if (preambleText !== '') {
    const existing = sections.get('Description');
    sections.set('Description', existing ? `${preambleText}\n${existing}` : preambleText);
  }
  return sections;
}

/** The placeholder body for a missing section — a marker plus a neutral note. Never AI-attributed. */
export function buildValidationPlaceholder(label: SectionLabel): string {
  const marker = VALIDATION_MARKER[DEFAULT_VALIDATION_KIND[label]];
  return `${marker}\nThe source material did not provide enough information to complete this section.`;
}

/**
 * Re-emits a description as all nine sections, in canonical order, preserving existing content and any
 * markers the model wrote, and inserting a validation-flagged placeholder for any missing or empty
 * section. Idempotent: normalizing an already-normalized description returns the same text.
 */
export function normalizeFeatureDescription(rawDescription: string): string {
  const parsed = parseSections(rawDescription);
  return SECTION_LABELS.map((label) => {
    const content = (parsed.get(label) ?? '').trim();
    return `${label}:\n${content !== '' ? content : buildValidationPlaceholder(label)}`;
  }).join('\n\n');
}

/** Phrases that attribute authorship to AI — removed on ingest so no such claim reaches Jira. */
const AI_ATTRIBUTION_PATTERNS: RegExp[] = [
  /\b(this|the following|the above|the (?:content|description|text|section))\s+(?:was|is|has been)\s+(?:generated|written|drafted|created|composed|produced|authored)\s+(?:by|with|using)\s+(?:an?\s+)?ai\b[^.\n]*\.?/gi,
  /\b(?:generated|written|drafted|created|composed|produced|authored)\s+(?:by|with|using)\s+(?:an?\s+)?(?:ai|artificial intelligence|a language model|an llm|chatgpt|gpt-?\d*)\b[^.\n]*\.?/gi,
  /\bas an ai(?:\s+language model)?\b[^.\n]*\.?/gi,
  /\bai[-\s]?(?:generated|written|drafted|composed|authored|produced)\b/gi,
];

/** Removes AI self-attribution phrasing while leaving all other content (incl. ⚠ markers) intact. */
export function stripAiAttribution(text: string): string {
  let result = text;
  for (const pattern of AI_ATTRIBUTION_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // Tidy the gaps left behind without disturbing section structure.
  return result
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

const JIRA_KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/g;

/** Returns the distinct Jira issue keys found ONLY in the Risks section, in first-seen order. */
export function extractRiskLinkKeys(description: string): string[] {
  const risksContent = parseSections(description).get('Risks') ?? '';
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of risksContent.match(JIRA_KEY_PATTERN) ?? []) {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
