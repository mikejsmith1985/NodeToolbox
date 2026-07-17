// richTextStructured.ts — Parses a Jira description into lightweight structure for readable rendering.
//
// Art VII drift justification: nothing in the dependency tree renders rich text, and a markdown
// library would not parse Jira's wiki syntax anyway — so this minimal custom parser targets exactly
// the structures the hygiene review needs to read (bold run-in headings like "Day one:", simple
// lists, paragraphs). Anything unrecognized degrades to a paragraph, so the output is never emptier
// than the previous flattened rendering (spec 019 FR-009).

import { normalizeRichTextToPlainText } from './richTextPlainText.ts';

/** One renderable block of a structured description. */
export type StructuredBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'listItem'; text: string; level: 1 | 2 };

// A short line ending in ":" reads as a run-in heading ("Day one:", "Steps to Reproduce:");
// longer colon-terminated lines are prose and must stay paragraphs.
const MAX_RUN_IN_HEADING_LENGTH = 60;
// Doubled markers (** / -- / ##) are Jira wiki's nested list syntax.
const NESTED_LIST_ITEM_PATTERN = /^(\*\*|--|##)\s+(.*)$/;
const LIST_ITEM_PATTERN = /^([-*#•])\s+(.*)$/;
// A whole line wrapped in single asterisks is Jira wiki bold — rendered as a heading.
const BOLD_LINE_PATTERN = /^\*([^*]+)\*$/;

/** Converts a raw Jira description into structured blocks; blank/non-text input yields []. */
export function parseStructuredText(rawDescription: unknown): StructuredBlock[] {
  const normalizedText = normalizeRichTextToPlainText(rawDescription);
  if (!normalizedText.trim()) return [];

  return normalizedText
    .split('\n')
    .map((rawLine) => rawLine.trim())
    .filter((trimmedLine) => trimmedLine !== '')
    .map(parseLine);
}

/** Classifies one trimmed, non-empty line into its structured block. */
function parseLine(lineText: string): StructuredBlock {
  const nestedListMatch = lineText.match(NESTED_LIST_ITEM_PATTERN);
  if (nestedListMatch) {
    return { kind: 'listItem', text: nestedListMatch[2], level: 2 };
  }

  const boldLineMatch = lineText.match(BOLD_LINE_PATTERN);
  if (boldLineMatch) {
    return { kind: 'heading', text: boldLineMatch[1].trim() };
  }

  const listItemMatch = lineText.match(LIST_ITEM_PATTERN);
  if (listItemMatch) {
    return { kind: 'listItem', text: listItemMatch[2], level: 1 };
  }

  const isRunInHeading = lineText.endsWith(':') && lineText.length <= MAX_RUN_IN_HEADING_LENGTH;
  if (isRunInHeading) {
    return { kind: 'heading', text: lineText };
  }

  return { kind: 'paragraph', text: lineText };
}
