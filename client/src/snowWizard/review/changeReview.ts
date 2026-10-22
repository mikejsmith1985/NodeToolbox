// changeReview.ts — Runs one review: the SAME readiness checks the Wizard's Checks step uses, on an existing change,
// plus who to address the coaching note to. Reads only; the Review job runs it behind the read-only guard.

import { buildChangeReadiness, type ChangeReadinessFacts, type ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { gatherChangeReadinessFacts } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import { readRcpRulesEnabled } from '../../views/SnowHub/rcp/rcpApprovalEmail.ts';
import { readCentralTodayIso } from '../../views/SnowHub/rcp/rcpRules.ts';
import { readChangeRequester } from './changeRequester.ts';
import type { CoachingChange } from './coachingNote.ts';

/** What a review found. */
export interface ChangeReviewResult {
  changeNumber: string;
  isChangeFound: boolean;
  items: ReadinessItem[];
  coachingChange: CoachingChange;
  requesterEmail: string;
  /** What the checks were judged on, so a reviewer's AI discussion sees the same change. */
  facts: Pick<ChangeReadinessFacts, 'change' | 'textFields' | 'plannedWindow' | 'isProduction'>;
}

/** The day and RCP switch to judge on; defaults are today (Central Time) and the browser's RCP setting. */
export interface ChangeReviewOptions {
  todayIso?: string;
  isRcpRulesEnabled?: boolean;
}

/**
 * The checks a reviewer cannot judge. "Risk check" asks whether the AUTHOR ran their own risk-check session in
 * Toolbox, which no reviewer can see; the change-text checks cover the same content, so Review leaves it out rather
 * than flag every change as "needs action".
 */
// Problem records are linked to the change by ServiceNow itself (owner, GH #475), so they are never the author's work
// and never belong in a coaching note.
export const AUTHOR_ONLY_ITEM_IDS: ReadonlySet<string> = new Set(['riskCheck', 'prbs']);

/** Reviews one change by number, on the same checks used when a change is made (minus author-only ones). */
export async function runChangeReview(changeNumber: string, options: ChangeReviewOptions = {}): Promise<ChangeReviewResult> {
  const trimmedNumber = changeNumber.trim();
  const [gathered, requester] = await Promise.all([
    gatherChangeReadinessFacts(trimmedNumber, {
      riskReview: null,
      isRcpRulesEnabled: options.isRcpRulesEnabled ?? readRcpRulesEnabled(),
      todayIso: options.todayIso ?? readCentralTodayIso(),
    }),
    readChangeRequester(trimmedNumber),
  ]);
  const { facts } = gathered;
  return {
    changeNumber: facts.change?.changeNumber || trimmedNumber,
    isChangeFound: facts.change !== null,
    items: buildChangeReadiness(facts).filter((item) => !AUTHOR_ONLY_ITEM_IDS.has(item.id)),
    coachingChange: {
      number: facts.change?.changeNumber || trimmedNumber,
      creatorName: requester.name || facts.change?.ownerName || '',
      shortDescription: facts.textFields?.shortDescription ?? '',
    },
    requesterEmail: requester.email,
    facts: { change: facts.change, textFields: facts.textFields, plannedWindow: facts.plannedWindow, isProduction: facts.isProduction },
  };
}
