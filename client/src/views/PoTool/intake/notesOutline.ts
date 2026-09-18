// notesOutline.ts — Turns raw meeting notes into numbered lines and a first grouping of items from their own
// bullet structure, before anyone is asked anything (spec 037, contracts/deterministic-rules.md §1).
//
// Framework-First drift (documented gap): nothing in the codebase reads a bullet outline — the source readers
// return flat text. Grouping by the notes' own bullets gets most items right with no assistant at all, gives the
// sorting request something concrete to correct rather than something to invent, and makes the locked path usable.

import {
  createIntakeItem,
  type EpicIntake,
  type IntakeItem,
  type SetAsideLine,
  type SourceLine,
} from './epicIntakeModel.ts';

// ── Markers ──

/** Top-level bullets: •, ●, -, *, or a number such as "1." / "2)" — each followed by whitespace. */
const TOP_LEVEL_MARKER_PATTERN = /^([•●\-*]|\d+[.)])\s+/;

/**
 * Sub-bullets: o, ◦, ▪, ■, –, +, or a letter such as "a)" — each followed by whitespace. Requiring whitespace after
 * the "o" is what keeps a word like "Oregon" or "offshore" from being read as a bullet.
 */
const SUB_LEVEL_MARKER_PATTERN = /^([o◦▪■–+]|[a-z][.)])\s+/;

/** A top-level marker indented at least this much deeper than the last top-level line counts as a sub-bullet. */
const SUB_LEVEL_EXTRA_INDENT = 2;

/** A tab counts as this many spaces when comparing indentation. */
const TAB_WIDTH_IN_SPACES = 4;

/** Rough size of a line's framing inside a prompt ("[12] " plus a newline), used when splitting into parts. */
const PROMPT_LINE_OVERHEAD_CHARS = 8;

interface ParsedLine {
  rawText: string;
  indent: number;
  markerLevel: 0 | 1 | 2;
  text: string;
}

function measureIndent(rawText: string): number {
  const leadingWhitespace = rawText.match(/^\s*/)?.[0] ?? '';
  return [...leadingWhitespace].reduce((total, character) => total + (character === '\t' ? TAB_WIDTH_IN_SPACES : 1), 0);
}

function parseLine(rawText: string): ParsedLine {
  const trimmedStart = rawText.trimStart();
  const indent = measureIndent(rawText);
  const topLevelMatch = trimmedStart.match(TOP_LEVEL_MARKER_PATTERN);
  if (topLevelMatch) {
    return { rawText, indent, markerLevel: 1, text: trimmedStart.slice(topLevelMatch[0].length).trim() };
  }
  const subLevelMatch = trimmedStart.match(SUB_LEVEL_MARKER_PATTERN);
  if (subLevelMatch) {
    return { rawText, indent, markerLevel: 2, text: trimmedStart.slice(subLevelMatch[0].length).trim() };
  }
  return { rawText, indent, markerLevel: 0, text: trimmedStart.trim() };
}

/** Demotes a top-level marker to a sub-bullet when it sits clearly deeper than the top-level line above it. */
function resolveOutlineLevels(parsedLines: readonly ParsedLine[]): Array<0 | 1 | 2> {
  let lastTopLevelIndent: number | null = null;
  return parsedLines.map((parsedLine) => {
    if (parsedLine.markerLevel !== 1) {
      return parsedLine.markerLevel;
    }
    if (lastTopLevelIndent !== null && parsedLine.indent >= lastTopLevelIndent + SUB_LEVEL_EXTRA_INDENT) {
      return 2;
    }
    lastTopLevelIndent = parsedLine.indent;
    return 1;
  });
}

// ── Numbering ──

/**
 * Numbers every non-blank line of the notes from 1 and reads its outline level. The numbering never changes for
 * the life of the intake (FR-003). Notes with no bullets at all are a plain list, so every line is its own item.
 */
export function numberSourceLines(notesText: string): SourceLine[] {
  const parsedLines = notesText
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trimEnd())
    .filter((rawLine) => rawLine.trim() !== '')
    .map(parseLine);
  const hasAnyMarker = parsedLines.some((parsedLine) => parsedLine.markerLevel !== 0);
  const levels = hasAnyMarker ? resolveOutlineLevels(parsedLines) : parsedLines.map(() => 1 as const);
  return parsedLines.map((parsedLine, index) => ({
    lineNumber: index + 1,
    text: parsedLine.text,
    rawText: parsedLine.rawText,
    outlineLevel: levels[index],
  }));
}

// ── Baseline grouping ──

/**
 * Groups numbered lines into items by outline: a top-level bullet starts an item, sub-bullets attach to the item
 * above them, and unmarked lines are set aside as headings or prose. Every line ends up in exactly one place.
 */
export function buildOutlineBaseline(lines: readonly SourceLine[]): { items: IntakeItem[]; setAsideLines: SetAsideLine[] } {
  const groupedLines: SourceLine[][] = [];
  const setAsideLines: SetAsideLine[] = [];
  for (const line of lines) {
    if (line.outlineLevel === 0) {
      setAsideLines.push({ lineNumber: line.lineNumber, reason: 'headingOrProse', settledBy: 'rule', note: null });
    } else if (line.outlineLevel === 1 || groupedLines.length === 0) {
      groupedLines.push([line]);
    } else {
      groupedLines[groupedLines.length - 1].push(line);
    }
  }
  const items = groupedLines.map((group, index) =>
    createIntakeItem(index + 1, group[0].text, group.map((line) => line.lineNumber)));
  return { items, setAsideLines };
}

// ── Coverage ──

/**
 * Proves every source line sits in exactly one item or is set aside (FR-011). Returns the lines that belong
 * nowhere and the lines claimed twice, so the PO can be shown exactly which ones need placing.
 */
export function proveLineCoverage(
  intake: Pick<EpicIntake, 'lines' | 'items' | 'setAsideLines'>,
): { isComplete: boolean; missing: number[]; duplicated: number[] } {
  const claimCounts = new Map<number, number>(intake.lines.map((line) => [line.lineNumber, 0]));
  const claimedLineNumbers = [
    ...intake.items.flatMap((item) => item.lineNumbers),
    ...intake.setAsideLines.map((setAside) => setAside.lineNumber),
  ];
  for (const lineNumber of claimedLineNumbers) {
    claimCounts.set(lineNumber, (claimCounts.get(lineNumber) ?? 0) + 1);
  }
  const missing: number[] = [];
  const duplicated: number[] = [];
  for (const [lineNumber, claimCount] of [...claimCounts.entries()].sort(([left], [right]) => left - right)) {
    if (claimCount === 0) missing.push(lineNumber);
    if (claimCount > 1) duplicated.push(lineNumber);
  }
  return { isComplete: missing.length === 0 && duplicated.length === 0, missing, duplicated };
}

// ── Prompt parts ──

function measureItemPromptChars(item: IntakeItem, lineTextByNumber: ReadonlyMap<number, string>): number {
  return item.lineNumbers.reduce(
    (total, lineNumber) => total + (lineTextByNumber.get(lineNumber)?.length ?? 0) + PROMPT_LINE_OVERHEAD_CHARS,
    0,
  );
}

/**
 * Packs items into consecutive parts no larger than `maxChars`, breaking only between items so no item's lines
 * straddle two parts. An item too big for any part travels alone.
 */
export function splitLinesIntoPromptParts(
  items: readonly IntakeItem[],
  lines: readonly SourceLine[],
  maxChars: number,
): IntakeItem[][] {
  const lineTextByNumber = new Map(lines.map((line) => [line.lineNumber, line.rawText]));
  const parts: IntakeItem[][] = [];
  let currentPart: IntakeItem[] = [];
  let currentChars = 0;
  for (const item of items) {
    const itemChars = measureItemPromptChars(item, lineTextByNumber);
    if (currentPart.length > 0 && currentChars + itemChars > maxChars) {
      parts.push(currentPart);
      currentPart = [];
      currentChars = 0;
    }
    currentPart.push(item);
    currentChars += itemChars;
  }
  if (currentPart.length > 0) {
    parts.push(currentPart);
  }
  return parts;
}
