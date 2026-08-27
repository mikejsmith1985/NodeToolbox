// rewriteJourney.ts — Working out where somebody is in a re-write, and what to do next.
//
// The tab shows five steps at once, each with its own controls, and every one of them looks equally
// ready to be pressed. That is fine for somebody who built it and baffling for everybody else: the
// question a person actually has is not "what are the steps" but "what do I do RIGHT NOW", and nothing
// on the screen answered it.
//
// So the state of the batch is read once, here, and turned into an answer: which steps are finished,
// which one is live, and a single sentence naming the next action. The tab renders that; it does not
// work it out for itself, so the strip at the top and the panels below can never disagree.
//
// Two things are deliberately NOT modelled:
//
//   - A step is never "locked". Somebody re-running Step 3 after approving is doing something sensible,
//     and a guided flow that forbade it would be a worse tool than the one that confused them.
//   - Step 2 is OPTIONAL. A batch whose notes already fit needs no condensing at all, and marking it
//     incomplete forever would be telling somebody to do work that would change nothing.
//
// Pure: no fetch, no storage, no clock.

import type { RewriteBatch, RewriteItem } from './rewriteBatchModel.ts';

/** Where a step stands. */
export type JourneyStepState = 'done' | 'current' | 'waiting' | 'skipped';

/** One step of the run, as the strip at the top renders it. */
export interface JourneyStep {
  /** 1-5, matching the panel headings the operator reads below. */
  number: number;
  /** Two or three words — this is a strip, not a paragraph. */
  label: string;
  state: JourneyStepState;
  /** What doing this step means, said in one sentence and only for the live one. */
  instruction: string;
}

/** The whole picture: the steps, and the one thing to do next. */
export interface RewriteJourney {
  steps: JourneyStep[];
  /** The live step's instruction, or a closing line when the run is finished. */
  nextAction: string;
  /** True once every approved item has been written to Jira and nothing is outstanding. */
  isComplete: boolean;
}

/** Items that could carry a re-write — a capture failure has nothing to re-write. */
function readCapturableItems(batch: RewriteBatch): RewriteItem[] {
  return batch.items.filter((item) => item.captureError === null);
}

/** True when every issue that could have a draft has one. */
function hasDraftedEverything(batch: RewriteBatch): boolean {
  const capturable = readCapturableItems(batch);
  return capturable.length > 0 && capturable.every((item) => item.proposed !== null);
}

/** True when every drafted issue has been decided on — approved, rejected, or already written. */
function hasReviewedEverything(batch: RewriteBatch): boolean {
  const drafted = readCapturableItems(batch).filter((item) => item.proposed !== null);
  const decidedStates = new Set(['approved', 'rejected', 'submitted', 'reverted']);
  return drafted.length > 0 && drafted.every((item) => decidedStates.has(item.state));
}

/**
 * Whether condensing still has work in it.
 *
 * A document nobody condensed is outstanding; so is a set of two or more extracts with no brief, because
 * consolidating is the only step that catches two documents contradicting each other. With no documents
 * at all there is nothing to do, which is different from something left undone.
 */
function readCondenseState(batch: RewriteBatch): { hasWork: boolean; hasDocuments: boolean } {
  const sources = batch.sharedSources ?? [];
  const extracts = batch.sourceExtracts ?? {};
  const condensedCount = sources.filter((source) => extracts[source.id] !== undefined).length;
  const hasWork = condensedCount < sources.length
    || (condensedCount >= 2 && batch.sharedBrief === undefined);
  return { hasWork: sources.length > 0 && hasWork, hasDocuments: sources.length > 0 };
}

/** The fixed labels and the sentence each step is asking for. */
const STEP_DEFINITIONS: readonly { number: number; label: string; instruction: string }[] = [
  {
    number: 1,
    label: 'Notes',
    instruction: 'Add the notes these issues should be re-written from — a Confluence page, a spreadsheet, '
      + 'PDFs, saved emails, or text you paste in. You can add more at any point and run again.',
  },
  {
    number: 2,
    label: 'Condense',
    instruction: 'Condense each document, then consolidate them. Your notes are larger than one prompt '
      + 'holds, so without this each document is cut to a fraction of itself.',
  },
  {
    number: 3,
    label: 'Draft',
    instruction: 'Build the prompt, copy it into your assistant, and paste the whole reply back. If it is '
      + 'split into parts, run every part.',
  },
  {
    number: 4,
    label: 'Review',
    instruction: 'Read each re-write beside its original. Edit anything you like, then press Approve or '
      + 'Reject on every one. Nothing is in Jira yet.',
  },
  {
    number: 5,
    label: 'Send',
    instruction: 'Press "Write N approved to Jira". Only the ones you approved are written, and each is '
      + 'checked against Jira first in case somebody else edited it.',
  },
];

/** The line shown when there is genuinely nothing left to do. */
const COMPLETE_MESSAGE = 'Done — every approved re-write is in Jira. Add more notes and run Step 3 again '
  + 'to keep building on these, or start a new batch.';

/** The line shown before any issues have been captured. */
const NO_BATCH_MESSAGE = 'Paste the Jira keys you want to re-write, then press "Capture originals".';

/**
 * Reads the batch and says where the run has got to.
 *
 * The FIRST unfinished step is the live one. Everything before it is done (or skipped, for condensing
 * nobody needed), everything after it is waiting — which is what turns five equally-shouting panels into
 * one thing to do now.
 */
export function readRewriteJourney(batch: RewriteBatch | null): RewriteJourney {
  if (batch === null || batch.items.length === 0) {
    return {
      steps: STEP_DEFINITIONS.map((definition) => ({ ...definition, state: 'waiting' as JourneyStepState })),
      nextAction: NO_BATCH_MESSAGE,
      isComplete: false,
    };
  }

  const condense = readCondenseState(batch);
  const hasNotes = (batch.sharedSources ?? []).length > 0;
  const isDrafted = hasDraftedEverything(batch);
  const isReviewed = hasReviewedEverything(batch);
  const approvedItems = batch.items.filter((item) => item.state === 'approved');
  const isSent = isReviewed && approvedItems.length === 0;

  // Ordered so index 0 is step one. A step is finished when its own work is finished, whatever the
  // steps after it are doing.
  //
  // Notes are OPTIONAL: an issue can be re-written from its own text, and a flow that insisted on
  // notes would block a perfectly ordinary run for ever. Once anything has been drafted the operator
  // has plainly moved past this step, whether or not they added any.
  const hasAnyDraft = readCapturableItems(batch).some((item) => item.proposed !== null);
  const isFinished = [hasNotes || hasAnyDraft, !condense.hasWork, isDrafted, isReviewed, isSent];
  const liveIndex = isFinished.findIndex((finished) => !finished);

  const steps = STEP_DEFINITIONS.map((definition, index): JourneyStep => {
    // Work nobody needed is SKIPPED, not done: saying "done" would claim something that never happened.
    if (index === 0 && !hasNotes && hasAnyDraft) {
      return { ...definition, state: 'skipped' };
    }
    if (index === 1 && !condense.hasDocuments) {
      return { ...definition, state: 'skipped' };
    }
    if (liveIndex === -1 || index < liveIndex) {
      return { ...definition, state: 'done' };
    }
    return { ...definition, state: index === liveIndex ? 'current' : 'waiting' };
  });

  return {
    steps,
    nextAction: liveIndex === -1 ? COMPLETE_MESSAGE : STEP_DEFINITIONS[liveIndex].instruction,
    isComplete: liveIndex === -1,
  };
}
