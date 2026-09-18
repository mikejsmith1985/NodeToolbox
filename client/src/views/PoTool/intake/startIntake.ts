// startIntake.ts — Starts an Epic Intake from the notes the PO added: numbers the lines, groups them by their own
// bullets, and lets every rule decide what it can before anyone is asked a question (spec 037).

import { describeSourceTitle, readSourceText, type ReferencedSource } from '../sources/sourceModel.ts';
import {
  DEFAULT_INTAKE_PROJECT_KEY,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type SourceLine,
} from './epicIntakeModel.ts';
import { deriveItemFacts } from './intakeFacts.ts';
import { buildOutlineBaseline, numberSourceLines } from './notesOutline.ts';

/** What starting an intake needs. `mintId` and `nowIso` are passed in so starting is fully repeatable in tests. */
export interface StartEpicIntakeInput {
  teamProfileId: string;
  sources: readonly ReferencedSource[];
  nowIso: string;
  mintId: () => string;
}

/**
 * Numbers every source's lines in one sequence, each source introduced by its title as an unbulleted line so the
 * title is set aside rather than mistaken for an item. Each source's outline is read on its own, so a plain-list
 * source still becomes one item per line even beside a bulleted one.
 */
function buildSourceLines(sources: readonly ReferencedSource[]): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const source of sources) {
    const titleText = describeSourceTitle(source);
    lines.push({ lineNumber: lines.length + 1, text: titleText, rawText: titleText, outlineLevel: 0 });
    for (const sourceLine of numberSourceLines(readSourceText(source))) {
      lines.push({ ...sourceLine, lineNumber: lines.length + 1 });
    }
  }
  return lines;
}

/** Names the intake after its first source and the day it started, so saved intakes are easy to tell apart. */
function buildIntakeName(input: StartEpicIntakeInput): string {
  const firstTitle = input.sources.length > 0 ? describeSourceTitle(input.sources[0]) : 'Notes';
  return `${firstTitle} — ${input.nowIso.slice(0, 10)}`;
}

/**
 * Builds a fresh intake: numbered lines, the outline grouping, and every rule-settled fact — named keys, stated
 * sizes, deferral evidence — applied to each item.
 */
export function startEpicIntake(input: StartEpicIntakeInput): EpicIntake {
  const lines = buildSourceLines(input.sources);
  const baseline = buildOutlineBaseline(lines);
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: input.mintId(),
    teamProfileId: input.teamProfileId,
    name: buildIntakeName(input),
    targetProjectKey: DEFAULT_INTAKE_PROJECT_KEY,
    createdAtIso: input.nowIso,
    updatedAtIso: input.nowIso,
    sourceTitles: input.sources.map(describeSourceTitle),
    lines,
    items: baseline.items.map((item) => deriveItemFacts(item, lines)),
    setAsideLines: baseline.setAsideLines,
    epicType: { state: 'unresolved' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}
