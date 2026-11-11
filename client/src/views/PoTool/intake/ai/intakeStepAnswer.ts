// intakeStepAnswer.ts — Reads and applies one pasted Epic Intake answer through the round it was asked in, and builds
// the follow-up that answer calls for (spec 037, GH #499).
//
// Both the step-by-step panel and the copy-paste loop read answers the same way, so the reading lives here once. The
// follow-up is built against the intake as it stood when the answer was pasted — what the request actually asked.

import type { EpicIntake } from '../epicIntakeModel.ts';
import { applyClassifyOutcome } from './intakeClassifyApply.ts';
import { buildClassifyFollowUpPrompt, parseClassifyReply } from './intakeClassifyRound.ts';
import { applyResolveOutcome, buildResolveFollowUpPrompt, parseResolveReply } from './intakeResolveRound.ts';

/** What the request being answered asked about, and which part of its round it was. */
export interface AnsweredRequest {
  itemIds: string[];
  partIndex: number;
  partCount: number;
}

/** The intake after one answer, and the follow-up for the same chat ('' when the answer was complete). */
export interface StepAnswerResult {
  updated: EpicIntake;
  followUpPrompt: string;
}

/**
 * Reads one pasted answer — the sorting round's or the resolve round's — applies what it validly answered, and builds
 * the follow-up asking only for the form or for the items it left out. Nothing missing is ever filled in.
 */
export function readStepAnswer(intake: EpicIntake, replyText: string, asked: AnsweredRequest, isSorting: boolean, nowIso: string): StepAnswerResult {
  const position = { partIndex: asked.partIndex, partCount: asked.partCount };
  if (isSorting) {
    const classifyOutcome = parseClassifyReply(replyText, intake, asked.itemIds);
    return {
      updated: applyClassifyOutcome(intake, classifyOutcome, asked.itemIds, position, nowIso),
      followUpPrompt: buildClassifyFollowUpPrompt(intake, asked.itemIds, classifyOutcome),
    };
  }
  const resolveOutcome = parseResolveReply(replyText, intake, asked.itemIds);
  return {
    updated: applyResolveOutcome(intake, resolveOutcome, asked.itemIds, position, nowIso),
    followUpPrompt: buildResolveFollowUpPrompt(intake, asked.itemIds, resolveOutcome),
  };
}
