// featureEnrichMerge.ts — Enriching an existing Feature ADDS to what it already says; it never rewrites it.
//
// The first version handed the assistant the gathered material and wrote a fresh nine-section document over the
// top. For a Feature whose description was already a full requirements document — numbered requirements, a
// comparison table, migration rules, open questions — that lost almost everything (GH #387). So the merge here is
// the guarantee, not the prompt wording: every line the Feature already had survives, and the proposal can only
// append what is genuinely new.

import { normalizeFeatureDescription, parseSections, SECTION_LABELS, type SectionLabel } from './featureDocSections.ts';

/** Jira refuses a description longer than this, so Toolbox says so before the save rather than after. */
export const MAX_JIRA_DESCRIPTION_CHARS = 32_767;

/** Compares two lines as a reader would: ignoring case, surrounding space and bullet punctuation. */
function readComparableLine(line: string): string {
  return line.trim().toLowerCase().replace(/^[-•*•\d.)\s]+/, '').replace(/\s+/g, ' ');
}

/** The proposal's lines for one section that the Feature does not already say, in the order proposed. */
function readAddedLines(originalSection: string, proposedSection: string): string[] {
  const existingLines = new Set(originalSection.split('\n').map(readComparableLine).filter((line) => line !== ''));
  const addedLines: string[] = [];
  for (const proposedLine of proposedSection.split('\n')) {
    const comparableLine = readComparableLine(proposedLine);
    if (comparableLine === '' || existingLines.has(comparableLine)) {
      continue;
    }
    existingLines.add(comparableLine);
    addedLines.push(proposedLine.trimEnd());
  }
  return addedLines;
}

function mergeSection(originalSection: string, proposedSection: string): string {
  const trimmedOriginal = originalSection.trim();
  if (trimmedOriginal === '') {
    return proposedSection.trim();
  }
  const addedLines = readAddedLines(trimmedOriginal, proposedSection);
  return addedLines.length === 0 ? trimmedOriginal : `${trimmedOriginal}\n${addedLines.join('\n')}`;
}

/**
 * Merges a proposed description into the Feature's existing one, section by section: the existing text stays exactly
 * as it is, and only genuinely new lines are appended beneath it. A section the Feature does not have yet is taken
 * from the proposal whole. With no existing description this is simply the proposal, normalised.
 */
export function mergeEnrichedDescription(originalDescription: string, proposedDescription: string): string {
  if (originalDescription.trim() === '') {
    return normalizeFeatureDescription(proposedDescription);
  }
  const originalSections = parseSections(originalDescription);
  const proposedSections = parseSections(proposedDescription);
  const mergedSections = SECTION_LABELS.map((label: SectionLabel) => {
    const merged = mergeSection(originalSections.get(label) ?? '', proposedSections.get(label) ?? '');
    return merged === '' ? '' : `${label}:\n${merged}`;
  }).filter((section) => section !== '');
  return normalizeFeatureDescription(mergedSections.join('\n\n'));
}

/** What a description's length means for saving it: how long it is, and how much must go if Jira would refuse it. */
export interface DescriptionLengthCheck {
  length: number;
  isOverLimit: boolean;
  excessCharacters: number;
}

/** Measures a description against Jira's own limit, so the PO can trim before a save is attempted. */
export function checkDescriptionLength(description: string): DescriptionLengthCheck {
  const length = description.length;
  return {
    length,
    isOverLimit: length > MAX_JIRA_DESCRIPTION_CHARS,
    excessCharacters: Math.max(0, length - MAX_JIRA_DESCRIPTION_CHARS),
  };
}
