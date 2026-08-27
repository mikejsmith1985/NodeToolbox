// checkInMessage.ts — Turning a check-in reply into a message somebody can actually send.
//
// Everything else in this feature produces data. This produces the thing that gets pasted into a chat
// window, and a chat window is an unusually hostile target: no tables, no headings, no styling that
// survives, and a reader who will decide in two seconds whether to read it or reply "sure, will do".
//
// So the format is deliberately plain:
//
//   - PLAIN TEXT, because Markdown renders in some chat clients and shows as raw asterisks in others.
//     A message that might arrive looking broken is worse than one that never tried to look good.
//   - THE ITEMS THAT NEED SOMETHING COME FIRST, each as its own short block. Anything that looks fine
//     is collapsed into ONE closing line naming the keys — enough to show it was looked at, short
//     enough not to bury the two questions that matter.
//   - THE ISSUE KEY LEADS EVERY LINE, because that is what the reader searches for when they go to
//     answer, and a question they cannot tie to a ticket is a question they have to ask back about.
//
// Pure: no clipboard, no DOM, no clock.

import type { CheckInIssue } from './checkInModel.ts';
import type { CheckInItem, CheckInReply } from './checkInPrompt.ts';

/** The line used when the assistant offered no opening of its own. */
const DEFAULT_OPENING = 'Quick check-in on where these are at when you get a moment:';

/** How an item that needs raising is written out. */
function renderItemBlock(item: CheckInItem, issue: CheckInIssue | undefined): string {
  const headline = issue === undefined ? item.issueKey : `${item.issueKey} — ${issue.summary}`;
  const lines = [headline];

  if (item.observation !== '') {
    lines.push(`  ${item.observation}`);
  }
  if (item.question !== '') {
    lines.push(`  ${item.question}`);
  }
  if (item.suggestion !== '') {
    lines.push(`  Might help: ${item.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Renders the message to send.
 *
 * Items are written in the order the reply gave them, which follows the order the plate was sent in —
 * overdue first, then longest-sitting. The reader meets the most pressing thing first without anyone
 * having to say it is the most pressing thing.
 */
export function buildCheckInMessage(
  reply: CheckInReply,
  issues: readonly CheckInIssue[],
): string {
  const issueByKey = new Map(issues.map((issue) => [issue.issueKey, issue]));
  const itemsNeedingAttention = reply.items.filter((item) => !item.looksFine);
  const itemsThatLookFine = reply.items.filter((item) => item.looksFine);

  const sections: string[] = [reply.opening === '' ? DEFAULT_OPENING : reply.opening];

  itemsNeedingAttention.forEach((item) => {
    sections.push(renderItemBlock(item, issueByKey.get(item.issueKey)));
  });

  if (itemsNeedingAttention.length === 0) {
    // Worth saying outright. A message that lists nothing reads as a mistake, and the reader will ask
    // what it was supposed to contain.
    sections.push('Nothing looks stuck from here — just confirming that matches your read.');
  }

  // One line, not a block each: enough to show they were looked at, short enough not to bury the rest.
  if (itemsThatLookFine.length > 0) {
    const fineKeys = itemsThatLookFine.map((item) => item.issueKey).join(', ');
    sections.push(`Everything else looks on track from here (${fineKeys}) — shout if not.`);
  }

  return sections.join('\n\n');
}

/**
 * A one-line summary of what the message will contain, shown beside it before it is sent.
 *
 * The sender is about to put this in front of a colleague, and knowing "3 questions across 11 items"
 * before reading it is what tells them whether the tone is right.
 */
export function describeCheckInMessage(reply: CheckInReply): string {
  const questionCount = reply.items.filter((item) => !item.looksFine).length;
  const fineCount = reply.items.length - questionCount;

  if (reply.items.length === 0) {
    return 'Nothing to send yet — paste the reply above.';
  }

  const questionLabel = questionCount === 1 ? '1 item to ask about' : `${questionCount} items to ask about`;
  return fineCount === 0
    ? questionLabel
    : `${questionLabel}, ${fineCount} noted as on track`;
}
