// coachingNote.ts — Turns the shared readiness checks into a plain-English note a Release Management reviewer sends to
// a change's creator: what is missing, why it matters, and what a good answer looks like. Pure — no reads, no writes.
//
// Custom (Art VII): no coaching text exists anywhere in Toolbox; the engine's reasons are written for the change's
// owner mid-build (and name Formula Card sections), so the creator-facing words live here, keyed by the engine's ids.

import type { ReadinessItem, ReadinessItemId } from '../../views/SnowHub/guided/changeReadiness.ts';

// ── Types ──

/** The words used to coach one readiness item, written for someone who has never seen a field name. */
export interface CoachingPhrase {
  /** A short name for the topic, used in "we couldn't check: …". */
  topic: string;
  missing: string;
  whyItMatters: string;
  goodExample: string;
}

/** The change the note is about, and who it is addressed to. */
export interface CoachingChange {
  number: string;
  creatorName: string;
  shortDescription: string;
}

/** One coached item: an item that needs action, in the engine's order. */
export interface CoachingItem extends Omit<CoachingPhrase, 'topic'> {
  itemId: ReadinessItemId;
}

/** Everything the note says, before it is turned into text. */
export interface CoachingNote {
  change: CoachingChange;
  isReady: boolean;
  items: CoachingItem[];
  notCheckedLabels: string[];
}

// ── Phrases ──

const UNFINISHED_TEXT = 'is empty, or still has details waiting to be confirmed';

/** Coaching words for every readiness item the engine can produce (a test enumerates the engine's ids). */
export const COACHING_PHRASES: Readonly<Record<ReadinessItemId, CoachingPhrase>> = {
  owner: { topic: 'who owns the change', missing: 'The change does not name an owner yet.', whyItMatters: 'Release Management needs one person to contact if anything goes wrong during the change.', goodExample: 'Name the person who will lead the work on the night, such as the lead developer.' },
  riskCheck: { topic: 'the risk check', missing: 'The risk check has not been run on this change, or it still found gaps.', whyItMatters: 'The risk check catches the usual reasons a change is sent back, before a reviewer has to.', goodExample: 'Run the risk check and fix what it lists until it says the change is ready.' },
  rcp: { topic: 'the restricted change period rules', missing: 'The change does not yet meet the extra rules for the restricted change period.', whyItMatters: 'During the restricted period, production changes need extra notice and approval so the business is not disrupted at a busy time.', goodExample: 'Give the required notice before the start date and attach the approval email to the change.' },
  outage: { topic: 'the planned outage', missing: 'No planned outage is recorded for this change.', whyItMatters: 'An outage record warns support teams and users that the service may be unavailable, so nobody is surprised.', goodExample: 'Add a planned outage with the same start and end time as the change.' },
  ctaskCi: { topic: 'what each task works on', missing: 'Some of the change\'s tasks name a different system than the change itself.', whyItMatters: 'Every task should name the same system so everyone knows exactly what is being touched.', goodExample: 'Set every task to the same application the change names, for example "Member Portal".' },
  ctaskBackout: { topic: 'the tasks\' undo plans', missing: 'At least one task that does the work has no plan for undoing it.', whyItMatters: 'If a step fails on the night, the team must know how to put things back quickly.', goodExample: 'Under the task, write "Redeploy the previous release (1.4.2) and confirm the login page loads."' },
  ctaskDates: { topic: 'the tasks\' dates', missing: 'Some tasks have no planned start and end time.', whyItMatters: 'Planned times show the order of the work and prove it fits inside the change window.', goodExample: 'Give each task a start and end inside the window, such as 8:00 pm to 8:30 pm.' },
  prbs: { topic: 'the linked problem records', missing: 'Problem records this change fixes are not linked to it yet.', whyItMatters: 'Linking them shows which known problems this change closes, so they can be followed to the end.', goodExample: 'Link each problem record named in the change\'s stories to this change.' },
  testEvidence: { topic: 'the test evidence', missing: 'No test evidence is attached to the change.', whyItMatters: 'Evidence shows the change was tested and passed before it reaches production.', goodExample: 'Attach screenshots or a test report showing the tests that passed in the test environment.' },
  formulaIdentity: { topic: 'what is changing', missing: `The summary of what is changing, and on which system, ${UNFINISHED_TEXT}.`, whyItMatters: 'Reviewers need to understand at a glance what is changing and where.', goodExample: '"Update the Member Portal login page to accept the new password rules."' },
  formulaBusinessNeed: { topic: 'why the change is needed', missing: `The reason for the change ${UNFINISHED_TEXT}.`, whyItMatters: 'Release Management weighs the risk of a change against its benefit, so the benefit must be clear.', goodExample: '"Members are locked out after three tries; this fix cuts calls to the help desk."' },
  formulaRisk: { topic: 'the risk and impact', missing: `What could go wrong, and who would be affected, ${UNFINISHED_TEXT}.`, whyItMatters: 'Knowing the impact helps reviewers decide when the change can safely happen.', goodExample: '"If this fails, members cannot log in for up to 15 minutes; we can undo it in 10 minutes."' },
  formulaSchedule: { topic: 'when the change happens', missing: 'The planned start and end are missing, or the end is not after the start.', whyItMatters: 'The time window tells everyone when to expect the work and when it must be finished.', goodExample: 'Start Saturday 8:00 pm, end Saturday 10:00 pm.' },
  formulaImplementation: { topic: 'the steps to make the change', missing: `The step-by-step plan for making the change ${UNFINISHED_TEXT}.`, whyItMatters: 'A clear plan lets anyone on the team carry out the change safely.', goodExample: '"1. Stop the service. 2. Deploy release 1.5.0. 3. Start the service. 4. Check the login page."' },
  formulaTesting: { topic: 'how the change was tested', missing: `How the change was tested, and what happened, ${UNFINISHED_TEXT}.`, whyItMatters: 'Reviewers need to see the change worked somewhere safe before it reaches production.', goodExample: '"Tested in the test environment on 10/14 — all 25 login tests passed."' },
  formulaBackout: { topic: 'how to undo the change', missing: `The plan for undoing the change ${UNFINISHED_TEXT}.`, whyItMatters: 'If something goes wrong, the team needs to know how to put things back fast.', goodExample: '"Redeploy release 1.4.2 and confirm the login page loads."' },
};

// ── Note ──

/**
 * Builds the coaching note from the checklist: one coached item per item that needs action, in the engine's order;
 * items that could not be checked are only named, never coached, because the creator may have done them already.
 */
export function buildCoachingNote(items: readonly ReadinessItem[], change: CoachingChange): CoachingNote {
  const coachingItems = items
    .filter((item) => item.state === 'needsAction')
    .map((item): CoachingItem => {
      const { missing, whyItMatters, goodExample } = COACHING_PHRASES[item.id];
      return { itemId: item.id, missing, whyItMatters, goodExample };
    });
  const notCheckedLabels = items.filter((item) => item.state === 'couldNotCheck').map((item) => COACHING_PHRASES[item.id].topic);
  return { change, isReady: coachingItems.length === 0 && notCheckedLabels.length === 0, items: coachingItems, notCheckedLabels };
}

/** "CHG0012345", or "CHG 12345" when the number was typed without its prefix. */
function formatChangeName(changeNumber: string): string {
  const trimmedNumber = changeNumber.trim();
  return /^CHG/i.test(trimmedNumber) ? trimmedNumber : `CHG ${trimmedNumber}`;
}

/** The opening paragraph: what was reviewed and what the reviewer found. */
function renderOpening(note: CoachingNote): string {
  const summaryText = note.change.shortDescription.trim() ? ` ("${note.change.shortDescription.trim()}")` : '';
  const changeText = `${formatChangeName(note.change.number)}${summaryText}`;
  if (note.isReady) return `I reviewed ${changeText} and it is ready for approval — nothing needs changing. Thank you!`;
  if (note.items.length === 0) return `I reviewed ${changeText} and found nothing that needs changing.`;
  return `I reviewed ${changeText} before approval. A few things need your attention:`;
}

/** The note as text: a greeting by name, the items as a numbered list, and a sign-off left for the reviewer. */
export function renderCoachingNoteText(note: CoachingNote): string {
  const creatorName = note.change.creatorName.trim();
  const paragraphs = [creatorName ? `Hi ${creatorName},` : 'Hello,', renderOpening(note)];
  if (note.items.length > 0) {
    paragraphs.push(note.items
      .map((coachingItem, index) => `${index + 1}. ${coachingItem.missing} ${coachingItem.whyItMatters} For example: ${coachingItem.goodExample}`)
      .join('\n\n'));
  }
  if (note.notCheckedLabels.length > 0) {
    paragraphs.push(`We couldn't check: ${note.notCheckedLabels.join('; ')}. Please make sure these are in place too.`);
  }
  paragraphs.push('Thanks,\n');
  return paragraphs.join('\n\n');
}

/** A mailto link to the requester (blank when unknown) with the agreed subject and the note as the body. */
export function buildCoachingMailto(changeNumber: string, noteText: string, requesterEmail: string): string {
  const subjectText = `${formatChangeName(changeNumber)} — changes needed before approval`;
  // encodeURIComponent (not URLSearchParams) so spaces become %20, which every mail client reads as a space.
  return `mailto:${encodeURIComponent(requesterEmail.trim())}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(noteText)}`;
}
